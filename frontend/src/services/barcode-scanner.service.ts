import Decimal from "decimal.js";
import type { SqlDriver } from "../database/connection";

export const MAX_KEY_GAP_MS = 30;
export const MIN_BARCODE_LENGTH = 4;

export interface BarcodeListenerOptions {
  onScan: (barcode: string) => void;
  maxGapMs?: number;
  minLength?: number;
}

export function createBarcodeListener(opts: BarcodeListenerOptions) {
  const maxGap = opts.maxGapMs ?? MAX_KEY_GAP_MS;
  const minLength = opts.minLength ?? MIN_BARCODE_LENGTH;
  let buffer = "";
  let lastTs = -Infinity;

  return {
    handleKey(key: string, ts: number): void {
      if (ts - lastTs > maxGap) buffer = "";
      lastTs = ts;

      if (key === "Enter") {
        const code = buffer;
        buffer = "";
        if (code.length >= minLength) opts.onScan(code);
      } else if (key.length === 1) {
        buffer += key;
      } else {
        buffer = ""; // Teclas especiales rompen la secuencia continua
      }
    },
    reset(): void {
      buffer = "";
      lastTs = -Infinity;
    },
  };
}

export interface KeyEventTargetLike {
  addEventListener(type: "keydown", cb: (e: { key: string; timeStamp: number }) => void): void;
  removeEventListener(type: "keydown", cb: (e: { key: string; timeStamp: number }) => void): void;
}

export function attachBarcodeListener(target: KeyEventTargetLike, opts: BarcodeListenerOptions): () => void {
  const listener = createBarcodeListener(opts);
  const cb = (e: { key: string; timeStamp: number }) => listener.handleKey(e.key, e.timeStamp);
  target.addEventListener("keydown", cb);
  return () => target.removeEventListener("keydown", cb);
}

export interface ProductLookup {
  productId: string;
  sku: string;
  name: string;
  priceUsd: string;
}

export interface CartLine extends ProductLookup {
  quantity: string;
}

export function findProductByBarcode(db: SqlDriver, barcode: string): ProductLookup | undefined {
  const [r] = db.all<{ id: string; sku: string; name: string; price_usd: string }>(
    "SELECT id, sku, name, price_usd FROM products WHERE barcode = ? AND is_active = 1",
    [barcode],
  );
  return r && { productId: r.id, sku: r.sku, name: r.name, priceUsd: r.price_usd };
}

export class Cart {
  private readonly map = new Map<string, CartLine>();

  add(p: ProductLookup, qty = "1"): CartLine {
    const prev = this.map.get(p.productId);
    const line = { ...p, quantity: new Decimal(prev?.quantity ?? 0).plus(qty).toString() };
    this.map.set(p.productId, line);
    return line;
  }

  remove(productId: string): void {
    this.map.delete(productId);
  }

  clear(): void {
    this.map.clear();
  }

  get lines(): CartLine[] {
    return [...this.map.values()];
  }
}

export function scanToCart(db: SqlDriver, cart: Cart, barcode: string): CartLine | undefined {
  const p = findProductByBarcode(db, barcode);
  return p ? cart.add(p) : undefined;
}

