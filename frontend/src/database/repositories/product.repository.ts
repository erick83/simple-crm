import type { SqlDriver } from "../connection";
import { uuidv7 } from "../../utils/uuid7";
import { toDecimal, formatFixed4, Decimal } from "../../utils/decimal";

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

export interface ProductEntity {
  id: string;
  tenantId: string;
  categoryId: string | null;
  barcode: string | null;
  sku: string;
  name: string;
  priceUsd: string;
  costUsd: string;
  taxRate: string;
  imagePath: string | null;
  minStock: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export function insertProduct(db: SqlDriver, p: NewProduct, now: number = Date.now()): string {
  const price = toDecimal(p.priceUsd, "priceUsd");
  const cost = toDecimal(p.costUsd, "costUsd");
  if (price.isNegative() || cost.isNegative()) {
    throw new Error("Precio/costo no pueden ser negativos");
  }

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
      toDecimal(p.taxRate ?? "0.16", "taxRate").toFixed(4),
      toDecimal(p.minStock ?? "5", "minStock").toFixed(4),
      now,
      now,
    ],
  );
  return id;
}

export function createCategory(db: SqlDriver, name: string, now: number = Date.now()): string {
  const id = uuidv7(now);
  db.run("INSERT INTO categories (id, name, created_at) VALUES (?, ?, ?)", [id, name.trim(), now]);
  return id;
}

/** Registra un delta de inventario (kardex). `delta` con signo y 4 decimales exactos. */
export function addStockMovement(
  db: SqlDriver,
  args: {
    productId: string;
    terminalId: string;
    delta: string;
    type: "SALE" | "RETURN" | "RESTOCK" | "ADJUSTMENT";
    referenceId?: string;
  },
  now: number = Date.now(),
): string {
  const delta = toDecimal(args.delta, "delta");
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

/** Obtiene todos los productos activos */
export function getAllActiveProducts(db: SqlDriver): ProductEntity[] {
  return db
    .all<{
      id: string;
      tenant_id: string;
      category_id: string | null;
      barcode: string | null;
      sku: string;
      name: string;
      price_usd: string;
      cost_usd: string;
      tax_rate: string;
      image_path: string | null;
      min_stock: string;
      is_active: number;
      created_at: number;
      updated_at: number;
    }>("SELECT * FROM products WHERE is_active = 1 ORDER BY name ASC")
    .map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      categoryId: r.category_id,
      barcode: r.barcode,
      sku: r.sku,
      name: r.name,
      priceUsd: r.price_usd,
      costUsd: r.cost_usd,
      taxRate: r.tax_rate,
      imagePath: r.image_path,
      minStock: r.min_stock,
      isActive: r.is_active === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
}

