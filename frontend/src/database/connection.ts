import { NativeModules, Platform } from "react-native";
import { createWebDesktopSqliteDriver, seedInitialPosData } from "./web-sqlite-driver";

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
 * Verifica si el binario nativo C++/JSI de op-sqlite está compilado en el runtime actual.
 * En Expo Go (que no incluye binarios C++ de terceros) retorna false sin disparar RedBox.
 */
function isOpSqliteNativeAvailable(): boolean {
  if (Platform.OS === "web") return false;
  const g = globalThis as { __OPSQLiteProxy?: unknown };
  if (g.__OPSQLiteProxy != null) return true;
  return Boolean(NativeModules && (NativeModules as Record<string, unknown>).OPSQLite != null);
}

/**
 * Driver para @op-engineering/op-sqlite (Android / iOS / Windows Desktop nativo).
 * Inicializa la base de datos local con modo WAL y foreign keys activadas.
 */
export function createOpSqliteDriver(dbName = "bisync_pos.db"): SqlDriver {
  if (!isOpSqliteNativeAvailable()) {
    throw new Error("OPSQLite native module is not available in this runtime (Expo Go / Web).");
  }
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

/**
 * Crea e inicializa el SqlDriver adecuado según la plataforma:
 * - Build nativo Android / iOS con JSI: @op-engineering/op-sqlite
 * - Expo Go / Windows Desktop (Tauri) / Web: createWebDesktopSqliteDriver con semilla inicial
 */
export function createDefaultSqlDriver(
  opts: { dbName?: string; tenantId?: string; terminalId?: string; seedIfEmpty?: boolean } = {},
): SqlDriver {
  let driver: SqlDriver;
    if (!isOpSqliteNativeAvailable()) {
      driver = createWebDesktopSqliteDriver();
    } else {
      try {
        driver = createOpSqliteDriver(opts.dbName);
      } catch {
        driver = createWebDesktopSqliteDriver();
      }
    }

    if (opts.seedIfEmpty !== false) {
      seedInitialPosData(driver, {
        tenantId: opts.tenantId,
        terminalId: opts.terminalId,
      });
    }

    return driver;
  }

  let sharedDefaultDriver: SqlDriver | null = null;

  /**
   * Obtiene o inicializa el SqlDriver compartido de la aplicación.
   * Garantiza que incluso durante Fast Refresh (HMR) en el navegador, la instancia exista
   * y comparta el estado entre Caja (POS), Inventario, Turnos y Balance.
   */
  export function getOrCreateDefaultSqlDriver(
    opts: { dbName?: string; tenantId?: string; terminalId?: string } = {},
  ): SqlDriver {
    if (!sharedDefaultDriver) {
      sharedDefaultDriver = createDefaultSqlDriver(opts);
    }
    return sharedDefaultDriver;
  }

