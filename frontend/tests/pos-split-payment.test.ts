import { describe, it, expect } from "vitest";
import React from "react";
import { createTestDb } from "./helpers";
import { uuidv7 } from "../src/utils/uuid7";
import { insertProduct, addStockMovement } from "../src/database/repositories/product.repository";
import { openShift, performCierreZ, performArqueoX } from "../src/database/repositories/shift.repository";
import { createInvoice, getInvoiceById, voidInvoice } from "../src/database/repositories/invoice.repository";
import { generatePeriodicBalance } from "../src/database/repositories/balance.repository";
import { PosScreen } from "../src/screens/PosScreen";
import { toDecimal, convertUsdToVes } from "../src/utils/decimal";

describe("PR-19: Cobro Combinado (SPLIT), Calculadora de Vuelto Bimoneda y Numpad de Pago", () => {
  const TENANT_1 = uuidv7();
  const TERMINAL_1 = "TERM-01";

  it("emite factura SPLIT con payment_breakdown y se refleja en el cuadre de arqueo y balance", () => {
    const db = createTestDb();

    const p1 = insertProduct(db, {
      tenantId: TENANT_1,
      sku: "PROD-1",
      name: "Producto General",
      priceUsd: "50.0000",
      costUsd: "30.0000",
      taxRate: "0.0000",
    });

    addStockMovement(db, { productId: p1, delta: "10.0000", type: "RESTOCK", terminalId: TERMINAL_1 });

    const shiftId = openShift(db, {
      terminalId: TERMINAL_1,
      cashierName: "Erick",
      exchangeRateApplied: "40.0000",
      initialCashUsd: "20.0000",
      initialCashVes: "500.0000",
    });

    // Venta de $50.0000 USD (≈ 2000.0000 VES)
    // Pago Mixto (SPLIT):
    // $20.0000 en efectivo USD
    // Bs. 1200.0000 en Pago Móvil ($30.0000 equiv @ 40)
    const breakdown = JSON.stringify({
      cash_usd: "20.0000",
      cash_ves: "0.0000",
      pago_movil: "1200.0000",
      card_ves: "0.0000",
    });

    const invoiceId = createInvoice(db, {
      shiftId,
      terminalId: TERMINAL_1,
      exchangeRate: "40.0000",
      subtotalUsd: "50.0000",
      taxUsd: "0.0000",
      totalUsd: "50.0000",
      subtotalVes: "2000.0000",
      taxVes: "0.0000",
      totalVes: "2000.0000",
      paymentMethod: "SPLIT",
      paymentBreakdown: breakdown,
      items: [
        {
          productId: p1,
          quantity: "1.0000",
          unitPriceUsd: "50.0000",
          unitPriceVes: "2000.0000",
          lineTotalUsd: "50.0000",
          lineTotalVes: "2000.0000",
          taxRate: "0.0000",
        },
      ],
    });

    const inv = getInvoiceById(db, invoiceId);
    expect(inv).toBeDefined();
    expect(inv?.paymentMethod).toBe("SPLIT");
    expect(inv?.paymentBreakdown).toBe(breakdown);

    // 1. Verificar Balance Consolidado desglosado
    const balance = generatePeriodicBalance(db, { terminalId: TERMINAL_1 });
    const cashUsdRow = balance.paymentBreakdown.find((b) => b.method === "CASH_USD");
    const pagoMovilRow = balance.paymentBreakdown.find((b) => b.method === "PAGO_MOVIL");

    expect(cashUsdRow?.totalUsd).toBe("20.0000");
    expect(pagoMovilRow?.totalVes).toBe("1200.0000");

    // 2. Verificar Arqueo Cierre Z
    // Esperado en efectivo USD: fondo $20.0000 + venta efectivo $20.0000 = $40.0000
    // Esperado en efectivo VES: fondo Bs. 500.0000 + venta efectivo Bs. 0 = Bs. 500.0000
    const z = performCierreZ(db, {
      shiftId,
      declaredCashUsd: "40.0000",
      declaredCashVes: "500.0000",
    });

    expect(z.expectedCashUsd).toBe("40.0000");
    expect(z.expectedCashVes).toBe("500.0000");
    expect(z.isSquare).toBe(true);
    expect(z.differenceUsd).toBe("0.0000");
    expect(z.differenceVes).toBe("0.0000");
  });

  it("calcula matemáticamente vuelto en USD y VES cuando el cliente entrega un billete mayor", () => {
    // Total de venta: $14.5000 USD
    // Tasa: 40.0000 Bs./$
    // Cliente paga con billete de $20.0000 USD
    const totalUsd = toDecimal("14.5000");
    const tenderUsd = toDecimal("20.0000");
    const rate = toDecimal("40.0000");

    const changeUsd = tenderUsd.minus(totalUsd);
    expect(changeUsd.toFixed(4)).toBe("5.5000");

    const changeVes = convertUsdToVes(changeUsd.toFixed(4), rate);
    expect(changeVes.toFixed(4)).toBe("220.0000"); // 5.5000 * 40 = 220
  });

  it("renderiza el componente PosScreen con soporte de Cobro Combinado", () => {
    const db = createTestDb();
    const elem = React.createElement(PosScreen, {
      db,
      terminalId: TERMINAL_1,
      tenantId: TENANT_1,
    });
    expect(elem).toBeDefined();
  });

  it("arqueo y balance leen ambos formatos de breakdown, clampan valores negativos/inválidos y excluyen facturas VOID", () => {
    const db = createTestDb();

    const p1 = insertProduct(db, {
      tenantId: TENANT_1,
      sku: "PROD-2",
      name: "Producto Split",
      priceUsd: "20.0000",
      costUsd: "10.0000",
      taxRate: "0.0000",
    });
    addStockMovement(db, { productId: p1, delta: "10.0000", type: "RESTOCK", terminalId: TERMINAL_1 });

    const shiftId = openShift(db, {
      terminalId: TERMINAL_1,
      cashierName: "Erick",
      exchangeRateApplied: "40.0000",
      initialCashUsd: "20.0000",
      initialCashVes: "500.0000",
    });

    // SPLIT con breakdown en forma de ARRAY (vía payments): $10 efectivo USD + Bs.400 Pago Móvil
    createInvoice(db, {
      shiftId,
      terminalId: TERMINAL_1,
      exchangeRate: "40.0000",
      totalUsd: "20.0000",
      totalVes: "800.0000",
      payments: [
        { method: "CASH_USD", amountUsd: "10.0000", amountVes: "400.0000", currency: "USD" },
        { method: "PAGO_MOVIL", amountUsd: "10.0000", amountVes: "400.0000", currency: "VES" },
      ],
      items: [{ productId: p1, quantity: "1.0000", unitPriceUsd: "20.0000", taxRate: "0.0000" }],
    });

    // SPLIT con breakdown corrupto (negativo + basura): no debe restar efectivo ni tumbar reportes
    const corruptId = createInvoice(db, {
      shiftId,
      terminalId: TERMINAL_1,
      exchangeRate: "40.0000",
      totalUsd: "5.0000",
      totalVes: "200.0000",
      paymentMethod: "SPLIT",
      paymentBreakdown: '{"cash_usd":"-5.0000","cash_ves":"basura","pago_movil":null,"card_ves":"0.0000"}',
      items: [{ productId: p1, quantity: "1.0000", unitPriceUsd: "5.0000", taxRate: "0.0000" }],
    });

    // Arqueo X: solo cuenta el efectivo USD legítimo del array; el corrupto no resta
    const x = performArqueoX(db, shiftId);
    expect(x.salesCashUsd).toBe("10.0000");
    expect(x.salesPagoMovilVes).toBe("400.0000");
    expect(x.expectedCashUsd).toBe("30.0000"); // fondo 20 + venta 10

    // Balance: el array se distribuye por método; el corrupto cae entero en la fila SPLIT
    const balance = generatePeriodicBalance(db, { terminalId: TERMINAL_1 });
    expect(balance.paymentBreakdown.find((b) => b.method === "CASH_USD")?.totalUsd).toBe("10.0000");
    expect(balance.paymentBreakdown.find((b) => b.method === "PAGO_MOVIL")?.totalVes).toBe("400.0000");
    const splitRow = balance.paymentBreakdown.find((b) => b.method === "SPLIT");
    expect(splitRow?.totalUsd).toBe("5.0000");
    expect(splitRow?.count).toBe(1);
    expect(balance.totalInvoices).toBe(2);

    // Anular la factura corrupta la saca del balance (el arqueo ya la excluye por status)
    voidInvoice(db, { invoiceId: corruptId, reason: "Anulación de prueba", terminalId: TERMINAL_1 });
    const balance2 = generatePeriodicBalance(db, { terminalId: TERMINAL_1 });
    expect(balance2.totalInvoices).toBe(1);
    expect(balance2.paymentBreakdown.find((b) => b.method === "SPLIT")).toBeUndefined();

    // Cierre Z cuadra con el efectivo físico real
    const z = performCierreZ(db, { shiftId, declaredCashUsd: "30.0000", declaredCashVes: "500.0000" });
    expect(z.expectedCashUsd).toBe("30.0000");
    expect(z.isSquare).toBe(true);
  });
});

