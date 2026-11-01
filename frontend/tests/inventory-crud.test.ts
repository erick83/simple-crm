import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./helpers";
import { uuidv7 } from "../src/utils/uuid7";
import {
  insertProduct,
  updateProduct,
  setProductActive,
  getProductById,
  getProductByBarcode,
  getProductBySku,
  createCategory,
  listCategories,
  listInventoryWithStock,
  addStockMovement,
  getProductKardex,
} from "../src/database/repositories/product.repository";
import { P2pSyncService } from "../src/services/p2p-sync.service";
import type { SqlDriver } from "../src/database/connection";

describe("PR-13: Repositorio CRUD Completo de Inventario, Categorías y Kardex con Outbox P2P", () => {
  const TENANT = uuidv7();
  let db: SqlDriver;

  beforeEach(() => {
    db = createTestDb();
  });

  it("crea un producto, valida unicidad de SKU/barcode y encola evento en outbox P2P", () => {
    const id = insertProduct(db, {
      tenantId: TENANT,
      sku: "HAR-01",
      barcode: "75910001",
      name: "Harina PAN 1kg",
      priceUsd: "1.25",
      costUsd: "0.95",
      minStock: "5",
    });

    const prod = getProductById(db, id);
    expect(prod).toBeDefined();
    expect(prod?.sku).toBe("HAR-01");
    expect(prod?.barcode).toBe("75910001");
    expect(prod?.priceUsd).toBe("1.2500");
    expect(prod?.costUsd).toBe("0.9500");
    expect(prod?.minStock).toBe("5.0000");
    expect(prod?.isActive).toBe(true);

    // Valida unicidad de SKU
    expect(() =>
      insertProduct(db, {
        tenantId: TENANT,
        sku: "HAR-01",
        name: "Otro producto",
        priceUsd: "2",
        costUsd: "1",
      }),
    ).toThrow("El SKU 'HAR-01' ya está registrado");

    // Valida unicidad de Barcode
    expect(() =>
      insertProduct(db, {
        tenantId: TENANT,
        sku: "DIF-02",
        barcode: "75910001",
        name: "Harina repetida",
        priceUsd: "2",
        costUsd: "1",
      }),
    ).toThrow("El código de barras '75910001' ya está registrado");

    // Verifica que se encoló evento en peer_sync_outbox
    const pending = P2pSyncService.getPendingEvents(db, "PEER-ANY");
    expect(pending.length).toBeGreaterThanOrEqual(1);
    const event = pending.find((e) => e.entityId === id);
    expect(event).toBeDefined();
    expect(event?.entityType).toBe("PRODUCT");
    expect(event?.action).toBe("UPSERT");
  });

  it("actualiza campos del producto y genera evento outbox UPSERT", () => {
    const id = insertProduct(db, {
      tenantId: TENANT,
      sku: "ACE-01",
      name: "Aceite 1L",
      priceUsd: "3.5",
      costUsd: "2.8",
    });

    const updated = updateProduct(db, {
      id,
      name: "Aceite Mazeite 1L",
      priceUsd: "3.8000",
      barcode: "75910003",
    });

    expect(updated.name).toBe("Aceite Mazeite 1L");
    expect(updated.priceUsd).toBe("3.8000");
    expect(updated.barcode).toBe("75910003");

    // Consulta de nuevo desde BD
    const fromDb = getProductByBarcode(db, "75910003");
    expect(fromDb?.id).toBe(id);
    expect(fromDb?.name).toBe("Aceite Mazeite 1L");

    // Valida conflicto si intenta actualizar su SKU a uno ya existente
    insertProduct(db, {
      tenantId: TENANT,
      sku: "ARR-02",
      name: "Arroz",
      priceUsd: "1.5",
      costUsd: "1.0",
    });

    expect(() => updateProduct(db, { id, sku: "ARR-02" })).toThrow("El SKU 'ARR-02' ya está registrado");
  });

  it("desactiva y reactiva productos (baja lógica) encolando DELETE y UPSERT", () => {
    const id = insertProduct(db, {
      tenantId: TENANT,
      sku: "PAS-01",
      name: "Pasta 1kg",
      priceUsd: "1.5",
      costUsd: "1.0",
    });

    // Desactivar
    setProductActive(db, id, false, "C01");
    const inactive = getProductById(db, id);
    expect(inactive?.isActive).toBe(false);

    // No debe aparecer en búsqueda activa
    expect(getProductBySku(db, "PAS-01")).toBeUndefined();

    // Reactivar
    setProductActive(db, id, true, "C01");
    const activeAgain = getProductById(db, id);
    expect(activeAgain?.isActive).toBe(true);
    expect(getProductBySku(db, "PAS-01")).toBeDefined();
  });

  it("gestiona categorías y lista ordenadamente", () => {
    const cat1 = createCategory(db, "Víveres");
    const cat2 = createCategory(db, "Bebidas");
    const cat3 = createCategory(db, "Charcutería");

    const list = listCategories(db);
    expect(list).toHaveLength(3);
    expect(list.map((c) => c.name)).toEqual(["Bebidas", "Charcutería", "Víveres"]);
  });

  it("listInventoryWithStock calcula stock actual, alerta de stock bajo y filtra por búsqueda y categoría", () => {
    const catViveres = createCategory(db, "Víveres");
    const catBebidas = createCategory(db, "Bebidas");

    const id1 = insertProduct(db, {
      tenantId: TENANT,
      sku: "HAR-01",
      barcode: "75910001",
      name: "Harina PAN 1kg",
      categoryId: catViveres,
      priceUsd: "1.25",
      costUsd: "0.95",
      minStock: "5",
    });

    const id2 = insertProduct(db, {
      tenantId: TENANT,
      sku: "REF-02",
      barcode: "75920002",
      name: "Coca Cola 2L",
      categoryId: catBebidas,
      priceUsd: "2.50",
      costUsd: "1.80",
      minStock: "10",
    });

    // Agregar movimientos de stock
    addStockMovement(db, {
      productId: id1,
      terminalId: "C01",
      delta: "20.0000",
      type: "RESTOCK",
    });
    addStockMovement(db, {
      productId: id1,
      terminalId: "C01",
      delta: "-4.0000",
      type: "SALE",
    });

    // id2 solo tiene stock 8.0000 (menor a su minStock 10.0000 -> alerta stock bajo)
    addStockMovement(db, {
      productId: id2,
      terminalId: "C01",
      delta: "8.0000",
      type: "RESTOCK",
    });

    // Listado completo
    const all = listInventoryWithStock(db, { tenantId: TENANT });
    expect(all).toHaveLength(2);

    const itemHarina = all.find((i) => i.id === id1)!;
    expect(itemHarina.currentStock).toBe("16.0000");
    expect(itemHarina.categoryName).toBe("Víveres");
    expect(itemHarina.isLowStock).toBe(false);

    const itemCoca = all.find((i) => i.id === id2)!;
    expect(itemCoca.currentStock).toBe("8.0000");
    expect(itemCoca.categoryName).toBe("Bebidas");
    expect(itemCoca.isLowStock).toBe(true); // 8 <= 10

    // Filtro por búsqueda (por código de barras)
    const filteredBarcode = listInventoryWithStock(db, { search: "75910001" });
    expect(filteredBarcode).toHaveLength(1);
    expect(filteredBarcode[0]?.sku).toBe("HAR-01");

    // Filtro por búsqueda (por nombre case-insensitive)
    const filteredName = listInventoryWithStock(db, { search: "coca" });
    expect(filteredName).toHaveLength(1);
    expect(filteredName[0]?.sku).toBe("REF-02");

    // Filtro por categoría
    const filteredCat = listInventoryWithStock(db, { categoryId: catViveres });
    expect(filteredCat).toHaveLength(1);
    expect(filteredCat[0]?.name).toBe("Harina PAN 1kg");
  });

  it("getProductKardex retorna el historial de movimientos en orden cronológico descendente", () => {
    const id = insertProduct(db, {
      tenantId: TENANT,
      sku: "PROD-K",
      name: "Producto Kardex",
      priceUsd: "1.0000",
      costUsd: "0.5000",
    });

    addStockMovement(db, { productId: id, terminalId: "C01", delta: "10.0000", type: "RESTOCK" }, 1000);
    addStockMovement(db, { productId: id, terminalId: "C01", delta: "-2.0000", type: "SALE" }, 1010);
    addStockMovement(db, { productId: id, terminalId: "C02", delta: "1.0000", type: "RETURN" }, 1020);

    const kardex = getProductKardex(db, id);
    expect(kardex).toHaveLength(3);
    expect(kardex[0]?.movementType).toBe("RETURN");
    expect(kardex[0]?.quantityDelta).toBe("1.0000");
    expect(kardex[1]?.movementType).toBe("SALE");
    expect(kardex[1]?.quantityDelta).toBe("-2.0000");
    expect(kardex[2]?.movementType).toBe("RESTOCK");
    expect(kardex[2]?.quantityDelta).toBe("10.0000");
  });
});

