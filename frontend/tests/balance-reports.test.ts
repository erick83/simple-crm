import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers";
import { insertProduct, addStockMovement } from "../src/database/repositories/product.repository";
import { openShift } from "../src/database/repositories/shift.repository";
import { createInvoice } from "../src/database/repositories/invoice.repository";
import { generatePeriodicBalance } from "../src/database/repositories/balance.repository";
import { uuidv7 } from "../src/utils/uuid7";

describe("PR-08: Módulo de Balance Periódico y Cierre Mensual", () => {
  it("totaliza ingresos, margen bruto y desglose por método de pago con precisión exacta", () => {
    const db = createTestDb();
    const tenantId = uuidv7();

    // 1. Crear productos con costo y precio
    // Prod A: Costo $1.0000, Precio $2.0000 (Margen $1.0000 = 50%)
    const prodA = insertProduct(db, {
      tenantId,
      sku: "PROD-A",
      name: "Café 500g",
      priceUsd: "2.0000",
      costUsd: "1.0000",
    });

    // Prod B: Costo $3.0000, Precio $5.0000 (Margen $2.0000 = 40%)
    const prodB = insertProduct(db, {
      tenantId,
      sku: "PROD-B",
      name: "Aceite 1L",
      priceUsd: "5.0000",
      costUsd: "3.0000",
    });

    // Fondos e inventario
    addStockMovement(db, { productId: prodA, terminalId: "C01", delta: "100.0000", type: "RESTOCK" });
    addStockMovement(db, { productId: prodB, terminalId: "C01", delta: "100.0000", type: "RESTOCK" });

    const shiftId = openShift(db, {
      terminalId: "C01",
      cashierName: "Erick",
      exchangeRateApplied: "40.0000",
    });

    // Venta 1: Prod A x 5 ($10.0000 / Bs. 400.0000) en Efectivo USD
    // Costo: 5 x $1.0000 = $5.0000
    createInvoice(
      db,
      {
        shiftId,
        terminalId: "C01",
        exchangeRate: "40.0000",
        paymentMethod: "CASH_USD",
        items: [
          {
            productId: prodA,
            quantity: "5.0000",
            unitPriceUsd: "2.0000",
            unitPriceVes: "80.0000",
            lineTotalUsd: "10.0000",
            lineTotalVes: "400.0000",
          },
        ],
      },
      1000,
    );

    // Venta 2: Prod B x 2 ($10.0000 / Bs. 400.0000) en Pago Móvil VES
    // Costo: 2 x $3.0000 = $6.0000
    createInvoice(
      db,
      {
        shiftId,
        terminalId: "C01",
        exchangeRate: "40.0000",
        paymentMethod: "PAGO_MOVIL",
        items: [
          {
            productId: prodB,
            quantity: "2.0000",
            unitPriceUsd: "5.0000",
            unitPriceVes: "200.0000",
            lineTotalUsd: "10.0000",
            lineTotalVes: "400.0000",
          },
        ],
      },
      2000,
    );

    // Venta 3: Prod A x 2 + Prod B x 1 = $4 + $5 = $9.0000 (Bs. 360.0000) en Punto/Tarjeta VES
    // Costo: 2x$1 + 1x$3 = $5.0000
    createInvoice(
      db,
      {
        shiftId,
        terminalId: "C01",
        exchangeRate: "40.0000",
        paymentMethod: "CARD_VES",
        items: [
          {
            productId: prodA,
            quantity: "2.0000",
            unitPriceUsd: "2.0000",
            unitPriceVes: "80.0000",
            lineTotalUsd: "4.0000",
            lineTotalVes: "160.0000",
          },
          {
            productId: prodB,
            quantity: "1.0000",
            unitPriceUsd: "5.0000",
            unitPriceVes: "200.0000",
            lineTotalUsd: "5.0000",
            lineTotalVes: "200.0000",
          },
        ],
      },
      3000,
    );

    // Generar balance de todo el período
    const balance = generatePeriodicBalance(db);

    expect(balance.totalInvoices).toBe(3);
    // Total Revenue USD: $10 + $10 + $9 = $29.0000
    expect(balance.totalRevenueUsd).toBe("29.0000");
    // Total Revenue VES: Bs. 400 + 400 + 360 = Bs. 1160.0000
    expect(balance.totalRevenueVes).toBe("1160.0000");

    // Costo Total (COGS): $5 (Venta 1) + $6 (Venta 2) + $5 (Venta 3) = $16.0000
    expect(balance.totalCogsUsd).toBe("16.0000");

    // Margen Bruto: $29.0000 - $16.0000 = $13.0000
    expect(balance.totalGrossMarginUsd).toBe("13.0000");
    // Margen %: (13 / 29) * 100 = 44.83%
    expect(balance.grossMarginPercent).toBe("44.83");

    // Desglose por método de pago
    const cashUsd = balance.paymentBreakdown.find((m) => m.method === "CASH_USD");
    expect(cashUsd?.totalUsd).toBe("10.0000");
    expect(cashUsd?.count).toBe(1);

    const pagoMovil = balance.paymentBreakdown.find((m) => m.method === "PAGO_MOVIL");
    expect(pagoMovil?.totalUsd).toBe("10.0000");
    expect(pagoMovil?.totalVes).toBe("400.0000");
    expect(pagoMovil?.count).toBe(1);

    const cardVes = balance.paymentBreakdown.find((m) => m.method === "CARD_VES");
    expect(cardVes?.totalUsd).toBe("9.0000");
    expect(cardVes?.totalVes).toBe("360.0000");
    expect(cardVes?.count).toBe(1);

    // Top productos vendidos
    // Prod B: $10 (Venta 2) + $5 (Venta 3) = $15.0000
    // Prod A: $10 (Venta 1) + $4 (Venta 3) = $14.0000
    expect(balance.topProducts[0]?.productId).toBe(prodB);
    expect(balance.topProducts[0]?.totalUsd).toBe("15.0000");
    expect(balance.topProducts[1]?.productId).toBe(prodA);
    expect(balance.topProducts[1]?.totalUsd).toBe("14.0000");
  });

  it("filtra el reporte exactamente por rango de fecha", () => {
    const db = createTestDb();
    const prodId = insertProduct(db, {
      tenantId: uuidv7(),
      sku: "ITEM",
      name: "Item",
      priceUsd: "10.0000",
      costUsd: "5.0000",
    });

    const shiftId = openShift(db, {
      terminalId: "C01",
      cashierName: "Erick",
      exchangeRateApplied: "40.0000",
    });

    // Factura en t=1000
    createInvoice(
      db,
      {
        shiftId,
        terminalId: "C01",
        exchangeRate: "40.0000",
        paymentMethod: "CASH_USD",
        items: [{ productId: prodId, quantity: "1.0000", unitPriceUsd: "10.0000", unitPriceVes: "400.0000", lineTotalUsd: "10.0000", lineTotalVes: "400.0000" }],
      },
      1000,
    );

    // Factura en t=5000
    createInvoice(
      db,
      {
        shiftId,
        terminalId: "C01",
        exchangeRate: "40.0000",
        paymentMethod: "CASH_USD",
        items: [{ productId: prodId, quantity: "2.0000", unitPriceUsd: "10.0000", unitPriceVes: "400.0000", lineTotalUsd: "20.0000", lineTotalVes: "800.0000" }],
      },
      5000,
    );

    // Factura en t=10000
    createInvoice(
      db,
      {
        shiftId,
        terminalId: "C01",
        exchangeRate: "40.0000",
        paymentMethod: "CASH_USD",
        items: [{ productId: prodId, quantity: "1.0000", unitPriceUsd: "10.0000", unitPriceVes: "400.0000", lineTotalUsd: "10.0000", lineTotalVes: "400.0000" }],
      },
      10000,
    );

    // Consulta filtrada entre t=2000 y t=6000 (solo debe incluir la de t=5000)
    const report = generatePeriodicBalance(db, {
      fromTimestamp: 2000,
      toTimestamp: 6000,
    });

    expect(report.totalInvoices).toBe(1);
    expect(report.totalRevenueUsd).toBe("20.0000");
    expect(report.totalRevenueVes).toBe("800.0000");
  });
});

