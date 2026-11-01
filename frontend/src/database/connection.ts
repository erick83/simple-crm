export type SqlValue = string | number | null;

export interface SqlDriver {
  /** Ejecuta DDL o múltiples sentencias sin parámetros */
  exec(sql: string): void;
  /** Ejecuta una sentencia parametrizada (INSERT/UPDATE/DELETE) */
  run(sql: string, params?: SqlValue[]): void;
  /** Consulta y retorna todas las filas tipadas */
  all<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): T[];
  /** Ejecuta un bloque dentro de una transacción atómica (BEGIN/COMMIT/ROLLBACK) */
  transaction<T>(fn: () => T): T;
}

/**
 * Driver para @op-engineering/op-sqlite (Android / iOS / Windows Desktop nativo).
 * Inicializa la base de datos local con modo WAL y foreign keys activadas.
 */
export function createOpSqliteDriver(dbName = "bisync_pos.db"): SqlDriver {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { open } = require("@op-engineering/op-sqlite");
  const db = open({ name: dbName });

  db.execute("PRAGMA foreign_keys = ON;");
  db.execute("PRAGMA journal_mode = WAL;");

  return {
    exec(sql: string): void {
      db.execute(sql);
    },
    run(sql: string, params: SqlValue[] = []): void {
      db.execute(sql, params as (string | number | null)[]);
    },
    all<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []): T[] {
      const result = db.execute(sql, params as (string | number | null)[]);
      return (result.rows?._array ?? []) as T[];
    },
    transaction<T>(fn: () => T): T {
      db.execute("BEGIN TRANSACTION;");
      try {
        const res = fn();
        db.execute("COMMIT;");
        return res;
      } catch (err) {
        db.execute("ROLLBACK;");
        throw err;
      }
    },
  };
}

