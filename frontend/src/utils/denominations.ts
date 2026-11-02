import { Decimal } from "./decimal";

export const USD_DENOMINATIONS = [100, 50, 20, 10, 5, 2, 1] as const;
export const VES_DENOMINATIONS = [500, 200, 100, 50, 20, 10] as const;

export type UsdDenomination = (typeof USD_DENOMINATIONS)[number];
export type VesDenomination = (typeof VES_DENOMINATIONS)[number];

/**
 * Calcula el monto total en string con 4 decimales a partir de un desglose de billetes por denominación.
 */
export function calculateDenominationsTotal(counts: Record<number, number>): string {
  let total = new Decimal(0);
  for (const [denomStr, count] of Object.entries(counts)) {
    const denom = Number(denomStr);
    const qty = Math.max(0, Math.floor(Number(count) || 0));
    if (qty > 0 && denom > 0) {
      total = total.plus(new Decimal(denom).times(qty));
    }
  }
  return total.toFixed(4);
}

