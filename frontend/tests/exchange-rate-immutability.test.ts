import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers";
import { uuidv7 } from "../src/utils/uuid7";
import { insertProduct } from "../src/database/repositories/product.repository";
import {
  openShift,
  getShiftById,
  setShiftExchangeRate,
  performCierreZ,
} from "../src/database/repositories/shift.repository";
import {
  createInvoice,
  generateNextInvoiceNumber,
  getInvoiceById,
  voidInvoice,
} from "../src/database/repositories/invoice.repository";
import { listRateCorrections } from "../src/database/repositories/exchange.repository";
import { registerManualRate, resolveDailyRate } from "../src/services/bcv-exchange.service";
import type { SqlDriver } from "../src/database/connection";

/**
 * Auditoría de inmutabilidad histórica §F3, §F4 y §F5: una tasa se fija al abrir el turno,
 * corregirla queda auditada y jamás re-tasa ventas emitidas, y el consecutivo fiscal
 * no se reutiliza.
 */
describe("Tasa del turno vinculante y bitácora de correcciones", () => {
  const TENANT = uuidv7();

  const productWithStock = (db: SqlDriver, costUsd = "2.0000") =>
    insertProduct(db, {
      tenantId: TENANT,
      sku: `LOMO-${Math.floor(Math.random() * 1e6)}`,
      name: "Lomo de res",
      priceUsd: "5.0000",
      costUsd,
      unit: "kg",
    });

  const sell = (db: SqlDriver, shiftId: string, productId: string, rate: string, now: number) =>
    createInvoice(
      db,
      {
        shiftId,
        terminalId: "C01",
        exchangeRate: rate,
        paymentMethod: "CASH_USD",
        items: [{ productId, quantity: "2.0000", unitPriceUsd: "5.0000" }],
      },
      now,
    );

  it("rechaza una venta cuya tasa no sea la del turno", () => {
    const db = createTestDb();
    const prodId = productWithStock(db);
    const shiftId = openShift(db, {
      terminalId: "C01",
      cashierName: "Erick",
      exchangeRateApplied: "40.0000",
    });

    expect(() => sell(db, shiftId, prodId, "36.5000", 2000)).toThrow(
      "no coincide con la tasa fijada en el turno",
    );

    // Equivalencia de forma: "40" y "40.0000" son la misma tasa
    expect(() => sell(db, shiftId, prodId, "40", 2000)).not.toThrow();

    // Y el rechazo no dejó media factura escrita
    const [count] = db.all<{ n: number }>("SELECT COUNT(*) AS n FROM invoices");
    expect(Number(count?.n ?? 0)).toBe(1);
  });

  it("permite corregir la tasa mientras el turno no tiene ventas, con rastro auditado", () => {
    const db = createTestDb();
    const shiftId = openShift(db, {
      terminalId: "C01",
      cashierName: "Erick",
      exchangeRateApplied: "40.0000",
    });

    const updated = setShiftExchangeRate(
      db,
      { shiftId, rate: "38.75", reason: "El BCV publicó mal la tasa de apertura", terminalId: "C01" },
      1500,
    );
    expect(updated.exchangeRateApplied).toBe("38.7500");
    expect(getShiftById(db, shiftId)?.exchangeRateApplied).toBe("38.7500");

    const corrections = listRateCorrections(db, { shiftId });
    expect(corrections).toHaveLength(1);
    expect(corrections[0]?.context).toBe("SHIFT");
    expect(corrections[0]?.previousRate).toBe("40.0000");
    expect(corrections[0]?.newRate).toBe("38.7500");
    expect(corrections[0]?.source).toBe("SHIFT_OVERRIDE");

    // Desde la corrección, el turno vende con su tasa nueva
    const prodId = productWithStock(db);
    expect(() => sell(db, shiftId, prodId, "38.7500", 2000)).not.toThrow();
  });

  it("exige motivo, rechaza la misma tasa y no permite corregir un turno con ventas", () => {
    const db = createTestDb();
    const shiftId = openShift(db, {
      terminalId: "C01",
      cashierName: "Erick",
      exchangeRateApplied: "40.0000",
    });

    expect(() =>
      setShiftExchangeRate(db, { shiftId, rate: "38.0000", reason: "   " }),
    ).toThrow("motivo de la corrección");
    expect(() =>
      setShiftExchangeRate(db, { shiftId, rate: "40.0000", reason: "Iguales" }),
    ).toThrow("ya es la tasa vigente del turno");

    const prodId = productWithStock(db);
    const invoiceId = sell(db, shiftId, prodId, "40.0000", 2000);

    expect(() =>
      setShiftExchangeRate(db, { shiftId, rate: "38.0000", reason: "Corrección tardía" }),
    ).toThrow("Cierra el turno (Z) y abre uno nuevo");

    // La venta emitida conserva su tasa original intacta
    expect(getInvoiceById(db, invoiceId)?.exchangeRate).toBe("40.0000");
  });

  it("corregir la tasa del día no re-tasa ventas ni arqueo ya cerrados", () => {
    const db = createTestDb();
    const prodId = productWithStock(db);

    // Tasa oficial del día publicada con error
    registerManualRate(
      db,
      { rateDate: "1970-01-01", rate: "40.0000", reason: "Tasa BCV del día" },
      1000,
    );

    const shiftId = openShift(db, {
      terminalId: "C01",
      cashierName: "Erick",
      exchangeRateApplied: "40.0000",
    });

    const invoiceId = sell(db, shiftId, prodId, "40.0000", 2000);
    const cierre = performCierreZ(
      db,
      { shiftId, declaredCashUsd: "10.0000", declaredCashVes: "0.0000" },
      3000,
    );
    expect(cierre.shift.exchangeRateApplied).toBe("40.0000");

    // El error se descubre después: se corrige el valor oficial del día
    registerManualRate(
      db,
      {
        rateDate: "1970-01-01",
        rate: "36.0000",
        reason: "El BCV publicó la tasa equivocada",
        allowUpdate: true,
      },
      5000,
    );

    // La venta y el turno cerrados conservan la tasa con la que se cobró
    const invoice = getInvoiceById(db, invoiceId)!;
    expect(invoice.exchangeRate).toBe("40.0000");
    expect(invoice.totalVes).toBe("400.0000");
    expect(getShiftById(db, shiftId)?.exchangeRateApplied).toBe("40.0000");

    // ...y la corrección del día quedó registrada con su valor anterior
    const corrections = listRateCorrections(db, { rateDate: "1970-01-01" });
    expect(corrections).toHaveLength(1);
    expect(corrections[0]?.context).toBe("EXCHANGE_RATE");
    expect(corrections[0]?.previousRate).toBe("40.0000");
    expect(corrections[0]?.newRate).toBe("36.0000");
    expect(corrections[0]?.source).toBe("MANUAL");
  });

  it("no duplica la corrección cuando el valor oficial no cambia", () => {
    const db = createTestDb();
    registerManualRate(db, { rateDate: "1970-01-01", rate: "40.0000", reason: "Alta inicial" });

    // Reenvío del mismo valor: upsert sin corrección
    registerManualRate(db, {
      rateDate: "1970-01-01",
      rate: "40.0000",
      reason: "Se volvió a registrar por error",
      allowUpdate: true,
    });
    expect(listRateCorrections(db, { rateDate: "1970-01-01" })).toHaveLength(0);
  });

  it("resolveDailyRate conserva la tasa del día y no la sobreescribe", async () => {
    const db = createTestDb();
    registerManualRate(db, { rateDate: "1970-01-01", rate: "40.0000", reason: "Alta manual" });

    const result = await resolveDailyRate(
      {
        db,
        countryCode: "VE",
        fetchFn: async () => ({
          ok: true,
          status: 200,
          text: async () => "<html><div id='dolarparalelo'>36,50</div></html>",
        }),
      },
      "1970-01-01",
    );

    expect(result.status).toBe("OK");
    if (result.status === "OK") expect(result.rate.rateToVes).toBe("40.0000");
    expect(listRateCorrections(db, { rateDate: "1970-01-01" })).toHaveLength(0);
  });
});

describe("Consecutivo fiscal sin reutilización (§F5)", () => {
  const TENANT = uuidv7();

  const newShift = (db: SqlDriver) =>
    openShift(db, {
      terminalId: "C01",
      cashierName: "Erick",
      exchangeRateApplied: "40.0000",
    });

  it("avanza por máximo y no libera un número al borrarse una factura", () => {
    const db = createTestDb();
    const shiftId = newShift(db);
    const prodId = insertProduct(db, {
      tenantId: TENANT,
      sku: "ARR-01",
      name: "Arroz 1kg",
      priceUsd: "2.0000",
      costUsd: "1.0000",
    });

    const first = createInvoice(
      db,
      {
        shiftId,
        terminalId: "C01",
        exchangeRate: "40.0000",
        paymentMethod: "CASH_USD",
        items: [{ productId: prodId, quantity: "1.0000", unitPriceUsd: "2.0000" }],
      },
      1000,
    );
    expect(getInvoiceById(db, first)?.invoiceNumber).toBe("C01-000001");

    const second = createInvoice(
      db,
      {
        shiftId,
        terminalId: "C01",
        exchangeRate: "40.0000",
        paymentMethod: "CASH_USD",
        items: [{ productId: prodId, quantity: "1.0000", unitPriceUsd: "2.0000" }],
      },
      2000,
    );
    expect(getInvoiceById(db, second)?.invoiceNumber).toBe("C01-000002");

    // Anular no libera el número (la anulada conserva su consecutivo)
    voidInvoice(db, { invoiceId: second, reason: "Devolución", terminalId: "C01" }, 3000);
    expect(generateNextInvoiceNumber(db, "C01")).toBe("C01-000003");

    // Borrado físico de la 002: el conteo habría vuelto a emitir C01-000002; el máximo no
    db.run("DELETE FROM invoice_items WHERE invoice_id = ?", [second]);
    db.run("DELETE FROM invoices WHERE id = ?", [second]);
    expect(generateNextInvoiceNumber(db, "C01")).toBe("C01-000003");
  });

  it("el índice único rechaza dos facturas con el mismo número en la misma caja", () => {
    const db = createTestDb();
    const shiftId = newShift(db);

    const insertInvoice = (id: string, terminal: string, number: string) =>
      db.run(
        `INSERT INTO invoices (id, shift_id, terminal_id, invoice_number, exchange_rate,
           subtotal_usd, tax_usd, total_usd, subtotal_ves, tax_ves, total_ves, payment_method, created_at)
         VALUES (?, ?, ?, ?, '40.0000', '1.0000', '0.0000', '1.0000', '40.0000', '0.0000', '40.0000', 'CASH_USD', 1000)`,
        [id, shiftId, terminal, number],
      );

    insertInvoice("inv-a", "C01", "C01-000001");
    expect(() => insertInvoice("inv-b", "C01", "C01-000001")).toThrow(/UNIQUE|constraint/i);

    // Otra caja puede usar el mismo sufijo: la unicidad es por terminal
    db.run(
      `INSERT INTO cash_shifts (id, terminal_id, cashier_name, opened_at, exchange_rate_applied, status)
       VALUES ('shift-c02', 'C02', 'María', 1, '40.0000', 'OPEN')`,
    );
    expect(() => insertInvoice("inv-c", "C02", "C02-000001")).not.toThrow();
    expect(() => insertInvoice("inv-d", "C02", "C02-000001")).toThrow(/UNIQUE|constraint/i);
  });

  it("una secuencia adelantada no retrocede aunque se borren las facturas", () => {
    const db = createTestDb();
    const shiftId = newShift(db);
    const prodId = insertProduct(db, {
      tenantId: uuidv7(),
      sku: "SAL-01",
      name: "Sal fina",
      priceUsd: "1.0000",
      costUsd: "0.5000",
    });

    createInvoice(
      db,
      {
        shiftId,
        terminalId: "C01",
        exchangeRate: "40.0000",
        paymentMethod: "CASH_USD",
        items: [{ productId: prodId, quantity: "1.0000", unitPriceUsd: "1.0000" }],
      },
      1000,
    );

    const [seq] = db.all<{ last_number: number }>(
      "SELECT last_number FROM invoice_sequences WHERE terminal_id = 'C01'",
    );
    expect(Number(seq?.last_number ?? 0)).toBe(1);

    // Borrado físico de la única factura: el conteo habría vuelto a C01-000001
    db.run("DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices)");
    db.run("DELETE FROM invoices");
    expect(generateNextInvoiceNumber(db, "C01")).toBe("C01-000002");
  });

  it("una emisión fallida no quema el consecutivo", () => {
    const db = createTestDb();
    const shiftId = newShift(db);
    const prodId = insertProduct(db, {
      tenantId: uuidv7(),
      sku: "PIM-01",
      name: "Pimienta molida",
      priceUsd: "1.0000",
      costUsd: "0.4000",
    });

    // Cantidad inválida: la transacción se revierte después de haber reservado el número
    expect(() =>
      createInvoice(
        db,
        {
          shiftId,
          terminalId: "C01",
          exchangeRate: "40.0000",
          paymentMethod: "CASH_USD",
          items: [{ productId: prodId, quantity: "0.0000", unitPriceUsd: "1.0000" }],
        },
        1000,
      ),
    ).toThrow("cantidad vendida debe ser mayor a cero");

    // La reserva se revierte junto con la factura: la secuencia no adelanta ni quema números
    // (si la fila aún no existía antes del intento, simplemente no queda fila).
    const [seq] = db.all<{ last_number: number }>(
      "SELECT last_number FROM invoice_sequences WHERE terminal_id = 'C01'",
    );
    expect(Number(seq?.last_number ?? 0)).toBe(0);

    // La siguiente venta recibe C01-000001, no el número del intento fallido
    const okId = createInvoice(
      db,
      {
        shiftId,
        terminalId: "C01",
        exchangeRate: "40.0000",
        paymentMethod: "CASH_USD",
        items: [{ productId: prodId, quantity: "1.0000", unitPriceUsd: "1.0000" }],
      },
      2000,
    );
    expect(getInvoiceById(db, okId)?.invoiceNumber).toBe("C01-000001");
  });
});
