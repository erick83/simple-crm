import { describe, expect, it } from "vitest";
import { openLegacyDb } from "./helpers";
import { migrateDatabase } from "../src/database/migrations";
import { SCHEMA_SQL } from "../src/database/schema.generated";
import { insertProduct, getCurrentStock } from "../src/database/repositories/product.repository";
import { generatePeriodicBalance } from "../src/database/repositories/balance.repository";
import { getInvoiceById } from "../src/database/repositories/invoice.repository";
import { uuidv7 } from "../src/utils/uuid7";
import type { SqlDriver } from "../src/database/connection";

/**
 * Una caja ya instalada no puede perder sus ventas al migrar: las columnas congeladas de
 * invoice_items (auditoría §F1/§F2) y tracks_inventory deben agregarse idempotentemente
 * y las líneas heredadas (snapshot NULL) deben seguir valuándose contra `products`.
 */
describe("Migración de base de datos existente", () => {
  const LEGACY_DDL = `
    CREATE TABLE categories (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
    );
    CREATE TABLE products (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, category_id TEXT REFERENCES categories(id),
      barcode TEXT UNIQUE, sku TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      price_usd TEXT NOT NULL, cost_usd TEXT NOT NULL, tax_rate TEXT NOT NULL DEFAULT '0.16',
      image_path TEXT, unit TEXT NOT NULL DEFAULT 'und', min_stock TEXT NOT NULL DEFAULT '5.0000',
      is_active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE cash_shifts (
      id TEXT PRIMARY KEY, terminal_id TEXT NOT NULL, cashier_name TEXT NOT NULL,
      opened_at INTEGER NOT NULL, closed_at INTEGER, exchange_rate_applied TEXT NOT NULL,
      initial_cash_usd TEXT NOT NULL DEFAULT '0.0000', initial_cash_ves TEXT NOT NULL DEFAULT '0.0000',
      expected_cash_usd TEXT, expected_cash_ves TEXT, declared_cash_usd TEXT, declared_cash_ves TEXT,
      difference_usd TEXT, difference_ves TEXT, status TEXT NOT NULL DEFAULT 'OPEN'
    );
    CREATE TABLE invoices (
      id TEXT PRIMARY KEY, shift_id TEXT NOT NULL, terminal_id TEXT NOT NULL,
      invoice_number TEXT NOT NULL, exchange_rate TEXT NOT NULL,
      subtotal_usd TEXT NOT NULL, tax_usd TEXT NOT NULL, total_usd TEXT NOT NULL,
      subtotal_ves TEXT NOT NULL, tax_ves TEXT NOT NULL, total_ves TEXT NOT NULL,
      payment_method TEXT NOT NULL, payment_breakdown TEXT, created_at INTEGER NOT NULL,
      FOREIGN KEY(shift_id) REFERENCES cash_shifts(id)
    );
    CREATE TABLE invoice_items (
      id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL, product_id TEXT NOT NULL,
      quantity TEXT NOT NULL, unit_price_usd TEXT NOT NULL, line_total_usd TEXT NOT NULL,
      unit_price_ves TEXT NOT NULL, line_total_ves TEXT NOT NULL, tax_rate TEXT NOT NULL,
      FOREIGN KEY(invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    );
    CREATE TABLE stock_movements (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL, terminal_id TEXT NOT NULL,
      quantity_delta TEXT NOT NULL, movement_type TEXT NOT NULL, reference_id TEXT,
      created_at INTEGER NOT NULL
    );
  `;

  const columnsOf = (db: SqlDriver, table: string): string[] =>
    db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name);

  it("agrega las columnas nuevas conservando la venta heredada", () => {
    const { driver: db, handle } = openLegacyDb(LEGACY_DDL);

    // Venta heredada: línea sin snapshot, producto con costo vivo $2.0000
    handle.run(
      `INSERT INTO products (id, tenant_id, sku, name, price_usd, cost_usd, tax_rate, unit, min_stock, is_active, created_at, updated_at)
       VALUES ('prod-legado', ?, 'VIEJO-01', 'Carne de segunda', '4.0000', '2.0000', '0.0000', 'kg', '0.0000', 1, 1, 1)`,
      [uuidv7()],
    );
    handle.run(
      `INSERT INTO cash_shifts (id, terminal_id, cashier_name, opened_at, exchange_rate_applied, status)
       VALUES ('shift-1', 'C01', 'Erick', 1, '40.0000', 'CLOSED')`,
    );
    handle.run(
      `INSERT INTO invoices (id, shift_id, terminal_id, invoice_number, exchange_rate,
          subtotal_usd, tax_usd, total_usd, subtotal_ves, tax_ves, total_ves, payment_method, created_at)
       VALUES ('inv-1', 'shift-1', 'C01', 'C01-000001', '40.0000',
          '8.0000', '0.0000', '8.0000', '320.0000', '0.0000', '320.0000', 'CASH_USD', 1000)`,
    );
    handle.run(
      `INSERT INTO invoice_items (id, invoice_id, product_id, quantity, unit_price_usd,
          line_total_usd, unit_price_ves, line_total_ves, tax_rate)
       VALUES ('item-1', 'inv-1', 'prod-legado', '2.0000', '4.0000', '8.0000', '160.0000', '160.0000', '0.0000')`,
    );

    expect(columnsOf(db, "invoice_items")).not.toContain("unit_cost_usd");
    expect(columnsOf(db, "products")).not.toContain("tracks_inventory");

    expect(() => migrateDatabase(db, SCHEMA_SQL)).not.toThrow();

    const itemCols = columnsOf(db, "invoice_items");
    for (const col of ["unit_cost_usd", "product_name", "product_sku", "product_unit"]) {
      expect(itemCols).toContain(col);
    }
    expect(columnsOf(db, "products")).toContain("tracks_inventory");

    // Idempotencia: migrar dos veces no puede fallar ni duplicar columnas
    expect(() => migrateDatabase(db, SCHEMA_SQL)).not.toThrow();
    expect(columnsOf(db, "invoice_items").filter((c) => c === "unit_cost_usd")).toHaveLength(1);

    // La venta heredada sigue legible y su snapshot es NULL (no '0.0000' disfrazado)
    const line = getInvoiceById(db, "inv-1")!.items[0];
    expect(line?.unitCostUsd).toBeNull();
    expect(line?.productName).toBeNull();
    expect(line?.quantity).toBe("2.0000");

    // El COGS heredado usa el costo vivo del producto: 2 x $2.0000
    const balance = generatePeriodicBalance(db);
    expect(balance.totalCogsUsd).toBe("4.0000");
    expect(balance.costedSalesUsd).toBe("8.0000");
    expect(balance.totalGrossMarginUsd).toBe("4.0000");

    // Y la caja puede seguir operando: los productos nuevos sí congelan su línea
    const nuevoId = insertProduct(db, {
      tenantId: uuidv7(),
      sku: "NUEVO-01",
      name: "Lomo fino",
      priceUsd: "9.0000",
      costUsd: "6.0000",
      unit: "kg",
    });
    expect(getCurrentStock(db, nuevoId)?.tracksInventory).toBe(true);
    expect(getCurrentStock(db, nuevoId)?.currentStock).toBe("0.0000");
  });

  it("sobrevive a una base aún más antigua, anterior a la columna unit", () => {
    // products sin `unit`: v_product_current_stock la proyecta, así que el ALTER debe
    // ejecutarse antes de recrear la vista o la caja quedaría inservible al actualizar.
    const ddlSinUnit = LEGACY_DDL.replace(
      "image_path TEXT, unit TEXT NOT NULL DEFAULT 'und', min_stock",
      "image_path TEXT, min_stock",
    );
    const { driver: db, handle } = openLegacyDb(ddlSinUnit);

    handle.run(
      `INSERT INTO products (id, tenant_id, sku, name, price_usd, cost_usd, tax_rate, min_stock, is_active, created_at, updated_at)
       VALUES ('prod-viejo', ?, 'ANTIGUO-01', 'Falda', '3.0000', '1.5000', '0.0000', '0.0000', 1, 1, 1)`,
      [uuidv7()],
    );

    expect(() => migrateDatabase(db, SCHEMA_SQL)).not.toThrow();

    const cols = columnsOf(db, "products");
    expect(cols).toContain("unit");
    expect(cols).toContain("tracks_inventory");

    // La vista quedó operativa y la fila heredada conserva su costo/stock
    const stock = getCurrentStock(db, "prod-viejo");
    expect(stock?.unit).toBe("und");
    expect(stock?.currentStock).toBe("0.0000");
    expect(stock?.tracksInventory).toBe(true);
  });
});
