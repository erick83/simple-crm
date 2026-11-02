import type { SqlDriver } from "./connection";
import { SCHEMA_SQL } from "./schema.generated";

/**
 * Inicializa y migra la base de datos local SQLite ejecutando el esquema DDL oficial.
 * Garantiza idempotencia mediante sentencias CREATE IF NOT EXISTS.
 */
export function migrateDatabase(driver: SqlDriver, customSchemaSql?: string): void {
  const sql = customSchemaSql ?? SCHEMA_SQL;
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
          p.image_path,
          p.unit,
          COALESCE(SUM(CAST(REPLACE(sm.quantity_delta, '.', '') AS INTEGER)), 0) AS current_stock_e4
      FROM products p
      LEFT JOIN stock_movements sm ON p.id = sm.product_id
      WHERE p.is_active = 1
      GROUP BY p.id;
    `);
  } catch {
    // Si la columna unit ya existe, SQLite ignorará el error
  }
}

