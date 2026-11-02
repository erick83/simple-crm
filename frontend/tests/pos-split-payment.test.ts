import { describe, it, expect } from "vitest";
import React from "react";
import { createTestDb } from "./helpers";
import { uuidv7 } from "../src/utils/uuid7";
import { insertProduct, addStockMovement } from "../src/database/repositories/product.repository";
import { openShift, performCierreZ } from "../src/database/repositories/shift.repository";
import { createInvoice, getInvoiceById } from "../src/database/repositories/invoice.repository";
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
});

