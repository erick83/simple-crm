import { Decimal, toDecimal, formatUsd, formatVes, convertUsdToVes, formatFixed4 } from "../utils/decimal";
import type { SqlDriver } from "../database/connection";
import {
  getAllActiveProducts,
  listInventoryWithStock,
  ProductEntity,
  InventoryItemWithStock,
} from "../database/repositories/product.repository";
import { getLatestRate, getRateForDate } from "../database/repositories/exchange.repository";

export interface BimonetaryProduct {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  priceUsd: string; // Base permanente en USD (inmutable en SQLite)
  priceVes: string; // Calculado dinámicamente según la tasa activa
  formattedUsd: string; // "$ X,XXX.0000"
  formattedVes: string; // "Bs. X,XXX.0000"
  costUsd: string;
  minStock: string;
  currentStock: string;
  isLowStock: boolean;
  unit: string;
  imagePath: string | null;
  categoryId: string | null;
  categoryName?: string | null;
}

/**
 * Convierte un listado de productos con precio base en USD a productos bimoneda reactivos
 * aplicando la tasa de cambio vigente sin alterar los registros base en SQLite.
 */
export function computeBimonetaryProducts(
  products: (ProductEntity | InventoryItemWithStock)[],
  exchangeRateToVes: string | Decimal,
): BimonetaryProduct[] {
  const rate = toDecimal(exchangeRateToVes, "Tasa de cambio");
  if (rate.lte(0)) {
    throw new Error("La tasa de cambio debe ser estrictamente mayor a cero");
  }

  return products.map((p) => {
    const priceVes = convertUsdToVes(p.priceUsd, rate).toFixed(4);
    const currentStock = "currentStock" in p ? p.currentStock : "0.0000";
    const isLowStock =
      "isLowStock" in p
        ? p.isLowStock
        : new Decimal(currentStock).lte(toDecimal(p.minStock ?? "0"));
    const categoryName = "categoryName" in p ? p.categoryName : null;

    return {
      id: p.id,
      sku: p.sku,
      barcode: p.barcode,
      name: p.name,
      priceUsd: formatFixed4(p.priceUsd),
      priceVes,
      formattedUsd: formatUsd(p.priceUsd),
      formattedVes: formatVes(priceVes),
      costUsd: formatFixed4(p.costUsd),
      minStock: formatFixed4(p.minStock),
      currentStock: formatFixed4(currentStock),
      isLowStock,
      unit: p.unit ?? "und",
      imagePath: p.imagePath,
      categoryId: p.categoryId,
      categoryName,
    };
  });
}

/**
 * Consulta los productos activos en SQLite con su stock actual de Kardex y calcula
 * reactivamente los precios en VES a partir de la tasa especificada o la más reciente.
 */
export function getCatalogWithBimonetaryPrices(
  db: SqlDriver,
  fallbackRateToVes = "36.5000",
  options?: { search?: string; categoryId?: string; tenantId?: string },
): { products: BimonetaryProduct[]; activeRate: string } {
  const items = listInventoryWithStock(db, options);
  const latestRateRecord = getLatestRate(db);
  const activeRate = latestRateRecord?.rateToVes ?? fallbackRateToVes;

  return {
    products: computeBimonetaryProducts(items, activeRate),
    activeRate,
  };
}
