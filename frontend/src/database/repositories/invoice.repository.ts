import type { SqlDriver } from "../connection";
import { uuidv7 } from "../../utils/uuid7";
import { toDecimal, formatFixed4, Decimal, convertUsdToVes } from "../../utils/decimal";
import { addStockMovement, getCurrentStock } from "./product.repository";
import { LicenseValidatorService } from "../../services/license-validator.service";

export interface InvoiceItemInput {
  productId: string;
  quantity: string;
  unitPriceUsd: string;
  unitPriceVes: string;
  lineTotalUsd: string;
  lineTotalVes: string;
  taxRate?: string;
}

export type PaymentMethod =
  | "CASH_USD"
  | "CASH_VES"
  | "PAGO_MOVIL"
  | "CARD_VES"
  | "SPLIT";

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
  paymentMethod: PaymentMethod;
  paymentBreakdown?: string;
  items: InvoiceItemInput[];
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
  createdAt: number;
  items: InvoiceItemEntity[];
}

/**
 * Genera el siguiente consecutivo de factura para la terminal: ej. C01-000001
 */
export function generateNextInvoiceNumber(db: SqlDriver, terminalId: string): string {
  const [row] = db.all<{ count: number }>(
    "SELECT COUNT(*) as count FROM invoices WHERE terminal_id = ?",
    [terminalId],
  );
  const nextSeq = (row?.count ?? 0) + 1;
  const cleanTerm = terminalId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const padSeq = String(nextSeq).padStart(6, "0");
  return `${cleanTerm}-${padSeq}`;
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
    // 2. Validar que el turno exista y esté ABIERTO
    const [shift] = db.all<{ status: string }>(
      "SELECT status FROM cash_shifts WHERE id = ?",
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
      input.invoiceNumber ?? generateNextInvoiceNumber(db, input.terminalId);
    const rate = toDecimal(input.exchangeRate, "Tasa de cambio");
    if (rate.lte(0)) throw new Error("La tasa de cambio debe ser mayor a cero");

    // 2. Calcular o validar sumatorias monetarias con Decimal exacto
    let computedSubtotalUsd = new Decimal("0");
    let computedSubtotalVes = new Decimal("0");

    for (const it of input.items) {
      const q = toDecimal(it.quantity, "Cantidad item");
      if (q.lte(0)) throw new Error("La cantidad vendida debe ser mayor a cero");
      const unitUsd = toDecimal(it.unitPriceUsd, "Precio unitario USD");
      const lineUsd = q.times(unitUsd);
      const lineVes = convertUsdToVes(lineUsd, rate);

      computedSubtotalUsd = computedSubtotalUsd.plus(lineUsd);
      computedSubtotalVes = computedSubtotalVes.plus(lineVes);
    }

    const subtotalUsdStr = input.subtotalUsd
      ? formatFixed4(input.subtotalUsd)
      : computedSubtotalUsd.toFixed(4);

    const taxUsdStr = input.taxUsd
      ? formatFixed4(input.taxUsd)
      : "0.0000";

    const totalUsdStr = input.totalUsd
      ? formatFixed4(input.totalUsd)
      : toDecimal(subtotalUsdStr).plus(toDecimal(taxUsdStr)).toFixed(4);

    const subtotalVesStr = input.subtotalVes
      ? formatFixed4(input.subtotalVes)
      : computedSubtotalVes.toFixed(4);

    const taxVesStr = input.taxVes
      ? formatFixed4(input.taxVes)
      : "0.0000";

    const totalVesStr = input.totalVes
      ? formatFixed4(input.totalVes)
      : toDecimal(subtotalVesStr).plus(toDecimal(taxVesStr)).toFixed(4);

    // 3. Persistir Factura (invoices) - Congelamiento permanente inmutable
    db.run(
      `INSERT INTO invoices (
        id, shift_id, terminal_id, invoice_number, exchange_rate,
        subtotal_usd, tax_usd, total_usd, subtotal_ves, tax_ves, total_ves,
        payment_method, payment_breakdown, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        input.paymentMethod,
        input.paymentBreakdown ?? null,
        now,
      ],
    );

    // 4. Persistir Detalle de Items y Deltas Conmutativos de Inventario
    for (const item of input.items) {
      const itemId = uuidv7(now);
      const q = toDecimal(item.quantity);

      db.run(
        `INSERT INTO invoice_items (
          id, invoice_id, product_id, quantity,
          unit_price_usd, line_total_usd, unit_price_ves, line_total_ves, tax_rate
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          itemId,
          invoiceId,
          item.productId,
          formatFixed4(q),
          formatFixed4(item.unitPriceUsd),
          formatFixed4(item.lineTotalUsd),
          formatFixed4(item.unitPriceVes),
          formatFixed4(item.lineTotalVes),
          formatFixed4(item.taxRate ?? "0.1600"),
        ],
      );

      // Descuento conmutativo del inventario (Kardex delta negativo con 4 decimales exactos)
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
    })),
  };
}
