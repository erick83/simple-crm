import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers";
import { insertProduct } from "../src/database/repositories/product.repository";
import { openShift } from "../src/database/repositories/shift.repository";
import { createInvoice } from "../src/database/repositories/invoice.repository";
import { generatePeriodicBalance } from "../src/database/repositories/balance.repository";
import { uuidv7 } from "../src/utils/uuid7";
import { toDecimal } from "../src/utils/decimal";

/**
 * El margen bruto solo puede construirse sobre la venta cuyo costo de reposición fue cargado.
 * Los rubros sin control de inventario, y los controlados con costo 0.0000, se reportan aparte.
 */
describe("Balance: cobertura de costo y margen bruto", () => {
  it("excluye del margen la venta sin costo cargado y conserva el cuadre de la venta neta", () => {
    const db = createTestDb();
    const tenantId = uuidv7();

    // A: controlado con costo $1.0000 (margen real observable)
    const prodA = insertProduct(db, {
      tenantId,
      sku: "LOMO-01",
      name: "Lomo de res",
      priceUsd: "2.0000",
      costUsd: "1.0000",
    });
    // B: rubro sin control de inventario -> costo normalizado a 0.0000
    const prodB = insertProduct(db, {
      tenantId,
      sku: "PICAD-01",
      name: "Picadilla del día",
      priceUsd: "4.0000",
      unit: "kg",
      tracksInventory: false,
    });
    // C: controlado pero con costo aún no cargado
    const prodC = insertProduct(db, {
      tenantId,
      sku: "TOCINO-01",
      name: "Tocino",
      priceUsd: "3.0000",
      costUsd: "0.0000",
    });

    const shiftId = openShift(db, {
      terminalId: "C01",
      cashierName: "Erick",
      exchangeRateApplied: "40.0000",
    });

    createInvoice(
      db,
      {
        shiftId,
        terminalId: "C01",
        exchangeRate: "40.0000",
        paymentMethod: "CASH_USD",
        items: [
          // Venta neta: A 5 x $2 = $10 | B 2.5 x $4 = $10 | C 1 x $3 = $3  => $23.0000
          { productId: prodA, quantity: "5.0000", unitPriceUsd: "2.0000" },
          { productId: prodB, quantity: "2.5000", unitPriceUsd: "4.0000" },
          { productId: prodC, quantity: "1.0000", unitPriceUsd: "3.0000" },
        ],
      },
      1000,
    );

    const report = generatePeriodicBalance(db);

    // Venta neta y sus dos canastas
    expect(report.netSalesUsd).toBe("23.0000");
    expect(report.costedSalesUsd).toBe("10.0000");
    expect(report.uncostedSalesUsd).toBe("13.0000");
    expect(report.netSalesVes).toBe("920.0000");
    expect(report.costedSalesVes).toBe("400.0000");
    expect(report.uncostedSalesVes).toBe("520.0000");

    // Invariante de cuadre: costo conocido + sin costo = venta neta
    expect(
      toDecimal(report.costedSalesUsd).plus(toDecimal(report.uncostedSalesUsd)).toFixed(4),
    ).toBe(report.netSalesUsd);

    // COGS y margen: solo sobre la venta con costo (5 x $1.0000 = $5.0000)
    expect(report.totalCogsUsd).toBe("5.0000");
    expect(report.totalGrossMarginUsd).toBe("5.0000");
    // 5 / 10 = 50% sobre venta con costo (no 5/23 = 21.74% sobre la facturación)
    expect(report.grossMarginPercent).toBe("50.00");
    expect(report.costCoveragePercent).toBe("43.48");

    // Ranking: marca qué productos tienen costo cargado y cuáles no
    const byId = new Map(report.topProducts.map((p) => [p.productId, p]));
    expect(byId.get(prodA)?.hasCost).toBe(true);
    expect(byId.get(prodB)?.hasCost).toBe(false);
    expect(byId.get(prodC)?.hasCost).toBe(false);
  });

  it("reporta margen y cobertura en cero cuando ningún producto tiene costo cargado", () => {
    const db = createTestDb();
    const tenantId = uuidv7();

    const prodId = insertProduct(db, {
      tenantId,
      sku: "HUESO-01",
      name: "Hueso con médula",
      priceUsd: "1.5000",
      tracksInventory: false,
    });

    const shiftId = openShift(db, {
      terminalId: "C01",
      cashierName: "Erick",
      exchangeRateApplied: "40.0000",
    });

    createInvoice(
      db,
      {
        shiftId,
        terminalId: "C01",
        exchangeRate: "40.0000",
        paymentMethod: "CASH_USD",
        items: [{ productId: prodId, quantity: "2.0000", unitPriceUsd: "1.5000" }],
      },
      1000,
    );

    const report = generatePeriodicBalance(db);

    expect(report.netSalesUsd).toBe("3.0000");
    expect(report.costedSalesUsd).toBe("0.0000");
    expect(report.uncostedSalesUsd).toBe("3.0000");
    expect(report.totalCogsUsd).toBe("0.0000");
    expect(report.totalGrossMarginUsd).toBe("0.0000");
    // Sin base de venta con costo no se inventa un porcentaje de rentabilidad
    expect(report.grossMarginPercent).toBe("0.00");
    expect(report.costCoveragePercent).toBe("0.00");
  });
});
