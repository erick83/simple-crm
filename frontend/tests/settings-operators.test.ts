import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./helpers";
import type { SqlDriver } from "../src/db/driver";
import {
  listOperators,
  createOperator,
  toggleOperatorActive,
  canDeleteOperator,
  deleteOperator,
  updateOperatorPin,
  listAuditLogs,
  logOperatorAction,
} from "../src/database/repositories/operator.repository";
import { openShift } from "../src/database/repositories/shift.repository";
import { createInvoice } from "../src/database/repositories/invoice.repository";
import { insertProduct } from "../src/database/repositories/product.repository";

describe("Gestión de Operadores y Auditoría en Configuración", () => {
  let db: SqlDriver;

  beforeEach(() => {
    db = createTestDb();
  });

  describe("Listado y Creación de Operadores", () => {
    it("lista los operadores activos por defecto", () => {
      const ops = listOperators(db);
      expect(ops.length).toBe(2);
      expect(ops.some((o) => o.name === "Administrador" && o.role === "ADMIN")).toBe(true);
      expect(ops.some((o) => o.name === "Cajero 1" && o.role === "CASHIER")).toBe(true);
    });

    it("permite agregar un nuevo cajero y registra la auditoría", () => {
      const newOp = createOperator(db, {
        name: "Carlos Supervisor",
        role: "ADMIN",
        pin: "4321",
      });

      logOperatorAction(db, {
        operatorId: "admin-root",
        operatorName: "Administrador",
        action: "OPERATOR_CREATE",
        entityType: "OPERATOR",
        entityId: newOp.id,
        details: { name: newOp.name, role: newOp.role },
      });

      const ops = listOperators(db);
      expect(ops.length).toBe(3);
      expect(ops.some((o) => o.id === newOp.id)).toBe(true);

      const logs = listAuditLogs(db, { action: "OPERATOR_CREATE" });
      expect(logs.length).toBe(1);
      expect(logs[0]?.entityId).toBe(newOp.id);
      expect(logs[0]?.details).toContain("Carlos Supervisor");
    });
  });

  describe("Bloqueo y Desbloqueo", () => {
    it("bloquea y desbloquea operadores actualizando el estado y la auditoría", () => {
      const cashier = listOperators(db).find((o) => o.role === "CASHIER")!;
      expect(cashier.isActive).toBe(true);

      toggleOperatorActive(db, cashier.id, false);
      logOperatorAction(db, {
        operatorId: "admin-root",
        operatorName: "Administrador",
        action: "OPERATOR_UPDATE",
        entityType: "OPERATOR",
        entityId: cashier.id,
        details: { isActive: false },
      });

      const updated = listOperators(db).find((o) => o.id === cashier.id)!;
      expect(updated.isActive).toBe(false);

      const logs = listAuditLogs(db, { action: "OPERATOR_UPDATE" });
      expect(logs.length).toBe(1);
      expect(logs[0]?.details).toContain('"isActive":false');

      // Reactivar
      toggleOperatorActive(db, cashier.id, true);
      const reactivated = listOperators(db).find((o) => o.id === cashier.id)!;
      expect(reactivated.isActive).toBe(true);
    });
  });

  describe("Eliminación Condicional Segura", () => {
    it("permite eliminar operadores sin historial", () => {
      const tempOp = createOperator(db, {
        name: "Cajero Suplente",
        role: "CASHIER",
        pin: "7890",
      });

      expect(canDeleteOperator(db, tempOp.id).canDelete).toBe(true);

      deleteOperator(db, tempOp.id);
      logOperatorAction(db, {
        operatorId: "admin-root",
        operatorName: "Administrador",
        action: "OPERATOR_DELETE",
        entityType: "OPERATOR",
        entityId: tempOp.id,
      });

      expect(listOperators(db).some((o) => o.id === tempOp.id)).toBe(false);

      const logs = listAuditLogs(db, { action: "OPERATOR_DELETE" });
      expect(logs.length).toBe(1);
    });

    it("protege contra la eliminación a operadores con historial de turnos", () => {
      const cashier = listOperators(db).find((o) => o.role === "CASHIER")!;

      openShift(db, {
        terminalId: "TERM-01",
        cashierName: cashier.name,
        exchangeRateApplied: "36.5000",
      });

      const check = canDeleteOperator(db, cashier.id);
      expect(check.canDelete).toBe(false);
      expect(check.reason).toContain("turnos de caja asociados");
    });
  });

  describe("Instrumentación de Auditoría en Operaciones de Negocio", () => {
    it("registra eventos de turno y ventas en la bitácora", () => {
      const cashier = listOperators(db).find((o) => o.role === "CASHIER")!;

      // 1. Apertura de turno
      const shiftId = openShift(db, {
        terminalId: "TERM-01",
        cashierName: cashier.name,
        exchangeRateApplied: "36.5000",
        initialCashUsd: "50.0000",
        initialCashVes: "1825.0000",
      });

      logOperatorAction(db, {
        operatorId: cashier.id,
        operatorName: cashier.name,
        action: "OPEN_SHIFT",
        entityType: "SHIFT",
        entityId: shiftId,
        details: { initialCashUsd: "50.0000" },
      });

      // 2. Cobro de factura
      const prodId = insertProduct(db, {
        tenantId: "TENANT-001",
        sku: "SKU-1",
        name: "Harina PAN",
        priceUsd: "10.0000",
      });

      const invoiceId = createInvoice(db, {
        shiftId,
        terminalId: "TERM-01",
        exchangeRate: "36.5000",
        subtotalUsd: "10.0000",
        taxUsd: "1.6000",
        totalUsd: "11.6000",
        subtotalVes: "365.0000",
        taxVes: "58.4000",
        totalVes: "423.4000",
        paymentMethod: "CASH_USD",
        items: [
          {
            productId: prodId,
            quantity: "1.0000",
            unitPriceUsd: "10.0000",
            unitPriceVes: "365.0000",
            lineTotalUsd: "10.0000",
            lineTotalVes: "365.0000",
            taxRate: "0.1600",
          },
        ],
      });

      logOperatorAction(db, {
        operatorId: cashier.id,
        operatorName: cashier.name,
        action: "INVOICE_CREATE",
        entityType: "INVOICE",
        entityId: invoiceId,
        details: { totalUsd: "11.6000", paymentMethod: "CASH_USD" },
      });

      const shiftLogs = listAuditLogs(db, { action: "OPEN_SHIFT" });
      expect(shiftLogs.length).toBe(1);
      expect(shiftLogs[0]?.operatorName).toBe(cashier.name);
      expect(shiftLogs[0]?.entityId).toBe(shiftId);

      const invoiceLogs = listAuditLogs(db, { action: "INVOICE_CREATE" });
      expect(invoiceLogs.length).toBe(1);
      expect(invoiceLogs[0]?.operatorName).toBe(cashier.name);
      expect(invoiceLogs[0]?.entityId).toBe(invoiceId);
      expect(invoiceLogs[0]?.details).toContain('"totalUsd":"11.6000"');
    });

    it("permite actualizar el PIN de un operador y registra la auditoría OPERATOR_UPDATE", () => {
      const ops = listOperators(db);
      const cashier = ops.find((o) => o.role === "CASHIER")!;

      updateOperatorPin(db, cashier.id, "9999");

      logOperatorAction(db, {
        operatorId: "admin-root",
        operatorName: "Administrador",
        action: "OPERATOR_UPDATE",
        entityType: "OPERATOR",
        entityId: cashier.id,
        details: { field: "pin", targetName: cashier.name },
      });

      const updateLogs = listAuditLogs(db, { action: "OPERATOR_UPDATE" });
      expect(updateLogs.length).toBe(1);
      expect(updateLogs[0]?.entityId).toBe(cashier.id);
      expect(updateLogs[0]?.details).toContain('"field":"pin"');
    });
  });
});
