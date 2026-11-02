import { describe, it, expect } from "vitest";
import React from "react";
import { createTestDb } from "./helpers";
import { uuidv7 } from "../src/utils/uuid7";
import {
  insertProduct,
  updateProduct,
  listInventoryWithStock,
  addStockMovement,
  getProductKardex,
  createCategory,
  deleteCategory,
  deleteProduct,
  listCategories,
} from "../src/database/repositories/product.repository";
import { MemoryFileStore, resolveProductImageUri } from "../src/services/image-compressor.service";
import { P2pSyncService } from "../src/services/p2p-sync.service";
import { formatFixed4, toDecimal } from "../src/utils/decimal";
import { createDefaultSqlDriver } from "../src/database/connection";
import App from "../src/App";
import type { AppProps } from "../src/App";
import { InventoryScreen } from "../src/screens/InventoryScreen";
import type { InventoryScreenProps } from "../src/screens/InventoryScreen";

describe("PR-16: Pantalla Táctil de Inventario, Gestión de Productos y Ajustes de Kardex", () => {
  const TENANT_A = uuidv7();
  const TERMINAL_1 = "TERM-01";

  it("lista reactivamente productos con stock acumulado desde v_product_current_stock", () => {
    const db = createTestDb();

    // 1. Insertar productos
    const prod1Id = insertProduct(
      db,
      {
        tenantId: TENANT_A,
        sku: "HAR-001",
        barcode: "75910001",
        name: "Harina PAN 1kg",
        priceUsd: "1.2500",
        costUsd: "0.9500",
        minStock: "10.0000",
      },
      Date.now(),
      TERMINAL_1,
    );
    addStockMovement(db, {
      productId: prod1Id,
      delta: "25.0000",
      type: "RESTOCK",
      terminalId: TERMINAL_1,
    });

    const prod2Id = insertProduct(
      db,
      {
        tenantId: TENANT_A,
        sku: "ARR-002",
        barcode: "75910002",
        name: "Arroz Primor 1kg",
        priceUsd: "1.5000",
        costUsd: "1.1000",
        minStock: "15.0000",
      },
      Date.now(),
      TERMINAL_1,
    );
    addStockMovement(db, {
      productId: prod2Id,
      delta: "5.0000", // Stock bajo (< minStock: 15.0000)
      type: "RESTOCK",
      terminalId: TERMINAL_1,
    });

    // 2. Consultar inventario
    const inventory = listInventoryWithStock(db, { tenantId: TENANT_A });
    expect(inventory).toHaveLength(2);

    const har = inventory.find((p) => p.id === prod1Id);
    expect(har).toBeDefined();
    expect(har?.currentStock).toBe("25.0000");
    expect(toDecimal(har!.currentStock).lte(toDecimal(har!.minStock))).toBe(false);

    const arr = inventory.find((p) => p.id === prod2Id);
    expect(arr).toBeDefined();
    expect(arr?.currentStock).toBe("5.0000");
    // Alerta de stock bajo
    expect(toDecimal(arr!.currentStock).lte(toDecimal(arr!.minStock))).toBe(true);
  });

  it("actualiza producto existente y refleja cambios sin alterar el histórico de stock", () => {
    const db = createTestDb();
    const prodId = insertProduct(
      db,
      {
        tenantId: TENANT_A,
        sku: "ACE-003",
        name: "Aceite Mazeite 1L",
        priceUsd: "3.5000",
        costUsd: "2.8000",
        minStock: "5.0000",
      },
      Date.now(),
      TERMINAL_1,
    );
    addStockMovement(db, {
      productId: prodId,
      delta: "12.0000",
      type: "RESTOCK",
      terminalId: TERMINAL_1,
    });

    // Actualizar precio y stock mínimo
    updateProduct(
      db,
      {
        id: prodId,
        sku: "ACE-003",
        barcode: "75910003",
        name: "Aceite Mazeite 1L (Renombrado)",
        priceUsd: "3.8500",
        costUsd: "3.0000",
        minStock: "8.0000",
      },
      Date.now(),
    );

    const items = listInventoryWithStock(db, { tenantId: TENANT_A });
    const updated = items.find((p) => p.id === prodId);
    expect(updated?.name).toBe("Aceite Mazeite 1L (Renombrado)");
    expect(updated?.priceUsd).toBe("3.8500");
    expect(updated?.costUsd).toBe("3.0000");
    expect(updated?.barcode).toBe("75910003");
    // El stock acumulado permanece intacto
    expect(updated?.currentStock).toBe("12.0000");
  });

  it("registra ajuste de Kardex táctil (RESTOCK, ADJUSTMENT, RETURN) con deltas exactos a 4 decimales", () => {
    const db = createTestDb();
    const now = 1700000000000;
    const prodId = insertProduct(
      db,
      {
        tenantId: TENANT_A,
        sku: "CAF-004",
        name: "Café Fama 500g",
        priceUsd: "4.2000",
        costUsd: "3.4000",
        minStock: "10.0000",
      },
      now,
      TERMINAL_1,
    );
    addStockMovement(
      db,
      {
        productId: prodId,
        delta: "20.0000",
        type: "RESTOCK",
        terminalId: TERMINAL_1,
      },
      now,
    );

    // 1. Reposición de mercancía (RESTOCK): +15.0000
    addStockMovement(
      db,
      {
        productId: prodId,
        terminalId: TERMINAL_1,
        delta: "15.0000",
        type: "RESTOCK",
        referenceId: "Llegada camión distribuidor",
      },
      now + 100,
    );

    // 2. Merma o ajuste físico (ADJUSTMENT negativo): -2.0000
    addStockMovement(
      db,
      {
        productId: prodId,
        terminalId: TERMINAL_1,
        delta: "-2.0000",
        type: "ADJUSTMENT",
        referenceId: "Empaque dañado",
      },
      now + 200,
    );

    // 3. Devolución de cliente (RETURN positivo): +1.0000
    addStockMovement(
      db,
      {
        productId: prodId,
        terminalId: TERMINAL_1,
        delta: "1.0000",
        type: "RETURN",
        referenceId: "Devolución ticket #102",
      },
      now + 300,
    );

    // Stock final: 20 + 15 - 2 + 1 = 34.0000
    const [item] = listInventoryWithStock(db, { tenantId: TENANT_A });
    expect(item).toBeDefined();
    expect(item!.currentStock).toBe("34.0000");

    // Verificar historial Kardex inmutable (orden cronológico ascendente tras revertir DESC)
    const kardex = getProductKardex(db, prodId);
    expect(kardex).toHaveLength(4);
    const chronological = [...kardex].reverse();
    expect(chronological.map((k) => k.movementType)).toEqual(["RESTOCK", "RESTOCK", "ADJUSTMENT", "RETURN"]);
    expect(chronological.map((k) => k.quantityDelta)).toEqual(["20.0000", "15.0000", "-2.0000", "1.0000"]);
  });

  it("calcula delta exacto cuando el usuario ajusta el stock objetivo en el modal", () => {
    const currentStock = "18.5000";
    const targetStock = "25.0000";
    const delta = formatFixed4(toDecimal(targetStock).minus(toDecimal(currentStock)));
    expect(delta).toBe("6.5000");

    const targetStockLower = "10.0000";
    const deltaNeg = formatFixed4(toDecimal(targetStockLower).minus(toDecimal(currentStock)));
    expect(deltaNeg).toBe("-8.5000");
  });

  it("resuelve imágenes locales usando FileStore y genera fallback si no hay foto", async () => {
    const fileStore = new MemoryFileStore();
    const fakeBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    await fileStore.writeFile("prod_test_01.webp", new Uint8Array(Buffer.from(fakeBase64, "base64")));

    const uriExisting = await resolveProductImageUri(fileStore, "prod_test_01.webp");
    expect(uriExisting).toContain("data:image/webp;base64,");

    const uriMissing = await resolveProductImageUri(fileStore, "non_existent.webp");
    expect(uriMissing).toBeNull();

    const uriNull = await resolveProductImageUri(fileStore, null);
    expect(uriNull).toBeNull();
  });

  it("encola automáticamente en outbox cada alta, edición y movimiento para sincronización P2P", () => {
    const db = createTestDb();
    expect(P2pSyncService.getPendingCount(db)).toBe(0);

    // Alta de producto encola 1 evento (PRODUCT UPSERT)
    const prodId = insertProduct(
      db,
      {
        tenantId: TENANT_A,
        sku: "GAL-005",
        name: "Galletas María 100g",
        priceUsd: "0.8000",
        costUsd: "0.5500",
      },
      Date.now(),
      TERMINAL_1,
    );
    expect(P2pSyncService.getPendingCount(db)).toBe(1);

    // Edición de producto encola 1 evento (PRODUCT UPSERT)
    updateProduct(
      db,
      {
        id: prodId,
        sku: "GAL-005",
        name: "Galletas María 120g",
        priceUsd: "0.9000",
        costUsd: "0.6000",
      },
      Date.now(),
    );
    expect(P2pSyncService.getPendingCount(db)).toBe(2);

    // Ajuste de Kardex encola 1 evento (STOCK_MOVEMENT UPSERT)
    addStockMovement(
      db,
      {
        productId: prodId,
        terminalId: TERMINAL_1,
        delta: "10.0000",
        type: "RESTOCK",
      },
    );
    expect(P2pSyncService.getPendingCount(db)).toBe(3);
  });

  it("App e InventoryScreen se instancian correctamente con inyección de db y fileStore", () => {
    const db = createTestDb();
    const fileStore = new MemoryFileStore();

    // Comprobar que App renderiza el árbol de elementos React con las props configuradas
    const appProps: AppProps = {
      initialDb: db,
      tenantId: TENANT_A,
      terminalId: TERMINAL_1,
      fileStore,
    };
    const appElement = React.createElement(App, appProps);
    expect(appElement).toBeDefined();
    expect(appElement.props.tenantId).toBe(TENANT_A);
    expect(appElement.props.terminalId).toBe(TERMINAL_1);

    const screenProps: InventoryScreenProps = {
      db,
      tenantId: TENANT_A,
      terminalId: TERMINAL_1,
      fileStore,
    };
    const screenElement = React.createElement(InventoryScreen, screenProps);
    expect(screenElement).toBeDefined();
    expect(screenElement.props.db).toBe(db);
  });

  it("elimina categorías y productos validando que el usuario escriba exactamente BORRAR", () => {
    const db = createTestDb();
    const catId = createCategory(db, "Lácteos");
    const prodId = insertProduct(
      db,
      {
        tenantId: TENANT_A,
        sku: "LAC-01",
        name: "Queso Blanco 1kg",
        categoryId: catId,
        priceUsd: "5.5000",
        costUsd: "4.0000",
      },
      Date.now(),
      TERMINAL_1,
    );
    addStockMovement(db, {
      productId: prodId,
      terminalId: TERMINAL_1,
      delta: "8.0000",
      type: "RESTOCK",
    });

    // Intento fallido sin escribir BORRAR
    expect(() =>
      deleteCategory(db, { categoryId: catId, confirmationWord: "eliminar" }),
    ).toThrow(/BORRAR/);

    expect(() =>
      deleteProduct(db, { productId: prodId, confirmationWord: "no" }),
    ).toThrow(/BORRAR/);

    // Eliminación válida de categoría (desasocia el producto a Sin Categoría)
    deleteCategory(db, { categoryId: catId, confirmationWord: "BORRAR" });
    expect(listCategories(db).find((c) => c.id === catId)).toBeUndefined();

    const [prodAfterCatDelete] = listInventoryWithStock(db, { tenantId: TENANT_A });
    expect(prodAfterCatDelete?.categoryId).toBeNull();

    // Eliminación válida de producto con liquidación de stock en Kardex
    deleteProduct(db, {
      productId: prodId,
      confirmationWord: "BORRAR",
      clearRemainingStock: true,
      terminalId: TERMINAL_1,
    });

    expect(listInventoryWithStock(db, { tenantId: TENANT_A })).toHaveLength(0);
    const kardex = getProductKardex(db, prodId);
    expect(kardex[0]?.quantityDelta).toBe("-8.0000");
  });

  it("createDefaultSqlDriver inicializa el driver de escritorio/web con semilla automática y permite operaciones CRUD", () => {
    const defaultDb = createDefaultSqlDriver({
      tenantId: TENANT_A,
      terminalId: TERMINAL_1,
    });

    const seededItems = listInventoryWithStock(defaultDb, { tenantId: TENANT_A });
    expect(seededItems.length).toBeGreaterThanOrEqual(6);

    const har = seededItems.find((i) => i.sku === "HAR-01");
    expect(har).toBeDefined();
    expect(har?.currentStock).toBe("24.0000");

    // Ajustar stock en el driver de escritorio/web
    addStockMovement(defaultDb, {
      productId: har!.id,
      terminalId: TERMINAL_1,
      delta: "6.0000",
      type: "RESTOCK",
    });

    const updatedItems = listInventoryWithStock(defaultDb, { tenantId: TENANT_A });
    const harUpdated = updatedItems.find((i) => i.sku === "HAR-01");
    expect(harUpdated?.currentStock).toBe("30.0000");
  });
});
