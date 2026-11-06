import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers";
import { insertProduct, getAllActiveProducts } from "../src/database/repositories/product.repository";
import { insertRate, getRateForDate } from "../src/database/repositories/exchange.repository";
import { computeBimonetaryProducts, getCatalogWithBimonetaryPrices } from "../src/services/catalog.service";
import { formatUsd, formatVes, convertUsdToVes, toDecimal } from "../src/utils/decimal";
import { uuidv7 } from "../src/utils/uuid7";

describe("PR-05: Integración Bimoneda en Catálogo y Conversión Reactiva", () => {
  it("calcula precios en VES según la tasa activa respetando 4 decimales exactos", () => {
    const products = [
      {
        id: "1",
        tenantId: "t1",
        categoryId: null,
        barcode: "7591001",
        sku: "HAR-01",
        name: "Harina PAN 1kg",
        priceUsd: "1.2500",
        costUsd: "0.9000",
        taxRate: "0.1600",
        imagePath: null,
        minStock: "5.0000",
        tracksInventory: true,
        isActive: true,
        createdAt: 1000,
        updatedAt: 1000,
      },
    ];

    const result = computeBimonetaryProducts(products, "36.5000");
    expect(result).toHaveLength(1);
    expect(result[0]?.priceUsd).toBe("1.2500");
    expect(result[0]?.priceVes).toBe("45.6250"); // 1.2500 * 36.5000 = 45.6250
    expect(result[0]?.formattedUsd).toBe("$ 1.25");
    expect(result[0]?.formattedVes).toBe("Bs. 45.63");
  });

  it("actualizar la tasa del día recalcula los precios mostrados en VES sin alterar price_usd en SQLite", () => {
    const db = createTestDb();
    const tenantId = uuidv7();

    // 1. Insertar productos en SQLite con precio base en USD
    const p1 = insertProduct(db, {
      tenantId,
      sku: "PROD-A",
      name: "Café Gourmet 500g",
      priceUsd: "4.2000",
      costUsd: "3.1000",
    });

    const p2 = insertProduct(db, {
      tenantId,
      sku: "PROD-B",
      name: "Aceite 1L",
      priceUsd: "3.5000",
      costUsd: "2.8000",
    });

    // 2. Establecer tasa inicial del día (36.5000)
    insertRate(db, "2026-11-01", "36.5000", "BCV_AUTO", null, 1000);

    const catalog1 = getCatalogWithBimonetaryPrices(db);
    expect(catalog1.activeRate).toBe("36.5000");

    const itemA1 = catalog1.products.find((p) => p.id === p1);
    const itemB1 = catalog1.products.find((p) => p.id === p2);
    expect(itemA1?.priceVes).toBe("153.3000"); // 4.2000 * 36.5000 = 153.3000
    expect(itemB1?.priceVes).toBe("127.7500"); // 3.5000 * 36.5000 = 127.7500

    // 3. Simular actualización oficial vespertina de la tasa del día siguiente (40.0000)
    insertRate(db, "2026-11-02", "40.0000", "MANUAL", "Ajuste oficial vespertino", 2000);

    const catalog2 = getCatalogWithBimonetaryPrices(db);
    expect(catalog2.activeRate).toBe("40.0000");

    const itemA2 = catalog2.products.find((p) => p.id === p1);
    const itemB2 = catalog2.products.find((p) => p.id === p2);

    // Precios en VES recalculados reactivamente al instante
    expect(itemA2?.priceVes).toBe("168.0000"); // 4.2000 * 40.0000 = 168.0000
    expect(itemB2?.priceVes).toBe("140.0000"); // 3.5000 * 40.0000 = 140.0000
    expect(itemA2?.formattedVes).toBe("Bs. 168.00");
    expect(itemB2?.formattedVes).toBe("Bs. 140.00");

    // 4. VERIFICACIÓN CRUCIAL: La base de datos SQLite NUNCA fue mutada
    const [rawA] = db.all<{ price_usd: string }>("SELECT price_usd FROM products WHERE id = ?", [p1]);
    const [rawB] = db.all<{ price_usd: string }>("SELECT price_usd FROM products WHERE id = ?", [p2]);

    expect(rawA?.price_usd).toBe("4.2000");
    expect(rawB?.price_usd).toBe("3.5000");
  });

  it("rechaza tasas inválidas o menores/iguales a cero", () => {
    const products = [
      {
        id: "1",
        tenantId: "t1",
        categoryId: null,
        barcode: null,
        sku: "TEST",
        name: "Test",
        priceUsd: "10.0000",
        costUsd: "5.0000",
        taxRate: "0.1600",
        imagePath: null,
        minStock: "5.0000",
        tracksInventory: true,
        isActive: true,
        createdAt: 1000,
        updatedAt: 1000,
      },
    ];

    expect(() => computeBimonetaryProducts(products, "0")).toThrow();
    expect(() => computeBimonetaryProducts(products, "-10")).toThrow();
    expect(() => computeBimonetaryProducts(products, "invalido")).toThrow();
  });

  it("mantiene precisión de 4 decimales en conversiones monetarias exactas", () => {
    // 10.5000 * 36.5000 = 383.2500
    const converted = convertUsdToVes("10.5000", "36.5000");
    expect(converted.toFixed(4)).toBe("383.2500");
    expect(formatVes(converted)).toBe("Bs. 383.25");
  });
});
