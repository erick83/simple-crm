import type { SqlDriver } from "../db/driver";
import { uuidv7 } from "../lib/uuidv7";
import { fetchBcvRate, parseManualRate, RateError, type FetchLike } from "./bcv";

export interface StoredRate {
  rateDate: string;
  rateToVes: string;
  source: "BCV_AUTO" | "MANUAL";
  notes: string | null;
}

export type DailyRateResult =
  | { status: "OK"; rate: StoredRate }
  | { status: "MANUAL_REQUIRED"; reason: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function getRateForDate(db: SqlDriver, rateDate: string): StoredRate | undefined {
  const [r] = db.all<{ rate_date: string; rate_to_ves: string; source: StoredRate["source"]; notes: string | null }>(
    "SELECT rate_date, rate_to_ves, source, notes FROM exchange_rates WHERE rate_date = ? AND currency_code = 'USD'",
    [rateDate],
  );
  return r && { rateDate: r.rate_date, rateToVes: r.rate_to_ves, source: r.source, notes: r.notes };
}

function insertRate(db: SqlDriver, rateDate: string, rate: string, source: StoredRate["source"], notes: string | null, now: number) {
  db.run(
    `INSERT INTO exchange_rates (id, rate_date, currency_code, rate_to_ves, source, fetched_at, notes, created_at)
     VALUES (?, ?, 'USD', ?, ?, ?, ?, ?)`,
    [uuidv7(now), rateDate, rate, source, now, notes, now],
  );
}

/** Registro manual auditado: exige motivo (notes) y no sobrescribe una tasa ya fijada para la fecha. */
export function registerManualRate(
  db: SqlDriver,
  args: { rateDate: string; rate: string; reason: string },
  now: number = Date.now(),
): StoredRate {
  if (!ISO_DATE.test(args.rateDate)) throw new RateError("Fecha inválida (use YYYY-MM-DD)");
  if (!args.reason.trim()) throw new RateError("El registro manual requiere un motivo para auditoría");
  if (getRateForDate(db, args.rateDate)) throw new RateError(`Ya existe una tasa para ${args.rateDate}`);
  const rate = parseManualRate(args.rate).toFixed(4);
  insertRate(db, args.rateDate, rate, "MANUAL", args.reason.trim(), now);
  return getRateForDate(db, args.rateDate)!;
}

/**
 * Tasa del día: usa la guardada; si no hay, consulta el BCV (solo country_code 'VE').
 * Ante fallo/offline devuelve MANUAL_REQUIRED para que la apertura de turno pida ingreso manual.
 */
export async function resolveDailyRate(
  deps: { db: SqlDriver; fetchFn: FetchLike; countryCode: string; now?: () => number },
  rateDate: string,
): Promise<DailyRateResult> {
  const existing = getRateForDate(deps.db, rateDate);
  if (existing) return { status: "OK", rate: existing };
  if (deps.countryCode !== "VE") return { status: "MANUAL_REQUIRED", reason: "Región sin tasa BCV" };
  try {
    const rate = await fetchBcvRate(deps.fetchFn);
    insertRate(deps.db, rateDate, rate.toFixed(4), "BCV_AUTO", null, (deps.now ?? Date.now)());
    return { status: "OK", rate: getRateForDate(deps.db, rateDate)! };
  } catch (e) {
    return { status: "MANUAL_REQUIRED", reason: (e as Error).message };
  }
}

