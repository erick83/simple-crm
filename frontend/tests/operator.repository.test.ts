import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./helpers";
import type { SqlDriver } from "../src/db/driver";
import {
  verifyOperatorPin,
  listOperators,
  getOperatorById,
  createOperator,
  toggleOperatorActive,
  canDeleteOperator,
  deleteOperator,
  updateOperatorPin,
  logOperatorAction,
  listAuditLogs,
  hashOperatorPin,
} from "../src/database/repositories/operator.repository";
import { openShift } from "../src/database/repositories/shift.repository";

describe("operator.repository", () => {
  let db: SqlDriver;

  beforeEach(() => {
    db = createTestDb();
  });

  describe("Semilla y Verificación de PIN", () => {
    it("crea automáticamente los operadores por defecto (Admin y Cajero 1) con sus PINes", () => {
      const operators = listOperators(db);
      expect(operators.length).toBe(2);

      const admin = verifyOperatorPin(db, "1234");
      expect(admin).not.toBeNull();
      expect(admin?.name).toBe("Administrador");
      expect(admin?.role).toBe("ADMIN");
      expect(admin?.isActive).toBe(true);

      const cashier = verifyOperatorPin(db, "0000");
      expect(cashier).not.toBeNull();
      expect(cashier?.name).toBe("Cajero 1");
      expect(cashier?.role).toBe("CASHIER");
      expect(cashier?.isActive).toBe(true);
    });

    it("rechaza PIN incorrecto devolviendo null", () => {
      expect(verifyOperatorPin(db, "9999")).toBeNull();
      expect(verifyOperatorPin(db, "1111")).toBeNull();
      expect(verifyOperatorPin(db, "")).toBeNull();
    });

    it("no permite login de un operador bloqueado/desactivado", () => {
      const cashier = verifyOperatorPin(db, "0000");
      expect(cashier).not.toBeNull();

      toggleOperatorActive(db, cashier!.id, false);

      expect(verifyOperatorPin(db, "0000")).toBeNull();

      // Al reactivarlo, vuelve a permitir el acceso
      toggleOperatorActive(db, cashier!.id, true);
      expect(verifyOperatorPin(db, "0000")).not.toBeNull();
    });
  });

  describe("Creación y Validación de Operadores", () => {
    it("permite registrar un nuevo cajero con PIN de 4 dígitos", () => {
      const newCashier = createOperator(db, {
        name: "María Gómez",
        role: "CASHIER",
        pin: "5555",
      });

      expect(newCashier.id).toBeDefined();
      expect(newCashier.name).toBe("María Gómez");
      expect(newCashier.role).toBe("CASHIER");
      expect(newCashier.pinHash).toBe(hashOperatorPin("5555"));

      const logged = verifyOperatorPin(db, "5555");
      expect(logged?.id).toBe(newCashier.id);
    });

    it("exige PIN de exactamente 4 dígitos", () => {
      expect(() =>
        createOperator(db, { name: "Test", role: "CASHIER", pin: "123" }),
      ).toThrow("El PIN debe ser exactamente de 4 dígitos numéricos");

      expect(() =>
        createOperator(db, { name: "Test", role: "CASHIER", pin: "12345" }),
      ).toThrow("El PIN debe ser exactamente de 4 dígitos numéricos");

      expect(() =>
        createOperator(db, { name: "Test", role: "CASHIER", pin: "abcd" }),
      ).toThrow("El PIN debe ser exactamente de 4 dígitos numéricos");
    });

    it("impide PIN duplicado entre operadores activos", () => {
      expect(() =>
        createOperator(db, { name: "Otro Admin", role: "ADMIN", pin: "1234" }),
      ).toThrow("El PIN ingresado ya está en uso");
    });

    it("no permite bloquear al único administrador activo", () => {
      const admin = verifyOperatorPin(db, "1234")!;
      expect(() => toggleOperatorActive(db, admin.id, false)).toThrow(
        "No se puede bloquear al único administrador activo",
      );
    });
  });

  describe("Eliminación Segura vs. Bloqueo", () => {
    it("permite eliminar un operador nuevo sin registros históricos", () => {
      const tempOp = createOperator(db, {
        name: "Temporal",
        role: "CASHIER",
        pin: "8888",
      });

      expect(canDeleteOperator(db, tempOp.id).canDelete).toBe(true);
      deleteOperator(db, tempOp.id);

      expect(getOperatorById(db, tempOp.id)).toBeNull();
    });

    it("impide eliminar un operador con turnos de caja registrados", () => {
      const cashier = verifyOperatorPin(db, "0000")!;

      // Abrir un turno a nombre del cajero
      openShift(db, {
        terminalId: "TERM-01",
        cashierName: cashier.name,
        exchangeRateApplied: "36.5000",
      });

      const check = canDeleteOperator(db, cashier.id);
      expect(check.canDelete).toBe(false);
      expect(check.reason).toContain("turnos de caja asociados");

      expect(() => deleteOperator(db, cashier.id)).toThrow(
        "turnos de caja asociados. Debe bloquearse para proteger el historial",
      );
    });

    it("impide eliminar un operador con eventos en la bitácora de auditoría", () => {
      const tempOp = createOperator(db, {
        name: "Cajero Auditado",
        role: "CASHIER",
        pin: "7777",
      });

      logOperatorAction(db, {
        operatorId: tempOp.id,
        operatorName: tempOp.name,
        action: "LOGIN",
        entityType: "AUTH",
      });

      const check = canDeleteOperator(db, tempOp.id);
      expect(check.canDelete).toBe(false);
      expect(check.reason).toContain("eventos de auditoría registrados");
    });
  });

  describe("Actualización de PIN (updateOperatorPin)", () => {
    it("permite cambiar el PIN a un operador y verificarlo con el nuevo valor", () => {
      const cashier = verifyOperatorPin(db, "0000")!;
      expect(cashier).not.toBeNull();

      updateOperatorPin(db, cashier.id, "4321");

      // El PIN viejo ya no funciona
      expect(verifyOperatorPin(db, "0000")).toBeNull();

      // El nuevo PIN desbloquea la cuenta
      const updated = verifyOperatorPin(db, "4321");
      expect(updated).not.toBeNull();
      expect(updated?.id).toBe(cashier.id);
      expect(updated?.name).toBe("Cajero 1");
    });

    it("rechaza PIN que no tenga exactamente 4 dígitos", () => {
      const cashier = verifyOperatorPin(db, "0000")!;
      expect(() => updateOperatorPin(db, cashier.id, "123")).toThrow("exactamente de 4 dígitos");
      expect(() => updateOperatorPin(db, cashier.id, "12345")).toThrow("exactamente de 4 dígitos");
      expect(() => updateOperatorPin(db, cashier.id, "abcd")).toThrow("exactamente de 4 dígitos");
    });

    it("rechaza un PIN que ya esté en uso por otro operador activo", () => {
      const cashier = verifyOperatorPin(db, "0000")!;
      // Intenta usar 1234 (que es del Admin)
      expect(() => updateOperatorPin(db, cashier.id, "1234")).toThrow(
        "ya está en uso por otro operador activo",
      );
    });
  });

  describe("Bitácora de Auditoría (operator_audit_logs)", () => {
    it("registra y lista acciones de auditoría con detalles", () => {
      const admin = verifyOperatorPin(db, "1234")!;

      const logId = logOperatorAction(db, {
        operatorId: admin.id,
        operatorName: admin.name,
        action: "SETTINGS_UPDATE",
        entityType: "SETTINGS",
        entityId: "tax_rate",
        details: { oldRate: "0.1600", newRate: "0.1800" },
      });

      expect(logId).toBeDefined();

      const logs = listAuditLogs(db, { operatorId: admin.id });
      expect(logs.length).toBe(1);
      expect(logs[0]?.action).toBe("SETTINGS_UPDATE");
      expect(logs[0]?.entityType).toBe("SETTINGS");
      expect(logs[0]?.entityId).toBe("tax_rate");
      expect(logs[0]?.details).toContain('"newRate":"0.1800"');
    });
  });
});
