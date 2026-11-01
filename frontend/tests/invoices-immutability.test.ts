import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers";
import { insertProduct, getCurrentStock, addStockMovement } from "../src/database/repositories/product.repository";
import { openShift, performCierreZ } from "../src/database/repositories/shift.repository";
import {
  createInvoice,
  getInvoiceById,
  generateNextInvoiceNumber,
} from "../src/database/repositories/invoice.repository";
import { insertRate } from "../src/database/repositories/exchange.repository";
import { uuidv7 } from "../src/utils/uuid7";

describe("PR-07: Emisión de Facturas, Inmutabilidad Cambiaria y Kardex Delta", () => {
  it("emite factura congelando permanentemente la tasa y totales en ambas monedas", () => {
    const db = createTestDb();
    const prodId = insertProduct(db, {
      tenantId: uuidv7(),
      sku: "HAR-01",
      name: "Harina PAN 1kg",
      priceUsd: "1.2500",
      costUsd: "0.9000",
    });

    const shiftId = openShift(db, {
      terminalId: "C01",
      cashierName: "Erick",
      exchangeRateApplied: "36.5000",
      initialCashUsd: "50.0000",
      initialCashVes: "1825.0000",
    });

    const invoiceId = createInvoice(db, {
      shiftId,
      terminalId: "C01",
      exchangeRate: "36.5000",
      paymentMethod: "CASH_USD",
      items: [
        {
          productId: prodId,
          quantity: "4.0000",
          unitPriceUsd: "1.2500",
          unitPriceVes: "45.6250",
          lineTotalUsd: "5.0000",
          lineTotalVes: "182.5000",
        },
      ],
    });

    const inv = getInvoiceById(db, invoiceId);
    expect(inv).toBeDefined();
    expect(inv?.invoiceNumber).toBe("C01-000001");
    expect(inv?.exchangeRate).toBe("36.5000");
    expect(inv?.totalUsd).toBe("5.0000");
    expect(inv?.totalVes).toBe("182.5000");
    expect(inv?.items).toHaveLength(1);
    expect(inv?.items[0]?.quantity).toBe("4.0000");
    expect(inv?.items[0]?.lineTotalUsd).toBe("5.0000");
    expect(inv?.items[0]?.lineTotalVes).toBe("182.5000");

    // INMUTABILIDAD: Mañana la tasa sube oficialmente a 50.0000 en SQLite
    insertRate(db, "2026-11-02", "50.0000", "BCV_AUTO", null, 2000);

    // Al consultar la factura anterior, NADA cambia retrospectivamente
    const invHistorical = getInvoiceById(db, invoiceId);
    expect(invHistorical?.exchangeRate).toBe("36.5000");
    expect(invHistorical?.totalUsd).toBe("5.0000");
    expect(invHistorical?.totalVes).toBe("182.5000");
    expect(invHistorical?.items[0]?.lineTotalVes).toBe("182.5000");
  });

  it("descuenta el inventario mediante deltas conmutativos inmutables y actualiza la vista", () => {
    const db = createTestDb();
    const prodId = insertProduct(db, {
      tenantId: uuidv7(),
      sku: "ARR-01",
      name: "Arroz 1kg",
      priceUsd: "1.5000",
      costUsd: "1.0000",
    });

    // 1. Carga inicial de inventario (+20.0000 unidades)
    addStockMovement(db, {
      productId: prodId,
      terminalId: "C01",
      delta: "20.0000",
      type: "RESTOCK",
    });
    expect(getCurrentStock(db, prodId)?.currentStock).toBe("20.0000");

    const shiftId = openShift(db, {
      terminalId: "C01",
      cashierName: "Erick",
      exchangeRateApplied: "40.0000",
    });

    // 2. Venta de 3.5000 unidades
    const inv1 = createInvoice(db, {
      shiftId,
      terminalId: "C01",
      exchangeRate: "40.0000",
      paymentMethod: "CASH_VES",
      items: [
        {
          productId: prodId,
          quantity: "3.5000",
          unitPriceUsd: "1.5000",
          unitPriceVes: "60.0000",
          lineTotalUsd: "5.2500",
          lineTotalVes: "210.0000",
        },
      ],
    });

    // Stock resultante: 20.0000 - 3.5000 = 16.5000
    expect(getCurrentStock(db, prodId)?.currentStock).toBe("16.5000");

    // Verificar registro delta conmutativo en tabla stock_movements
    const [sm1] = db.all<{ quantity_delta: string; movement_type: string; reference_id: string }>(
      "SELECT quantity_delta, movement_type, reference_id FROM stock_movements WHERE reference_id = ?",
      [inv1],
    );
    expect(sm1?.quantity_delta).toBe("-3.5000");
    expect(sm1?.movement_type).toBe("SALE");
    expect(sm1?.reference_id).toBe(inv1);

    // 3. Segunda venta de 1.5000 unidades
    createInvoice(db, {
      shiftId,
      terminalId: "C01",
      exchangeRate: "40.0000",
      paymentMethod: "PAGO_MOVIL",
      items: [
        {
          productId: prodId,
          quantity: "1.5000",
          unitPriceUsd: "1.5000",
          unitPriceVes: "60.0000",
          lineTotalUsd: "2.2500",
          lineTotalVes: "90.0000",
        },
      ],
    });

    // Stock resultante: 16.5000 - 1.5000 = 15.0000
    expect(getCurrentStock(db, prodId)?.currentStock).toBe("15.0000");
  });

  it("genera consecutivos auto-incrementales por caja", () => {
    const db = createTestDb();
    expect(generateNextInvoiceNumber(db, "C01")).toBe("C01-000001");

    const shiftId = openShift(db, {
      terminalId: "C01",
      cashierName: "Erick",
      exchangeRateApplied: "40.0000",
    });

    const prodId = insertProduct(db, {
      tenantId: uuidv7(),
      sku: "TEST-01",
      name: "Item",
      priceUsd: "1.0000",
      costUsd: "0.5000",
    });

    createInvoice(db, {
      shiftId,
      terminalId: "C01",
      exchangeRate: "40.0000",
      paymentMethod: "CASH_USD",
      items: [
        {
          productId: prodId,
          quantity: "1.0000",
          unitPriceUsd: "1.0000",
          unitPriceVes: "40.0000",
          lineTotalUsd: "1.0000",
          lineTotalVes: "40.0000",
        },
      ],
    });

    expect(generateNextInvoiceNumber(db, "C01")).toBe("C01-000002");
    expect(generateNextInvoiceNumber(db, "C02")).toBe("C02-000001");
  });

  it("realiza rollback atómico completo si la transacción de cobro falla", () => {
    const db = createTestDb();
    const prodId = insertProduct(db, {
      tenantId: uuidv7(),
      sku: "TEST-RB",
      name: "Item Rollback",
      priceUsd: "10.0000",
      costUsd: "5.0000",
    });

    addStockMovement(db, {
      productId: prodId,
      terminalId: "C01",
      delta: "10.0000",
      type: "RESTOCK",
    });

    const shiftId = openShift(db, {
      terminalId: "C01",
      cashierName: "Erick",
      exchangeRateApplied: "40.0000",
    });

    // Intentar venta con cantidad cero (debe fallar)
    expect(() =>
      createInvoice(db, {
        shiftId,
        terminalId: "C01",
        exchangeRate: "40.0000",
        paymentMethod: "CASH_USD",
        items: [
          {
            productId: prodId,
            quantity: "0.0000",
            unitPriceUsd: "10.0000",
            unitPriceVes: "400.0000",
            lineTotalUsd: "0.0000",
            lineTotalVes: "0.0000",
          },
        ],
      }),
    ).toThrow(/mayor a cero/);

    // Ni la factura fue persistida ni el stock fue alterado
    const [invCount] = db.all<{ count: number }>("SELECT COUNT(*) as count FROM invoices");
    expect(invCount?.count).toBe(0);
    expect(getCurrentStock(db, prodId)?.currentStock).toBe("10.0000");
  });
});

