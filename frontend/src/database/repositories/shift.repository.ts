import type { SqlDriver } from "../connection";
import { uuidv7 } from "../../utils/uuid7";
import { toDecimal, formatFixed4, Decimal } from "../../utils/decimal";
import { parseSplitBreakdown } from "./invoice.repository";
import { recordRateCorrection } from "./exchange.repository";

export interface ShiftEntity {
  id: string;
  terminalId: string;
  cashierName: string;
  openedAt: number;
  closedAt: number | null;
  exchangeRateApplied: string;
  initialCashUsd: string;
  initialCashVes: string;
  expectedCashUsd: string | null;
  expectedCashVes: string | null;
  declaredCashUsd: string | null;
  declaredCashVes: string | null;
  differenceUsd: string | null;
  differenceVes: string | null;
  status: "OPEN" | "CLOSED";
}

export interface CashMovementEntity {
  id: string;
  shiftId: string;
  terminalId: string;
  movementType: "DROP" | "INFLOW";
  currency: "USD" | "VES";
  amount: string;
  reason: string;
  cashierName: string;
  createdAt: number;
}

export interface ShiftCashAudit {
  shiftId: string;
  terminalId: string;
  cashierName: string;
  status: "OPEN" | "CLOSED";
  exchangeRateApplied: string;
  initialCashUsd: string;
  initialCashVes: string;
  salesCashUsd: string;
  salesCashVes: string;
  dropsCashUsd: string;
  dropsCashVes: string;
  inflowsCashUsd: string;
  inflowsCashVes: string;
  salesPagoMovilVes: string;
  salesCardVes: string;
  totalSalesUsd: string;
  totalSalesVes: string;
  expectedCashUsd: string;
  expectedCashVes: string;
  invoiceCount: number;
}

export interface CierreZResult {
  shift: ShiftEntity;
  declaredCashUsd: string;
  declaredCashVes: string;
  expectedCashUsd: string;
  expectedCashVes: string;
  differenceUsd: string;
  differenceVes: string;
  isSquare: boolean;
}

export function openShift(
  db: SqlDriver,
  args: {
    terminalId: string;
    cashierName: string;
    exchangeRateApplied: string;
    initialCashUsd?: string;
    initialCashVes?: string;
  },
  now: number = Date.now(),
): string {
  const existing = getOpenShift(db, args.terminalId);
  if (existing) {
    throw new Error(`Ya existe un turno abierto para la terminal ${args.terminalId}`);
  }

  const id = uuidv7(now);
  const initialUsd = toDecimal(args.initialCashUsd ?? "0", "initialCashUsd").toFixed(4);
  const initialVes = toDecimal(args.initialCashVes ?? "0", "initialCashVes").toFixed(4);
  const rate = toDecimal(args.exchangeRateApplied, "exchangeRateApplied").toFixed(4);

  db.run(
    `INSERT INTO cash_shifts (
      id, terminal_id, cashier_name, opened_at, exchange_rate_applied,
      initial_cash_usd, initial_cash_ves, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN')`,
    [id, args.terminalId, args.cashierName.trim(), now, rate, initialUsd, initialVes],
  );
  return id;
}

export function getOpenShift(db: SqlDriver, terminalId: string): ShiftEntity | undefined {
  const [row] = db.all<{
    id: string;
    terminal_id: string;
    cashier_name: string;
    opened_at: number;
    closed_at: number | null;
    exchange_rate_applied: string;
    initial_cash_usd: string;
    initial_cash_ves: string;
    expected_cash_usd: string | null;
    expected_cash_ves: string | null;
    declared_cash_usd: string | null;
    declared_cash_ves: string | null;
    difference_usd: string | null;
    difference_ves: string | null;
    status: "OPEN" | "CLOSED";
  }>(
    "SELECT * FROM cash_shifts WHERE terminal_id = ? AND status = 'OPEN' ORDER BY opened_at DESC LIMIT 1",
    [terminalId],
  );
  return row ? mapShiftRow(row) : undefined;
}

export function getShiftById(db: SqlDriver, shiftId: string): ShiftEntity | undefined {
  const [row] = db.all<{
    id: string;
    terminal_id: string;
    cashier_name: string;
    opened_at: number;
    closed_at: number | null;
    exchange_rate_applied: string;
    initial_cash_usd: string;
    initial_cash_ves: string;
    expected_cash_usd: string | null;
    expected_cash_ves: string | null;
    declared_cash_usd: string | null;
    declared_cash_ves: string | null;
    difference_usd: string | null;
    difference_ves: string | null;
    status: "OPEN" | "CLOSED";
  }>("SELECT * FROM cash_shifts WHERE id = ?", [shiftId]);
  return row ? mapShiftRow(row) : undefined;
}

function mapShiftRow(row: {
  id: string;
  terminal_id: string;
  cashier_name: string;
  opened_at: number;
  closed_at: number | null;
  exchange_rate_applied: string;
  initial_cash_usd: string;
  initial_cash_ves: string;
  expected_cash_usd: string | null;
  expected_cash_ves: string | null;
  declared_cash_usd: string | null;
  declared_cash_ves: string | null;
  difference_usd: string | null;
  difference_ves: string | null;
  status: "OPEN" | "CLOSED";
}): ShiftEntity {
  return {
    id: row.id,
    terminalId: row.terminal_id,
    cashierName: row.cashier_name,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    exchangeRateApplied: row.exchange_rate_applied,
    initialCashUsd: row.initial_cash_usd,
    initialCashVes: row.initial_cash_ves,
    expectedCashUsd: row.expected_cash_usd,
    expectedCashVes: row.expected_cash_ves,
    declaredCashUsd: row.declared_cash_usd,
    declaredCashVes: row.declared_cash_ves,
    differenceUsd: row.difference_usd,
    differenceVes: row.difference_ves,
    status: row.status,
  };
}

/**
 * Corrige la tasa de un turno ABIERTO que todavía no tiene ventas (auditoría §F3).
 * Con ventas emitidas se rechaza: esas facturas ya congelaron su tasa en
 * `invoices.exchange_rate`, y lo correcto es cerrar el turno (Z) y abrir otro con la
 * tasa corregida. Toda corrección exige motivo y queda en `exchange_rate_corrections`.
 */
export function setShiftExchangeRate(
  db: SqlDriver,
  args: { shiftId: string; rate: string; reason: string; terminalId?: string },
  now: number = Date.now(),
): ShiftEntity {
  const reason = args.reason.trim();
  if (!reason) {
    throw new Error("El motivo de la corrección de tasa es obligatorio para la auditoría.");
  }

  const newRate = toDecimal(args.rate, "rate");
  if (newRate.lte(0)) throw new Error("La tasa de cambio debe ser mayor a cero");

  const shift = getShiftById(db, args.shiftId);
  if (!shift) throw new Error(`Turno no encontrado: ${args.shiftId}`);
  if (shift.status !== "OPEN") {
    throw new Error(`El turno ${shift.id} está cerrado: su tasa es definitiva.`);
  }

  const [anySale] = db.all<{ id: string }>(
    "SELECT id FROM invoices WHERE shift_id = ? AND (status IS NULL OR status != 'VOID') LIMIT 1",
    [args.shiftId],
  );
  if (anySale) {
    throw new Error(
      "El turno ya tiene ventas con su tasa congelada. Cierra el turno (Z) y abre uno nuevo con la tasa corregida.",
    );
  }

  const previous = toDecimal(shift.exchangeRateApplied, "exchangeRateApplied").toFixed(4);
  const formatted = newRate.toFixed(4);
  if (previous === formatted) {
    throw new Error("La tasa indicada ya es la tasa vigente del turno.");
  }

  db.run("UPDATE cash_shifts SET exchange_rate_applied = ? WHERE id = ?", [
    formatted,
    args.shiftId,
  ]);

  recordRateCorrection(
    db,
    {
      rateDate: new Date(shift.openedAt).toISOString().split("T")[0]!,
      context: "SHIFT",
      contextId: args.shiftId,
      previousRate: previous,
      newRate: formatted,
      reason,
      source: "SHIFT_OVERRIDE",
      terminalId: args.terminalId ?? shift.terminalId,
    },
    now,
  );

  return getShiftById(db, args.shiftId)!;
}

/**
 * Calcula la auditoría y recaudación acumulada del turno discriminada por moneda.
 */
export function calculateShiftAuditTotals(db: SqlDriver, shiftId: string): ShiftCashAudit {
  const shift = getShiftById(db, shiftId);
  if (!shift) {
    throw new Error(`Turno no encontrado: ${shiftId}`);
  }

  const invoices = db.all<{
    payment_method: string;
    payment_breakdown: string | null;
    total_usd: string;
    total_ves: string;
  }>("SELECT payment_method, payment_breakdown, total_usd, total_ves FROM invoices WHERE shift_id = ? AND (status IS NULL OR status != 'VOID')", [
    shiftId,
  ]);

  let salesCashUsd = new Decimal("0");
  let salesCashVes = new Decimal("0");
  let salesPagoMovilVes = new Decimal("0");
  let salesCardVes = new Decimal("0");
  let totalSalesUsd = new Decimal("0");
  let totalSalesVes = new Decimal("0");

  for (const inv of invoices) {
    totalSalesUsd = totalSalesUsd.plus(toDecimal(inv.total_usd));
    totalSalesVes = totalSalesVes.plus(toDecimal(inv.total_ves));

    if (inv.payment_method === "CASH_USD") {
      salesCashUsd = salesCashUsd.plus(toDecimal(inv.total_usd));
    } else if (inv.payment_method === "CASH_VES") {
      salesCashVes = salesCashVes.plus(toDecimal(inv.total_ves));
    } else if (inv.payment_method === "PAGO_MOVIL") {
      salesPagoMovilVes = salesPagoMovilVes.plus(toDecimal(inv.total_ves));
    } else if (inv.payment_method === "CARD_VES") {
      salesCardVes = salesCardVes.plus(toDecimal(inv.total_ves));
    } else if (inv.payment_method === "SPLIT") {
      const bd = parseSplitBreakdown(inv.payment_breakdown);
      if (bd) {
        salesCashUsd = salesCashUsd.plus(bd.cashUsd);
        salesCashVes = salesCashVes.plus(bd.cashVes);
        salesPagoMovilVes = salesPagoMovilVes.plus(bd.pagoMovilVes);
        salesCardVes = salesCardVes.plus(bd.cardVes);
      }
    }
  }

  // Movimientos de gaveta del turno (Sangrías y Entradas extraordinarias)
  let dropsCashUsd = new Decimal("0");
  let dropsCashVes = new Decimal("0");
  let inflowsCashUsd = new Decimal("0");
  let inflowsCashVes = new Decimal("0");

  const movements = listCashMovements(db, shiftId);
  for (const mov of movements) {
    const amt = toDecimal(mov.amount);
    if (mov.currency === "USD") {
      if (mov.movementType === "DROP") dropsCashUsd = dropsCashUsd.plus(amt);
      else if (mov.movementType === "INFLOW") inflowsCashUsd = inflowsCashUsd.plus(amt);
    } else if (mov.currency === "VES") {
      if (mov.movementType === "DROP") dropsCashVes = dropsCashVes.plus(amt);
      else if (mov.movementType === "INFLOW") inflowsCashVes = inflowsCashVes.plus(amt);
    }
  }

  const expectedCashUsd = toDecimal(shift.initialCashUsd)
    .plus(salesCashUsd)
    .plus(inflowsCashUsd)
    .minus(dropsCashUsd)
    .toFixed(4);

  const expectedCashVes = toDecimal(shift.initialCashVes)
    .plus(salesCashVes)
    .plus(inflowsCashVes)
    .minus(dropsCashVes)
    .toFixed(4);

  return {
    shiftId: shift.id,
    terminalId: shift.terminalId,
    cashierName: shift.cashierName,
    status: shift.status,
    exchangeRateApplied: shift.exchangeRateApplied,
    initialCashUsd: shift.initialCashUsd,
    initialCashVes: shift.initialCashVes,
    salesCashUsd: salesCashUsd.toFixed(4),
    salesCashVes: salesCashVes.toFixed(4),
    dropsCashUsd: dropsCashUsd.toFixed(4),
    dropsCashVes: dropsCashVes.toFixed(4),
    inflowsCashUsd: inflowsCashUsd.toFixed(4),
    inflowsCashVes: inflowsCashVes.toFixed(4),
    salesPagoMovilVes: salesPagoMovilVes.toFixed(4),
    salesCardVes: salesCardVes.toFixed(4),
    totalSalesUsd: totalSalesUsd.toFixed(4),
    totalSalesVes: totalSalesVes.toFixed(4),
    expectedCashUsd,
    expectedCashVes,
    invoiceCount: invoices.length,
  };
}

/**
 * Arqueo X (Corte Parcial Informativo):
 * Consulta los totales acumulados y efectivo esperado sin cerrar ni bloquear el turno.
 */
export function performArqueoX(db: SqlDriver, shiftId: string): ShiftCashAudit {
  return calculateShiftAuditTotals(db, shiftId);
}

/**
 * Cierre Z (Cierre Ciego Definitivo):
 * Recibe el efectivo físicamente contado por el cajero (USD y VES independientes),
 * calcula los descuadres contra lo esperado por sistema y bloquea permanentemente el turno.
 */
export function performCierreZ(
  db: SqlDriver,
  args: {
    shiftId: string;
    declaredCashUsd: string;
    declaredCashVes: string;
  },
  now: number = Date.now(),
): CierreZResult {
  return db.transaction(() => {
    const shift = getShiftById(db, args.shiftId);
    if (!shift) {
      throw new Error(`Turno no encontrado: ${args.shiftId}`);
    }
    if (shift.status === "CLOSED") {
      throw new Error(`El turno ${args.shiftId} ya se encuentra cerrado.`);
    }

    const declaredUsd = toDecimal(args.declaredCashUsd, "Efectivo USD declarado");
    const declaredVes = toDecimal(args.declaredCashVes, "Efectivo VES declarado");
    if (declaredUsd.isNegative() || declaredVes.isNegative()) {
      throw new Error("Los montos de efectivo declarado no pueden ser negativos");
    }

    const audit = calculateShiftAuditTotals(db, args.shiftId);
    const expectedUsd = toDecimal(audit.expectedCashUsd);
    const expectedVes = toDecimal(audit.expectedCashVes);

    const diffUsd = declaredUsd.minus(expectedUsd).toFixed(4);
    const diffVes = declaredVes.minus(expectedVes).toFixed(4);
    const declaredUsdStr = declaredUsd.toFixed(4);
    const declaredVesStr = declaredVes.toFixed(4);

    db.run(
      `UPDATE cash_shifts SET
        closed_at = ?,
        status = 'CLOSED',
        expected_cash_usd = ?,
        expected_cash_ves = ?,
        declared_cash_usd = ?,
        declared_cash_ves = ?,
        difference_usd = ?,
        difference_ves = ?
      WHERE id = ?`,
      [
        now,
        audit.expectedCashUsd,
        audit.expectedCashVes,
        declaredUsdStr,
        declaredVesStr,
        diffUsd,
        diffVes,
        args.shiftId,
      ],
    );

    const updatedShift = getShiftById(db, args.shiftId)!;

    const isSquare =
      toDecimal(diffUsd).isZero() && toDecimal(diffVes).isZero();

    return {
      shift: updatedShift,
      declaredCashUsd: declaredUsdStr,
      declaredCashVes: declaredVesStr,
      expectedCashUsd: audit.expectedCashUsd,
      expectedCashVes: audit.expectedCashVes,
      differenceUsd: diffUsd,
      differenceVes: diffVes,
      isSquare,
    };
  });
}

/**
 * Registra un movimiento de gaveta (sangría/retiro por seguridad o entrada de efectivo).
 */
export function addCashMovement(
  db: SqlDriver,
  args: {
    shiftId: string;
    terminalId: string;
    movementType: "DROP" | "INFLOW";
    currency: "USD" | "VES";
    amount: string;
    reason: string;
    cashierName: string;
  },
  now: number = Date.now(),
): CashMovementEntity {
  const shift = getShiftById(db, args.shiftId);
  if (!shift) {
    throw new Error(`Turno no encontrado: ${args.shiftId}`);
  }
  if (shift.status !== "OPEN") {
    throw new Error("No se pueden registrar movimientos en un turno cerrado");
  }

  const amt = toDecimal(args.amount, "Monto de movimiento de caja");
  if (amt.lte(0)) {
    throw new Error("El monto del movimiento debe ser mayor a cero");
  }

  const cleanReason = args.reason.trim();
  if (!cleanReason) {
    throw new Error("El motivo del movimiento de caja es obligatorio para auditoría");
  }

  const id = uuidv7(now);
  const formattedAmount = amt.toFixed(4);

  db.run(
    `INSERT INTO cash_movements (
      id, shift_id, terminal_id, movement_type, currency, amount, reason, cashier_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      args.shiftId,
      args.terminalId,
      args.movementType,
      args.currency,
      formattedAmount,
      cleanReason,
      args.cashierName.trim(),
      now,
    ],
  );

  return {
    id,
    shiftId: args.shiftId,
    terminalId: args.terminalId,
    movementType: args.movementType,
    currency: args.currency,
    amount: formattedAmount,
    reason: cleanReason,
    cashierName: args.cashierName.trim(),
    createdAt: now,
  };
}

/**
 * Retorna todos los movimientos de gaveta registrados para el turno en orden cronológico.
 */
export function listCashMovements(db: SqlDriver, shiftId: string): CashMovementEntity[] {
  const rows = db.all<{
    id: string;
    shift_id: string;
    terminal_id: string;
    movement_type: "DROP" | "INFLOW";
    currency: "USD" | "VES";
    amount: string;
    reason: string;
    cashier_name: string;
    created_at: number;
  }>("SELECT * FROM cash_movements WHERE shift_id = ? ORDER BY created_at ASC", [shiftId]);

  return rows.map((r) => ({
    id: r.id,
    shiftId: r.shift_id,
    terminalId: r.terminal_id,
    movementType: r.movement_type,
    currency: r.currency,
    amount: r.amount,
    reason: r.reason,
    cashierName: r.cashier_name,
    createdAt: r.created_at,
  }));
}

/**
 * Consulta el histórico de turnos cerrados (Cierres Z anteriores).
 */
export function listClosedShifts(
  db: SqlDriver,
  terminalId?: string,
  limit: number = 20,
): ShiftEntity[] {
  const query = terminalId
    ? "SELECT * FROM cash_shifts WHERE status = 'CLOSED' AND terminal_id = ? ORDER BY closed_at DESC LIMIT ?"
    : "SELECT * FROM cash_shifts WHERE status = 'CLOSED' ORDER BY closed_at DESC LIMIT ?";
  const params = terminalId ? [terminalId, limit] : [limit];
  const rows = db.all<{
    id: string;
    terminal_id: string;
    cashier_name: string;
    opened_at: number;
    closed_at: number | null;
    exchange_rate_applied: string;
    initial_cash_usd: string;
    initial_cash_ves: string;
    expected_cash_usd: string | null;
    expected_cash_ves: string | null;
    declared_cash_usd: string | null;
    declared_cash_ves: string | null;
    difference_usd: string | null;
    difference_ves: string | null;
    status: "OPEN" | "CLOSED";
  }>(query, params);

  return rows.map(mapShiftRow);
}
