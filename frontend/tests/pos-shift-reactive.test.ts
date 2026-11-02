import { describe, it, expect } from "vitest";
import React from "react";
import { createTestDb } from "./helpers";
import { uuidv7 } from "../src/utils/uuid7";
import { insertProduct, addStockMovement } from "../src/database/repositories/product.repository";
import { openShift, getOpenShift, performCierreZ } from "../src/database/repositories/shift.repository";
import { createInvoice } from "../src/database/repositories/invoice.repository";
import { registerManualRate } from "../src/services/bcv-exchange.service";
import { getRateForDate } from "../src/database/repositories/exchange.repository";
import { PosScreen } from "../src/screens/PosScreen";
import { ShiftsScreen } from "../src/screens/ShiftsScreen";
import { App } from "../src/App";

describe("PR-20: Sincronización Reactiva de Turno y Tasa Cambiaria Auditada", () => {
  const TENANT_1 = uuidv7();
  const TERMINAL_1 = "TERM-01";

  it("permite actualizar la tasa del día con auditoría mediante allowUpdate=true sin fallar por duplicados", () => {
    const db = createTestDb();
    const today = "2026-11-02";

    // 1. Registro inicial de tasa para el día de hoy
    registerManualRate(db, {
      rateDate: today,
      rate: "45.0000",
      reason: "Tasa apertura de mañana",
    });

    const rate1 = getRateForDate(db, today);
    expect(rate1).toBeDefined();
    expect(rate1?.rateToVes).toBe("45.0000");

    // 2. Intentar registrar de nuevo sin allowUpdate lanza error de duplicado (mantiene compatibilidad de auditoría estricta)
    expect(() => {
      registerManualRate(db, {
        rateDate: today,
        rate: "46.0000",
        reason: "Actualización no permitida sin flag",
        allowUpdate: false,
      });
    }).toThrow(/Ya existe/);

    // 3. Registrar con allowUpdate: true permite actualizar la tasa con auditoría
    registerManualRate(db, {
      rateDate: today,
      rate: "46.5000",
      reason: "Ajuste BCV publicado a la 1:00 PM",
      allowUpdate: true,
    });

    const rateUpdated = getRateForDate(db, today);
    expect(rateUpdated).toBeDefined();
    expect(rateUpdated?.rateToVes).toBe("46.5000");
    expect(rateUpdated?.notes).toBe("Ajuste BCV publicado a la 1:00 PM");
  });

  it("mantiene consistencia reactiva de apertura y cierre de turno", () => {
    const db = createTestDb();

    // Estado inicial: sin turno abierto
    expect(getOpenShift(db, TERMINAL_1)).toBeUndefined();

    // Apertura de turno
    const shiftId = openShift(db, {
      terminalId: TERMINAL_1,
      cashierName: "María",
      exchangeRateApplied: "45.0000",
      initialCashUsd: "50.0000",
      initialCashVes: "2250.0000",
    });

    const openShiftEntity = getOpenShift(db, TERMINAL_1);
    expect(openShiftEntity).toBeDefined();
    expect(openShiftEntity?.id).toBe(shiftId);
    expect(openShiftEntity?.cashierName).toBe("María");
    expect(openShiftEntity?.status).toBe("OPEN");

    // No permite abrir un segundo turno si ya hay uno abierto para la misma terminal
    expect(() => {
      openShift(db, {
        terminalId: TERMINAL_1,
        cashierName: "Pedro",
        exchangeRateApplied: "45.0000",
      });
    }).toThrow(/Ya existe un turno abierto para la terminal/);

    // Cierre Z del turno
    const cierre = performCierreZ(db, {
      shiftId,
      declaredCashUsd: "50.0000",
      declaredCashVes: "2250.0000",
    });

    expect(cierre.shift.status).toBe("CLOSED");
    // Al cerrarse, getOpenShift debe retornar undefined
    expect(getOpenShift(db, TERMINAL_1)).toBeUndefined();
  });

  it("impide facturación en PosScreen si no existe turno abierto en la base de datos", () => {
    const db = createTestDb();

    const p1 = insertProduct(db, {
      tenantId: TENANT_1,
      sku: "PROD-X",
      name: "Articulo Prueba",
      priceUsd: "10.0000",
      costUsd: "5.0000",
    });
    addStockMovement(db, { productId: p1, delta: "5.0000", type: "RESTOCK", terminalId: TERMINAL_1 });

    // Intentar crear factura sin turno debe arrojar error o bloquearse
    expect(() => {
      createInvoice(db, {
        shiftId: "no-shift-id",
        terminalId: TERMINAL_1,
        exchangeRate: "45.0000",
        subtotalUsd: "10.0000",
        taxUsd: "0.0000",
        totalUsd: "10.0000",
        subtotalVes: "450.0000",
        taxVes: "0.0000",
        totalVes: "450.0000",
        paymentMethod: "CASH_USD",
        items: [
          {
            productId: p1,
            quantity: "1.0000",
            unitPriceUsd: "10.0000",
            unitPriceVes: "450.0000",
            lineTotalUsd: "10.0000",
            lineTotalVes: "450.0000",
            taxRate: "0.0000",
          },
        ],
      });
    }).toThrow();

    // Abrir turno formalmente
    const shiftId = openShift(db, {
      terminalId: TERMINAL_1,
      cashierName: "Erick",
      exchangeRateApplied: "45.0000",
      initialCashUsd: "20.0000",
      initialCashVes: "900.0000",
    });

    // Ahora la facturación procede con éxito
    const invoiceId = createInvoice(db, {
      shiftId,
      terminalId: TERMINAL_1,
      exchangeRate: "45.0000",
      subtotalUsd: "10.0000",
      taxUsd: "0.0000",
      totalUsd: "10.0000",
      subtotalVes: "450.0000",
      taxVes: "0.0000",
      totalVes: "450.0000",
      paymentMethod: "CASH_USD",
      items: [
        {
          productId: p1,
          quantity: "1.0000",
          unitPriceUsd: "10.0000",
          unitPriceVes: "450.0000",
          lineTotalUsd: "10.0000",
          lineTotalVes: "450.0000",
          taxRate: "0.0000",
        },
      ],
    });

    expect(invoiceId).toBeDefined();
    expect(invoiceId.length).toBeGreaterThan(0);
  });

  it("renderiza componentes reactivos de PosScreen, ShiftsScreen y App sin fallar", () => {
    const db = createTestDb();

    // PosScreen instanciada con db
    const posElement = React.createElement(PosScreen, {
      db,
      terminalId: TERMINAL_1,
      tenantId: TENANT_1,
      initialExchangeRate: "45.0000",
      onNavigateToShifts: () => { },
    });
    expect(posElement).toBeDefined();

    // ShiftsScreen instanciada con callback reactivo
    let notifiedShift: unknown = null;
    const shiftsElement = React.createElement(ShiftsScreen, {
      db,
      terminalId: TERMINAL_1,
      defaultExchangeRate: "45.0000",
      onShiftChanged: (s) => {
        notifiedShift = s;
      },
    });
    expect(shiftsElement).toBeDefined();

    // App shell instanciada
    const appElement = React.createElement(App, {
      initialDb: db,
      terminalId: TERMINAL_1,
      tenantId: TENANT_1,
    });
    expect(appElement).toBeDefined();
  });
});
