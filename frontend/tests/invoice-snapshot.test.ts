import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers";
import { uuidv7 } from "../src/utils/uuid7";
import { insertProduct, updateProduct } from "../src/database/repositories/product.repository";
import { openShift } from "../src/database/repositories/shift.repository";
import {
  createInvoice,
  getInvoiceById,
} from "../src/database/repositories/invoice.repository";
import { generatePeriodicBalance } from "../src/database/repositories/balance.repository";
import { buildReceiptModel, renderReceiptText } from "../src/services/receipt-print.service";
import { P2pSyncService } from "../src/services/p2p-sync.service";
import type { SqlDriver } from "../src/database/connection";

/**
 * Auditoría de inmutabilidad histórica §F1 y §F2: el costo de reposición y la identidad
 * del producto se COPIAN en la línea de factura. Renombrar un rubro o editar su costo
 * no puede reescribir un documento ya emitido ni su margen.
 */
describe("Snapshot congelado en invoice_items", () => {
  const TENANT = uuidv7();
  const RATE = "40.0000";

  const seed = (db: SqlDriver) =>
    openShift(db, {
      terminalId: "C01",
      cashierName: "Erick",
      exchangeRateApplied: RATE,
    });

  const readLine = (db: SqlDriver, invoiceId: string) => {
    const [row] = db.all<{
      unit_cost_usd: string | null;
      product_name: string | null;
      product_sku: string | null;
      product_unit: string | null;
    }>(
      `SELECT unit_cost_usd, product_name, product_sku, product_unit
       FROM invoice_items WHERE invoice_id = ?`,
      [invoiceId],
    );
    return row;
  };

  it("congela costo, nombre, SKU y unidad en la línea al cobrar", () => {
    const db = createTestDb();
    const prodId = insertProduct(db, {
      tenantId: TENANT,
      sku: "LOMO-01",
      name: "Lomo de res",
      priceUsd: "9.0000",
      costUsd: "6.5000",
      unit: "kg",
    });

    const invoiceId = createInvoice(
      db,
      {
        shiftId: seed(db),
        terminalId: "C01",
        exchangeRate: RATE,
        paymentMethod: "CASH_USD",
        items: [{ productId: prodId, quantity: "2.0000", unitPriceUsd: "9.0000" }],
      },
      1000,
    );

    const line = readLine(db, invoiceId);
    expect(line?.unit_cost_usd).toBe("6.5000");
    expect(line?.product_name).toBe("Lomo de res");
    expect(line?.product_sku).toBe("LOMO-01");
    expect(line?.product_unit).toBe("kg");
  });

  it("editar el costo no recalcula el COGS ni el margen de la venta emitida", () => {
    const db = createTestDb();
    const prodId = insertProduct(db, {
      tenantId: TENANT,
      sku: "PACH-01",
      name: "Pacheca",
      priceUsd: "5.0000",
      costUsd: "3.0000",
    });

    const invoiceId = createInvoice(
      db,
      {
        shiftId: seed(db),
        terminalId: "C01",
        exchangeRate: RATE,
        paymentMethod: "CASH_USD",
        // 4 x $5.0000 = $20.0000 con costo $3.0000 => COGS $12.0000, margen $8.0000
        items: [{ productId: prodId, quantity: "4.0000", unitPriceUsd: "5.0000" }],
      },
      1000,
    );

    const antes = generatePeriodicBalance(db);
    expect(antes.totalCogsUsd).toBe("12.0000");
    expect(antes.totalGrossMarginUsd).toBe("8.0000");

    // El dueño corrige el costo de reposición al día siguiente
    updateProduct(db, { id: prodId, costUsd: "4.7500" }, 2000);

    const despues = generatePeriodicBalance(db);
    // La venta sigue valuada con el costo vigente al cobrar, no con el actual
    expect(despues.totalCogsUsd).toBe("12.0000");
    expect(despues.totalGrossMarginUsd).toBe("8.0000");
    expect(despues.grossMarginPercent).toBe(antes.grossMarginPercent);
    expect(readLine(db, invoiceId)?.unit_cost_usd).toBe("3.0000");
  });

  it("renombrar el rubro no reescribe el ticket impreso ni el ranking del balance", () => {
    const db = createTestDb();
    const prodId = insertProduct(db, {
      tenantId: TENANT,
      sku: "PICAD-01",
      name: "Picadilla especial",
      priceUsd: "4.0000",
      costUsd: "2.5000",
      unit: "kg",
    });

    const invoiceId = createInvoice(
      db,
      {
        shiftId: seed(db),
        terminalId: "C01",
        exchangeRate: RATE,
        paymentMethod: "CASH_VES",
        items: [{ productId: prodId, quantity: "1.0000", unitPriceUsd: "4.0000" }],
      },
      1000,
    );

    const invoice = getInvoiceById(db, invoiceId)!;
    expect(invoice.items[0]?.productName).toBe("Picadilla especial");
    expect(invoice.items[0]?.productSku).toBe("PICAD-01");
    expect(invoice.items[0]?.productUnit).toBe("kg");

    // Reorganización del catálogo al día siguiente
    updateProduct(db, { id: prodId, name: "Picadilla común", sku: "PICAD-99" }, 2000);

    const reemitida = getInvoiceById(db, invoiceId)!;
    expect(reemitida.items[0]?.productName).toBe("Picadilla especial");
    expect(reemitida.items[0]?.productSku).toBe("PICAD-01");

    // El ticket reconstruido conserva el texto original aunque el llamador resuelva
    // el nombre contra el catálogo vivo (comportamiento del POS en pantalla e impresión)
    const model = buildReceiptModel(reemitida, {
      branchName: "Carnicería La Sierra",
      resolveItemName: () => "Picadilla común",
    });
    const text = renderReceiptText(model);
    expect(text).toContain("Picadilla especial");
    expect(text).not.toContain("Picadilla comun");

    // El ranking del balance también reporta el nombre histórico
    const balance = generatePeriodicBalance(db);
    expect(balance.topProducts[0]?.name).toBe("Picadilla especial");
    expect(balance.topProducts[0]?.sku).toBe("PICAD-01");
  });

  it("las líneas anteriores a la migración (NULL) se resuelven contra products", () => {
    const db = createTestDb();
    const prodId = insertProduct(db, {
      tenantId: TENANT,
      sku: "HUESO-01",
      name: "Hueso con médula",
      priceUsd: "2.0000",
      costUsd: "1.0000",
    });

    const invoiceId = createInvoice(
      db,
      {
        shiftId: seed(db),
        terminalId: "C01",
        exchangeRate: RATE,
        paymentMethod: "CASH_USD",
        items: [{ productId: prodId, quantity: "3.0000", unitPriceUsd: "2.0000" }],
      },
      1000,
    );

    // Simular el registro heredado: sin snapshot en la línea
    db.run(
      "UPDATE invoice_items SET unit_cost_usd = NULL, product_name = NULL, product_sku = NULL, product_unit = NULL WHERE invoice_id = ?",
      [invoiceId],
    );

    const line = getInvoiceById(db, invoiceId)!.items[0];
    expect(line?.unitCostUsd).toBeNull();
    expect(line?.productName).toBeNull();

    // Fallback documentado: COGS con el costo vivo del producto (3 x $1.0000)
    const balance = generatePeriodicBalance(db);
    expect(balance.totalCogsUsd).toBe("3.0000");
    expect(balance.topProducts[0]?.name).toBe("Hueso con médula");
  });

  it("el evento INVOICE del outbox replica la línea ya congelada", () => {
    const db = createTestDb();
    const prodId = insertProduct(db, {
      tenantId: TENANT,
      sku: "MOLIDA-01",
      name: "Carne molida",
      priceUsd: "5.2500",
      costUsd: "3.1000",
      unit: "kg",
    });

    createInvoice(
      db,
      {
        shiftId: seed(db),
        terminalId: "C01",
        exchangeRate: RATE,
        paymentMethod: "CASH_USD",
        items: [{ productId: prodId, quantity: "2.5000", unitPriceUsd: "5.2500" }],
      },
      1000,
    );

    const events = P2pSyncService.getPendingEvents(db, "C02");
    const invoiceEvent = events.find((e) => e.entityType === "INVOICE");
    expect(invoiceEvent).toBeDefined();

    const payload = JSON.parse(invoiceEvent?.payload ?? "{}") as {
      items: { unitCostUsd: string; productName: string; productSku: string; productUnit: string }[];
    };
    expect(payload.items[0]?.unitCostUsd).toBe("3.1000");
    expect(payload.items[0]?.productName).toBe("Carne molida");
    expect(payload.items[0]?.productSku).toBe("MOLIDA-01");
    expect(payload.items[0]?.productUnit).toBe("kg");
  });
});
