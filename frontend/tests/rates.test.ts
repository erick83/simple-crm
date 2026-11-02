import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers";
import { fetchBcvRate, parseBcvHtml, parseManualRate, type FetchLike } from "../src/rates/bcv";
import {
  getRateForDate,
  getLatestRate,
  getRateHistory,
  insertRate,
  registerManualRate,
  resolveDailyRate,
} from "../src/rates/rates";

const HTML = `<div id="dolar"><div><span>USD</span><div><strong> 36,50129999 </strong></div></div></div>`;
const okFetch: FetchLike = async () => ({ ok: true, status: 200, text: async () => HTML });
const offline: FetchLike = async () => { throw new Error("network down"); };
const hanging: FetchLike = (_u, { signal }) =>
  new Promise((_res, rej) => signal.addEventListener("abort", () => rej(new Error("aborted"))));

describe("parsers", () => {
  it("extrae la tasa del HTML y redondea a 4 decimales", () => {
    expect(parseBcvHtml(HTML).toFixed(4)).toBe("36.5013");
  });
  it("rechaza HTML sin tasa", () => {
    expect(() => parseBcvHtml("<html></html>")).toThrow();
  });
  it("valida ingreso manual", () => {
    expect(parseManualRate("1.234,5678").toFixed(4)).toBe("1234.5678");
    expect(parseManualRate("36,5").toFixed(4)).toBe("36.5000");
    for (const bad of ["abc", "0", "-3", "36.12345", ""]) expect(() => parseManualRate(bad)).toThrow();
  });
});

describe("fetchBcvRate", () => {
  it("falla por timeout estricto", async () => {
    await expect(fetchBcvRate(hanging, { timeoutMs: 20 })).rejects.toThrow(/No se pudo consultar/);
  });
  it("falla ante HTTP no-ok", async () => {
    const f: FetchLike = async () => ({ ok: false, status: 503, text: async () => "" });
    await expect(fetchBcvRate(f)).rejects.toThrow(/503/);
  });
});

describe("resolveDailyRate", () => {
  it("online + VE: captura y persiste la tasa oficial", async () => {
    const db = createTestDb();
    const r = await resolveDailyRate({ db, fetchFn: okFetch, countryCode: "VE" }, "2026-11-02");
    expect(r).toMatchObject({ status: "OK", rate: { rateToVes: "36.5013", source: "BCV_AUTO" } });
    expect(getRateForDate(db, "2026-11-02")?.rateToVes).toBe("36.5013");
  });

  it("no vuelve a consultar si ya hay tasa del día", async () => {
    const db = createTestDb();
    await resolveDailyRate({ db, fetchFn: okFetch, countryCode: "VE" }, "2026-11-02");
    const r = await resolveDailyRate({ db, fetchFn: offline, countryCode: "VE" }, "2026-11-02");
    expect(r.status).toBe("OK");
  });

  it("offline: exige ingreso manual auditado", async () => {
    const db = createTestDb();
    const r = await resolveDailyRate({ db, fetchFn: offline, countryCode: "VE" }, "2026-11-02");
    expect(r.status).toBe("MANUAL_REQUIRED");
    expect(() => registerManualRate(db, { rateDate: "2026-11-02", rate: "36.5", reason: " " })).toThrow(/motivo/);
    const m = registerManualRate(db, { rateDate: "2026-11-02", rate: "36,5", reason: "Sin internet en apertura" });
    expect(m).toMatchObject({ rateToVes: "36.5000", source: "MANUAL", notes: "Sin internet en apertura" });
    expect(() => registerManualRate(db, { rateDate: "2026-11-02", rate: "37", reason: "x" })).toThrow(/Ya existe/);
  });

  it("país distinto de VE no consulta el BCV", async () => {
    const r = await resolveDailyRate({ db: createTestDb(), fetchFn: okFetch, countryCode: "CO" }, "2026-11-02");
    expect(r.status).toBe("MANUAL_REQUIRED");
  });
});

describe("histórico de tasas de cambio", () => {
  it("persiste en SQLite con UUIDv7, auditoría y estructura relacional completa", () => {
    const db = createTestDb();
    const now = Date.now();
    insertRate(db, "2026-11-01", "36.4500", "BCV_AUTO", null, now);

    const rows = db.all<{
      id: string;
      rate_date: string;
      currency_code: string;
      rate_to_ves: string;
      source: string;
      fetched_at: number;
      created_at: number;
      notes: string | null;
    }>("SELECT * FROM exchange_rates WHERE rate_date = '2026-11-01'");

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(row.rate_date).toBe("2026-11-01");
    expect(row.currency_code).toBe("USD");
    expect(row.rate_to_ves).toBe("36.4500");
    expect(row.source).toBe("BCV_AUTO");
    expect(row.fetched_at).toBe(now);
    expect(row.created_at).toBe(now);
    expect(row.notes).toBeNull();
  });

  it("almacena múltiples tasas por fecha y genera el histórico ordenado", () => {
    const db = createTestDb();
    insertRate(db, "2026-11-01", "36.4500", "BCV_AUTO", null, 1700000000000);
    insertRate(db, "2026-11-02", "36.5013", "BCV_AUTO", null, 1700086400000);
    registerManualRate(
      db,
      { rateDate: "2026-11-03", rate: "36.6200", reason: "Falla eléctrica en sede" },
      1700172800000,
    );

    // Consulta de la más reciente
    const latest = getLatestRate(db);
    expect(latest?.rateDate).toBe("2026-11-03");
    expect(latest?.rateToVes).toBe("36.6200");

    // Histórico completo por defecto (DESC: más reciente primero)
    const historyDesc = getRateHistory(db);
    expect(historyDesc).toHaveLength(3);
    expect(historyDesc.map((h) => h.rateDate)).toEqual(["2026-11-03", "2026-11-02", "2026-11-01"]);
    expect(historyDesc[0]).toMatchObject({
      rateDate: "2026-11-03",
      rateToVes: "36.6200",
      source: "MANUAL",
      notes: "Falla eléctrica en sede",
    });

    // Histórico ascendente
    const historyAsc = getRateHistory(db, { order: "ASC" });
    expect(historyAsc.map((h) => h.rateDate)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);

    // Filtrado por rango de fechas
    const range = getRateHistory(db, { startDate: "2026-11-02", endDate: "2026-11-03" });
    expect(range.map((h) => h.rateDate)).toEqual(["2026-11-03", "2026-11-02"]);

    // Paginación / límite
    const limited = getRateHistory(db, { limit: 2 });
    expect(limited).toHaveLength(2);
    expect(limited.map((h) => h.rateDate)).toEqual(["2026-11-03", "2026-11-02"]);
  });
});


