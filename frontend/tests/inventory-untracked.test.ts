import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers";
import { uuidv7 } from "../src/utils/uuid7";
import {
  insertProduct,
  updateProduct,
  getProductById,
  getCurrentStock,
  addStockMovement,
  listInventoryWithStock,
  productTracksInventory,
} from "../src/database/repositories/product.repository";
import { createInvoice, voidInvoice } from "../src/database/repositories/invoice.repository";
import { openShift } from "../src/database/repositories/shift.repository";
import { computeBimonetaryProducts } from "../src/services/catalog.service";
import { P2pSyncService } from "../src/services/p2p-sync.service";
import type { SqlDriver } from "../src/database/connection";

/**
 * Rubros "sin control de inventario" (requisito de carnicería):
 * no guardan costo de reposición, no generan kardex, no se valorizan y no disparan alertas.
 */
describe("Rubros sin control de inventario", () => {
  const TENANT = uuidv7();

  const movementCount = (db: SqlDriver, productId: string): number => {
    const [row] = db.all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM stock_movements WHERE product_id = ?",
      [productId],
    );
    return Number(row?.n ?? 0);
  };

  it("persiste la bandera y normaliza costo/umbral a 0.0000 al crear el rubro", () => {
    const db = createTestDb();

    const id = insertProduct(db, {
      tenantId: TENANT,
      sku: "PICAD-01",
      name: "Picadilla especial",
      priceUsd: "4.5000",
      // Se ignora porque el rubro no controla inventario
      costUsd: "3.1000",
      minStock: "8",
      unit: "kg",
      tracksInventory: false,
    });

    const prod = getProductById(db, id);
    expect(prod?.tracksInventory).toBe(false);
    expect(prod?.costUsd).toBe("0.0000");
    expect(prod?.minStock).toBe("0.0000");
    expect(productTracksInventory(db, id)).toBe(false);

    // Los rubros sin bandera explícita siguen controlando inventario (compatibilidad)
    const id2 = insertProduct(db, {
      tenantId: TENANT,
      sku: "MUSLO-01",
      name: "Muslo muslo",
      priceUsd: "3.2000",
      costUsd: "2.0000",
    });
    expect(getProductById(db, id2)?.tracksInventory).toBe(true);
    expect(productTracksInventory(db, id2)).toBe(true);
  });

  it("al desactivar el control limpia costo y umbral, y al reactivarlos se conservan", () => {
    const db = createTestDb();
    const id = insertProduct(db, {
      tenantId: TENANT,
      sku: "HUESO-01",
      name: "Hueso con médula",
      priceUsd: "1.8000",
      costUsd: "1.1000",
      minStock: "12",
    });

    const off = updateProduct(db, { id, tracksInventory: false });
    expect(off.tracksInventory).toBe(false);
    expect(off.costUsd).toBe("0.0000");
    expect(off.minStock).toBe("0.0000");

    const on = updateProduct(db, {
      id,
      tracksInventory: true,
      costUsd: "1.1000",
      minStock: "12",
    });
    expect(on.tracksInventory).toBe(true);
    expect(on.costUsd).toBe("1.1000");
    expect(on.minStock).toBe("12.0000");
  });

  it("la venta de un rubro sin control no genera kardex y no altera otros rubros", () => {
    const db = createTestDb();
    const untracked = insertProduct(db, {
      tenantId: TENANT,
      sku: "MOLIDA-01",
      name: "Carne molida del día",
      priceUsd: "5.2500",
      unit: "kg",
      tracksInventory: false,
    });
    const tracked = insertProduct(db, {
      tenantId: TENANT,
      sku: "LOMO-01",
      name: "Lomo de res",
      priceUsd: "9.0000",
      costUsd: "6.5000",
      minStock: "3",
    });
    addStockMovement(db, {
      productId: tracked,
      delta: "10.0000",
      type: "RESTOCK",
      terminalId: "C01",
    });

    const shiftId = openShift(db, {
      terminalId: "C01",
      cashierName: "Erick",
      exchangeRateApplied: "36.5000",
      initialCashUsd: "50.0000",
      initialCashVes: "1825.0000",
    });

    const invoiceId = createInvoice(db, {
      shiftId,
      terminalId: "C01",
      exchangeRate: "36.5000",
      paymentMethod: "CASH_USD",
      items: [
        { productId: untracked, quantity: "2.5000", unitPriceUsd: "5.2500" },
        { productId: tracked, quantity: "1.0000", unitPriceUsd: "9.0000" },
      ],
    });

    // La factura se emite completa: el rubro sin control se cobra igual
    expect(invoiceId).toBeTruthy();
    expect(movementCount(db, untracked)).toBe(0);
    expect(getCurrentStock(db, untracked)?.currentStock).toBe("0.0000");
    expect(getCurrentStock(db, tracked)?.currentStock).toBe("9.0000");

    // Anulación: solo devuelve el stock que realmente se descontó
    voidInvoice(db, { invoiceId, reason: "Devolución de cliente", terminalId: "C01" });
    expect(movementCount(db, untracked)).toBe(0);
    expect(getCurrentStock(db, tracked)?.currentStock).toBe("10.0000");
  });

  it("no aparece en alertas ni en el stock del listado, aunque tenga kardex histórico", () => {
    const db = createTestDb();
    const id = insertProduct(db, {
      tenantId: TENANT,
      sku: "MENUDO-01",
      name: "Menudencias",
      priceUsd: "2.0000",
      costUsd: "1.0000",
      minStock: "5",
    });
    addStockMovement(db, { productId: id, delta: "4.0000", type: "RESTOCK", terminalId: "C01" });

    // Con control de inventario sí alerta (4.0000 <= 5.0000)
    expect(listInventoryWithStock(db, { tenantId: TENANT })[0]?.isLowStock).toBe(true);

    updateProduct(db, { id, tracksInventory: false });

    const item = listInventoryWithStock(db, { tenantId: TENANT })[0];
    expect(item?.tracksInventory).toBe(false);
    expect(item?.currentStock).toBe("0.0000");
    expect(item?.isLowStock).toBe(false);
    expect(item?.costUsd).toBe("0.0000");
  });

  it("rechaza ajustes manuales de kardex sobre un rubro sin control", () => {
    const db = createTestDb();
    const id = insertProduct(db, {
      tenantId: TENANT,
      sku: "CABEZA-01",
      name: "Cabeza de cochino",
      priceUsd: "1.5000",
      tracksInventory: false,
    });

    expect(() =>
      addStockMovement(db, { productId: id, delta: "5.0000", type: "ADJUSTMENT", terminalId: "C01" }),
    ).toThrow("no puede registrar kardex");
    expect(movementCount(db, id)).toBe(0);
  });

  it("el catálogo bimoneda no marca como bajo stock un rubro sin control", () => {
    const db = createTestDb();
    const id = insertProduct(db, {
      tenantId: TENANT,
      sku: "TOCINO-01",
      name: "Tocino",
      priceUsd: "6.0000",
      tracksInventory: false,
    });

    const items = listInventoryWithStock(db, { tenantId: TENANT });
    const catalog = computeBimonetaryProducts(items, "36.5000");
    expect(catalog[0]?.tracksInventory).toBe(false);
    expect(catalog[0]?.isLowStock).toBe(false);
    expect(catalog[0]?.costUsd).toBe("0.0000");
    expect(id).toBeTruthy();
  });

  it("propaga la bandera en el evento PRODUCT del outbox para la réplica P2P", () => {
    const db = createTestDb();
    const id = insertProduct(db, {
      tenantId: TENANT,
      sku: "CHULP-01",
      name: "Chuleta de cerdo",
      priceUsd: "4.1000",
      tracksInventory: false,
    });

    const events = P2pSyncService.getPendingEvents(db, "C02");
    const productEvent = events.find((e) => e.entityId === id && e.entityType === "PRODUCT");
    expect(productEvent).toBeDefined();

    const payload = JSON.parse(productEvent?.payload ?? "{}") as Record<string, unknown>;
    expect(payload.tracksInventory).toBe(false);
    expect(payload.costUsd).toBe("0.0000");
    expect(payload.minStock).toBe("0.0000");
  });
});
