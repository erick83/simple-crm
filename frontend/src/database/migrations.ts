import type { SqlDriver } from "./connection";
import { SCHEMA_SQL } from "./schema.generated";

/**
 * Inicializa y migra la base de datos local SQLite ejecutando el esquema DDL oficial.
 * Garantiza idempotencia mediante sentencias CREATE IF NOT EXISTS.
 */
export function migrateDatabase(driver: SqlDriver, customSchemaSql?: string): void {
  const sql = customSchemaSql ?? SCHEMA_SQL;

  // La columna debe existir ANTES de recrear v_product_current_stock (la vista la proyecta),
  // por eso esta migración corre antes del DDL completo y es idempotente.
  try {
    driver.run(
      "ALTER TABLE products ADD COLUMN tracks_inventory INTEGER NOT NULL DEFAULT 1",
    );
  } catch {
    // Tabla inexistente (BD nueva) o columna ya migrada
  }

  driver.exec(sql);

  // Migraciones incrementales idempotentes para bases de datos existentes
  try {
    driver.run("ALTER TABLE products ADD COLUMN unit TEXT NOT NULL DEFAULT 'und'");
    driver.exec(`
      DROP VIEW IF EXISTS v_product_current_stock;
      CREATE VIEW v_product_current_stock AS
      SELECT 
          p.id AS product_id,
          p.sku,
          p.barcode,
          p.name,
          p.category_id,
          p.price_usd,
          p.cost_usd,
          p.min_stock,
          p.tracks_inventory,
          p.image_path,
          p.unit,
          -- Los rubros sin control de inventario no arrastran stock: el kardex los ignora.
          CASE
              WHEN p.tracks_inventory = 1
              THEN COALESCE(SUM(CAST(REPLACE(sm.quantity_delta, '.', '') AS INTEGER)), 0)
              ELSE 0
          END AS current_stock_e4
      FROM products p
      LEFT JOIN stock_movements sm ON p.id = sm.product_id
      WHERE p.is_active = 1
      GROUP BY p.id;
    `);
  } catch {
    // Si la columna unit ya existe, SQLite ignorará el error
  }

  try {
    driver.exec(`
      CREATE TABLE IF NOT EXISTS cash_movements (
        id TEXT PRIMARY KEY,
        shift_id TEXT NOT NULL,
        terminal_id TEXT NOT NULL,
        movement_type TEXT NOT NULL CHECK (movement_type IN ('DROP', 'INFLOW')),
        currency TEXT NOT NULL CHECK (currency IN ('USD', 'VES')),
        amount TEXT NOT NULL,
        reason TEXT NOT NULL,
        cashier_name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(shift_id) REFERENCES cash_shifts(id) ON DELETE RESTRICT
      );
      CREATE INDEX IF NOT EXISTS idx_cash_movements_shift ON cash_movements(shift_id);
    `);
  } catch {
    // Ignorar si ya existe
  }

  try {
    driver.run("ALTER TABLE invoices ADD COLUMN status TEXT NOT NULL DEFAULT 'COMPLETED'");
  } catch {
    // Ignorar si ya existe
  }
  try {
    driver.run("ALTER TABLE invoices ADD COLUMN voided_at INTEGER");
  } catch {
    // Ignorar si ya existe
  }
  try {
    driver.run("ALTER TABLE invoices ADD COLUMN void_reason TEXT");
  } catch {
    // Ignorar si ya existe
  }

  // Congelado de costo e identidad del producto en la línea de factura (auditoría §F1/§F2).
  // Columns NULL-ables: NULL marca las líneas anteriores a la migración, que se resuelven
  // contra `products`; las nuevas emitidas nunca quedan NULL.
  const lineSnapshotColumns: [string, string][] = [
    ["unit_cost_usd", "TEXT"],
    ["product_name", "TEXT"],
    ["product_sku", "TEXT"],
    ["product_unit", "TEXT"],
  ];
  for (const [column, type] of lineSnapshotColumns) {
    try {
      driver.run(`ALTER TABLE invoice_items ADD COLUMN ${column} ${type}`);
    } catch {
      // Ignorar si ya existe
    }
  }
}

