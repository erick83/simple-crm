import { Decimal, toDecimal, formatUsd, formatVes, convertUsdToVes, formatFixed4 } from "../utils/decimal";
import type { SqlDriver } from "../database/connection";
import { getAllActiveProducts, ProductEntity } from "../database/repositories/product.repository";
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
  imagePath: string | null;
  categoryId: string | null;
}

/**
 * Convierte un listado de productos con precio base en USD a productos bimoneda reactivos
 * aplicando la tasa de cambio vigente sin alterar los registros base en SQLite.
 */
export function computeBimonetaryProducts(
  products: ProductEntity[],
  exchangeRateToVes: string | Decimal,
): BimonetaryProduct[] {
  const rate = toDecimal(exchangeRateToVes, "Tasa de cambio");
  if (rate.lte(0)) {
    throw new Error("La tasa de cambio debe ser estrictamente mayor a cero");
  }

  return products.map((p) => {
    const priceVes = convertUsdToVes(p.priceUsd, rate).toFixed(4);
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
      imagePath: p.imagePath,
      categoryId: p.categoryId,
    };
  });
}

/**
 * Consulta los productos activos en SQLite y calcula reactivamente los precios en VES
 * a partir de la tasa especificada o la tasa más reciente registrada en exchange_rates.
 */
export function getCatalogWithBimonetaryPrices(
  db: SqlDriver,
  fallbackRateToVes = "36.5000",
): { products: BimonetaryProduct[]; activeRate: string } {
  const products = getAllActiveProducts(db);
  const latestRateRecord = getLatestRate(db);
  const activeRate = latestRateRecord?.rateToVes ?? fallbackRateToVes;

  return {
    products: computeBimonetaryProducts(products, activeRate),
    activeRate,
  };
}
