import Decimal from "decimal.js";
import type { SqlDriver } from "./driver";
import { uuidv7 } from "../lib/uuidv7";

export interface NewProduct {
  tenantId: string;
  sku: string;
  name: string;
  /** Decimal en string; nunca `number`. */
  priceUsd: string;
  costUsd: string;
  barcode?: string;
  categoryId?: string;
  taxRate?: string;
  minStock?: string;
}

export interface StockRow {
  productId: string;
  sku: string;
  name: string;
  /** Decimal exacto con 4 decimales (cantidades). */
  currentStock: string;
}

/** Valida y normaliza un decimal; lanza si no es un decimal válido y finito. */
function dec(value: string, field: string): Decimal {
  let d: Decimal;
  try {
    d = new Decimal(value);
  } catch {
    throw new Error(`${field} no es un decimal válido: ${value}`);
  }
  if (!d.isFinite()) throw new Error(`${field} no es finito`);
  return d;
}

export function insertProduct(db: SqlDriver, p: NewProduct, now: number = Date.now()): string {
  const price = dec(p.priceUsd, "priceUsd");
  const cost = dec(p.costUsd, "costUsd");
  if (price.isNegative() || cost.isNegative()) throw new Error("Precio/costo no pueden ser negativos");

  const id = uuidv7(now);
  db.run(
    `INSERT INTO products (id, tenant_id, category_id, barcode, sku, name, price_usd, cost_usd, tax_rate, min_stock, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      p.tenantId,
      p.categoryId ?? null,
      p.barcode ?? null,
      p.sku,
      p.name,
      price.toFixed(4),
      cost.toFixed(4),
      dec(p.taxRate ?? "0.16", "taxRate").toFixed(4),
      dec(p.minStock ?? "5", "minStock").toFixed(4),
      now,
      now,
    ],
  );
  return id;
}

/** Registra un delta de inventario (kardex). `delta` con signo, ej. "-1" o "10". */
export function addStockMovement(
  db: SqlDriver,
  args: { productId: string; terminalId: string; delta: string; type: "SALE" | "RETURN" | "RESTOCK" | "ADJUSTMENT"; referenceId?: string },
  now: number = Date.now(),
): string {
  const delta = dec(args.delta, "delta");
  const id = uuidv7(now);
  db.run(
    `INSERT INTO stock_movements (id, product_id, terminal_id, quantity_delta, movement_type, reference_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, args.productId, args.terminalId, delta.toFixed(4), args.type, args.referenceId ?? null, now],
  );
  return id;
}

/** Lee stock vigente desde la vista `v_product_current_stock`. */
export function getCurrentStock(db: SqlDriver, productId: string): StockRow | undefined {
  const [row] = db.all<{ product_id: string; sku: string; name: string; current_stock_e4: number }>(
    "SELECT product_id, sku, name, current_stock_e4 FROM v_product_current_stock WHERE product_id = ?",
    [productId],
  );
  if (!row) return undefined;
  return {
    productId: row.product_id,
    sku: row.sku,
    name: row.name,
    currentStock: new Decimal(row.current_stock_e4).div(10000).toFixed(4),
  };
}


export function createCategory(db: SqlDriver, name: string, now: number = Date.now()): string {
  const id = uuidv7(now);
  db.run("INSERT INTO categories (id, name, created_at) VALUES (?, ?, ?)", [id, name.trim(), now]);
  return id;
}