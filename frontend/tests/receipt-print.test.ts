import { describe, expect, it } from "vitest";
import {
  BLE_CHUNK,
  RECEIPT_COLS,
  buildReceiptModel,
  chunkBytes,
  encodeEscPos,
  labelForTransport,
  pickBluetoothWriter,
  renderReceiptText,
  resolveDefaultTransport,
  shortLabelForTransport,
} from "../src/services/receipt-print.service";
import type { BtCharacteristicLike } from "../src/services/receipt-print.service";
import type { InvoiceEntity } from "../src/database/repositories/invoice.repository";

const fakeChar = (props: Partial<BtCharacteristicLike["properties"]>): BtCharacteristicLike => ({
  properties: props,
  writeValue: async () => undefined,
});

const makeInvoice = (overrides: Partial<InvoiceEntity> = {}): InvoiceEntity => ({
  id: "inv-1",
  shiftId: "aaaaaaaa-bbbb-cccc-dddd-00002735",
  terminalId: "TERM-01",
  invoiceNumber: "TERM01-000042",
  exchangeRate: "36.5000",
  subtotalUsd: "1.5000",
  taxUsd: "0.2400",
  totalUsd: "1.7400",
  subtotalVes: "54.7500",
  taxVes: "8.7600",
  totalVes: "63.5100",
  paymentMethod: "CASH_USD",
  paymentBreakdown: null,
  status: "COMPLETED",
  voidedAt: null,
  voidReason: null,
  createdAt: new Date("2026-11-05T17:15:46").getTime(),
  items: [
    {
      id: "item-1",
      invoiceId: "inv-1",
      productId: "prod-arroz",
      quantity: "1.0000",
      unitPriceUsd: "1.5000",
      lineTotalUsd: "1.5000",
      unitPriceVes: "54.7500",
      lineTotalVes: "54.7500",
      taxRate: "0.1600",
      // Línea sin snapshot (heredada): el nombre se resuelve con `resolveItemName`.
      unitCostUsd: null,
      productName: null,
      productSku: null,
      productUnit: null,
    },
  ],
  ...overrides,
});

const ctx = { resolveItemName: (id: string) => (id === "prod-arroz" ? "Arroz Primor 1kg" : "Artículo sin nombre") };

describe("Formato XP-58IIHT (58 mm / 32 columnas)", () => {
  it("todas las líneas del modelo caben en 32 columnas y son ASCII", () => {
    const model = buildReceiptModel(makeInvoice(), ctx);
    for (const l of model) {
      expect(l.text.length).toBeLessThanOrEqual(l.wide ? 16 : RECEIPT_COLS);
      // eslint-disable-next-line no-control-regex
      expect(l.text).toMatch(/^[\x20-\x7E]*$/);
    }
    expect(model.some((l) => l.wide)).toBe(true); // el TOTAL usa doble tamaño
  });

  it("conecta la identidad legal de la venta", () => {
    const text = renderReceiptText(buildReceiptModel(makeInvoice(), ctx));
    expect(text).toContain("TERM01-000042");
    expect(text).toContain("Terminal: TERM-01");
    expect(text).toContain("Turno #2735");
    expect(text).toContain("Arroz Primor 1kg");
    expect(text).toContain("$ 1.5000");
    expect(text).toContain("Bs. 63.5100");
    expect(text).toContain("36.5000");
    expect(text).toMatch(/Metodo de pago: Efectivo USD/);
  });

  it("translitera acentos y símbolos no ASCII del catálogo", () => {
    const model = buildReceiptModel(makeInvoice(), {
      resolveItemName: () => "Café Fama “de América” 500g ≈ especial",
    });
    const text = renderReceiptText(model);
    expect(text).toContain("Cafe Fama");
    expect(text).not.toMatch(/[^\x20-\x7E\n]/);
  });

  it("envuelve nombres de producto más largos que el papel", () => {
    const model = buildReceiptModel(makeInvoice(), {
      resolveItemName: () => "Pasta Primor Corta Especial Alimentacion 3kg",
    });
    expect(model.some((l) => l.text === "Pasta Primor Corta Especial")).toBe(true);
    expect(model.some((l) => l.text === "Alimentacion 3kg")).toBe(true);
  });

  it("marca las ventas anuladas con su motivo", () => {
    const model = buildReceiptModel(
      makeInvoice({ status: "VOID", voidReason: "Error de digitacion" }),
      ctx,
    );
    const text = renderReceiptText(model);
    expect(text).toContain("*** VENTA ANULADA");
    expect(text).toContain("Error de digitacion");
  });

  it("desglosa el cobro mixto (SPLIT) por método", () => {
    const invoice = makeInvoice({
      paymentMethod: "SPLIT",
      paymentBreakdown: JSON.stringify({
        cash_usd: "1.0000",
        cash_ves: "0.0000",
        pago_movil: "26.9000",
        card_ves: "0.0000",
      }),
    });
    const text = renderReceiptText(buildReceiptModel(invoice, ctx));
    expect(text).toContain("Efectivo USD:");
    expect(text).toContain("$ 1.0000");
    expect(text).toContain("Pago Movil:");
    expect(text).not.toContain("Tarjeta/Punto"); // montos en cero no ensucian el ticket
  });

  it("nunca trunca el monto total: cae de doble tamaño a línea normal si es largo", () => {
    const big = makeInvoice({
      totalUsd: "12345.6700",
      totalVes: "450617.0550",
    });
    const model = buildReceiptModel(big, ctx);
    const wide = model.filter((l) => l.wide).map((l) => l.text);
    expect(wide.every((t) => t.length <= 16)).toBe(true);
    expect(renderReceiptText(model)).toContain("$ 12,345.6700");
  });
});

describe("Codificador ESC/POS", () => {
  const hex = (bytes: Uint8Array) => Array.from(bytes);
  const contains = (bytes: number[], seq: number[]) =>
    bytes.some((_, i) => seq.every((b, j) => bytes[i + j] === b));

  it("inicializa la impresora, centra, negrita y termina con feed de desgarro", () => {
    const bytes = hex(encodeEscPos(buildReceiptModel(makeInvoice(), ctx)));
    expect(bytes.slice(0, 2)).toEqual([0x1b, 0x40]); // ESC @
    expect(contains(bytes, [0x1b, 0x61, 0x01])).toBe(true); // ESC a 1: centrado
    expect(contains(bytes, [0x1b, 0x45, 0x01])).toBe(true); // ESC E 1: negrita
    expect(contains(bytes, [0x1d, 0x21, 0x11])).toBe(true); // GS ! 0x11: doble tamaño
    expect(bytes.slice(-3)).toEqual([0x1b, 0x64, 0x03]); // ESC d 3: 3 líneas de feed
  });

  it("emite sólo bytes imprimibles ASCII (sin depender del code page)", () => {
    const bytes = Array.from(encodeEscPos(buildReceiptModel(makeInvoice(), ctx)));
    // Tras el ESC @ inicial, cada secuencia de control nuestra ocupa 3 bytes
    // (ESC|GS + letra + argumento); cualquier otro byte debe ser texto o LF.
    expect(bytes.slice(0, 2)).toEqual([0x1b, 0x40]);
    let i = 2;
    while (i < bytes.length) {
      const b = bytes[i];
      if (b === undefined) break;
      if (b === 0x1b || b === 0x1d) {
        i += 3;
        continue;
      }
      expect(b === 0x0a || (b >= 0x20 && b <= 0x7f)).toBe(true);
      i += 1;
    }
  });
});

describe("Transportes: USB serie, Bluetooth y diálogo del sistema", () => {
  it("chunkBytes parte en bloques exactos y no pierde bytes", () => {
    const data = new Uint8Array(5);
    const parts = chunkBytes(data, 2);
    expect(parts.map((p) => p.length)).toEqual([2, 2, 1]);
    const total = parts.reduce((acc, p) => acc + p.length, 0);
    expect(total).toBe(5);
    const ble = chunkBytes(new Uint8Array(BLE_CHUNK * 3 + 7), BLE_CHUNK);
    expect(ble.length).toBe(4);
  });

  it("prefiere la característica del servicio de impresora térmica (FF00/FFE2)", () => {
    const generic = fakeChar({ write: true });
    const printer = fakeChar({ writeWithoutResponse: true });
    const chosen = pickBluetoothWriter([
      { uuid: "0000180a-0000-1000-8000-00805f9b34fb", characteristics: [fakeChar({}), generic] },
      { uuid: "0000ff00-0000-1000-8000-00805f9b34fb", characteristics: [printer] },
    ]);
    expect(chosen?.ch).toBe(printer);
    expect(chosen?.preferential).toBe(true);
  });

  it("cae en cualquier característica writable si no hay servicio conocido", () => {
    const odd = fakeChar({ write: true });
    const chosen = pickBluetoothWriter([
      { uuid: "12345678-1234-1234-1234-123456789abc", characteristics: [odd] },
    ]);
    expect(chosen?.ch).toBe(odd);
    expect(chosen?.preferential).toBe(false);
  });

  it("rechaza servicios sin escritura y devuelve null si nada sirve", () => {
    const chosen = pickBluetoothWriter([
      { uuid: "0000ff00-0000-1000-8000-00805f9b34fb", characteristics: [fakeChar({})] },
    ]);
    expect(chosen).toBeNull();
  });

  it("resuelve el transporte por defecto según APIs disponibles", () => {
    expect(resolveDefaultTransport(true, true)).toBe("serial");
    expect(resolveDefaultTransport(false, true)).toBe("bluetooth");
    expect(resolveDefaultTransport(false, false)).toBe("dialog");
  });

  it("etiqueta los transportes para chips y para el botón", () => {
    expect(labelForTransport("serial")).toBe("USB/Serie");
    expect(labelForTransport("bluetooth")).toBe("Bluetooth (BLE)");
    expect(labelForTransport("dialog")).toBe("Ventana del sistema");
    expect(shortLabelForTransport("serial")).toBe("USB");
    expect(shortLabelForTransport("bluetooth")).toBe("BT");
    expect(shortLabelForTransport("dialog")).toBe("SO");
  });
});
