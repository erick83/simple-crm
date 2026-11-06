import { describe, it, expect } from "vitest";
import {
  createWebDesktopSqliteDriver,
  seedInitialPosData,
} from "../src/database/web-sqlite-driver";
import {
  verifyOperatorPin,
  listOperators,
  createOperator,
  toggleOperatorActive,
  logOperatorAction,
  listAuditLogs,
  canDeleteOperator,
  deleteOperator,
} from "../src/database/repositories/operator.repository";

describe("web-sqlite-driver with operators", () => {
  it("permite verificar el PIN de Administrador (1234) y Cajero (0000) tras seedInitialPosData", () => {
    const db = createWebDesktopSqliteDriver();
    seedInitialPosData(db);

    const ops = listOperators(db);
    expect(ops.length).toBe(2);

    const admin = verifyOperatorPin(db, "1234");
    expect(admin).not.toBeNull();
    expect(admin?.role).toBe("ADMIN");
    expect(admin?.name).toBe("Administrador");
    expect(admin?.isActive).toBe(true);

    const cashier = verifyOperatorPin(db, "0000");
    expect(cashier).not.toBeNull();
    expect(cashier?.role).toBe("CASHIER");
    expect(cashier?.name).toBe("Cajero 1");
    expect(cashier?.isActive).toBe(true);
  });

  it("permite crear, verificar, bloquear y desbloquear operadores con el web driver", () => {
    const db = createWebDesktopSqliteDriver();
    seedInitialPosData(db);

    // Crear nuevo cajero con PIN 5555
    const nuevo = createOperator(db, {
      name: "Carlos Cajero",
      role: "CASHIER",
      pin: "5555",
    });
    expect(nuevo.name).toBe("Carlos Cajero");
    expect(nuevo.isActive).toBe(true);

    // Verificar login exitoso con 5555
    const verified = verifyOperatorPin(db, "5555");
    expect(verified).not.toBeNull();
    expect(verified?.id).toBe(nuevo.id);

    // Bloquear operador
    toggleOperatorActive(db, nuevo.id, false);
    const blockedCheck = verifyOperatorPin(db, "5555");
    expect(blockedCheck).toBeNull();

    // Desbloquear operador
    toggleOperatorActive(db, nuevo.id, true);
    const unblockedCheck = verifyOperatorPin(db, "5555");
    expect(unblockedCheck).not.toBeNull();
  });

  it("registra y lista eventos de auditoría correctamente en web driver", () => {
    const db = createWebDesktopSqliteDriver();
    seedInitialPosData(db);

    const admin = verifyOperatorPin(db, "1234")!;
    logOperatorAction(db, {
      operatorId: admin.id,
      operatorName: admin.name,
      action: "LOGIN",
      entityType: "AUTH",
      details: { terminalId: "TERM-01" },
    });

    const logs = listAuditLogs(db, { operatorId: admin.id });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0]?.action).toBe("LOGIN");
    expect(logs[0]?.operatorName).toBe("Administrador");
  });

  it("permite eliminar un operador sin registros históricos", () => {
    const db = createWebDesktopSqliteDriver();
    seedInitialPosData(db);

    const temp = createOperator(db, {
      name: "Temporal",
      role: "CASHIER",
      pin: "7777",
    });

    const check = canDeleteOperator(db, temp.id);
    expect(check.canDelete).toBe(true);

    deleteOperator(db, temp.id);
    expect(verifyOperatorPin(db, "7777")).toBeNull();
  });
});
