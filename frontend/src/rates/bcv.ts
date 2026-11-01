import Decimal from "decimal.js";

export const BCV_URL = "https://www.bcv.org.ve/";
export const BCV_TIMEOUT_MS = 5000;

/** Subconjunto de `fetch` necesario (permite inyectar en tests y RN). */
export type FetchLike = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export class RateError extends Error {}

/** Convierte "36,5000" / "1.234,5678" / "36.5" a Decimal positivo; lanza RateError si es inválido. */
export function parseRate(raw: string): Decimal {
  let s = raw.trim();
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) throw new RateError(`Tasa inválida: "${raw}"`);
  const d = new Decimal(s);
  if (d.lte(0)) throw new RateError("La tasa debe ser mayor que cero");
  return d;
}

/** Validación estricta para ingreso manual: máximo 4 decimales exactos. */
export function parseManualRate(raw: string): Decimal {
  const d = parseRate(raw);
  if (d.decimalPlaces() > 4) throw new RateError("La tasa admite como máximo 4 decimales");
  return d;
}

/** Extrae la tasa USD del bloque `id="dolar"` del portal del BCV. */
export function parseBcvHtml(html: string): Decimal {
  const m = /id=["']dolar["'][\s\S]*?<strong>\s*([\d.,]+)\s*<\/strong>/i.exec(html);
  if (!m?.[1]) throw new RateError("No se encontró la tasa USD en la respuesta del BCV");
  return parseRate(m[1]).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

/** Consulta el portal del BCV con timeout estricto. Lanza RateError ante cualquier fallo. */
export async function fetchBcvRate(
  fetchFn: FetchLike,
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

