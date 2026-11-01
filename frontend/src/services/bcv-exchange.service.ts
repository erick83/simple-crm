import Decimal from "decimal.js";
import type { SqlDriver } from "../database/connection";
import { getRateForDate, insertRate, StoredRate } from "../database/repositories/exchange.repository";

export { getRateForDate, insertRate, type StoredRate };

export const BCV_URL = "https://www.bcv.org.ve/";
export const BCV_TIMEOUT_MS = 5000;

export type FetchLike = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export class RateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateError";
  }
}

export function parseRate(raw: string): Decimal {
  let s = raw.trim();
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) throw new RateError(`Tasa inválida: "${raw}"`);
  const d = new Decimal(s);
  if (d.lte(0)) throw new RateError("La tasa debe ser mayor que cero");
  return d;
}

export function parseManualRate(raw: string): Decimal {
  const d = parseRate(raw);
  if (d.decimalPlaces() > 4) throw new RateError("La tasa admite como máximo 4 decimales");
  return d;
}

export function parseBcvHtml(html: string): Decimal {
  const m = /id=["']dolar["'][\s\S]*?<strong>\s*([\d.,]+)\s*<\/strong>/i.exec(html);
  if (!m?.[1]) throw new RateError("No se encontró la tasa USD en la respuesta del BCV");
  return parseRate(m[1]).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

export async function fetchBcvRate(
  fetchFn: FetchLike = fetch as unknown as FetchLike,
  opts: { url?: string; timeoutMs?: number } = {},
): Promise<Decimal> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? BCV_TIMEOUT_MS);
  try {
    const res = await fetchFn(opts.url ?? BCV_URL, { signal: ctrl.signal });
    if (!res.ok) throw new RateError(`BCV respondió HTTP ${res.status}`);
    return parseBcvHtml(await res.text());
  } catch (e) {
    if (e instanceof RateError) throw e;
    throw new RateError(`No se pudo consultar el BCV: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

export type DailyRateResult =
  | { status: "OK"; rate: StoredRate }
  | { status: "MANUAL_REQUIRED"; reason: string };

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
