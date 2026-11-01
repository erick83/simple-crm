import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers";
import { addStockMovement, getCurrentStock, insertProduct } from "../src/db/products";
import { uuidv7 } from "../src/lib/uuidv7";

const TENANT = uuidv7();
const base = { tenantId: TENANT, sku: "SKU-1", name: "Harina PAN 1kg", priceUsd: "1.2", costUsd: "0.9" };

describe("uuidv7", () => {
  it("tiene formato v7 y es ordenable en el tiempo", () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
  });

  it("es estrictamente creciente dentro del mismo milisegundo", () => {
    const ids = Array.from({ length: 50 }, () => uuidv7(1_800_000_000_000));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(50);
  });
});

describe("productos y stock", () => {
  it("inserta producto con decimales normalizados a 4 dígitos", () => {
    const db = createTestDb();
    const id = insertProduct(db, base);
    const [row] = db.all<{ price_usd: string; tax_rate: string }>("SELECT price_usd, tax_rate FROM products WHERE id = ?", [id]);
    expect(row).toEqual({ price_usd: "1.2000", tax_rate: "0.1600" });
  });

  it("rechaza decimales inválidos y precios negativos", () => {
    const db = createTestDb();
    expect(() => insertProduct(db, { ...base, priceUsd: "abc" })).toThrow();
    expect(() => insertProduct(db, { ...base, priceUsd: "-1" })).toThrow();
  });

  it("rechaza SKU duplicado", () => {
    const db = createTestDb();
    insertProduct(db, base);
    expect(() => insertProduct(db, base)).toThrow();
  });

  it("calcula stock vía v_product_current_stock", () => {
    const db = createTestDb();
    const id = insertProduct(db, base);
    expect(getCurrentStock(db, id)?.currentStock).toBe("0.00");
    addStockMovement(db, { productId: id, terminalId: "C01", delta: "10", type: "RESTOCK" });
    addStockMovement(db, { productId: id, terminalId: "C01", delta: "-3", type: "SALE" });
    addStockMovement(db, { productId: id, terminalId: "C02", delta: "-0.5", type: "ADJUSTMENT" });
    expect(getCurrentStock(db, id)?.currentStock).toBe("6.50");
  });
});

