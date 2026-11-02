import type { SqlDriver } from "../connection";
import { Decimal, toDecimal, formatFixed4, formatUsd, formatVes } from "../../utils/decimal";
import type { PaymentMethod } from "./invoice.repository";

export interface PaymentMethodBreakdown {
  method: PaymentMethod;
  label: string;
  totalUsd: string;
  totalVes: string;
  count: number;
}

export interface TopProductSale {
  productId: string;
  sku: string;
  name: string;
  quantitySold: string;
  totalUsd: string;
  totalVes: string;
}

export interface PeriodicBalanceReport {
  periodFrom: number;
  periodTo: number;
  totalInvoices: number;
  totalRevenueUsd: string;
  totalRevenueVes: string;
  totalTaxUsd: string;
  totalTaxVes: string;
  totalCogsUsd: string;
  totalGrossMarginUsd: string;
  grossMarginPercent: string;
  paymentBreakdown: PaymentMethodBreakdown[];
  topProducts: TopProductSale[];
}

export interface BalanceFilter {
  fromTimestamp?: number;
  toTimestamp?: number;
  terminalId?: string;
}

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH_USD: "Efectivo USD ($)",
  CASH_VES: "Efectivo VES (Bs.)",
  PAGO_MOVIL: "Pago Móvil (Bs.)",
  CARD_VES: "Tarjeta de Débito (Punto Bs.)",
  SPLIT: "Pago Dividido (Split)",
};

/**
 * Genera el balance consolidado periódico y mensual mediante consultas de agregación en SQLite
 * utilizando matemática financiera de precisión fija (Decimal).
 */
export function generatePeriodicBalance(
  db: SqlDriver,
  filter: BalanceFilter = {},
): PeriodicBalanceReport {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filter.fromTimestamp !== undefined) {
    conditions.push("created_at >= ?");
    params.push(filter.fromTimestamp);
  }
  if (filter.toTimestamp !== undefined) {
    conditions.push("created_at <= ?");
    params.push(filter.toTimestamp);
  }
  if (filter.terminalId !== undefined) {
    conditions.push("terminal_id = ?");
    params.push(filter.terminalId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // 1. Obtener todas las facturas del período
  const invoices = db.all<{
    id: string;
    total_usd: string;
    total_ves: string;
    tax_usd: string;
    tax_ves: string;
    payment_method: PaymentMethod;
    payment_breakdown: string | null;
    created_at: number;
  }>(
    `SELECT id, total_usd, total_ves, tax_usd, tax_ves, payment_method, payment_breakdown, created_at
     FROM invoices ${whereClause} ORDER BY created_at ASC`,
    params,
  );

  let totalRevUsd = new Decimal("0");
  let totalRevVes = new Decimal("0");
  let totalTaxUsd = new Decimal("0");
  let totalTaxVes = new Decimal("0");

  const methodAccumulator: Record<
    PaymentMethod,
    { totalUsd: Decimal; totalVes: Decimal; count: number }
  > = {
    CASH_USD: { totalUsd: new Decimal("0"), totalVes: new Decimal("0"), count: 0 },
    CASH_VES: { totalUsd: new Decimal("0"), totalVes: new Decimal("0"), count: 0 },
    PAGO_MOVIL: { totalUsd: new Decimal("0"), totalVes: new Decimal("0"), count: 0 },
    CARD_VES: { totalUsd: new Decimal("0"), totalVes: new Decimal("0"), count: 0 },
    SPLIT: { totalUsd: new Decimal("0"), totalVes: new Decimal("0"), count: 0 },
  };

  const invoiceIds = invoices.map((i) => i.id);

  for (const inv of invoices) {
    const usd = toDecimal(inv.total_usd);
    const ves = toDecimal(inv.total_ves);
    const tUsd = toDecimal(inv.tax_usd);
    const tVes = toDecimal(inv.tax_ves);

    totalRevUsd = totalRevUsd.plus(usd);
    totalRevVes = totalRevVes.plus(ves);
    totalTaxUsd = totalTaxUsd.plus(tUsd);
    totalTaxVes = totalTaxVes.plus(tVes);

    const m = inv.payment_method;
    if (m === "SPLIT" && inv.payment_breakdown) {
      try {
        const bd = JSON.parse(inv.payment_breakdown);
        let handledAny = false;
        if (bd.cash_usd && toDecimal(bd.cash_usd).gt(0)) {
          methodAccumulator.CASH_USD.totalUsd = methodAccumulator.CASH_USD.totalUsd.plus(toDecimal(bd.cash_usd));
          methodAccumulator.CASH_USD.count += 1;
          handledAny = true;
        }
        if (bd.cash_ves && toDecimal(bd.cash_ves).gt(0)) {
          methodAccumulator.CASH_VES.totalVes = methodAccumulator.CASH_VES.totalVes.plus(toDecimal(bd.cash_ves));
          methodAccumulator.CASH_VES.count += 1;
          handledAny = true;
        }
        if (bd.pago_movil && toDecimal(bd.pago_movil).gt(0)) {
          methodAccumulator.PAGO_MOVIL.totalVes = methodAccumulator.PAGO_MOVIL.totalVes.plus(toDecimal(bd.pago_movil));
          methodAccumulator.PAGO_MOVIL.count += 1;
          handledAny = true;
        }
        if (bd.card_ves && toDecimal(bd.card_ves).gt(0)) {
          methodAccumulator.CARD_VES.totalVes = methodAccumulator.CARD_VES.totalVes.plus(toDecimal(bd.card_ves));
          methodAccumulator.CARD_VES.count += 1;
          handledAny = true;
        }
        if (!handledAny && methodAccumulator[m]) {
          methodAccumulator[m].totalUsd = methodAccumulator[m].totalUsd.plus(usd);
          methodAccumulator[m].totalVes = methodAccumulator[m].totalVes.plus(ves);
          methodAccumulator[m].count += 1;
        }
      } catch {
        if (methodAccumulator[m]) {
          methodAccumulator[m].totalUsd = methodAccumulator[m].totalUsd.plus(usd);
          methodAccumulator[m].totalVes = methodAccumulator[m].totalVes.plus(ves);
          methodAccumulator[m].count += 1;
        }
      }
    } else if (methodAccumulator[m]) {
      methodAccumulator[m].totalUsd = methodAccumulator[m].totalUsd.plus(usd);
      methodAccumulator[m].totalVes = methodAccumulator[m].totalVes.plus(ves);
      methodAccumulator[m].count += 1;
    }
  }

  // 2. Calcular Costo de Mercancía Vendida (COGS) y Margen Bruto
  let totalCogsUsd = new Decimal("0");
  const productSalesMap = new Map<
    string,
    { sku: string; name: string; quantity: Decimal; totalUsd: Decimal; totalVes: Decimal }
  >();

  if (invoiceIds.length > 0) {
    // Consulta de items con el costo de reposición de producto en SQLite
    const placeholders = invoiceIds.map(() => "?").join(",");
    const items = db.all<{
      product_id: string;
      sku: string;
      name: string;
      cost_usd: string;
      quantity: string;
      line_total_usd: string;
      line_total_ves: string;
    }>(
      `SELECT ii.product_id, p.sku, p.name, p.cost_usd, ii.quantity, ii.line_total_usd, ii.line_total_ves
       FROM invoice_items ii
       JOIN products p ON p.id = ii.product_id
       WHERE ii.invoice_id IN (${placeholders})`,
      invoiceIds,
    );

    for (const item of items) {
      const q = toDecimal(item.quantity);
      const unitCost = toDecimal(item.cost_usd);
      const lineCogs = q.times(unitCost);
      totalCogsUsd = totalCogsUsd.plus(lineCogs);

      const lineUsd = toDecimal(item.line_total_usd);
      const lineVes = toDecimal(item.line_total_ves);

      const prev = productSalesMap.get(item.product_id);
      if (prev) {
        prev.quantity = prev.quantity.plus(q);
        prev.totalUsd = prev.totalUsd.plus(lineUsd);
        prev.totalVes = prev.totalVes.plus(lineVes);
      } else {
        productSalesMap.set(item.product_id, {
          sku: item.sku,
          name: item.name,
          quantity: q,
          totalUsd: lineUsd,
          totalVes: lineVes,
        });
      }
    }
  }

  const grossMarginUsd = totalRevUsd.minus(totalCogsUsd);
  const marginPercent = totalRevUsd.gt(0)
    ? grossMarginUsd.div(totalRevUsd).times(100).toFixed(2)
    : "0.00";

  // 3. Estructurar Desglose de Métodos de Pago
  const paymentBreakdown: PaymentMethodBreakdown[] = (
    Object.keys(methodAccumulator) as PaymentMethod[]
  )
    .filter((m) => methodAccumulator[m].count > 0 || m === "CASH_USD" || m === "CASH_VES")
    .map((m) => ({
      method: m,
      label: PAYMENT_METHOD_LABELS[m] ?? m,
      totalUsd: methodAccumulator[m].totalUsd.toFixed(4),
      totalVes: methodAccumulator[m].totalVes.toFixed(4),
      count: methodAccumulator[m].count,
    }));

  // 4. Ranking de productos más vendidos
  const topProducts: TopProductSale[] = Array.from(productSalesMap.entries())
    .map(([productId, data]) => ({
      productId,
      sku: data.sku,
      name: data.name,
      quantitySold: data.quantity.toFixed(4),
      totalUsd: data.totalUsd.toFixed(4),
      totalVes: data.totalVes.toFixed(4),
    }))
    .sort((a, b) => (toDecimal(b.totalUsd).gt(toDecimal(a.totalUsd)) ? 1 : -1))
    .slice(0, 10);

  return {
    periodFrom: filter.fromTimestamp ?? (invoices[0]?.created_at ?? 0),
    periodTo: filter.toTimestamp ?? (invoices[invoices.length - 1]?.created_at ?? Date.now()),
    totalInvoices: invoices.length,
    totalRevenueUsd: totalRevUsd.toFixed(4),
    totalRevenueVes: totalRevVes.toFixed(4),
    totalTaxUsd: totalTaxUsd.toFixed(4),
    totalTaxVes: totalTaxVes.toFixed(4),
    totalCogsUsd: totalCogsUsd.toFixed(4),
    totalGrossMarginUsd: grossMarginUsd.toFixed(4),
    grossMarginPercent: marginPercent,
    paymentBreakdown,
    topProducts,
  };
}

