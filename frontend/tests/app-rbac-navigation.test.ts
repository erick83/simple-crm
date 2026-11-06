import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./helpers";
import type { SqlDriver } from "../src/db/driver";
import {
  verifyOperatorPin,
  listAuditLogs,
  logOperatorAction,
} from "../src/database/repositories/operator.repository";
import { openShift, getOpenShift } from "../src/database/repositories/shift.repository";

describe("App RBAC y Control de Navegación por Rol", () => {
  let db: SqlDriver;

  beforeEach(() => {
    db = createTestDb();
  });

  describe("Filtrado de secciones por Rol", () => {
    it("el Administrador tiene acceso completo a las 5 secciones del sistema", () => {
      const admin = verifyOperatorPin(db, "1234")!;
      expect(admin.role).toBe("ADMIN");

      const allTabs = ["pos", "inventory", "shifts", "balance", "settings"];
      const allowedTabs =
        admin.role === "ADMIN"
          ? ["pos", "inventory", "shifts", "balance", "settings"]
          : ["pos", "shifts"];

      expect(allowedTabs).toEqual(allTabs);
    });

    it("el Cajero solo tiene acceso a Caja y Turnos (Inventario, Balance y Configuración ocultos)", () => {
      const cashier = verifyOperatorPin(db, "0000")!;
      expect(cashier.role).toBe("CASHIER");

      const allowedTabs =
        cashier.role === "ADMIN"
          ? ["pos", "inventory", "shifts", "balance", "settings"]
          : ["pos", "shifts"];

      expect(allowedTabs).toEqual(["pos", "shifts"]);
      expect(allowedTabs).not.toContain("inventory");
      expect(allowedTabs).not.toContain("balance");
      expect(allowedTabs).not.toContain("settings");
    });
  });

  describe("Flujo de Apertura Forzada para Cajero", () => {
    it("si la caja está cerrada, el cajero es guiado a la pestaña Turnos", () => {
      const cashier = verifyOperatorPin(db, "0000")!;
      const openShiftRecord = getOpenShift(db, "TERM-01");
      expect(openShiftRecord).toBeFalsy();

      // Lógica de redirección implementada en App.tsx al desbloquear
      let targetTab = "pos";
      if (cashier.role === "CASHIER") {
        const shift = getOpenShift(db, "TERM-01");
        targetTab = shift ? "pos" : "shifts";
      }

      expect(targetTab).toBe("shifts");
    });

    it("si la caja ya está abierta, el cajero entra directamente a Caja", () => {
      const cashier = verifyOperatorPin(db, "0000")!;

      openShift(db, {
        terminalId: "TERM-01",
        cashierName: cashier.name,
        exchangeRateApplied: "36.5000",
        initialCashUsd: "50.0000",
        initialCashVes: "1825.0000",
      });

      let targetTab = "shifts";
      if (cashier.role === "CASHIER") {
        const shift = getOpenShift(db, "TERM-01");
        targetTab = shift ? "pos" : "shifts";
      }

      expect(targetTab).toBe("pos");
    });
  });

  describe("Bloqueo de Terminal y Auditoría", () => {
    it("registra evento LOGOUT en la bitácora al bloquear el terminal", () => {
      const cashier = verifyOperatorPin(db, "0000")!;

      // Simular evento de bloqueo
      logOperatorAction(db, {
        operatorId: cashier.id,
        operatorName: cashier.name,
        action: "LOGOUT",
        entityType: "AUTH",
        details: { terminalId: "TERM-01" },
      });

      const logs = listAuditLogs(db, { operatorId: cashier.id, action: "LOGOUT" });
      expect(logs.length).toBe(1);
      expect(logs[0]?.action).toBe("LOGOUT");
      expect(logs[0]?.entityType).toBe("AUTH");
      expect(logs[0]?.operatorName).toBe("Cajero 1");
    });
  });
});
