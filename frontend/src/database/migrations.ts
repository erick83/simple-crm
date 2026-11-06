import type { SqlDriver } from "./connection";
import { SCHEMA_SQL } from "./schema.generated";
import { hashOperatorPin } from "./repositories/operator.repository";

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

  // Bitácora de correcciones de tasa (auditoría §F3/§F4) y unicidad del consecutivo
  // fiscal por caja (§F5). Tabla/índice idempotentes para instalaciones ya existentes.
  try {
    driver.exec(`
      CREATE TABLE IF NOT EXISTS exchange_rate_corrections (
        id TEXT PRIMARY KEY,
        rate_date TEXT NOT NULL,
        context TEXT NOT NULL,
        context_id TEXT,
        previous_rate TEXT NOT NULL,
        new_rate TEXT NOT NULL,
        reason TEXT NOT NULL,
        source TEXT NOT NULL,
        terminal_id TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rate_corrections_date ON exchange_rate_corrections(rate_date);
      CREATE INDEX IF NOT EXISTS idx_rate_corrections_shift ON exchange_rate_corrections(context_id);
    `);
  } catch {
    // Ignorar si ya existe
  }

  try {
    driver.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_terminal_number ON invoices(terminal_id, invoice_number)",
    );
  } catch {
    // Una base con números duplicados (solo posible tras un replay P2P defectuoso) no debe
    // inutilizar la caja: se omite el constraint y la secuencia evita nuevos choques.
  }

  // Secuencia de consecutivos por caja (auditoría §F5): reemplaza al COUNT(*)+1, que
  // reutilizaba números si una factura desaparecía físicamente.
  try {
    driver.exec(`
      CREATE TABLE IF NOT EXISTS invoice_sequences (
        terminal_id TEXT PRIMARY KEY,
        last_number INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
    `);
  } catch {
    // Ignorar si ya existe
  }

  // Operadores y bitácora de auditoría (control de acceso y roles)
  try {
    driver.exec(`
      CREATE TABLE IF NOT EXISTS operators (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('ADMIN', 'CASHIER')),
        pin_hash TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS operator_audit_logs (
        id TEXT PRIMARY KEY,
        operator_id TEXT NOT NULL,
        operator_name TEXT NOT NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        details TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_logs_operator ON operator_audit_logs(operator_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON operator_audit_logs(created_at);
    `);

    const rows = driver.all<{ count: number }>("SELECT COUNT(*) as count FROM operators");
    if ((rows[0]?.count ?? 0) === 0) {
      const now = Date.now();
      driver.run(
        "INSERT INTO operators (id, name, role, pin_hash, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        ["01940000-0000-7000-8000-000000000001", "Administrador", "ADMIN", hashOperatorPin("1234"), 1, now],
      );
      driver.run(
        "INSERT INTO operators (id, name, role, pin_hash, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        ["01940000-0000-7000-8000-000000000002", "Cajero 1", "CASHIER", hashOperatorPin("0000"), 1, now],
      );
    }
  } catch {
    // Ignorar si ya existe o está inicializado
  }
}

