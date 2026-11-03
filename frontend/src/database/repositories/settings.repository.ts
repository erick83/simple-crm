import type { SqlDriver } from "../connection";
import { toDecimal, formatQuantity } from "../../utils/decimal";

const TAX_DEFAULT_RATE_KEY = "tax_default_rate";

/** Alícuota legal general de Venezuela cuando nunca se configuró otra. */
const FALLBACK_TAX_RATE = "0.1600";

export function getSetting(db: SqlDriver, key: string): string | null {
  const [row] = db.all<{ value: string }>("SELECT value FROM app_metadata WHERE key = ?", [key]);
  return row ? row.value : null;
}

export function setSetting(db: SqlDriver, key: string, value: string, now: number = Date.now()): void {
  db.run(
    `INSERT INTO app_metadata (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, now],
  );
}

/** Convierte un porcentaje digitado ("16", "8.5", "8,5") a fracción decimal de alícuota ("0.1600"). */
export function taxPercentToRate(percent: string): string {
  const pct = toDecimal(percent.replace(",", "."), "IVA (%)");
  if (pct.isNegative() || pct.gt(100)) {
    throw new Error("El IVA debe estar entre 0% y 100%");
  }
  return pct.dividedBy(100).toFixed(4);
}

/** Convierte una alícuota almacenada ("0.1600") a porcentaje para mostrar ("16"). */
export function taxRateToPercent(rate: string): string {
  return formatQuantity(toDecimal(rate, "IVA").times(100));
}

/** IVA general sugerido como fracción decimal; se aplica solo a productos nuevos. */
export function getDefaultTaxRate(db: SqlDriver | null | undefined): string {
  if (!db) return FALLBACK_TAX_RATE;
  const raw = getSetting(db, TAX_DEFAULT_RATE_KEY);
  if (!raw) return FALLBACK_TAX_RATE;
  try {
    return toDecimal(raw, "IVA sugerido").toFixed(4);
  } catch {
    return FALLBACK_TAX_RATE;
  }
}

/** Guarda el IVA sugerido a partir de un porcentaje. Devuelve la fracción almacenada. */
export function setDefaultTaxRate(db: SqlDriver, percent: string): string {
  const rate = taxPercentToRate(percent);
  setSetting(db, TAX_DEFAULT_RATE_KEY, rate);
  return rate;
}
