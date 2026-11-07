import type { SqlDriver } from "./driver";
import { migrateDatabase, ensureBaseSchema } from "../database/migrations";

export { migrateDatabase, ensureBaseSchema };

export function initDatabase(driver: SqlDriver, schemaSql?: string): void {
  migrateDatabase(driver, schemaSql);
}
