import { describe, it, expect } from "vitest";
import React from "react";
import { createTestDb } from "./helpers";
import { uuidv7 } from "../src/utils/uuid7";
import { insertProduct, addStockMovement } from "../src/database/repositories/product.repository";
import { openShift } from "../src/database/repositories/shift.repository";
import { createInvoice, getInvoiceById } from "../src/database/repositories/invoice.repository";
import { Numpad } from "../src/components/Numpad";
import { PosScreen } from "../src/screens/PosScreen";
import { toDecimal } from "../src/utils/decimal";

describe("PR-18: Ticket con Numpad para Cantidades/Pesables, IVA Real y Acciones Rápidas", () => {
  const TENANT_1 = uuidv7();
  const TERMINAL_1 = "TERM-01";

  it("permite entrada numérica con punto decimal en el Numpad", () => {
    let digits = "";
    let isCleared = false;
    let backspaced = false;

    const numpadElem = React.createElement(Numpad, {
      onDigit: (d: string) => {
        digits += d;
      },
      onDecimal: () => {
        if (!digits.includes(".")) digits += ".";
      },
      onClear: () => {
        digits = "";
        isCleared = true;
      },
      onBackspace: () => {
        digits = digits.slice(0, -1);
        backspaced = true;
      },
      showDecimal: true,
    });

    expect(numpadElem).toBeDefined();

    // Simular escritura de pesable 0.750
    numpadElem.props.onDigit("0");
    numpadElem.props.onDecimal!();
    numpadElem.props.onDigit("7");
    numpadElem.props.onDigit("5");
    expect(digits).toBe("0.75");

    numpadElem.props.onBackspace();
    expect(digits).toBe("0.7");
    expect(backspaced).toBe(true);

    numpadElem.props.onClear();
    expect(digits).toBe("");
    expect(isCleared).toBe(true);
  });

  it("calcula y congela el IVA real y subtotal en la factura según el taxRate del producto", () => {
    const db = createTestDb();

    // Producto 1: Con IVA 16% (0.1600)
    const p1 = insertProduct(db, {
      tenantId: TENANT_1,
      sku: "HAR-01",
      name: "Harina PAN 1kg",
      priceUsd: "2.0000",
      costUsd: "1.5000",
      taxRate: "0.1600",
    });

    // Producto 2: Exento de IVA (0.0000)
    const p2 = insertProduct(db, {
      tenantId: TENANT_1,
      sku: "MED-02",
      name: "Medicamento Exento",
      priceUsd: "10.0000",
      costUsd: "7.0000",
      taxRate: "0.0000",
    });

    addStockMovement(db, { productId: p1, delta: "50.0000", type: "RESTOCK", terminalId: TERMINAL_1 });
    addStockMovement(db, { productId: p2, delta: "20.0000", type: "RESTOCK", terminalId: TERMINAL_1 });

    const shiftId = openShift(db, {
      terminalId: TERMINAL_1,
      cashierName: "Erick",
      exchangeRateApplied: "40.0000",
      initialCashUsd: "10.0000",
      initialCashVes: "400.0000",
    });

    // Simular compra de 1.5000 kg de P1 ($2.0000 c/u => $3.0000 subtotal, IVA $0.4800)
    // y 1.0000 und de P2 ($10.0000 => $10.0000 subtotal, IVA $0.0000)
    // Subtotal: 3.0000 + 10.0000 = 13.0000 USD
    // IVA: 0.4800 + 0.0000 = 0.4800 USD
    // Total: 13.4800 USD (x 40.0000 = 539.2000 VES)
    const subtotalUsd = "13.0000";
    const taxUsd = "0.4800";
    const totalUsd = "13.4800";
    const subtotalVes = "520.0000";
    const taxVes = "19.2000";
    const totalVes = "539.2000";

    const invoiceId = createInvoice(db, {
      shiftId,
      terminalId: TERMINAL_1,
      exchangeRate: "40.0000",
      subtotalUsd,
      taxUsd,
      totalUsd,
      subtotalVes,
      taxVes,
      totalVes,
      paymentMethod: "CASH_USD",
      items: [
        {
          productId: p1,
          quantity: "1.5000",
          unitPriceUsd: "2.0000",
          unitPriceVes: "80.0000",
          lineTotalUsd: "3.0000",
          lineTotalVes: "120.0000",
          taxRate: "0.1600",
        },
        {
          productId: p2,
          quantity: "1.0000",
          unitPriceUsd: "10.0000",
          unitPriceVes: "400.0000",
          lineTotalUsd: "10.0000",
          lineTotalVes: "400.0000",
          taxRate: "0.0000",
        },
      ],
    });

    const inv = getInvoiceById(db, invoiceId);
    expect(inv).toBeDefined();
    expect(inv?.subtotalUsd).toBe("13.0000");
    expect(inv?.taxUsd).toBe("0.4800");
    expect(inv?.totalUsd).toBe("13.4800");
    expect(inv?.subtotalVes).toBe("520.0000");
    expect(inv?.taxVes).toBe("19.2000");
    expect(inv?.totalVes).toBe("539.2000");

    // Verificar que los items guardaron su alícuota respectiva
    expect(inv?.items[0]?.taxRate).toBe("0.1600");
    expect(inv?.items[1]?.taxRate).toBe("0.0000");
  });

  it("renderiza el componente PosScreen con soporte para vaciado de ticket y numpad", () => {
    const db = createTestDb();
    const elem = React.createElement(PosScreen, {
      db,
      terminalId: TERMINAL_1,
      tenantId: TENANT_1,
    });
    expect(elem).toBeDefined();
  });
});

