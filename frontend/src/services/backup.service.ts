import type { SqlDriver, SqlValue } from "../database/connection";

export interface BackupMetadata {
  format: "bisync_pos_backup_v1";
  version: string;
  createdAt: string;
  tenantId: string;
  terminalId: string;
  createdBy?: string;
  totalRecords: number;
  tables: Record<string, Record<string, SqlValue>[]>;
}

export interface RestoreResult {
  success: boolean;
  message: string;
  restoredCount: number;
}

const BACKUP_TABLES = [
  "categories",
  "products",
  "stock_movements",
  "exchange_rates",
  "exchange_rate_corrections",
  "cash_shifts",
  "invoices",
  "invoice_items",
  "operators",
  "operator_audit_logs",
  "app_metadata",
  "license_state",
  "device_trials",
  "peer_sync_outbox",
] as const;

export class BackupService {
  /**
   * Genera un volcado completo de la base de datos en formato JSON estructurado.
   */
  static createBackup(
    db: SqlDriver,
    options?: {
      tenantId?: string;
      terminalId?: string;
      createdBy?: string;
    },
  ): BackupMetadata {
    const tablesData: Record<string, Record<string, SqlValue>[]> = {};
    let totalRecords = 0;

    for (const tableName of BACKUP_TABLES) {
      try {
        const rows = db.all<Record<string, SqlValue>>(`SELECT * FROM ${tableName}`);
        tablesData[tableName] = rows;
        totalRecords += rows.length;
      } catch {
        tablesData[tableName] = [];
      }
    }

    return {
      format: "bisync_pos_backup_v1",
      version: "1.0.0",
      createdAt: new Date().toISOString(),
      tenantId: options?.tenantId ?? "TENANT-001",
      terminalId: options?.terminalId ?? "TERM-01",
      createdBy: options?.createdBy ?? "Sistema",
      totalRecords,
      tables: tablesData,
    };
  }

  /**
   * Descarga la copia de seguridad como archivo .json en el entorno de escritorio / web.
   */
  static downloadBackupFile(backup: BackupMetadata, filename?: string): void {
    const name =
      filename ??
      `bisync-pos-backup-${new Date().toISOString().slice(0, 10)}-${Date.now()}.json`;

    const json = JSON.stringify(backup, null, 2);

    if (typeof document !== "undefined") {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Restaura una copia de seguridad validando su integridad y cargando los registros
   * de forma atómica dentro de una transacción SQLite.
   */
  static restoreBackup(
    db: SqlDriver,
    input: BackupMetadata | string,
  ): RestoreResult {
    let backup: BackupMetadata;
    try {
      backup = typeof input === "string" ? (JSON.parse(input) as BackupMetadata) : input;
    } catch {
      return {
        success: false,
        message: "El archivo de respaldo no es un JSON válido.",
        restoredCount: 0,
      };
    }

    if (!backup.tables || typeof backup.tables !== "object") {
      return {
        success: false,
        message: "Estructura de respaldo incompatible o inválida (falta sección de tablas).",
        restoredCount: 0,
      };
    }

    let restoredCount = 0;

    try {
      db.transaction(() => {
        // 1. Limpiar tablas existentes en orden de dependencia inversa
        const reverseTables = [...BACKUP_TABLES].reverse();
        for (const tbl of reverseTables) {
          try {
            db.run(`DELETE FROM ${tbl}`);
          } catch {
            // Ignorar tablas no creadas
          }
        }

        // 2. Insertar registros restaurados
        for (const tbl of BACKUP_TABLES) {
          const rows = backup.tables[tbl];
          if (!rows || !Array.isArray(rows) || rows.length === 0) continue;

          for (const row of rows) {
            const keys = Object.keys(row);
            if (keys.length === 0) continue;

            const placeholders = keys.map(() => "?").join(", ");
            const columns = keys.join(", ");
            const values = keys.map((k) => row[k] ?? null);

            const sql = `INSERT OR REPLACE INTO ${tbl} (${columns}) VALUES (${placeholders})`;
            db.run(sql, values);
            restoredCount++;
          }
        }
      });

      return {
        success: true,
        message: `Copia de seguridad restaurada exitosamente (${restoredCount} registros cargados).`,
        restoredCount,
      };
    } catch (err) {
      return {
        success: false,
        message: `Error al restaurar respaldo: ${err instanceof Error ? err.message : String(err)}`,
        restoredCount: 0,
      };
    }
  }

  /**
   * Restablece la base de datos a su estado limpio de fábrica
   * conservando el operador administrador por defecto.
   */
  static resetDatabase(db: SqlDriver): { success: boolean; message: string } {
    try {
      db.transaction(() => {
        for (const tbl of BACKUP_TABLES) {
          try {
            db.run(`DELETE FROM ${tbl}`);
          } catch {
            // Ignorar si no existe
          }
        }

        // Restaurar operador administrador inicial
        const now = Date.now();
        db.run(
          "INSERT INTO operators (id, name, role, pin_hash, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          [
            "01940000-0000-7000-8000-000000000001",
            "Administrador",
            "ADMIN",
            "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4", // SHA256("1234")
            1,
            now,
          ],
        );
      });

      return {
        success: true,
        message: "Base de datos restablecida a valores de fábrica correctamente.",
      };
    } catch (err) {
      return {
        success: false,
        message: `Error al restablecer base de datos: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
