import Decimal from "decimal.js";

// Configuración global de precisión: 20 dígitos significativos, redondeo HALF_UP
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

export class FinancialDecimalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinancialDecimalError";
  }
}

/**
 * Valida y convierte un valor a Decimal de precisión fija.
 * Rechaza números flotantes no serializados de forma segura, valores infinitos o NaN.
 */
export function toDecimal(value: string | Decimal, fieldName = "Monto"): Decimal {
  try {
    const d = value instanceof Decimal ? value : new Decimal(value.trim());
    if (!d.isFinite()) {
      throw new FinancialDecimalError(`${fieldName} no es un número finito.`);
    }
    return d;
  } catch (err) {
    if (err instanceof FinancialDecimalError) throw err;
    throw new FinancialDecimalError(`${fieldName} no es un decimal válido: "${value}"`);
  }
}

/** Formatea a string con exactamente 4 decimales requeridos por la constitución. */
export function formatFixed4(value: string | Decimal): string {
  return toDecimal(value).toFixed(4);
}

/**
 * Formatea un importe en USD con separadores de miles y 4 decimales:
 * Formato: "$ 1,250.0000"
 */
export function formatUsd(value: string | Decimal): string {
  const d = toDecimal(value);
  const parts = d.toFixed(4).split(".");
  const integerPart = parts[0]!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$ ${integerPart}.${parts[1]}`;
}

/**
 * Formatea un importe en VES (Bolívares) con separadores de miles y 4 decimales:
 * Formato: "Bs. 45,625.5000"
 */
export function formatVes(value: string | Decimal): string {
  const d = toDecimal(value);
  const parts = d.toFixed(4).split(".");
  const integerPart = parts[0]!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `Bs. ${integerPart}.${parts[1]}`;
}

/**
 * Multiplicación monetaria exacta (ej. cantidad * precioUnitario).
 */
export function multiplyExact(a: string | Decimal, b: string | Decimal): Decimal {
  return toDecimal(a).times(toDecimal(b));
}

/**
 * Convierte un monto en USD a VES congelando la tasa con 4 decimales exactos.
 */
export function convertUsdToVes(usdAmount: string | Decimal, rateToVes: string | Decimal): Decimal {
  return toDecimal(usdAmount).times(toDecimal(rateToVes)).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

/**
 * Formatea una cantidad de inventario o ítems para visualización sin ceros decimales innecesarios.
 * No muestra decimales si la cantidad es entera (ej. 24 en lugar de 24.0000).
 * Si tiene fracciones decimales (ej. balanza de kg), muestra hasta los decimales significativos.
 * Incluye opcionalmente la unidad de medida (ej. "24 und", "1.5 kg", "10 caja").
 */
export function formatQuantity(value: string | Decimal, unit?: string | null): string {
  const d = toDecimal(value, "Cantidad");
  const isNegative = d.isNegative() && !d.isZero();
  const absFixed = d.abs().toFixed(4);
  const clean = absFixed.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
  const parts = clean.split(".");
  const integerPart = parts[0]!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const formatted = `${isNegative ? "-" : ""}${parts.length > 1 ? `${integerPart}.${parts[1]}` : integerPart}`;
  const trimmedUnit = unit?.trim();
  return trimmedUnit ? `${formatted} ${trimmedUnit}` : formatted;
}


