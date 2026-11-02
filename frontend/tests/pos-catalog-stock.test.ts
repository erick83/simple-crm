import { describe, it, expect } from "vitest";
import React from "react";
import { createTestDb } from "./helpers";
import { uuidv7 } from "../src/utils/uuid7";
import {
  insertProduct,
  addStockMovement,
  createCategory,
} from "../src/database/repositories/product.repository";
import { insertRate } from "../src/database/repositories/exchange.repository";
import { getCatalogWithBimonetaryPrices } from "../src/services/catalog.service";
import { MemoryFileStore } from "../src/services/image-compressor.service";
import { PosScreen } from "../src/screens/PosScreen";
import type { PosScreenProps } from "../src/screens/PosScreen";

describe("PR-17: Catálogo POS Reactivo con Stock, Imágenes, Buscador y Categorías", () => {
  const TENANT_1 = uuidv7();
  const TERMINAL_1 = "TERM-01";

  it("obtiene catálogo bimoneda con stock actual de Kardex y nombres de categorías", () => {
    const db = createTestDb();

    // 1. Crear categoría
    const catId = createCategory(db, "Víveres");

    // 2. Insertar producto con categoría y stock
    const p1 = insertProduct(
      db,
      {
        tenantId: TENANT_1,
        sku: "HAR-01",
        barcode: "75910001",
        name: "Harina PAN 1kg",
        priceUsd: "1.2500",
        costUsd: "0.9500",
        categoryId: catId,
        unit: "paq",
        minStock: "5.0000",
      },
      Date.now(),
      TERMINAL_1,
    );

    addStockMovement(db, {
      productId: p1,
      delta: "20.0000",
      type: "RESTOCK",
      terminalId: TERMINAL_1,
    });

    // 3. Insertar tasa
    insertRate(db, "2026-11-02", "36.5000", "BCV_AUTO", null);

    // 4. Consultar catálogo
    const catalog = getCatalogWithBimonetaryPrices(db, "36.5000", { tenantId: TENANT_1 });
    expect(catalog.products).toHaveLength(1);
    const item = catalog.products[0]!;
    expect(item.id).toBe(p1);
    expect(item.sku).toBe("HAR-01");
    expect(item.currentStock).toBe("20.0000");
    expect(item.minStock).toBe("5.0000");
    expect(item.isLowStock).toBe(false);
    expect(item.unit).toBe("paq");
    expect(item.categoryName).toBe("Víveres");
    expect(item.priceUsd).toBe("1.2500");
    expect(item.priceVes).toBe("45.6250");
  });

  it("filtra productos por búsqueda de texto y por categoría", () => {
    const db = createTestDb();
    const catLacteos = createCategory(db, "Lácteos");
    const catGranos = createCategory(db, "Granos");

    insertProduct(db, {
      tenantId: TENANT_1,
      sku: "LECH-01",
      barcode: "75910020",
      name: "Leche Completa 1L",
      priceUsd: "2.1000",
      costUsd: "1.6000",
      categoryId: catLacteos,
    });

    insertProduct(db, {
      tenantId: TENANT_1,
      sku: "CARA-02",
      barcode: "75910030",
      name: "Caraotas Negras 500g",
      priceUsd: "1.8000",
      costUsd: "1.2000",
      categoryId: catGranos,
    });

    // Búsqueda por texto (SKU o nombre)
    const searchRes = getCatalogWithBimonetaryPrices(db, "36.5000", {
      tenantId: TENANT_1,
      search: "Leche",
    });
    expect(searchRes.products).toHaveLength(1);
    expect(searchRes.products[0]?.sku).toBe("LECH-01");

    // Filtro por categoría
    const catRes = getCatalogWithBimonetaryPrices(db, "36.5000", {
      tenantId: TENANT_1,
      categoryId: catGranos,
    });
    expect(catRes.products).toHaveLength(1);
    expect(catRes.products[0]?.sku).toBe("CARA-02");
  });

  it("renderiza el componente PosScreen con soporte para fileStore y tenantId", () => {
    const db = createTestDb();
    const fileStore = new MemoryFileStore();

    const elem = React.createElement(PosScreen, {
      db,
      tenantId: TENANT_1,
      terminalId: TERMINAL_1,
      fileStore,
    } as PosScreenProps);

    expect(elem).toBeDefined();
    expect(elem.props.terminalId).toBe("TERM-01");
    expect(elem.props.tenantId).toBe(TENANT_1);
  });
});

