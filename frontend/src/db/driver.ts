/**
 * Abstracción mínima de SQLite. Producción: adaptador sobre `op-sqlite`.
 * Tests: adaptador sobre `better-sqlite3` (ver tests/helpers.ts).
 */
export type SqlValue = string | number | null;

export interface SqlDriver {
  /** Ejecuta uno o varios statements sin parámetros (DDL). */
  exec(sql: string): void;
  /** Ejecuta un statement con parámetros posicionales (?). */
  run(sql: string, params?: SqlValue[]): void;
  /** Devuelve todas las filas. */
  all<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): T[];
  /** Ejecuta `fn` de forma atómica (BEGIN/COMMIT/ROLLBACK). */
  transaction<T>(fn: () => T): T;
}

