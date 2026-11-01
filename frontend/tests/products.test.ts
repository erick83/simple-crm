import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers";
import { addStockMovement, createCategory, getCurrentStock, insertProduct } from "../src/db/products";
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
    expect(getCurrentStock(db, id)?.currentStock).toBe("0.0000");
    addStockMovement(db, { productId: id, terminalId: "C01", delta: "10", type: "RESTOCK" });
    addStockMovement(db, { productId: id, terminalId: "C01", delta: "-3", type: "SALE" });
    addStockMovement(db, { productId: id, terminalId: "C02", delta: "-0.5", type: "ADJUSTMENT" });
    addStockMovement(db, { productId: id, terminalId: "C02", delta: "0.0001", type: "ADJUSTMENT" });
    expect(getCurrentStock(db, id)?.currentStock).toBe("6.5001");
  });

  it("el esquema rechaza deltas que no tengan 4 decimales exactos", () => {
    const db = createTestDb();
    const id = insertProduct(db, base);
    const ins = (d: string) =>
      db.run(
        "INSERT INTO stock_movements (id, product_id, terminal_id, quantity_delta, movement_type, created_at) VALUES (?, ?, 'C01', ?, 'ADJUSTMENT', 1)",
        [uuidv7(), id, d],
      );
    for (const bad of ["1", "1.5", "1.00", "abc", "1e3"]) expect(() => ins(bad)).toThrow();
    expect(() => ins("-1.0000")).not.toThrow();
  });

  it("asigna categoría al producto", () => {
    const db = createTestDb();
    const cat = createCategory(db, "Víveres");
    const id = insertProduct(db, { ...base, categoryId: cat });
    const [row] = db.all<{ category_id: string }>("SELECT category_id FROM products WHERE id = ?", [id]);
    expect(row?.category_id).toBe(cat);
    expect(() => createCategory(db, "Víveres")).toThrow();
  });
});

