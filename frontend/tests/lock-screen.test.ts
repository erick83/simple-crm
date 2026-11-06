import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { createTestDb } from "./helpers";
import type { SqlDriver } from "../src/db/driver";
import type { LockScreenProps } from "../src/screens/LockScreen";
import {
  verifyOperatorPin,
  toggleOperatorActive,
  listAuditLogs,
  logOperatorAction,
} from "../src/database/repositories/operator.repository";
import type { OperatorEntity } from "../src/database/repositories/operator.repository";

describe("LockScreen (Pantalla de Bloqueo con PIN)", () => {
  let db: SqlDriver;

  beforeEach(() => {
    db = createTestDb();
  });

  it("define el contrato de propiedades de LockScreen", () => {
    const props: LockScreenProps = {
      db,
      terminalId: "TERM-01",
      onUnlock: () => {},
    };
    expect(props.terminalId).toBe("TERM-01");
  });

  it("permite verificar y desbloquear con el PIN de administrador predeterminado (1234)", () => {
    const operator = verifyOperatorPin(db, "1234");
    expect(operator).not.toBeNull();
    expect(operator?.name).toBe("Administrador");
    expect(operator?.role).toBe("ADMIN");
  });

  it("permite verificar y desbloquear con el PIN de cajero predeterminado (0000)", () => {
    const operator = verifyOperatorPin(db, "0000");
    expect(operator).not.toBeNull();
    expect(operator?.name).toBe("Cajero 1");
    expect(operator?.role).toBe("CASHIER");
  });

  it("rechaza un PIN incorrecto", () => {
    const operator = verifyOperatorPin(db, "9999");
    expect(operator).toBeNull();
  });

  it("detecta si un PIN pertenece a un operador inactivo/bloqueado", () => {
    const cashier = verifyOperatorPin(db, "0000")!;
    toggleOperatorActive(db, cashier.id, false);

    // No debe autenticar
    const auth = verifyOperatorPin(db, "0000");
    expect(auth).toBeNull();

    // Debe encontrarse en la lista de inactivos
    const rows = db.all<{ name: string }>(
      "SELECT name FROM operators WHERE pin_hash = (SELECT pin_hash FROM operators WHERE id = ?) AND is_active = 0",
      [cashier.id],
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.name).toBe("Cajero 1");
  });

  it("registra un evento de auditoría LOGIN al autenticar una sesión de terminal", () => {
    const admin = verifyOperatorPin(db, "1234")!;
    logOperatorAction(db, {
      operatorId: admin.id,
      operatorName: admin.name,
      action: "LOGIN",
      entityType: "AUTH",
      details: { terminalId: "TERM-01" },
    });

    const logs = listAuditLogs(db, { operatorId: admin.id, action: "LOGIN" });
    expect(logs.length).toBe(1);
    expect(logs[0]?.action).toBe("LOGIN");
    expect(logs[0]?.entityType).toBe("AUTH");
    expect(logs[0]?.details).toContain('"terminalId":"TERM-01"');
  });
});
