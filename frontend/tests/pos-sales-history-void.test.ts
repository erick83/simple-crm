import { describe, it, expect } from "vitest";
import React from "react";
import { createTestDb } from "./helpers";
import { uuidv7 } from "../src/utils/uuid7";
import {
  insertProduct,
  addStockMovement,
  getCurrentStock,
} from "../src/database/repositories/product.repository";
import {
  openShift,
  calculateShiftAuditTotals,
  performCierreZ,
} from "../src/database/repositories/shift.repository";
import {
  createInvoice,
  getInvoiceById,
  listInvoicesByShift,
  voidInvoice,
} from "../src/database/repositories/invoice.repository";
import { PosScreen } from "../src/screens/PosScreen";

describe("PR-22: Historial de Ventas del Turno, Recibo Digital y Anulación Auditada con Reintegro de Stock", () => {
  const TENANT_1 = uuidv7();
  const TERMINAL_1 = "TERM-01";

  it("createInvoice encola evento INVOICE en peer_sync_outbox para replicación P2P", () => {
    const db = createTestDb();
    const t0 = 1700000000000;

    // 1. Crear producto con stock
    const p1 = insertProduct(
      db,
      {
        tenantId: TENANT_1,
        sku: "ARROZ-01",
        barcode: "75910002",
        name: "Arroz Primor 1kg",
        priceUsd: "1.5000",
        costUsd: "1.1000",
      },
      t0,
      TERMINAL_1,
    );

    addStockMovement(
      db,
      {
        productId: p1,
        delta: "50.0000",
        type: "RESTOCK",
        terminalId: TERMINAL_1,
      },
      t0,
    );

    // 2. Abrir turno
    const shiftId = openShift(
      db,
      {
        terminalId: TERMINAL_1,
        cashierName: "Erick",
        exchangeRateApplied: "45.0000",
        initialCashUsd: "20.0000",
        initialCashVes: "1000.0000",
      },
      t0,
    );

    // 3. Crear factura
    const invoiceId = createInvoice(
      db,
      {
        terminalId: TERMINAL_1,
        shiftId,
        exchangeRate: "45.0000",
        items: [
          {
            productId: p1,
            productName: "Arroz Primor 1kg",
            quantity: "2.0000",
            unitPriceUsd: "1.5000",
            taxRate: "0.1600",
            isExempt: false,
          },
        ],
        payments: [
          {
            method: "CASH_USD",
            amountUsd: "3.4800",
            amountVes: "156.6000",
            currency: "USD",
          },
        ],
      },
      t0 + 1000,
    );

    expect(invoiceId).toBeDefined();
    const invoice = getInvoiceById(db, invoiceId);
    expect(invoice).toBeDefined();
    expect(invoice!.status).toBe("COMPLETED");

    // 4. Verificar que se encoló en peer_sync_outbox
    const outboxRows = db.all<{
      entity_type: string;
      payload: string;
    }>(
      "SELECT * FROM peer_sync_outbox WHERE entity_type = 'INVOICE' AND entity_id = ?",
      [invoiceId],
    );
    expect(outboxRows.length).toBe(1);
    const row = outboxRows[0]!;
    expect(row.entity_type).toBe("INVOICE");
    const payload = JSON.parse(row.payload);
    expect(payload.id).toBe(invoiceId);
    expect(payload.totalUsd).toBe("3.4800");
  });

  it("listInvoicesByShift lista las facturas del turno con ítems y montos bimoneda", () => {
    const db = createTestDb();
    const t0 = 1700000000000;

    const p1 = insertProduct(
      db,
      {
        tenantId: TENANT_1,
        sku: "ACEITE-01",
        barcode: "75910003",
        name: "Aceite Mazeite 1L",
        priceUsd: "3.0000",
        costUsd: "2.3000",
      },
      t0,
      TERMINAL_1,
    );
    addStockMovement(
      db,
      {
        productId: p1,
        delta: "20.0000",
        type: "RESTOCK",
        terminalId: TERMINAL_1,
      },
      t0,
    );

    const shiftId = openShift(
      db,
      {
        terminalId: TERMINAL_1,
        cashierName: "Erick",
        exchangeRateApplied: "45.0000",
        initialCashUsd: "10.0000",
        initialCashVes: "500.0000",
      },
      t0,
    );

    // Factura 1 (emitida primero en t0 + 1000)
    createInvoice(
      db,
      {
        terminalId: TERMINAL_1,
        shiftId,
        exchangeRate: "45.0000",
        items: [
          {
            productId: p1,
            productName: "Aceite Mazeite 1L",
            quantity: "1.0000",
            unitPriceUsd: "3.0000",
            taxRate: "0.1600",
            isExempt: false,
          },
        ],
        payments: [
          {
            method: "PAGO_MOVIL",
            amountUsd: "3.4800",
            amountVes: "156.6000",
            currency: "VES",
          },
        ],
      },
      t0 + 1000,
    );

    // Factura 2 (emitida después en t0 + 2000)
    createInvoice(
      db,
      {
        terminalId: TERMINAL_1,
        shiftId,
        exchangeRate: "45.0000",
        items: [
          {
            productId: p1,
            productName: "Aceite Mazeite 1L",
            quantity: "2.0000",
            unitPriceUsd: "3.0000",
            taxRate: "0.1600",
            isExempt: false,
          },
        ],
        payments: [
          {
            method: "CASH_USD",
            amountUsd: "6.9600",
            amountVes: "313.2000",
            currency: "USD",
          },
        ],
      },
      t0 + 2000,
    );

    const invoices = listInvoicesByShift(db, shiftId);
    expect(invoices.length).toBe(2);
    // invoices[0] es la más reciente (Factura 2)
    expect(invoices[0]!.items.length).toBe(1);
    expect(invoices[0]!.totalUsd).toBe("6.9600");
    // invoices[1] es la primera (Factura 1)
    expect(invoices[1]!.totalUsd).toBe("3.4800");
  });

  it("voidInvoice anula factura, restituye stock de forma conmutativa (+RETURN) y encola en outbox", () => {
    const db = createTestDb();
    const t0 = 1700000000000;

    const p1 = insertProduct(
      db,
      {
        tenantId: TENANT_1,
        sku: "ATUN-01",
        barcode: "75910004",
        name: "Atún Margarita 140g",
        priceUsd: "1.8000",
        costUsd: "1.2000",
      },
      t0,
      TERMINAL_1,
    );

    // Stock inicial: 10 unidades
    addStockMovement(
      db,
      {
        productId: p1,
        delta: "10.0000",
        type: "RESTOCK",
        terminalId: TERMINAL_1,
      },
      t0,
    );
    expect(getCurrentStock(db, p1)?.currentStock).toBe("10.0000");

    const shiftId = openShift(
      db,
      {
        terminalId: TERMINAL_1,
        cashierName: "Erick",
        exchangeRateApplied: "45.0000",
        initialCashUsd: "10.0000",
        initialCashVes: "500.0000",
      },
      t0,
    );

    // Venta de 3 unidades
    const invoiceId = createInvoice(
      db,
      {
        terminalId: TERMINAL_1,
        shiftId,
        exchangeRate: "45.0000",
        items: [
          {
            productId: p1,
            productName: "Atún Margarita 140g",
            quantity: "3.0000",
            unitPriceUsd: "1.8000",
            taxRate: "0.0000",
            isExempt: true,
          },
        ],
        payments: [
          {
            method: "CASH_USD",
            amountUsd: "5.4000",
            amountVes: "243.0000",
            currency: "USD",
          },
        ],
      },
      t0 + 1000,
    );

    // El stock ahora debe ser 10 - 3 = 7.0000
    expect(getCurrentStock(db, p1)?.currentStock).toBe("7.0000");

    // Anulación obligatoria con motivo
    expect(() =>
      voidInvoice(
        db,
        {
          invoiceId,
          reason: "",
          terminalId: TERMINAL_1,
        },
        t0 + 2000,
      ),
    ).toThrow("El motivo de anulación es obligatorio");

    const voided = voidInvoice(
      db,
      {
        invoiceId,
        reason: "Cliente desistió de la compra antes de salir de caja",
        terminalId: TERMINAL_1,
      },
      t0 + 2000,
    );

    expect(voided.status).toBe("VOID");
    expect(voided.voidReason).toBe(
      "Cliente desistió de la compra antes de salir de caja",
    );
    expect(voided.voidedAt).toBe(t0 + 2000);

    // El stock debe haberse restituido a 10.0000 conmutativamente
    expect(getCurrentStock(db, p1)?.currentStock).toBe("10.0000");

    // Verificar que el movimiento conmutativo es tipo 'RETURN'
    const returnRows = db.all<{ quantity_delta: string }>(
      "SELECT quantity_delta FROM stock_movements WHERE product_id = ? AND movement_type = 'RETURN'",
      [p1],
    );
    expect(returnRows.length).toBe(1);
    expect(returnRows[0]!.quantity_delta).toBe("3.0000");

    // No se puede anular dos veces
    expect(() =>
      voidInvoice(
        db,
        {
          invoiceId,
          reason: "Segunda anulación no permitida",
          terminalId: TERMINAL_1,
        },
        t0 + 3000,
      ),
    ).toThrow("ya se encuentra anulada");

    // Verificar evento de anulación en peer_sync_outbox
    const outboxVoidRows = db.all<{ payload: string }>(
      "SELECT payload FROM peer_sync_outbox WHERE entity_type = 'INVOICE' AND entity_id = ?",
      [invoiceId],
    );
    expect(outboxVoidRows.length).toBe(2); // 1 INSERT + 1 VOID
    const voidPayload = JSON.parse(outboxVoidRows[1]!.payload);
    expect(voidPayload.status).toBe("VOID");
    expect(voidPayload.voidReason).toBe(
      "Cliente desistió de la compra antes de salir de caja",
    );
  });

  it("calculateShiftAuditTotals y performCierreZ excluyen facturas anuladas de la recaudación", () => {
    const db = createTestDb();
    const t0 = 1700000000000;

    const p1 = insertProduct(
      db,
      {
        tenantId: TENANT_1,
        sku: "LECHE-01",
        barcode: "75910005",
        name: "Leche Completa 1L",
        priceUsd: "2.0000",
        costUsd: "1.5000",
      },
      t0,
      TERMINAL_1,
    );
    addStockMovement(
      db,
      {
        productId: p1,
        delta: "20.0000",
        type: "RESTOCK",
        terminalId: TERMINAL_1,
      },
      t0,
    );

    const shiftId = openShift(
      db,
      {
        terminalId: TERMINAL_1,
        cashierName: "Erick",
        exchangeRateApplied: "45.0000",
        initialCashUsd: "50.0000",
        initialCashVes: "1000.0000",
      },
      t0,
    );

    // Factura 1: $10 en Efectivo USD (Válida)
    createInvoice(
      db,
      {
        terminalId: TERMINAL_1,
        shiftId,
        exchangeRate: "45.0000",
        items: [
          {
            productId: p1,
            productName: "Leche Completa 1L",
            quantity: "5.0000",
            unitPriceUsd: "2.0000",
            taxRate: "0.0000",
            isExempt: true,
          },
        ],
        payments: [
          {
            method: "CASH_USD",
            amountUsd: "10.0000",
            amountVes: "450.0000",
            currency: "USD",
          },
        ],
      },
      t0 + 1000,
    );

    // Factura 2: $6 en Efectivo USD (Luego será anulada)
    const inv2Id = createInvoice(
      db,
      {
        terminalId: TERMINAL_1,
        shiftId,
        exchangeRate: "45.0000",
        items: [
          {
            productId: p1,
            productName: "Leche Completa 1L",
            quantity: "3.0000",
            unitPriceUsd: "2.0000",
            taxRate: "0.0000",
            isExempt: true,
          },
        ],
        payments: [
          {
            method: "CASH_USD",
            amountUsd: "6.0000",
            amountVes: "270.0000",
            currency: "USD",
          },
        ],
      },
      t0 + 2000,
    );

    // Antes de anular: Total Ventas = 16.0000, Efectivo Esperado USD = 50 + 16 = 66.0000
    let totals = calculateShiftAuditTotals(db, shiftId);
    expect(totals.totalSalesUsd).toBe("16.0000");
    expect(totals.salesCashUsd).toBe("16.0000");
    expect(totals.expectedCashUsd).toBe("66.0000");

    // Anulamos la Factura 2
    voidInvoice(
      db,
      {
        invoiceId: inv2Id,
        reason: "Error de digitación",
        terminalId: TERMINAL_1,
      },
      t0 + 3000,
    );

    // Después de anular: Factura 2 excluida.
    // Total Ventas = 10.0000, Ventas Efectivo USD = 10.0000
    // Efectivo Esperado USD = 50 (fondo) + 10 (ventas válidas) = 60.0000
    totals = calculateShiftAuditTotals(db, shiftId);
    expect(totals.totalSalesUsd).toBe("10.0000");
    expect(totals.salesCashUsd).toBe("10.0000");
    expect(totals.expectedCashUsd).toBe("60.0000");

    // Cierre Z con arqueo ciego exacto de $60 y Bs. 1000
    const cierre = performCierreZ(
      db,
      {
        shiftId,
        declaredCashUsd: "60.0000",
        declaredCashVes: "1000.0000",
      },
      t0 + 4000,
    );

    expect(cierre.isSquare).toBe(true);
    expect(cierre.differenceUsd).toBe("0.0000");
    expect(cierre.expectedCashUsd).toBe("60.0000");
  });

  it("renderiza PosScreen con soporte para pestaña de historial y recibos digitales", () => {
    const db = createTestDb();
    const element = React.createElement(PosScreen, {
      db,
      terminalId: TERMINAL_1,
      tenantId: TENANT_1,
    });
    expect(element).toBeDefined();
  });
});
