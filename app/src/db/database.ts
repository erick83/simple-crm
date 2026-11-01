import type { SqlDriver } from "./driver";

/**
 * Aplica el DDL base (docs/database_schema.sql). El DDL es idempotente
 * (CREATE ... IF NOT EXISTS), por lo que es seguro invocarlo en cada arranque.
 * El texto del esquema lo provee el llamador (bundler en RN, fs en tests/desktop).
 */
export function initDatabase(driver: SqlDriver, schemaSql: string): void {
  driver.exec(schemaSql);
}

