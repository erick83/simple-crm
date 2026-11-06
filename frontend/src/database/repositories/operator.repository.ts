import type { SqlDriver } from "../connection";
import { uuidv7 } from "../../utils/uuid7";
import { sha256Hex } from "../../utils/crypto";

export type OperatorRole = "ADMIN" | "CASHIER";

export interface OperatorEntity {
  id: string;
  name: string;
  role: OperatorRole;
  pinHash: string;
  isActive: boolean;
  createdAt: number;
}

export type AuditAction =
  | "LOGIN"
  | "LOGOUT"
  | "OPEN_SHIFT"
  | "CLOSE_SHIFT"
  | "INVOICE_CREATE"
  | "INVOICE_VOID"
  | "CASH_MOVEMENT"
  | "STOCK_ADJUST"
  | "OPERATOR_CREATE"
  | "OPERATOR_UPDATE"
  | "OPERATOR_DELETE"
  | "SETTINGS_UPDATE";

export type AuditEntityType =
  | "AUTH"
  | "SHIFT"
  | "INVOICE"
  | "PRODUCT"
  | "CASH_MOVEMENT"
  | "OPERATOR"
  | "SETTINGS";

export interface AuditLogEntity {
  id: string;
  operatorId: string;
  operatorName: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string | null;
  details: string | null;
  createdAt: number;
}

export interface AuditLogInput {
  operatorId: string;
  operatorName: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | null;
  details?: Record<string, unknown> | string | null;
  createdAt?: number;
}

interface OperatorRow {
  id: string;
  name: string;
  role: string;
  pin_hash: string;
  is_active: number;
  created_at: number;
}

interface AuditLogRow {
  id: string;
  operator_id: string;
  operator_name: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: string | null;
  created_at: number;
}

export function hashOperatorPin(pin: string): string {
  const cleanPin = pin.trim();
  return sha256Hex(`bisync-operator:${cleanPin}`);
}

function mapOperatorRow(row: OperatorRow): OperatorEntity {
  return {
    id: row.id,
    name: row.name,
    role: row.role as OperatorRole,
    pinHash: row.pin_hash,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
  };
}

/**
 * Valida un PIN de 4 dígitos contra los operadores activos.
 * Devuelve el operador correspondiente o null si el PIN no coincide o el operador está bloqueado.
 */
export function verifyOperatorPin(db: SqlDriver, pin: string): OperatorEntity | null {
  const hash = hashOperatorPin(pin);
  const rows = db.all<OperatorRow>(
    "SELECT id, name, role, pin_hash, is_active, created_at FROM operators WHERE pin_hash = ? AND is_active = 1 LIMIT 1",
    [hash],
  );
  if (!rows || rows.length === 0) return null;
  return mapOperatorRow(rows[0]!);
}

/**
 * Obtiene un operador por su identificador único.
 */
export function getOperatorById(db: SqlDriver, id: string): OperatorEntity | null {
  const rows = db.all<OperatorRow>(
    "SELECT id, name, role, pin_hash, is_active, created_at FROM operators WHERE id = ? LIMIT 1",
    [id],
  );
  if (!rows || rows.length === 0) return null;
  return mapOperatorRow(rows[0]!);
}

/**
 * Lista todos los operadores registrados.
 */
export function listOperators(
  db: SqlDriver,
  options?: { includeInactive?: boolean },
): OperatorEntity[] {
  const includeInactive = options?.includeInactive ?? true;
  const sql = includeInactive
    ? "SELECT id, name, role, pin_hash, is_active, created_at FROM operators ORDER BY role ASC, name ASC"
    : "SELECT id, name, role, pin_hash, is_active, created_at FROM operators WHERE is_active = 1 ORDER BY role ASC, name ASC";
  const rows = db.all<OperatorRow>(sql);
  return rows.map(mapOperatorRow);
}

/**
 * Registra un nuevo operador en el sistema.
 */
export function createOperator(
  db: SqlDriver,
  args: {
    name: string;
    role: OperatorRole;
    pin: string;
  },
  now: number = Date.now(),
): OperatorEntity {
  const cleanName = args.name.trim();
  const cleanPin = args.pin.trim();

  if (!cleanName) {
    throw new Error("El nombre del operador no puede estar vacío");
  }
  if (!/^\d{4}$/.test(cleanPin)) {
    throw new Error("El PIN debe ser exactamente de 4 dígitos numéricos");
  }

  const hash = hashOperatorPin(cleanPin);
  const existingWithPin = db.all<OperatorRow>(
    "SELECT id FROM operators WHERE pin_hash = ? AND is_active = 1 LIMIT 1",
    [hash],
  );
  if (existingWithPin.length > 0) {
    throw new Error("El PIN ingresado ya está en uso por otro operador activo");
  }

  const id = uuidv7(now);
  db.run(
    "INSERT INTO operators (id, name, role, pin_hash, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)",
    [id, cleanName, args.role, hash, now],
  );

  return {
    id,
    name: cleanName,
    role: args.role,
    pinHash: hash,
    isActive: true,
    createdAt: now,
  };
}

/**
 * Activa o bloquea a un operador.
 */
export function toggleOperatorActive(
  db: SqlDriver,
  operatorId: string,
  isActive: boolean,
): void {
  const current = getOperatorById(db, operatorId);
  if (!current) {
    throw new Error(`Operador no encontrado: ${operatorId}`);
  }

  // Prevenir que se desactive al último administrador activo
  if (!isActive && current.role === "ADMIN") {
    const activeAdmins = db.all<{ count: number }>(
      "SELECT COUNT(*) as count FROM operators WHERE role = 'ADMIN' AND is_active = 1 AND id != ?",
      [operatorId],
    );
    if ((activeAdmins[0]?.count ?? 0) === 0) {
      throw new Error("No se puede bloquear al único administrador activo del sistema");
    }
  }

  db.run("UPDATE operators SET is_active = ? WHERE id = ?", [isActive ? 1 : 0, operatorId]);
}

/**
 * Determina si un operador puede ser eliminado físicamente de la base de datos
 * o si posee registros asociados que exigen bloqueo en su lugar.
 */
export function canDeleteOperator(
  db: SqlDriver,
  operatorId: string,
): { canDelete: boolean; reason?: string } {
  const operator = getOperatorById(db, operatorId);
  if (!operator) {
    return { canDelete: false, reason: "Operador no existe" };
  }

  // 1. Verificar si tiene turnos de caja registrados
  try {
    const shifts = db.all<{ count: number }>(
      "SELECT COUNT(*) as count FROM cash_shifts WHERE cashier_name = ?",
      [operator.name],
    );
    if ((shifts[0]?.count ?? 0) > 0) {
      return {
        canDelete: false,
        reason: "El operador posee turnos de caja asociados. Debe bloquearse para proteger el historial.",
      };
    }
  } catch {
    // Si la tabla no está disponible, continuar con la siguiente verificación
  }

  // 2. Verificar si tiene registros en la bitácora de auditoría
  try {
    const logs = db.all<{ count: number }>(
      "SELECT COUNT(*) as count FROM operator_audit_logs WHERE operator_id = ?",
      [operatorId],
    );
    if ((logs[0]?.count ?? 0) > 0) {
      return {
        canDelete: false,
        reason: "El operador posee eventos de auditoría registrados. Debe bloquearse en lugar de eliminarse.",
      };
    }
  } catch {
    // Ignorar si la tabla no está disponible
  }

  return { canDelete: true };
}

/**
 * Elimina físicamente a un operador siempre que no tenga registros históricos.
 */
export function deleteOperator(db: SqlDriver, operatorId: string): void {
  const check = canDeleteOperator(db, operatorId);
  if (!check.canDelete) {
    throw new Error(check.reason || "No se puede eliminar el operador debido a registros históricos.");
  }

  const operator = getOperatorById(db, operatorId);
  if (operator?.role === "ADMIN") {
    const activeAdmins = db.all<{ count: number }>(
      "SELECT COUNT(*) as count FROM operators WHERE role = 'ADMIN' AND id != ?",
      [operatorId],
    );
    if ((activeAdmins[0]?.count ?? 0) === 0) {
      throw new Error("No se puede eliminar al único administrador del sistema");
    }
  }

  db.run("DELETE FROM operators WHERE id = ?", [operatorId]);
}

/**
 * Registra una acción en la bitácora inmutable de auditoría.
 */
export function logOperatorAction(
  db: SqlDriver,
  entry: AuditLogInput,
): string {
  const now = entry.createdAt ?? Date.now();
  const id = uuidv7(now);
  const detailsStr =
    entry.details == null
      ? null
      : typeof entry.details === "string"
        ? entry.details
        : JSON.stringify(entry.details);

  db.run(
    "INSERT INTO operator_audit_logs (id, operator_id, operator_name, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      entry.operatorId,
      entry.operatorName,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      detailsStr,
      now,
    ],
  );
  return id;
}

/**
 * Consulta la bitácora de auditoría.
 */
export function listAuditLogs(
  db: SqlDriver,
  options?: {
    operatorId?: string;
    action?: AuditAction;
    limit?: number;
  },
): AuditLogEntity[] {
  const limit = options?.limit ?? 50;
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (options?.operatorId) {
    conditions.push("operator_id = ?");
    params.push(options.operatorId);
  }
  if (options?.action) {
    conditions.push("action = ?");
    params.push(options.action);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);

  const rows = db.all<AuditLogRow>(
    `SELECT id, operator_id, operator_name, action, entity_type, entity_id, details, created_at FROM operator_audit_logs ${whereClause} ORDER BY created_at DESC LIMIT ?`,
    params,
  );

  return rows.map((r) => ({
    id: r.id,
    operatorId: r.operator_id,
    operatorName: r.operator_name,
    action: r.action as AuditAction,
    entityType: r.entity_type as AuditEntityType,
    entityId: r.entity_id,
    details: r.details,
    createdAt: r.created_at,
  }));
}
