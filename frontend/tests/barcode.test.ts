import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers";
import { insertProduct } from "../src/db/products";
import { attachBarcodeListener, createBarcodeListener } from "../src/hid/barcodeListener";
import { Cart, scanToCart } from "../src/pos/cart";
import { uuidv7 } from "../src/lib/uuidv7";

/** Simula una secuencia de teclas separadas por `gap` ms. */
function type(l: ReturnType<typeof createBarcodeListener>, text: string, gap: number, start = 0, enter = true) {
  let t = start;
  for (const ch of text) { l.handleKey(ch, t); t += gap; }
  if (enter) l.handleKey("Enter", t);
  return t;
}

describe("createBarcodeListener", () => {
  it("emite ráfagas rápidas terminadas en Enter", () => {
    const scans: string[] = [];
    const l = createBarcodeListener({ onScan: (c) => scans.push(c) });
    type(l, "7591234567890", 5);
    expect(scans).toEqual(["7591234567890"]);
  });

  it("ignora tecleo humano lento", () => {
    const scans: string[] = [];
    const l = createBarcodeListener({ onScan: (c) => scans.push(c) });
    type(l, "7591234567890", 120);
    expect(scans).toEqual([]);
  });

  it("descarta basura previa lenta y toma solo la ráfaga final", () => {
    const scans: string[] = [];
    const l = createBarcodeListener({ onScan: (c) => scans.push(c) });
    const t = type(l, "99", 200, 0, false);
    type(l, "123456", 10, t + 500);
    expect(scans).toEqual(["123456"]);
  });

  it("ignora ráfagas cortas y teclas de control; soporta escaneos consecutivos", () => {
    const scans: string[] = [];
    const l = createBarcodeListener({ onScan: (c) => scans.push(c) });
    type(l, "12", 5);
    l.handleKey("1", 1000); l.handleKey("2", 1005); l.handleKey("Shift", 1010);
    l.handleKey("3", 1015); l.handleKey("4", 1020); l.handleKey("Enter", 1025);
    expect(scans).toEqual([]);
    type(l, "AAAA1", 5, 2000);
    type(l, "BBBB2", 5, 3000);
    expect(scans).toEqual(["AAAA1", "BBBB2"]);
  });

  it("attach/detach sobre un target de teclado", () => {
    let cb: ((e: { key: string; timeStamp: number }) => void) | undefined;
    const target = {
      addEventListener: (_: "keydown", f: typeof cb) => void (cb = f),
      removeEventListener: () => void (cb = undefined),
    };
    const scans: string[] = [];
    const off = attachBarcodeListener(target, { onScan: (c) => scans.push(c) });
    "12345".split("").forEach((k, i) => cb!({ key: k, timeStamp: i * 5 }));
    cb!({ key: "Enter", timeStamp: 30 });
    off();
    expect(scans).toEqual(["12345"]);
    expect(cb).toBeUndefined();
  });
});

describe("scanToCart", () => {
  it("añade el producto al carrito en <10 ms y acumula cantidad", () => {
    const db = createTestDb();
    insertProduct(db, { tenantId: uuidv7(), sku: "S1", barcode: "7591234567890", name: "Café", priceUsd: "3.5", costUsd: "2" });
    const cart = new Cart();
    const t0 = performance.now();
    const line = scanToCart(db, cart, "7591234567890");
    const elapsed = performance.now() - t0;
    expect(line?.name).toBe("Café");
    expect(elapsed).toBeLessThan(10);
    scanToCart(db, cart, "7591234567890");
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]?.quantity).toBe("2");
  });

  it("devuelve undefined si el código no existe", () => {
    expect(scanToCart(createTestDb(), new Cart(), "0000000000000")).toBeUndefined();
  });
});

