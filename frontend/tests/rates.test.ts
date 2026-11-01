import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers";
import { fetchBcvRate, parseBcvHtml, parseManualRate, type FetchLike } from "../src/rates/bcv";
import { getRateForDate, registerManualRate, resolveDailyRate } from "../src/rates/rates";

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

