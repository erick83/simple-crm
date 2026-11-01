import type { SqlDriver } from "../connection";
import { uuidv7 } from "../../utils/uuid7";
import { toDecimal, formatFixed4 } from "../../utils/decimal";
import { addStockMovement } from "./product.repository";

export interface InvoiceItemInput {
  productId: string;
  quantity: string;
  unitPriceUsd: string;
  unitPriceVes: string;
  lineTotalUsd: string;
  lineTotalVes: string;
  taxRate?: string;
}

export interface CreateInvoiceInput {
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
  paymentMethod: "CASH_USD" | "CASH_VES" | "PAGO_MOVIL" | "CARD_VES" | "SPLIT";
  paymentBreakdown?: string;
  items: InvoiceItemInput[];
}

export function createInvoice(db: SqlDriver, input: CreateInvoiceInput, now: number = Date.now()): string {
  return db.transaction(() => {
    const invoiceId = uuidv7(now);

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
        input.invoiceNumber,
        formatFixed4(input.exchangeRate),
        formatFixed4(input.subtotalUsd),
        formatFixed4(input.taxUsd),
        formatFixed4(input.totalUsd),
        formatFixed4(input.subtotalVes),
        formatFixed4(input.taxVes),
        formatFixed4(input.totalVes),
        input.paymentMethod,
        input.paymentBreakdown ?? null,
        now,
      ],
    );

    for (const item of input.items) {
      const itemId = uuidv7(now);
      db.run(
        `INSERT INTO invoice_items (
          id, invoice_id, product_id, quantity,
          unit_price_usd, line_total_usd, unit_price_ves, line_total_ves, tax_rate
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          itemId,
          invoiceId,
          item.productId,
          formatFixed4(item.quantity),
          formatFixed4(item.unitPriceUsd),
          formatFixed4(item.lineTotalUsd),
          formatFixed4(item.unitPriceVes),
          formatFixed4(item.lineTotalVes),
          formatFixed4(item.taxRate ?? "0.1600"),
        ],
      );

      // Descuento conmutativo del inventario (Kardex delta negativo con 4 decimales)
      const qty = toDecimal(item.quantity);
      const delta = qty.isNegative() ? qty.toFixed(4) : qty.neg().toFixed(4);

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

