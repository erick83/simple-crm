import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./helpers";
import { uuidv7 } from "../src/utils/uuid7";
import {
  getDefaultTaxRate,
  setDefaultTaxRate,
  taxPercentToRate,
  taxRateToPercent,
} from "../src/database/repositories/settings.repository";
import {
  insertProduct,
  updateProduct,
  getProductById,
} from "../src/database/repositories/product.repository";
import type { SqlDriver } from "../src/database/connection";

describe("Módulo de Configuración: IVA general sugerido", () => {
  const TENANT = uuidv7();
  let db: SqlDriver;

  beforeEach(() => {
    db = createTestDb();
  });

  it("sin configuración previa cae en el 16% legal por defecto", () => {
    expect(getDefaultTaxRate(db)).toBe("0.1600");
    expect(getDefaultTaxRate(null)).toBe("0.1600");
  });

  it("guarda y relee el IVA sugerido en app_metadata (upsert idempotente por clave)", () => {
    expect(setDefaultTaxRate(db, "8")).toBe("0.0800");
    expect(getDefaultTaxRate(db)).toBe("0.0800");
    expect(setDefaultTaxRate(db, "16.5")).toBe("0.1650");
    expect(getDefaultTaxRate(db)).toBe("0.1650");
    const rows = db.all<{ key: string }>("SELECT key FROM app_metadata");
    expect(rows.length).toBe(1);
  });

  it("rechaza alícuotas inválidas o fuera de rango 0-100%", () => {
    expect(() => setDefaultTaxRate(db, "abc")).toThrow();
    expect(() => setDefaultTaxRate(db, "-1")).toThrow("El IVA debe estar entre 0% y 100%");
    expect(() => setDefaultTaxRate(db, "101")).toThrow("El IVA debe estar entre 0% y 100%");
    expect(getDefaultTaxRate(db)).toBe("0.1600");
  });

  it("convierte entre porcentaje legible y fracción decimal de 4 dígitos", () => {
    expect(taxPercentToRate("16")).toBe("0.1600");
    expect(taxPercentToRate("8,5")).toBe("0.0850");
    expect(taxRateToPercent("0.1600")).toBe("16");
    expect(taxRateToPercent("0.0800")).toBe("8");
    expect(taxRateToPercent("0.0950")).toBe("9.5");
  });

  it("un producto nuevo puede sobrescribir el IVA sugerido con su propia tasa", () => {
    setDefaultTaxRate(db, "8");
    const id = insertProduct(
      db,
      {
        tenantId: TENANT,
        sku: "MED-01",
        name: "Medicamento Genérico",
        priceUsd: "2.5",
        costUsd: "1.8",
        taxRate: getDefaultTaxRate(db),
      },
      Date.now(),
      "TERM-01",
    );
    expect(getProductById(db, id)!.taxRate).toBe("0.0800");

    updateProduct(
      db,
      { id, taxRate: taxPercentToRate("16"), terminalId: "TERM-01" },
      Date.now() + 1,
    );
    expect(getProductById(db, id)!.taxRate).toBe("0.1600");
  });
});
