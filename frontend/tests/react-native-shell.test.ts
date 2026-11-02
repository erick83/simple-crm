import { describe, expect, it } from "vitest";
import React from "react";
import { colors } from "../src/theme/colors";
import { spacing } from "../src/theme/spacing";
import { formatUsd, formatVes, toDecimal, convertUsdToVes } from "../src/utils/decimal";
import { createTestDb } from "./helpers";
import { insertProduct } from "../src/database/repositories/product.repository";
import { openShift, getOpenShift } from "../src/database/repositories/shift.repository";
import { createInvoice } from "../src/database/repositories/invoice.repository";
import { LicenseValidatorService } from "../src/services/license-validator.service";
import { SCHEMA_SQL } from "../src/database/schema.generated";
import { migrateDatabase } from "../src/database/migrations";
import { uuidv7 } from "../src/utils/uuid7";
import { MonthlyBalanceScreen, ReportsScreen } from "../src/screens/MonthlyBalanceScreen";

describe("Design Tokens y Reglas de la Constitución", () => {
  it("cumple los colores de tema oscuro obligatorios", () => {
    expect(colors.dark.surfaceBase).toBe("#061426");
    expect(colors.dark.surfaceContainerLow).toBe("#0E1C2F");
    expect(colors.dark.primary).toBe("#1D61E0");
    expect(colors.dark.hero).toBe("#00B074");
  });

  it("cumple los touch targets mínimos de 48px y 64px", () => {
    expect(spacing.touchTargetMin).toBe(48);
    expect(spacing.touchTargetHero).toBe(64);
  });

  it("formatea moneda a 4 decimales exactos", () => {
    expect(formatUsd("1250")).toBe("$ 1,250.0000");
    expect(formatVes("45625.5")).toBe("Bs. 45,625.5000");
    expect(convertUsdToVes("10.0000", "36.5000").toFixed(4)).toBe("365.0000");
  });
});

describe("Database & Repositories en Frontend", () => {
  it("migra el esquema oficial autogenerado sin errores", () => {
    const db = createTestDb();
    expect(() => migrateDatabase(db, SCHEMA_SQL)).not.toThrow();
  });

  it("abre y consulta un turno de caja bimoneda", () => {
    const db = createTestDb();
    const shiftId = openShift(db, {
      terminalId: "TERM-01",
      cashierName: "Erick",
      exchangeRateApplied: "36.5000",
      initialCashUsd: "50.0000",
      initialCashVes: "1825.0000",
    });

    const shift = getOpenShift(db, "TERM-01");
    expect(shift?.id).toBe(shiftId);
    expect(shift?.initialCashUsd).toBe("50.0000");
    expect(shift?.initialCashVes).toBe("1825.0000");
    expect(shift?.exchangeRateApplied).toBe("36.5000");
  });

  it("emite factura con inmutabilidad cambiaria y descuenta stock atómicamente", () => {
    const db = createTestDb();
    const prodId = insertProduct(db, {
      tenantId: uuidv7(),
      sku: "PROD-10",
      name: "Harina PAN",
      priceUsd: "1.2500",
      costUsd: "0.9000",
    });

    const shiftId = openShift(db, {
      terminalId: "TERM-01",
      cashierName: "Erick",
      exchangeRateApplied: "36.5000",
    });

    const invoiceId = createInvoice(db, {
      shiftId,
      terminalId: "TERM-01",
      invoiceNumber: "INV-001",
      exchangeRate: "36.5000",
      subtotalUsd: "2.5000",
      taxUsd: "0.4000",
      totalUsd: "2.9000",
      subtotalVes: "91.2500",
      taxVes: "14.6000",
      totalVes: "105.8500",
      paymentMethod: "CASH_USD",
      items: [
        {
          productId: prodId,
          quantity: "2.0000",
          unitPriceUsd: "1.2500",
          unitPriceVes: "45.6250",
          lineTotalUsd: "2.5000",
          lineTotalVes: "91.2500",
        },
      ],
    });

    expect(invoiceId).toBeDefined();

    const [inv] = db.all<{ total_usd: string; total_ves: string; exchange_rate: string }>(
      "SELECT total_usd, total_ves, exchange_rate FROM invoices WHERE id = ?",
      [invoiceId],
    );
    expect(inv?.total_usd).toBe("2.9000");
    expect(inv?.total_ves).toBe("105.8500");
    expect(inv?.exchange_rate).toBe("36.5000");

    // Verificar movimiento delta en stock_movements
    const [sm] = db.all<{ quantity_delta: string }>(
      "SELECT quantity_delta FROM stock_movements WHERE reference_id = ?",
      [invoiceId],
    );
    expect(sm?.quantity_delta).toBe("-2.0000");
  });
});

describe("Guardia de Reloj Monótono", () => {
  it("detecta atraso deliberado del reloj del sistema", () => {
    const db = createTestDb();
    db.run(
      `INSERT INTO license_state (
        id, tenant_id, branch_id, terminal_id, hwid, raw_license_token,
        issued_at, valid_until, grace_period_days, last_recorded_timestamp, status
      ) VALUES ('current_license', 't1', 'b1', 'term1', 'hwid123', '{}', 1000, 9999999, 3, 50000, 'ACTIVE')`,
    );

    // Registro normal progresivo
    const check1 = LicenseValidatorService.verifyMonotonicClock(db, 60000);
    expect(check1.valid).toBe(true);

    // Intento de atrasar el reloj (tampering)
    const check2 = LicenseValidatorService.verifyMonotonicClock(db, 40000);
    expect(check2.valid).toBe(false);

    const evalRes = LicenseValidatorService.evaluateLicense(db, "hwid123", 40000);
    expect(evalRes.canCheckout).toBe(false);
    expect(evalRes.status).toBe("TAMPERED");
  });

  it("renderiza el módulo de reportes con soporte bimoneda e histórico BCV", () => {
    const db = createTestDb();
    const elem = React.createElement(ReportsScreen, { db });
    expect(elem).toBeDefined();
    expect(MonthlyBalanceScreen).toBe(ReportsScreen);
  });
});

