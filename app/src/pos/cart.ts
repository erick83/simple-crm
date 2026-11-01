import Decimal from "decimal.js";
import type { SqlDriver } from "../db/driver";

export interface ProductLookup {
  productId: string;
  sku: string;
  name: string;
  priceUsd: string;
}

export interface CartLine extends ProductLookup {
  quantity: string;
}

/** Busca un producto activo por código de barras (índice idx_products_barcode). */
export function findProductByBarcode(db: SqlDriver, barcode: string): ProductLookup | undefined {
  const [r] = db.all<{ id: string; sku: string; name: string; price_usd: string }>(
    "SELECT id, sku, name, price_usd FROM products WHERE barcode = ? AND is_active = 1",
    [barcode],
  );
  return r && { productId: r.id, sku: r.sku, name: r.name, priceUsd: r.price_usd };
}

/** Carrito de cobro en memoria; escanear el mismo producto incrementa la cantidad. */
export class Cart {
  private readonly map = new Map<string, CartLine>();

  add(p: ProductLookup, qty = "1"): CartLine {
    const prev = this.map.get(p.productId);
    const line = { ...p, quantity: new Decimal(prev?.quantity ?? 0).plus(qty).toString() };
    this.map.set(p.productId, line);
    return line;
  }

  get lines(): CartLine[] {
    return [...this.map.values()];
  }
}

/** Handler para `onScan`: devuelve la línea agregada o undefined si el código no existe. */
export function scanToCart(db: SqlDriver, cart: Cart, barcode: string): CartLine | undefined {
  const p = findProductByBarcode(db, barcode);
  return p && cart.add(p);
}

