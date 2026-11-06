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

function createInMemoryDriver(): SqlDriver {
  try {
    return betterSqliteDriver(new Database(":memory:"));
  } catch {
    // Fallback a node:sqlite nativo (Node 22.5+ / Node 24+) cuando better-sqlite3
    // fue compilado para un NODE_MODULE_VERSION distinto al Node activo en consola.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DatabaseSync } = require("node:sqlite") as {
      DatabaseSync: new (path: string) => {
        exec(sql: string): void;
        prepare(sql: string): {
          run(...params: (string | number | null)[]): unknown;
          all(...params: (string | number | null)[]): Record<string, unknown>[];
        };
      };
    };
    const db = new DatabaseSync(":memory:");
    return {
      exec: (sql) => void db.exec(sql),
      run: (sql, params = []) => void db.prepare(sql).run(...params),
      all: <T>(sql: string, params: (string | number | null)[] = []) =>
        db
          .prepare(sql)
          .all(...params)
          .map((row) => ({ ...row })) as T[],
      transaction: <T>(fn: () => T): T => {
        db.exec("BEGIN");
        try {
          const res = fn();
          db.exec("COMMIT");
          return res;
        } catch (txErr) {
          db.exec("ROLLBACK");
          throw txErr;
        }
      },
    };
  }
}

export function createTestDb(): SqlDriver {
  const driver = createInMemoryDriver();
  const schema = readFileSync(resolve(__dirname, "../../docs/database_schema.sql"), "utf8");
  initDatabase(driver, schema);
  return driver;
}

export interface LegacyDbHandle {
  /** Ejecuta DDL/DML suelto sobre la base heredada. */
  run(sql: string, params?: (string | number | null)[]): void;
}

/**
 * Base de datos con un DDL anterior a las migraciones actuales, para probar que una caja
 * ya instalada migra sin perder sus ventas. `driver` es el SqlDriver que recibe
 * `migrateDatabase`.
 */
export function openLegacyDb(legacyDdl: string): { driver: SqlDriver; handle: LegacyDbHandle } {
  try {
    const db = new Database(":memory:");
    db.exec(legacyDdl);
    return {
      driver: betterSqliteDriver(db),
      handle: { run: (sql, params = []) => void db.prepare(sql).run(...params) },
    };
  } catch {
    // Mismo fallback de createInMemoryDriver: node:sqlite nativo cuando better-sqlite3
    // fue compilado para otro NODE_MODULE_VERSION.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DatabaseSync } = require("node:sqlite") as {
      DatabaseSync: new (path: string) => {
        exec(sql: string): void;
        prepare(sql: string): {
          run(...params: (string | number | null)[]): unknown;
          all(...params: (string | number | null)[]): Record<string, unknown>[];
        };
      };
    };
    const db = new DatabaseSync(":memory:");
    db.exec(legacyDdl);
    return {
      driver: {
        exec: (sql) => void db.exec(sql),
        run: (sql, params = []) => void db.prepare(sql).run(...params),
        all: <T>(sql: string, params: (string | number | null)[] = []) =>
          db.prepare(sql).all(...params).map((row) => ({ ...row })) as T[],
        transaction: <T>(fn: () => T): T => {
          db.exec("BEGIN");
          try {
            const res = fn();
            db.exec("COMMIT");
            return res;
          } catch (txErr) {
            db.exec("ROLLBACK");
            throw txErr;
          }
        },
      },
      handle: { run: (sql, params = []) => void db.prepare(sql).run(...params) },
    };
  }
}

