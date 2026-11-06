import type { SqlDriver } from "../connection";
import { uuidv7 } from "../../utils/uuid7";
import { toDecimal, formatFixed4, Decimal, convertUsdToVes } from "../../utils/decimal";
import { addStockMovement, getCurrentStock, productTracksInventory } from "./product.repository";
import { LicenseValidatorService } from "../../services/license-validator.service";
import { P2pSyncService } from "../../services/p2p-sync.service";

export interface InvoiceItemInput {
  productId: string;
  quantity: string;
  unitPriceUsd: string;
  unitPriceVes?: string;
  lineTotalUsd?: string;
  lineTotalVes?: string;
  taxRate?: string;
  productName?: string;
  /**
   * Costo de reposición a congelar en la línea. Si se omite se toma `products.cost_usd`
   * del momento del cobro; nunca se recalcula después (auditoría §F1).
   */
  unitCostUsd?: string;
  productSku?: string;
  productUnit?: string;
  isExempt?: boolean;
}

export type PaymentMethod =
  | "CASH_USD"
  | "CASH_VES"
  | "PAGO_MOVIL"
  | "CARD_VES"
  | "SPLIT";

export interface SplitBreakdownAmounts {
  cashUsd: Decimal;
  cashVes: Decimal;
  pagoMovilVes: Decimal;
  cardVes: Decimal;
}

/**
 * Única fuente de verdad para leer payment_breakdown de facturas SPLIT.
 * Acepta ambas formas: la del POS ({cash_usd, cash_ves, pago_movil, card_ves})
 * y la de createInvoice vía payments ([{method, amountUsd, amountVes, currency}]).
 * Valores negativos o inválidos se fijan en cero; retorna null si el JSON no parsea.
 */
export function parseSplitBreakdown(json: string | null | undefined): SplitBreakdownAmounts | null {
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  const amt = (v: unknown): Decimal => {
    if (typeof v !== "string" && typeof v !== "number") return new Decimal(0);
    try {
      const d = toDecimal(String(v));
      return d.gt(0) ? d : new Decimal(0);
    } catch {
      return new Decimal(0);
    }
  };

  const out: SplitBreakdownAmounts = {
    cashUsd: new Decimal(0),
    cashVes: new Decimal(0),
    pagoMovilVes: new Decimal(0),
    cardVes: new Decimal(0),
  };

  if (Array.isArray(parsed)) {
    for (const p of parsed as Array<Record<string, unknown> | null>) {
      if (!p || typeof p !== "object") continue;
      const method = p.method;
      if (method === "CASH_USD") out.cashUsd = out.cashUsd.plus(amt(p.amountUsd));
      else if (method === "CASH_VES") out.cashVes = out.cashVes.plus(amt(p.amountVes));
      else if (method === "PAGO_MOVIL") out.pagoMovilVes = out.pagoMovilVes.plus(amt(p.amountVes));
      else if (method === "CARD_VES") out.cardVes = out.cardVes.plus(amt(p.amountVes));
    }
    return out;
  }

  if (parsed && typeof parsed === "object") {
    const o = parsed as Record<string, unknown>;
    out.cashUsd = amt(o.cash_usd);
    out.cashVes = amt(o.cash_ves);
    out.pagoMovilVes = amt(o.pago_movil);
    out.cardVes = amt(o.card_ves);
    return out;
  }

  return null;
}

export interface CreateInvoiceInput {
  shiftId: string;
  terminalId: string;
  invoiceNumber?: string;
  exchangeRate: string;
  subtotalUsd?: string;
  taxUsd?: string;
  totalUsd?: string;
  subtotalVes?: string;
  taxVes?: string;
  totalVes?: string;
  paymentMethod?: PaymentMethod | string;
  paymentBreakdown?: string | null;
  items: InvoiceItemInput[];
  payments?: {
    method: string;
    amountUsd: string;
    amountVes: string;
    currency: string;
  }[];
}

export interface InvoiceItemEntity {
  id: string;
  invoiceId: string;
  productId: string;
  quantity: string;
  unitPriceUsd: string;
  lineTotalUsd: string;
  unitPriceVes: string;
  lineTotalVes: string;
  taxRate: string;
  /** Costo de reposición congelado al cobrar. `null` = línea anterior a la migración. */
  unitCostUsd: string | null;
  /** Nombre/SKU/unidad del producto al cobrar. `null` = línea anterior a la migración. */
  productName: string | null;
  productSku: string | null;
  productUnit: string | null;
}

export interface InvoiceEntity {
  id: string;
  shiftId: string;
  terminalId: string;
  invoiceNumber: string;
  exchangeRate: string;
  subtotalUsd: string;
  taxUsd: string;
  totalUsd: string;
  subtotalVes: string;
  taxVes: string;
  totalVes: string;
  paymentMethod: PaymentMethod;
  paymentBreakdown: string | null;
  status: "COMPLETED" | "VOID";
  voidedAt: number | null;
  voidReason: string | null;
  createdAt: number;
  items: InvoiceItemEntity[];
}

/**
 * Número máximo ya usado por la terminal mirando las facturas existentes.
 * Solo sirve para sembrar la secuencia al migrar; no es la fuente de emisión.
 */
function maxInvoiceSeqFromRows(db: SqlDriver, terminalId: string): number {
  const [row] = db.all<{ last_seq: number | null }>(
    `SELECT MAX(CAST(SUBSTR(invoice_number, INSTR(invoice_number, '-') + 1) AS INTEGER)) AS last_seq
     FROM invoices
     WHERE terminal_id = ?`,
    [terminalId],
  );
  return Number(row?.last_seq ?? 0) || 0;
}

function currentSequenceNumber(db: SqlDriver, terminalId: string): number {
  const [row] = db.all<{ last_number: number | null }>(
    "SELECT last_number FROM invoice_sequences WHERE terminal_id = ?",
    [terminalId],
  );
  return Number(row?.last_number ?? 0) || 0;
}

const formatInvoiceNumber = (terminalId: string, seq: number): string => {
  const cleanTerm = terminalId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return `${cleanTerm}-${String(seq).padStart(6, "0")}`;
};

/**
 * Siguiente consecutivo de la terminal SIN consumirlo: ej. C01-000001. Útil para vistas
 * previas y auditoría. La emisión usa `allocateInvoiceNumber`, que avanza la secuencia
 * (auditoría §F5: borrar físicamente la factura más alta no libera su número).
 */
export function generateNextInvoiceNumber(db: SqlDriver, terminalId: string): string {
  const seq =
    Math.max(currentSequenceNumber(db, terminalId), maxInvoiceSeqFromRows(db, terminalId)) + 1;
  return formatInvoiceNumber(terminalId, seq);
}

/**
 * Reserva el siguiente consecutivo. Debe correr dentro de la misma transacción de la
 * emisión: si la factura no se concreta, el `ROLLBACK` restaura la secuencia y el número
 * no se quema ni se duplica.
 */
export function allocateInvoiceNumber(db: SqlDriver, terminalId: string, now: number): string {
  // Al migrar una base existente la secuencia debe conocer su propio máximo histórico.
  db.run(
    `INSERT INTO invoice_sequences (terminal_id, last_number, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(terminal_id) DO UPDATE SET
       last_number = MAX(invoice_sequences.last_number, excluded.last_number),
       updated_at = excluded.updated_at`,
    [terminalId, maxInvoiceSeqFromRows(db, terminalId), now],
  );

  db.run(
    "UPDATE invoice_sequences SET last_number = last_number + 1, updated_at = ? WHERE terminal_id = ?",
    [now, terminalId],
  );

  return formatInvoiceNumber(terminalId, currentSequenceNumber(db, terminalId));
}

/**
 * Emite una venta con inmutabilidad cambiaria permanente y descuento atómico de stock.
 */
export function createInvoice(
  db: SqlDriver,
  input: CreateInvoiceInput,
  now: number = Date.now(),
): string {
  if (!input.items || input.items.length === 0) {
    throw new Error("No se puede emitir una factura sin items");
  }

  // 1. Guardia de reloj monótono y estado de licencia (previo a la transacción para persistir TAMPERED si hay fraude)
  const [lic] = db.all<{ status: string }>(
    "SELECT status FROM license_state WHERE id = 'current_license'",
  );
  if (lic) {
    if (lic.status === "TAMPERED" || lic.status === "EXPIRED") {
      throw new Error(`Operación de cobro bloqueada: licencia ${lic.status.toLowerCase()}`);
    }
    const clock = LicenseValidatorService.verifyMonotonicClock(db, now);
    if (!clock.valid) {
      throw new Error("Operación de cobro bloqueada: el reloj del dispositivo fue atrasado.");
    }
  }

  return db.transaction(() => {
    // 2. Validar que el turno exista, esté ABIERTO y que la tasa sea la del turno
    const [shift] = db.all<{ status: string; exchange_rate_applied?: string }>(
      "SELECT status, exchange_rate_applied FROM cash_shifts WHERE id = ?",
      [input.shiftId],
    );
    if (!shift) {
      throw new Error(`Turno no encontrado: ${input.shiftId}`);
    }
    if (shift.status !== "OPEN") {
      throw new Error(`El turno ${input.shiftId} está cerrado. No se pueden emitir facturas.`);
    }

    const invoiceId = uuidv7(now);
    const invoiceNumber =
      input.invoiceNumber ?? allocateInvoiceNumber(db, input.terminalId, now);
    const rate = toDecimal(input.exchangeRate, "Tasa de cambio");
    if (rate.lte(0)) throw new Error("La tasa de cambio debe ser mayor a cero");

    // Una tasa por turno: la del día se fija al abrir y no puede cambiar dentro del mismo
    // turno, porque el arqueo Z cuadra Bs. de una sola conversión (auditoría §F3).
    // Corregirla exige cerrar el turno o, si aún no hay ventas, `setShiftExchangeRate`.
    if (shift.exchange_rate_applied !== undefined && shift.exchange_rate_applied !== null) {
      const shiftRate = toDecimal(shift.exchange_rate_applied, "exchange_rate_applied").toFixed(4);
      if (rate.toFixed(4) !== shiftRate) {
        throw new Error(
          `La tasa del ticket (${rate.toFixed(4)}) no coincide con la tasa fijada en el turno (${shiftRate}). ` +
            "Si la tasa del día está mal, corrígela con 'setShiftExchangeRate' (turno sin ventas) o cierra el turno (Z) y abre uno nuevo.",
        );
      }
    }

    // 2. Calcular o validar sumatorias monetarias con Decimal exacto
    let computedSubtotalUsd = new Decimal("0");
    let computedSubtotalVes = new Decimal("0");
    let computedTaxUsd = new Decimal("0");

    for (const it of input.items) {
      const q = toDecimal(it.quantity, "Cantidad item");
      if (q.lte(0)) throw new Error("La cantidad vendida debe ser mayor a cero");
      const unitUsd = toDecimal(it.unitPriceUsd, "Precio unitario USD");
      const lineUsd = q.times(unitUsd);
      const lineVes = convertUsdToVes(lineUsd, rate);

      computedSubtotalUsd = computedSubtotalUsd.plus(lineUsd);
      computedSubtotalVes = computedSubtotalVes.plus(lineVes);

      if (it.taxRate && toDecimal(it.taxRate).gt(0)) {
        computedTaxUsd = computedTaxUsd.plus(lineUsd.times(toDecimal(it.taxRate)));
      }
    }

    const subtotalUsdStr = input.subtotalUsd
      ? formatFixed4(input.subtotalUsd)
      : computedSubtotalUsd.toFixed(4);

    const taxUsdStr = input.taxUsd
      ? formatFixed4(input.taxUsd)
      : computedTaxUsd.toFixed(4);

    const totalUsdStr = input.totalUsd
      ? formatFixed4(input.totalUsd)
      : toDecimal(subtotalUsdStr).plus(toDecimal(taxUsdStr)).toFixed(4);

    const subtotalVesStr = input.subtotalVes
      ? formatFixed4(input.subtotalVes)
      : computedSubtotalVes.toFixed(4);

    const taxVesStr = input.taxVes
      ? formatFixed4(input.taxVes)
      : convertUsdToVes(toDecimal(taxUsdStr), rate).toFixed(4);

    const totalVesStr = input.totalVes
      ? formatFixed4(input.totalVes)
      : toDecimal(subtotalVesStr).plus(toDecimal(taxVesStr)).toFixed(4);

    const derivedPaymentMethod =
      input.paymentMethod ??
      (input.payments && input.payments.length === 1
        ? input.payments[0]!.method
        : input.payments && input.payments.length > 1
        ? "SPLIT"
        : "CASH_USD");

    const derivedPaymentBreakdown =
      input.paymentBreakdown ??
      (input.payments ? JSON.stringify(input.payments) : null);

    // 3. Persistir Factura (invoices) - Congelamiento permanente inmutable
    db.run(
      `INSERT INTO invoices (
        id, shift_id, terminal_id, invoice_number, exchange_rate,
        subtotal_usd, tax_usd, total_usd, subtotal_ves, tax_ves, total_ves,
        payment_method, payment_breakdown, status, voided_at, void_reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', NULL, NULL, ?)`,
      [
        invoiceId,
        input.shiftId,
        input.terminalId,
        invoiceNumber,
        formatFixed4(rate),
        subtotalUsdStr,
        taxUsdStr,
        totalUsdStr,
        subtotalVesStr,
        taxVesStr,
        totalVesStr,
        derivedPaymentMethod,
        derivedPaymentBreakdown,
        now,
      ],
    );

    // 4. Persistir Detalle de Items y Deltas Conmutativos de Inventario.
    //    El costo de reposición y la identidad del producto se COPIAN en la línea: un documento
    //    emitido no se resuelve contra `products` (auditoría §F1/§F2).
    const productCache = new Map<
      string,
      { name: string; sku: string; unit: string; costUsd: string } | null
    >();
    const readProduct = (productId: string) => {
      if (productCache.has(productId)) return productCache.get(productId) ?? null;
      const [row] = db.all<{ name: string; sku: string; unit?: string; cost_usd: string }>(
        "SELECT name, sku, unit, cost_usd FROM products WHERE id = ?",
        [productId],
      );
      const value = row
        ? { name: row.name, sku: row.sku, unit: row.unit ?? "und", costUsd: row.cost_usd }
        : null;
      productCache.set(productId, value);
      return value;
    };

    const frozenItems: Record<string, unknown>[] = [];

    for (const item of input.items) {
      const itemId = uuidv7(now);
      const q = toDecimal(item.quantity, "item.quantity");
      const unitUsd = toDecimal(item.unitPriceUsd, "item.unitPriceUsd");
      const lineUsd = item.lineTotalUsd ? toDecimal(item.lineTotalUsd) : q.times(unitUsd);
      const unitVes = item.unitPriceVes ? toDecimal(item.unitPriceVes) : convertUsdToVes(unitUsd, rate);
      const lineVes = item.lineTotalVes ? toDecimal(item.lineTotalVes) : convertUsdToVes(lineUsd, rate);

      const product = readProduct(item.productId);
      const rawCost = item.unitCostUsd ?? product?.costUsd ?? null;
      const taxRateStr = formatFixed4(item.taxRate ?? "0.1600");
      const snapshot = {
        id: itemId,
        productId: item.productId,
        quantity: formatFixed4(q),
        unitPriceUsd: formatFixed4(unitUsd),
        lineTotalUsd: formatFixed4(lineUsd),
        unitPriceVes: formatFixed4(unitVes),
        lineTotalVes: formatFixed4(lineVes),
        taxRate: taxRateStr,
        unitCostUsd: rawCost === null ? null : formatFixed4(rawCost),
        productName: (item.productName?.trim() || product?.name || "").trim() || null,
        productSku: product?.sku?.trim() || null,
        productUnit: item.productUnit ?? product?.unit ?? null,
      };

      db.run(
        `INSERT INTO invoice_items (
          id, invoice_id, product_id, quantity,
          unit_price_usd, line_total_usd, unit_price_ves, line_total_ves, tax_rate,
          unit_cost_usd, product_name, product_sku, product_unit
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          snapshot.id,
          invoiceId,
          snapshot.productId,
          snapshot.quantity,
          snapshot.unitPriceUsd,
          snapshot.lineTotalUsd,
          snapshot.unitPriceVes,
          snapshot.lineTotalVes,
          snapshot.taxRate,
          snapshot.unitCostUsd,
          snapshot.productName,
          snapshot.productSku,
          snapshot.productUnit,
        ],
      );

      frozenItems.push(snapshot);

      // Descuento conmutativo del inventario (Kardex delta negativo con 4 decimales exactos).
      // Los rubros sin control de inventario no generan kardex: la venta se factura igual.
      if (productTracksInventory(db, item.productId)) {
        const delta = q.isNegative() ? q.toFixed(4) : q.neg().toFixed(4);

        addStockMovement(
          db,
          {
            productId: item.productId,
            terminalId: input.terminalId,
            delta,
            type: "SALE",
            referenceId: invoiceId,
          },
          now,
        );
      }
    }

    // 5. Encolar evento INVOICE en outbox para replicación P2P
    P2pSyncService.enqueueEvent(
      db,
      {
        originTerminalId: input.terminalId,
        entityType: "INVOICE",
        entityId: invoiceId,
        action: "UPSERT",
        payload: {
          id: invoiceId,
          shiftId: input.shiftId,
          terminalId: input.terminalId,
          invoiceNumber,
          exchangeRate: formatFixed4(rate),
          subtotalUsd: subtotalUsdStr,
          taxUsd: taxUsdStr,
          totalUsd: totalUsdStr,
          subtotalVes: subtotalVesStr,
          taxVes: taxVesStr,
          totalVes: totalVesStr,
          paymentMethod: derivedPaymentMethod,
          paymentBreakdown: derivedPaymentBreakdown,
          status: "COMPLETED",
          createdAt: now,
          items: frozenItems,
        },
      },
      now,
    );

    return invoiceId;
  });
}

/**
 * Consulta una factura por ID con sus items relacionados.
 */
export function getInvoiceById(db: SqlDriver, invoiceId: string): InvoiceEntity | undefined {
  const [inv] = db.all<{
    id: string;
    shift_id: string;
    terminal_id: string;
    invoice_number: string;
    exchange_rate: string;
    subtotal_usd: string;
    tax_usd: string;
    total_usd: string;
    subtotal_ves: string;
    tax_ves: string;
    total_ves: string;
    payment_method: PaymentMethod;
    payment_breakdown: string | null;
    status: "COMPLETED" | "VOID" | null;
    voided_at: number | null;
    void_reason: string | null;
    created_at: number;
  }>("SELECT * FROM invoices WHERE id = ?", [invoiceId]);

  if (!inv) return undefined;

  const items = db.all<{
    id: string;
    invoice_id: string;
    product_id: string;
    quantity: string;
    unit_price_usd: string;
    line_total_usd: string;
    unit_price_ves: string;
    line_total_ves: string;
    tax_rate: string;
    unit_cost_usd: string | null;
    product_name: string | null;
    product_sku: string | null;
    product_unit: string | null;
  }>("SELECT * FROM invoice_items WHERE invoice_id = ?", [invoiceId]);

  return {
    id: inv.id,
    shiftId: inv.shift_id,
    terminalId: inv.terminal_id,
    invoiceNumber: inv.invoice_number,
    exchangeRate: inv.exchange_rate,
    subtotalUsd: inv.subtotal_usd,
    taxUsd: inv.tax_usd,
    totalUsd: inv.total_usd,
    subtotalVes: inv.subtotal_ves,
    taxVes: inv.tax_ves,
    totalVes: inv.total_ves,
    paymentMethod: inv.payment_method,
    paymentBreakdown: inv.payment_breakdown,
    status: (inv.status as "COMPLETED" | "VOID") ?? "COMPLETED",
    voidedAt: inv.voided_at ?? null,
    voidReason: inv.void_reason ?? null,
    createdAt: inv.created_at,
    items: items.map((it) => ({
      id: it.id,
      invoiceId: it.invoice_id,
      productId: it.product_id,
      quantity: it.quantity,
      unitPriceUsd: it.unit_price_usd,
      lineTotalUsd: it.line_total_usd,
      unitPriceVes: it.unit_price_ves,
      lineTotalVes: it.line_total_ves,
      taxRate: it.tax_rate,
      unitCostUsd: it.unit_cost_usd ?? null,
      productName: it.product_name ?? null,
      productSku: it.product_sku ?? null,
      productUnit: it.product_unit ?? null,
    })),
  };
}

/**
 * Consulta el listado de facturas emitidas en un turno de caja específico.
 */
export function listInvoicesByShift(db: SqlDriver, shiftId: string): InvoiceEntity[] {
  const rows = db.all<{
    id: string;
  }>("SELECT id FROM invoices WHERE shift_id = ? ORDER BY created_at DESC, id DESC", [shiftId]);

  return rows.map((r) => getInvoiceById(db, r.id)!).filter(Boolean);
}

/**
 * Anula una factura con motivo auditado obligatorio:
 * 1. Marca la factura como 'VOID'.
 * 2. Revierte el stock atómicamente creando movimientos delta conmutativos 'RETURN' (+quantity).
 * 3. Encola la actualización en outbox P2P.
 */
export function voidInvoice(
  db: SqlDriver,
  args: {
    invoiceId: string;
    reason: string;
    cashierName?: string;
    terminalId?: string;
  },
  now: number = Date.now(),
): InvoiceEntity {
  const cleanReason = args.reason.trim();
  if (!cleanReason) {
    throw new Error("El motivo de anulación es obligatorio para auditoría fiscal y de inventario");
  }

  return db.transaction(() => {
    const invoice = getInvoiceById(db, args.invoiceId);
    if (!invoice) {
      throw new Error(`Factura no encontrada: ${args.invoiceId}`);
    }
    if (invoice.status === "VOID") {
      throw new Error(`La factura ${invoice.invoiceNumber} ya se encuentra anulada`);
    }

    // 1. Marcar como VOID
    db.run(
      "UPDATE invoices SET status = 'VOID', voided_at = ?, void_reason = ? WHERE id = ?",
      [now, cleanReason, invoice.id],
    );

    // 2. Restituir inventario por deltas conmutativos con signo positivo ('RETURN').
    //    Solo se devuelve lo que realmente descontó stock en su momento: los rubros sin
    //    control de inventario nunca generaron 'SALE' y así el kardex sigue siendo conmutativo.
    for (const item of invoice.items) {
      const q = toDecimal(item.quantity);

      const [saleMovement] = db.all<{ id: string }>(
        `SELECT id FROM stock_movements
         WHERE product_id = ? AND reference_id = ? AND movement_type = 'SALE'
         LIMIT 1`,
        [item.productId, invoice.id],
      );
      if (!saleMovement) continue;

      const returnDelta = q.abs().toFixed(4); // Siempre positivo para reingreso

      addStockMovement(
        db,
        {
          productId: item.productId,
          terminalId: args.terminalId ?? invoice.terminalId,
          delta: returnDelta,
          type: "RETURN",
          referenceId: invoice.id,
        },
        now,
      );
    }

    // 3. Encolar evento de anulación en outbox P2P
    P2pSyncService.enqueueEvent(
      db,
      {
        originTerminalId: args.terminalId ?? invoice.terminalId,
        entityType: "INVOICE",
        entityId: invoice.id,
        action: "UPSERT",
        payload: {
          id: invoice.id,
          shiftId: invoice.shiftId,
          terminalId: invoice.terminalId,
          invoiceNumber: invoice.invoiceNumber,
          status: "VOID",
          voidedAt: now,
          voidReason: cleanReason,
        },
      },
      now,
    );

    return getInvoiceById(db, invoice.id)!;
  });
}
