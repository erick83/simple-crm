import type { SqlDriver } from "../connection";
import { uuidv7 } from "../../utils/uuid7";
import { toDecimal, formatFixed4, Decimal } from "../../utils/decimal";
import { P2pSyncService } from "../../services/p2p-sync.service";

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
  /** Unidad de medida (ej. 'und', 'kg', 'g', 'l', 'caja', 'paq'). Por defecto 'und'. */
  unit?: string;
}

export interface UpdateProductInput {
  id: string;
  name?: string;
  sku?: string;
  barcode?: string | null;
  categoryId?: string | null;
  priceUsd?: string;
  costUsd?: string;
  taxRate?: string;
  minStock?: string;
  unit?: string;
  imagePath?: string | null;
  terminalId?: string;
}

export interface StockRow {
  productId: string;
  sku: string;
  name: string;
  unit: string;
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
  unit?: string;
  minStock: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CategoryEntity {
  id: string;
  name: string;
  createdAt: number;
}

export interface InventoryItemWithStock {
  id: string;
  tenantId: string;
  sku: string;
  barcode: string | null;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  priceUsd: string;
  costUsd: string;
  taxRate: string;
  imagePath: string | null;
  unit: string;
  minStock: string;
  currentStock: string;
  isLowStock: boolean;
  isActive: boolean;
  updatedAt: number;
}

export interface StockMovementEntity {
  id: string;
  productId: string;
  terminalId: string;
  quantityDelta: string;
  movementType: "SALE" | "RETURN" | "RESTOCK" | "ADJUSTMENT";
  referenceId: string | null;
  createdAt: number;
}

export function insertProduct(
  db: SqlDriver,
  p: NewProduct,
  now: number = Date.now(),
  terminalId: string = "C01",
): string {
  const price = toDecimal(p.priceUsd, "priceUsd");
  const cost = toDecimal(p.costUsd, "costUsd");
  if (price.isNegative() || cost.isNegative()) {
    throw new Error("Precio/costo no pueden ser negativos");
  }

  const cleanSku = p.sku.trim();
  const cleanBarcode = p.barcode ? p.barcode.trim() : null;

  // Validación de unicidad de SKU
  const [skuConflict] = db.all<{ id: string }>("SELECT id FROM products WHERE sku = ?", [cleanSku]);
  if (skuConflict) {
    throw new Error(`El SKU '${cleanSku}' ya está registrado`);
  }

  // Validación de unicidad de Barcode
  if (cleanBarcode) {
    const [barcodeConflict] = db.all<{ id: string }>("SELECT id FROM products WHERE barcode = ?", [cleanBarcode]);
    if (barcodeConflict) {
      throw new Error(`El código de barras '${cleanBarcode}' ya está registrado`);
    }
  }

  const id = uuidv7(now);
  const priceStr = price.toFixed(4);
  const costStr = cost.toFixed(4);
  const taxRateStr = toDecimal(p.taxRate ?? "0.16", "taxRate").toFixed(4);
  const minStockStr = toDecimal(p.minStock ?? "5", "minStock").toFixed(4);
  const unit = (p.unit ?? "und").trim() || "und";

  db.run(
    `INSERT INTO products (id, tenant_id, category_id, barcode, sku, name, price_usd, cost_usd, tax_rate, unit, min_stock, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      p.tenantId,
      p.categoryId ?? null,
      cleanBarcode,
      cleanSku,
      p.name.trim(),
      priceStr,
      costStr,
      taxRateStr,
      unit,
      minStockStr,
      now,
      now,
    ],
  );

  P2pSyncService.enqueueEvent(
    db,
    {
      originTerminalId: terminalId,
      entityType: "PRODUCT",
      entityId: id,
      action: "UPSERT",
      payload: {
        id,
        tenantId: p.tenantId,
        categoryId: p.categoryId ?? null,
        barcode: cleanBarcode,
        sku: cleanSku,
        name: p.name.trim(),
        priceUsd: priceStr,
        costUsd: costStr,
        taxRate: taxRateStr,
        unit,
        minStock: minStockStr,
        imagePath: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    },
    now,
  );

  return id;
}

export function updateProduct(
  db: SqlDriver,
  input: UpdateProductInput,
  now: number = Date.now(),
): ProductEntity {
  const [existing] = db.all<{
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
    unit?: string;
    min_stock: string;
    is_active: number;
    created_at: number;
    updated_at: number;
  }>("SELECT * FROM products WHERE id = ?", [input.id]);

  if (!existing) {
    throw new Error(`Producto no encontrado: ${input.id}`);
  }

  const nextSku = input.sku !== undefined ? input.sku.trim() : existing.sku;
  if (nextSku !== existing.sku) {
    const [conflict] = db.all<{ id: string }>(
      "SELECT id FROM products WHERE sku = ? AND id != ?",
      [nextSku, input.id],
    );
    if (conflict) {
      throw new Error(`El SKU '${nextSku}' ya está registrado`);
    }
  }

  const nextBarcode =
    input.barcode !== undefined
      ? input.barcode
        ? input.barcode.trim()
        : null
      : existing.barcode;

  if (nextBarcode && nextBarcode !== existing.barcode) {
    const [conflict] = db.all<{ id: string }>(
      "SELECT id FROM products WHERE barcode = ? AND id != ?",
      [nextBarcode, input.id],
    );
    if (conflict) {
      throw new Error(`El código de barras '${nextBarcode}' ya está registrado`);
    }
  }

  const nextPrice =
    input.priceUsd !== undefined
      ? toDecimal(input.priceUsd, "priceUsd").toFixed(4)
      : existing.price_usd;

  const nextCost =
    input.costUsd !== undefined
      ? toDecimal(input.costUsd, "costUsd").toFixed(4)
      : existing.cost_usd;

  const nextTax =
    input.taxRate !== undefined
      ? toDecimal(input.taxRate, "taxRate").toFixed(4)
      : existing.tax_rate;

  const nextMinStock =
    input.minStock !== undefined
      ? toDecimal(input.minStock, "minStock").toFixed(4)
      : existing.min_stock;

  const nextUnit =
    input.unit !== undefined
      ? input.unit.trim() || "und"
      : existing.unit || "und";

  const nextName = input.name !== undefined ? input.name.trim() : existing.name;
  const nextCategoryId = input.categoryId !== undefined ? input.categoryId : existing.category_id;
  const nextImagePath = input.imagePath !== undefined ? input.imagePath : existing.image_path;
  const terminalId = input.terminalId ?? "C01";

  db.run(
    `UPDATE products SET
       name = ?, sku = ?, barcode = ?, category_id = ?, price_usd = ?, cost_usd = ?,
       tax_rate = ?, unit = ?, min_stock = ?, image_path = ?, updated_at = ?
     WHERE id = ?`,
    [
      nextName,
      nextSku,
      nextBarcode,
      nextCategoryId,
      nextPrice,
      nextCost,
      nextTax,
      nextUnit,
      nextMinStock,
      nextImagePath,
      now,
      input.id,
    ],
  );

  P2pSyncService.enqueueEvent(
    db,
    {
      originTerminalId: terminalId,
      entityType: "PRODUCT",
      entityId: input.id,
      action: "UPSERT",
      payload: {
        id: input.id,
        tenantId: existing.tenant_id,
        categoryId: nextCategoryId,
        barcode: nextBarcode,
        sku: nextSku,
        name: nextName,
        priceUsd: nextPrice,
        costUsd: nextCost,
        taxRate: nextTax,
        unit: nextUnit,
        minStock: nextMinStock,
        imagePath: nextImagePath,
        isActive: existing.is_active === 1,
        createdAt: existing.created_at,
        updatedAt: now,
      },
    },
    now,
  );

  return {
    id: input.id,
    tenantId: existing.tenant_id,
    categoryId: nextCategoryId,
    barcode: nextBarcode,
    sku: nextSku,
    name: nextName,
    priceUsd: nextPrice,
    costUsd: nextCost,
    taxRate: nextTax,
    unit: nextUnit,
    imagePath: nextImagePath,
    minStock: nextMinStock,
    isActive: existing.is_active === 1,
    createdAt: existing.created_at,
    updatedAt: now,
  };
}

export function setProductActive(
  db: SqlDriver,
  productId: string,
  isActive: boolean,
  terminalId: string = "C01",
  now: number = Date.now(),
): void {
  const [existing] = db.all<{
    id: string;
    tenant_id: string;
    sku: string;
    name: string;
  }>("SELECT id, tenant_id, sku, name FROM products WHERE id = ?", [productId]);

  if (!existing) {
    throw new Error(`Producto no encontrado: ${productId}`);
  }

  db.run("UPDATE products SET is_active = ?, updated_at = ? WHERE id = ?", [
    isActive ? 1 : 0,
    now,
    productId,
  ]);

  P2pSyncService.enqueueEvent(
    db,
    {
      originTerminalId: terminalId,
      entityType: "PRODUCT",
      entityId: productId,
      action: isActive ? "UPSERT" : "DELETE",
      payload: {
        id: productId,
        tenantId: existing.tenant_id,
        isActive,
        updatedAt: now,
      },
    },
    now,
  );
}

export function getProductById(db: SqlDriver, id: string): ProductEntity | undefined {
  const [r] = db.all<{
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
    unit?: string;
    min_stock: string;
    is_active: number;
    created_at: number;
    updated_at: number;
  }>("SELECT * FROM products WHERE id = ?", [id]);

  if (!r) return undefined;
  return {
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
    unit: r.unit ?? "und",
    minStock: r.min_stock,
    isActive: r.is_active === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function getProductByBarcode(
  db: SqlDriver,
  barcode: string,
  tenantId?: string,
): ProductEntity | undefined {
  const sql = tenantId
    ? "SELECT * FROM products WHERE barcode = ? AND tenant_id = ? AND is_active = 1"
    : "SELECT * FROM products WHERE barcode = ? AND is_active = 1";
  const params = tenantId ? [barcode, tenantId] : [barcode];
  const [r] = db.all<{
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
    unit?: string;
    min_stock: string;
    is_active: number;
    created_at: number;
    updated_at: number;
  }>(sql, params);

  if (!r) return undefined;
  return {
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
    unit: r.unit ?? "und",
    minStock: r.min_stock,
    isActive: r.is_active === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function getProductBySku(
  db: SqlDriver,
  sku: string,
  tenantId?: string,
): ProductEntity | undefined {
  const sql = tenantId
    ? "SELECT * FROM products WHERE sku = ? AND tenant_id = ? AND is_active = 1"
    : "SELECT * FROM products WHERE sku = ? AND is_active = 1";
  const params = tenantId ? [sku, tenantId] : [sku];
  const [r] = db.all<{
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
    unit?: string;
    min_stock: string;
    is_active: number;
    created_at: number;
    updated_at: number;
  }>(sql, params);

  if (!r) return undefined;
  return {
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
    unit: r.unit ?? "und",
    minStock: r.min_stock,
    isActive: r.is_active === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function createCategory(db: SqlDriver, name: string, now: number = Date.now()): string {
  const id = uuidv7(now);
  db.run("INSERT INTO categories (id, name, created_at) VALUES (?, ?, ?)", [id, name.trim(), now]);
  return id;
}

export function listCategories(db: SqlDriver): CategoryEntity[] {
  return db
    .all<{ id: string; name: string; created_at: number }>(
      "SELECT id, name, created_at FROM categories ORDER BY name ASC",
    )
    .map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at }));
}

export function deleteCategory(
  db: SqlDriver,
  args: { categoryId: string; confirmationWord: string },
  now: number = Date.now(),
): void {
  if (args.confirmationWord.trim().toUpperCase() !== "BORRAR") {
    throw new Error('Confirmación inválida: debe escribir exactamente "BORRAR".');
  }

  const existing = listCategories(db).find((c) => c.id === args.categoryId);
  if (!existing) {
    throw new Error("La categoría seleccionada no existe o ya fue eliminada.");
  }

  db.transaction(() => {
    db.run("UPDATE products SET category_id = NULL, updated_at = ? WHERE category_id = ?", [
      now,
      args.categoryId,
    ]);
    db.run("DELETE FROM categories WHERE id = ?", [args.categoryId]);
  });
}

export function deleteProduct(
  db: SqlDriver,
  args: {
    productId: string;
    confirmationWord: string;
    clearRemainingStock?: boolean;
    terminalId?: string;
  },
  now: number = Date.now(),
): void {
  if (args.confirmationWord.trim().toUpperCase() !== "BORRAR") {
    throw new Error('Confirmación inválida: debe escribir exactamente "BORRAR".');
  }

  const terminalId = args.terminalId ?? "TERM-01";
  const stockInfo = getCurrentStock(db, args.productId);

  db.transaction(() => {
    if (args.clearRemainingStock && stockInfo) {
      const currentDec = toDecimal(stockInfo.currentStock);
      if (!currentDec.isZero()) {
        addStockMovement(
          db,
          {
            productId: args.productId,
            terminalId,
            delta: currentDec.negated().toFixed(4),
            type: "ADJUSTMENT",
            referenceId: "Liquidación por baja de producto",
          },
          now,
        );
      }
    }

    setProductActive(db, args.productId, false, terminalId, now + 1);
  });
}

/** Registra un delta de inventario (kardex). `delta` con signo y 4 decimales exactos. */
export function addStockMovement(
  db: SqlDriver,
  args: {
    productId: string;
    terminalId?: string;
    delta?: string;
    quantityDelta?: string;
    type?: "SALE" | "RETURN" | "RESTOCK" | "ADJUSTMENT";
    movementType?: "SALE" | "RETURN" | "RESTOCK" | "ADJUSTMENT";
    referenceId?: string;
    tenantId?: string;
    costUsdSnapshot?: string;
    notes?: string;
  },
  now: number = Date.now(),
): string {
  const rawDelta = args.delta ?? args.quantityDelta;
  const rawType = args.type ?? args.movementType ?? "ADJUSTMENT";
  const terminalId = args.terminalId ?? "TERM-01";
  const delta = toDecimal(rawDelta ?? "0", "delta");
  const id = uuidv7(now);
  const deltaStr = delta.toFixed(4);

  db.run(
    `INSERT INTO stock_movements (id, product_id, terminal_id, quantity_delta, movement_type, reference_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, args.productId, terminalId, deltaStr, rawType, args.referenceId ?? args.notes ?? null, now],
  );

  P2pSyncService.enqueueEvent(
    db,
    {
      originTerminalId: terminalId,
      entityType: "STOCK_MOVEMENT",
      entityId: id,
      action: "UPSERT",
      payload: {
        id,
        productId: args.productId,
        terminalId,
        quantityDelta: deltaStr,
        movementType: rawType,
        referenceId: args.referenceId ?? args.notes ?? null,
        createdAt: now,
      },
    },
    now,
  );

  return id;
}

/** Lee stock vigente desde la vista `v_product_current_stock`. */
export function getCurrentStock(db: SqlDriver, productId: string): StockRow | undefined {
  const [row] = db.all<{ product_id: string; sku: string; name: string; unit?: string; current_stock_e4: number }>(
    "SELECT product_id, sku, name, unit, current_stock_e4 FROM v_product_current_stock WHERE product_id = ?",
    [productId],
  );
  if (!row) return undefined;
  return {
    productId: row.product_id,
    sku: row.sku,
    name: row.name,
    unit: row.unit ?? "und",
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
      unit?: string;
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
      unit: r.unit ?? "und",
      minStock: r.min_stock,
      isActive: r.is_active === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
}

/** Lista el inventario con cálculo de stock actual por Kardex y filtro de búsqueda */
export function listInventoryWithStock(
  db: SqlDriver,
  options?: string | { search?: string; categoryId?: string; tenantId?: string },
): InventoryItemWithStock[] {
  const opts = typeof options === "string" ? { tenantId: options } : options;
  let sql = `
    SELECT
      p.id, p.tenant_id, p.sku, p.barcode, p.name, p.category_id,
      c.name AS category_name, p.price_usd, p.cost_usd, p.tax_rate,
      p.image_path, p.unit, p.min_stock, p.is_active, p.updated_at,
      COALESCE(SUM(CAST(REPLACE(sm.quantity_delta, '.', '') AS INTEGER)), 0) AS current_stock_e4
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN stock_movements sm ON p.id = sm.product_id
    WHERE p.is_active = 1
  `;
  const params: (string | number)[] = [];

  if (opts?.tenantId) {
    sql += " AND p.tenant_id = ?";
    params.push(opts.tenantId);
  }
  if (opts?.categoryId) {
    sql += " AND p.category_id = ?";
    params.push(opts.categoryId);
  }

  sql += " GROUP BY p.id ORDER BY p.name ASC";

  let rows = db.all<{
    id: string;
    tenant_id: string;
    sku: string;
    barcode: string | null;
    name: string;
    category_id: string | null;
    category_name: string | null;
    price_usd: string;
    cost_usd: string;
    tax_rate: string;
    image_path: string | null;
    unit?: string;
    min_stock: string;
    is_active: number;
    updated_at: number;
    current_stock_e4: number;
  }>(sql, params);

  if (opts?.search) {
    const q = opts.search.trim().toLowerCase();
    rows = rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.sku.toLowerCase().includes(q) ||
        (r.barcode && r.barcode.toLowerCase().includes(q)) ||
        (r.category_name && r.category_name.toLowerCase().includes(q)),
    );
  }

  return rows.map((r) => {
    const currentStock = new Decimal(r.current_stock_e4).div(10000).toFixed(4);
    const minStock = formatFixed4(r.min_stock);
    const isLowStock = new Decimal(currentStock).lte(new Decimal(minStock));
    return {
      id: r.id,
      tenantId: r.tenant_id,
      sku: r.sku,
      barcode: r.barcode,
      name: r.name,
      categoryId: r.category_id,
      categoryName: r.category_name,
      priceUsd: formatFixed4(r.price_usd),
      costUsd: formatFixed4(r.cost_usd),
      taxRate: formatFixed4(r.tax_rate),
      imagePath: r.image_path,
      unit: r.unit ?? "und",
      minStock,
      currentStock,
      isLowStock,
      isActive: r.is_active === 1,
      updatedAt: r.updated_at,
    };
  });
}

/** Historial de movimientos del Kardex para un producto dado */
export function getProductKardex(
  db: SqlDriver,
  productId: string,
  limit: number = 100,
): StockMovementEntity[] {
  return db
    .all<{
      id: string;
      product_id: string;
      terminal_id: string;
      quantity_delta: string;
      movement_type: StockMovementEntity["movementType"];
      reference_id: string | null;
      created_at: number;
    }>(
      `SELECT id, product_id, terminal_id, quantity_delta, movement_type, reference_id, created_at
       FROM stock_movements
       WHERE product_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [productId, limit],
    )
    .map((r) => ({
      id: r.id,
      productId: r.product_id,
      terminalId: r.terminal_id,
      quantityDelta: formatFixed4(r.quantity_delta),
      movementType: r.movement_type,
      referenceId: r.reference_id,
      createdAt: r.created_at,
    }));
}
