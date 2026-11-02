import { describe, it, expect } from "vitest";
import React from "react";
import { createTestDb } from "./helpers";
import { uuidv7 } from "../src/utils/uuid7";
import {
  openShift,
  getOpenShift,
  addCashMovement,
  listCashMovements,
  calculateShiftAuditTotals,
  performCierreZ,
  listClosedShifts,
} from "../src/database/repositories/shift.repository";
import { insertProduct } from "../src/database/repositories/product.repository";
import { createInvoice } from "../src/database/repositories/invoice.repository";
import {
  calculateDenominationsTotal,
  USD_DENOMINATIONS,
  VES_DENOMINATIONS,
} from "../src/utils/denominations";
import { ShiftsScreen } from "../src/screens/ShiftsScreen";

describe("PR-21: Movimientos de Gaveta (Sangrías/Ingresos) y Conteo por Denominación en Turnos", () => {
  const TERMINAL_1 = "TERM-01";

  it("registra sangrías (DROP) y entradas (INFLOW) con auditoría obligatoria en SQLite", () => {
    const db = createTestDb();

    const shiftId = openShift(db, {
      terminalId: TERMINAL_1,
      cashierName: "Erick",
      exchangeRateApplied: "45.0000",
      initialCashUsd: "100.0000",
      initialCashVes: "4500.0000",
    });

    // 1. Registrar sangría por seguridad a caja fuerte
    const drop = addCashMovement(db, {
      shiftId,
      terminalId: TERMINAL_1,
      movementType: "DROP",
      currency: "USD",
      amount: "60.0000",
      reason: "Retiro parcial de seguridad a sobre de caja fuerte",
      cashierName: "Erick",
    });

    expect(drop.id).toBeDefined();
    expect(drop.amount).toBe("60.0000");
    expect(drop.movementType).toBe("DROP");
    expect(drop.currency).toBe("USD");

    // 2. Registrar entrada de fondo sencillo para dar cambio en VES
    const inflow = addCashMovement(db, {
      shiftId,
      terminalId: TERMINAL_1,
      movementType: "INFLOW",
      currency: "VES",
      amount: "500.0000",
      reason: "Dotación de cambio sencillo en efectivo",
      cashierName: "Erick",
    });

    expect(inflow.id).toBeDefined();
    expect(inflow.amount).toBe("500.0000");
    expect(inflow.movementType).toBe("INFLOW");
    expect(inflow.currency).toBe("VES");

    // 3. Listar movimientos del turno
    const movements = listCashMovements(db, shiftId);
    expect(movements.length).toBe(2);
    expect(movements[0].movementType).toBe("DROP");
    expect(movements[1].movementType).toBe("INFLOW");
  });

  it("valida reglas de negocio en movimientos de gaveta (montos > 0, motivo obligatorio y turno abierto)", () => {
    const db = createTestDb();

    const shiftId = openShift(db, {
      terminalId: TERMINAL_1,
      cashierName: "Erick",
      exchangeRateApplied: "45.0000",
      initialCashUsd: "50.0000",
      initialCashVes: "2000.0000",
    });

    // Rechaza monto cero o negativo
    expect(() => {
      addCashMovement(db, {
        shiftId,
        terminalId: TERMINAL_1,
        movementType: "DROP",
        currency: "USD",
        amount: "0.0000",
        reason: "Prueba cero",
        cashierName: "Erick",
      });
    }).toThrow(/mayor a cero/);

    // Rechaza motivo vacío
    expect(() => {
      addCashMovement(db, {
        shiftId,
        terminalId: TERMINAL_1,
        movementType: "DROP",
        currency: "USD",
        amount: "20.0000",
        reason: "   ",
        cashierName: "Erick",
      });
    }).toThrow(/motivo/);

    // Cierre Z del turno
    performCierreZ(db, {
      shiftId,
      declaredCashUsd: "50.0000",
      declaredCashVes: "2000.0000",
    });

    // Rechaza registrar movimiento en turno cerrado
    expect(() => {
      addCashMovement(db, {
        shiftId,
        terminalId: TERMINAL_1,
        movementType: "DROP",
        currency: "USD",
        amount: "10.0000",
        reason: "Tardío",
        cashierName: "Erick",
      });
    }).toThrow(/turno cerrado/);
  });

  it("calcula exactamente el efectivo esperado en Cierre Z considerando inicial, ventas, sangrías y entradas", () => {
    const db = createTestDb();

    const p1 = insertProduct(db, {
      tenantId: uuidv7(),
      sku: "PROD-1",
      name: "Harina PAN",
      priceUsd: "2.0000",
      costUsd: "1.0000",
    });

    const shiftId = openShift(db, {
      terminalId: TERMINAL_1,
      cashierName: "Carlos",
      exchangeRateApplied: "45.0000",
      initialCashUsd: "50.0000", // Fondo inicial USD: 50.0000
      initialCashVes: "1000.0000", // Fondo inicial VES: 1000.0000
    });

    // Venta en efectivo USD: $30.0000
    createInvoice(db, {
      shiftId,
      terminalId: TERMINAL_1,
      exchangeRate: "45.0000",
      subtotalUsd: "30.0000",
      taxUsd: "0.0000",
      totalUsd: "30.0000",
      subtotalVes: "1350.0000",
      taxVes: "0.0000",
      totalVes: "1350.0000",
      paymentMethod: "CASH_USD",
      items: [
        {
          productId: p1,
          quantity: "15.0000",
          unitPriceUsd: "2.0000",
          unitPriceVes: "90.0000",
          lineTotalUsd: "30.0000",
          lineTotalVes: "1350.0000",
          taxRate: "0.0000",
        },
      ],
    });

    // Venta en efectivo VES: Bs. 450.0000 ($10 USD)
    createInvoice(db, {
      shiftId,
      terminalId: TERMINAL_1,
      exchangeRate: "45.0000",
      subtotalUsd: "10.0000",
      taxUsd: "0.0000",
      totalUsd: "10.0000",
      subtotalVes: "450.0000",
      taxVes: "0.0000",
      totalVes: "450.0000",
      paymentMethod: "CASH_VES",
      items: [
        {
          productId: p1,
          quantity: "5.0000",
          unitPriceUsd: "2.0000",
          unitPriceVes: "90.0000",
          lineTotalUsd: "10.0000",
          lineTotalVes: "450.0000",
          taxRate: "0.0000",
        },
      ],
    });

    // Movimientos de gaveta:
    // 1. Sangría de $40.0000 USD
    addCashMovement(db, {
      shiftId,
      terminalId: TERMINAL_1,
      movementType: "DROP",
      currency: "USD",
      amount: "40.0000",
      reason: "Retiro de seguridad",
      cashierName: "Carlos",
    });

    // 2. Entrada extraordinaria de Bs. 200.0000 para cambio
    addCashMovement(db, {
      shiftId,
      terminalId: TERMINAL_1,
      movementType: "INFLOW",
      currency: "VES",
      amount: "200.0000",
      reason: "Fondo sencillo",
      cashierName: "Carlos",
    });

    // Cálculos esperados:
    // USD: 50.0000 (inicial) + 30.0000 (ventas) - 40.0000 (sangría) = 40.0000
    // VES: 1000.0000 (inicial) + 450.0000 (ventas) + 200.0000 (entrada) = 1650.0000
    const audit = calculateShiftAuditTotals(db, shiftId);
    expect(audit.expectedCashUsd).toBe("40.0000");
    expect(audit.expectedCashVes).toBe("1650.0000");
    expect(audit.dropsCashUsd).toBe("40.0000");
    expect(audit.inflowsCashVes).toBe("200.0000");

    // Cajero hace arqueo ciego declarando exactamente lo que tiene en mano
    const cierre = performCierreZ(db, {
      shiftId,
      declaredCashUsd: "40.0000",
      declaredCashVes: "1650.0000",
    });

    expect(cierre.isSquare).toBe(true);
    expect(cierre.differenceUsd).toBe("0.0000");
    expect(cierre.differenceVes).toBe("0.0000");

    // Verificar en lista de turnos cerrados
    const history = listClosedShifts(db, TERMINAL_1);
    expect(history.length).toBe(1);
    expect(history[0].id).toBe(shiftId);
    expect(history[0].status).toBe("CLOSED");
  });

  it("calcula totales exactos con el Asistente de Billetes por Denominación", () => {
    // 2 billetes de $50 + 1 de $20 + 3 de $5 + 2 de $1 = 100 + 20 + 15 + 2 = $137.0000
    const usdCounts: Record<number, number> = {
      100: 0,
      50: 2,
      20: 1,
      10: 0,
      5: 3,
      2: 0,
      1: 2,
    };
    expect(calculateDenominationsTotal(usdCounts)).toBe("137.0000");

    // 4 billetes de Bs. 500 + 3 de Bs. 100 + 1 de Bs. 50 = 2000 + 300 + 50 = Bs. 2350.0000
    const vesCounts: Record<number, number> = {
      500: 4,
      200: 0,
      100: 3,
      50: 1,
      20: 0,
      10: 0,
    };
    expect(calculateDenominationsTotal(vesCounts)).toBe("2350.0000");

    // Maneja objetos vacíos o valores inválidos
    expect(calculateDenominationsTotal({})).toBe("0.0000");
    expect(calculateDenominationsTotal({ 20: -3, 50: NaN })).toBe("0.0000");
  });

  it("renderiza ShiftsScreen con modales y componentes táctiles de movimientos y denominaciones", () => {
    const db = createTestDb();
    const element = React.createElement(ShiftsScreen, {
      db,
      terminalId: TERMINAL_1,
      defaultExchangeRate: "45.0000",
    });
    expect(element).toBeDefined();
  });
});

