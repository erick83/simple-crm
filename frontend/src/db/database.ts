import type { SqlDriver } from "./driver";
import { migrateDatabase } from "../database/migrations";

export { migrateDatabase };

export function initDatabase(driver: SqlDriver, schemaSql?: string): void {
  migrateDatabase(driver, schemaSql);
}
