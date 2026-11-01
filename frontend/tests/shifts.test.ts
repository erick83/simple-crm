import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers";
import {
  openShift,
  getOpenShift,
  getShiftById,
  performArqueoX,
  performCierreZ,
} from "../src/database/repositories/shift.repository";
import { insertProduct } from "../src/database/repositories/product.repository";
import { createInvoice } from "../src/database/repositories/invoice.repository";
import { uuidv7 } from "../src/utils/uuid7";

describe("PR-06: Turnos de Caja Bimoneda (Arqueo X y Z)", () => {
  it("abre turno bimoneda con fondo inicial y tasa fija, e impide duplicados", () => {
    const db = createTestDb();
    const shiftId = openShift(db, {
      terminalId: "C01",
      cashierName: "Erick",
      exchangeRateApplied: "36.5000",
      initialCashUsd: "50.0000",
      initialCashVes: "1825.0000",
    });

    const shift = getOpenShift(db, "C01");
    expect(shift?.id).toBe(shiftId);
    expect(shift?.status).toBe("OPEN");
    expect(shift?.initialCashUsd).toBe("50.0000");
    expect(shift?.initialCashVes).toBe("1825.0000");
    expect(shift?.exchangeRateApplied).toBe("36.5000");

    // Impedir abrir dos turnos simultáneos en la misma terminal
    expect(() =>
      openShift(db, {
        terminalId: "C01",
        cashierName: "Pedro",
        exchangeRateApplied: "36.5000",
      }),
    ).toThrow(/Ya existe un turno abierto/);
  });

  it("calcula Arqueo X correctamente sin cerrar el turno", () => {
    const db = createTestDb();
    const prodId = insertProduct(db, {
      tenantId: uuidv7(),
      sku: "PROD-1",
      name: "Café",
      priceUsd: "2.0000",
      costUsd: "1.0000",
    });

    const shiftId = openShift(db, {
      terminalId: "C01",
      cashierName: "Erick",
      exchangeRateApplied: "40.0000",
      initialCashUsd: "100.0000",
      initialCashVes: "4000.0000",
    });

    // Venta 1: Pagada en efectivo USD ($10.0000)
    createInvoice(db, {
      shiftId,
      terminalId: "C01",
      invoiceNumber: "INV-001",
      exchangeRate: "40.0000",
      subtotalUsd: "10.0000",
      taxUsd: "0.0000",
      totalUsd: "10.0000",
      subtotalVes: "400.0000",
      taxVes: "0.0000",
      totalVes: "400.0000",
      paymentMethod: "CASH_USD",
      items: [
        {
          productId: prodId,
          quantity: "5.0000",
          unitPriceUsd: "2.0000",
          unitPriceVes: "80.0000",
          lineTotalUsd: "10.0000",
          lineTotalVes: "400.0000",
        },
      ],
    });

    // Venta 2: Pagada en efectivo VES (Bs. 800.0000)
    createInvoice(db, {
      shiftId,
      terminalId: "C01",
      invoiceNumber: "INV-002",
      exchangeRate: "40.0000",
      subtotalUsd: "20.0000",
      taxUsd: "0.0000",
      totalUsd: "20.0000",
      subtotalVes: "800.0000",
      taxVes: "0.0000",
      totalVes: "800.0000",
      paymentMethod: "CASH_VES",
      items: [
        {
          productId: prodId,
          quantity: "10.0000",
          unitPriceUsd: "2.0000",
          unitPriceVes: "80.0000",
          lineTotalUsd: "20.0000",
          lineTotalVes: "800.0000",
        },
      ],
    });

    // Venta 3: Pagada por Pago Móvil (Bs. 200.0000) -> No suma a efectivo gaveta
    createInvoice(db, {
      shiftId,
      terminalId: "C01",
      invoiceNumber: "INV-003",
      exchangeRate: "40.0000",
      subtotalUsd: "5.0000",
      taxUsd: "0.0000",
      totalUsd: "5.0000",
      subtotalVes: "200.0000",
      taxVes: "0.0000",
      totalVes: "200.0000",
      paymentMethod: "PAGO_MOVIL",
      items: [
        {
          productId: prodId,
          quantity: "2.5000",
          unitPriceUsd: "2.0000",
          unitPriceVes: "80.0000",
          lineTotalUsd: "5.0000",
          lineTotalVes: "200.0000",
        },
      ],
    });

    // Realizar Arqueo X
    const xReport = performArqueoX(db, shiftId);
    expect(xReport.invoiceCount).toBe(3);
    expect(xReport.salesCashUsd).toBe("10.0000");
    expect(xReport.salesCashVes).toBe("800.0000");
    expect(xReport.salesPagoMovilVes).toBe("200.0000");

    // Efectivo esperado en gaveta: fondo inicial + ventas en efectivo
    expect(xReport.expectedCashUsd).toBe("110.0000"); // 100 + 10
    expect(xReport.expectedCashVes).toBe("4800.0000"); // 4000 + 800

    // El turno sigue ABIERTO
    const shiftStillOpen = getShiftById(db, shiftId);
    expect(shiftStillOpen?.status).toBe("OPEN");
  });

  it("Cierre Z cuadrado bloquea el turno y genera diferencias exactas a 4 decimales", () => {
    const db = createTestDb();
    const prodId = insertProduct(db, {
      tenantId: uuidv7(),
      sku: "PROD-2",
      name: "Harina",
      priceUsd: "1.0000",
      costUsd: "0.8000",
    });

    const shiftId = openShift(db, {
      terminalId: "C01",
      cashierName: "Erick",
      exchangeRateApplied: "36.0000",
      initialCashUsd: "20.0000",
      initialCashVes: "720.0000",
    });

    createInvoice(db, {
      shiftId,
      terminalId: "C01",
      invoiceNumber: "INV-100",
      exchangeRate: "36.0000",
      subtotalUsd: "10.0000",
      taxUsd: "0.0000",
      totalUsd: "10.0000",
      subtotalVes: "360.0000",
      taxVes: "0.0000",
      totalVes: "360.0000",
      paymentMethod: "CASH_USD",
      items: [
        {
          productId: prodId,
          quantity: "10.0000",
          unitPriceUsd: "1.0000",
          unitPriceVes: "36.0000",
          lineTotalUsd: "10.0000",
          lineTotalVes: "360.0000",
        },
      ],
    });

    // Esperado: USD 30.0000, VES 720.0000
    // Cajero declara exactamente lo que hay (caja cuadrada)
    const zResult = performCierreZ(db, {
      shiftId,
      declaredCashUsd: "30.0000",
      declaredCashVes: "720.0000",
    });

    expect(zResult.isSquare).toBe(true);
    expect(zResult.differenceUsd).toBe("0.0000");
    expect(zResult.differenceVes).toBe("0.0000");
    expect(zResult.shift.status).toBe("CLOSED");
    expect(zResult.shift.closedAt).toBeGreaterThan(0);

    // Intento de emitir factura en turno cerrado debe ser RECHAZADO
    expect(() =>
      createInvoice(db, {
        shiftId,
        terminalId: "C01",
        invoiceNumber: "INV-101",
        exchangeRate: "36.0000",
        subtotalUsd: "1.0000",
        taxUsd: "0.0000",
        totalUsd: "1.0000",
        subtotalVes: "36.0000",
        taxVes: "0.0000",
        totalVes: "36.0000",
        paymentMethod: "CASH_USD",
        items: [
          {
            productId: prodId,
            quantity: "1.0000",
            unitPriceUsd: "1.0000",
            unitPriceVes: "36.0000",
            lineTotalUsd: "1.0000",
            lineTotalVes: "36.0000",
          },
        ],
      }),
    ).toThrow(/está cerrado/);

    // Intento de volver a cerrar el turno debe ser RECHAZADO
    expect(() =>
      performCierreZ(db, {
        shiftId,
        declaredCashUsd: "30.0000",
        declaredCashVes: "720.0000",
      }),
    ).toThrow(/ya se encuentra cerrado/);
  });

  it("Cierre Z detecta descuadres por sobrante o faltante con precisión fija", () => {
    const db = createTestDb();
    const shiftId = openShift(db, {
      terminalId: "C02",
      cashierName: "Pedro",
      exchangeRateApplied: "36.5000",
      initialCashUsd: "50.0000",
      initialCashVes: "1000.0000",
    });

    // Esperado sin ventas: USD 50.0000, VES 1000.0000
    // Cajero declara: USD 52.5000 (sobrante +2.5000), VES 950.0000 (faltante -50.0000)
    const zResult = performCierreZ(db, {
      shiftId,
      declaredCashUsd: "52.5000",
      declaredCashVes: "950.0000",
    });

    expect(zResult.isSquare).toBe(false);
    expect(zResult.differenceUsd).toBe("2.5000"); // Sobrante
    expect(zResult.differenceVes).toBe("-50.0000"); // Faltante
    expect(zResult.shift.status).toBe("CLOSED");

    // Verificar en SQLite persistencia de diferencias
    const [row] = db.all<{ difference_usd: string; difference_ves: string }>(
      "SELECT difference_usd, difference_ves FROM cash_shifts WHERE id = ?",
      [shiftId],
    );
    expect(row?.difference_usd).toBe("2.5000");
    expect(row?.difference_ves).toBe("-50.0000");
  });

  it("rechaza declaraciones con montos negativos", () => {
    const db = createTestDb();
    const shiftId = openShift(db, {
      terminalId: "C03",
      cashierName: "Ana",
      exchangeRateApplied: "36.5000",
    });

    expect(() =>
      performCierreZ(db, {
        shiftId,
        declaredCashUsd: "-10.0000",
        declaredCashVes: "0.0000",
      }),
    ).toThrow(/no pueden ser negativos/);
  });
});

