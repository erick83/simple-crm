import type { SqlDriver } from "./connection";
import { SCHEMA_SQL } from "./schema.generated";

/**
 * Inicializa y migra la base de datos local SQLite ejecutando el esquema DDL oficial.
 * Garantiza idempotencia mediante sentencias CREATE IF NOT EXISTS.
 */
export function migrateDatabase(driver: SqlDriver, customSchemaSql?: string): void {
  const sql = customSchemaSql ?? SCHEMA_SQL;
  driver.exec(sql);
}

