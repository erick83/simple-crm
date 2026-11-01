import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SqlDriver } from "../src/db/driver";
import { initDatabase } from "../src/db/database";

export function betterSqliteDriver(db: Database.Database): SqlDriver {
  return {
    exec: (sql) => void db.exec(sql),
    run: (sql, params = []) => void db.prepare(sql).run(...params),
    all: <T>(sql: string, params: (string | number | null)[] = []) => db.prepare(sql).all(...params) as T[],
    transaction: (fn) => db.transaction(fn)(),
  };
}

export function createTestDb(): SqlDriver {
  const driver = betterSqliteDriver(new Database(":memory:"));
  const schema = readFileSync(resolve(__dirname, "../../docs/database_schema.sql"), "utf8");
  initDatabase(driver, schema);
  return driver;
}

