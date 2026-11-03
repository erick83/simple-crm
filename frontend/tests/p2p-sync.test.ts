import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./helpers";
import { uuidv7 } from "../src/utils/uuid7";
import {
  InMemoryP2pNetwork,
  P2pHttpClient,
  P2pHttpServer,
  P2pSyncService,
} from "../src/services/p2p-sync.service";
import type { FileStore } from "../src/services/image-compressor.service";
import { getCurrentStock } from "../src/database/repositories/product.repository";

describe("PR-12: Replicación Cruzada P2P de Catálogo, Deltas de Kardex e Imágenes", () => {
  const TENANT_A = "018f0000-0000-7000-8000-00000000000a";
  const TENANT_B = "018f0000-0000-7000-8000-00000000000b";

  let network: InMemoryP2pNetwork;

  function createMemoryFileStore(): FileStore & {
    files: Map<string, Uint8Array>;
    readFile: (p: string) => Promise<Uint8Array | null>;
  } {
    const map = new Map<string, Uint8Array>();
    return {
      files: map,
      writeFile: async (p, d) => void map.set(p, d),
      deleteFile: async (p) => void map.delete(p),
      readFile: async (p) => map.get(p) ?? null,
    };
  }

  beforeEach(() => {
    network = new InMemoryP2pNetwork();
  });

  it("crear/editar un producto con foto en Caja 1 se replica de forma idempotente en Caja 2", async () => {
    const db1 = createTestDb();
    const fs1 = createMemoryFileStore();
    const server1 = new P2pHttpServer({
      ip: "192.168.1.10",
      port: 8088,
      tenantId: TENANT_A,
      terminalId: "CAJA-01",
      db: db1,
      fileStore: fs1,
    });
    network.register(server1);

    const db2 = createTestDb();
    const fs2 = createMemoryFileStore();
    const server2 = new P2pHttpServer({
      ip: "192.168.1.20",
      port: 8088,
      tenantId: TENANT_A,
      terminalId: "CAJA-02",
      db: db2,
      fileStore: fs2,
    });
    network.register(server2);

    const client1 = new P2pHttpClient({
      tenantId: TENANT_A,
      terminalId: "CAJA-01",
      dispatcher: network,
    });

    // 1. En Caja 1 se crea una imagen local y un producto
    const prodId = uuidv7();
    const imgPath = `images/products/${prodId}.webp`;
    const imgBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x12, 0x34]); // WebP mock header
    await fs1.writeFile(imgPath, imgBytes);

    const productPayload = {
      id: prodId,
      sku: "HAR-PAN-01",
      barcode: "75910001",
      name: "Harina PAN 1kg",
      priceUsd: "1.2500",
      costUsd: "0.9500",
      taxRate: "0.1600",
      minStock: "5.0000",
      imagePath: imgPath,
      isActive: true,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    };

    // Insertar en BD local de Caja 1 y encolar en peer_sync_outbox
    db1.run(
      `INSERT INTO products (id, tenant_id, sku, barcode, name, price_usd, cost_usd, tax_rate, min_stock, image_path, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        prodId,
        TENANT_A,
        productPayload.sku,
        productPayload.barcode,
        productPayload.name,
        productPayload.priceUsd,
        productPayload.costUsd,
        productPayload.taxRate,
        productPayload.minStock,
        productPayload.imagePath,
        productPayload.createdAt,
        productPayload.updatedAt,
      ],
    );

    P2pSyncService.enqueueEvent(db1, {
      originTerminalId: "CAJA-01",
      entityType: "PRODUCT",
      entityId: prodId,
      action: "UPSERT",
      payload: productPayload,
    });

    expect(P2pSyncService.getPendingCount(db1)).toBe(1);
    expect(P2pSyncService.getUnreplicatedCount(db1)).toBe(1);

    // 2. Ejecutar replicación de Caja 1 hacia Caja 2
    const syncResult = await P2pSyncService.syncWithPeer({
      db: db1,
      client: client1,
      peer: { ip: "192.168.1.20", port: 8088, terminalId: "CAJA-02" },
      fileStore: fs1,
    });

    expect(syncResult.sent).toBe(1);
    expect(syncResult.acked).toBe(1);

    // 3. Verificar que Caja 2 recibió el producto en su SQLite
    const [prodCaja2] = db2.all<{
      id: string;
      sku: string;
      name: string;
      price_usd: string;
      image_path: string;
    }>("SELECT id, sku, name, price_usd, image_path FROM products WHERE id = ?", [prodId]);

    expect(prodCaja2).toBeDefined();
    expect(prodCaja2?.sku).toBe("HAR-PAN-01");
    expect(prodCaja2?.name).toBe("Harina PAN 1kg");
    expect(prodCaja2?.price_usd).toBe("1.2500");
    expect(prodCaja2?.image_path).toBe(imgPath);

    // 4. Verificar que el archivo de imagen se guardó físicamente en el FileStore local de Caja 2
    const fileBytesCaja2 = await fs2.readFile(imgPath);
    expect(fileBytesCaja2).toBeDefined();
    expect(fileBytesCaja2).toEqual(imgBytes);

    // 5. Verificar que el outbox de Caja 1 ya no tiene eventos pendientes para Caja 2
    const pendingForCaja2 = P2pSyncService.getPendingEvents(db1, "CAJA-02");
    expect(pendingForCaja2).toHaveLength(0);
    expect(P2pSyncService.getUnreplicatedCount(db1)).toBe(0);
    expect(P2pSyncService.getLastSyncAt()).toBeTypeOf("number");

    // 6. Idempotencia: si se re-sincroniza el mismo delta, no falla ni corrompe nada
    const reSync = await P2pSyncService.syncWithPeer({
      db: db1,
      client: client1,
      peer: { ip: "192.168.1.20", port: 8088, terminalId: "CAJA-02" },
      fileStore: fs1,
    });
    expect(reSync.sent).toBe(0);
  });

  it("movimientos de stock (Kardex) se replican e impactan el inventario calculado de forma conmutativa e idempotente", async () => {
    const db1 = createTestDb();
    const server1 = new P2pHttpServer({
      ip: "192.168.1.10",
      port: 8088,
      tenantId: TENANT_A,
      terminalId: "CAJA-01",
      db: db1,
    });
    network.register(server1);

    const db2 = createTestDb();
    const server2 = new P2pHttpServer({
      ip: "192.168.1.20",
      port: 8088,
      tenantId: TENANT_A,
      terminalId: "CAJA-02",
      db: db2,
    });
    network.register(server2);

    const client1 = new P2pHttpClient({
      tenantId: TENANT_A,
      terminalId: "CAJA-01",
      dispatcher: network,
    });

    const prodId = uuidv7();

    // Insertar el producto en ambas cajas
    for (const db of [db1, db2]) {
      db.run(
        `INSERT INTO products (id, tenant_id, sku, barcode, name, price_usd, cost_usd, tax_rate, min_stock, is_active, created_at, updated_at)
         VALUES (?, ?, 'ARR-01', '75910002', 'Arroz Primor', '1.5000', '1.1000', '0.1600', '5.0000', 1, 1000, 1000)`,
        [prodId, TENANT_A],
      );
    }

    // Caja 1 registra dos movimientos: un RESTOCK de +10.0000 y una SALE de -2.5000
    const movId1 = uuidv7();
    const movId2 = uuidv7();

    P2pSyncService.enqueueEvent(db1, {
      originTerminalId: "CAJA-01",
      entityType: "STOCK_MOVEMENT",
      entityId: movId1,
      action: "UPSERT",
      payload: {
        id: movId1,
        productId: prodId,
        terminalId: "CAJA-01",
        quantityDelta: "10.0000",
        movementType: "RESTOCK",
        createdAt: 1001,
      },
    });

    P2pSyncService.enqueueEvent(db1, {
      originTerminalId: "CAJA-01",
      entityType: "STOCK_MOVEMENT",
      entityId: movId2,
      action: "UPSERT",
      payload: {
        id: movId2,
        productId: prodId,
        terminalId: "CAJA-01",
        quantityDelta: "-2.5000",
        movementType: "SALE",
        createdAt: 1002,
      },
    });

    // Sincronizar de Caja 1 a Caja 2
    const syncRes = await P2pSyncService.syncWithPeer({
      db: db1,
      client: client1,
      peer: { ip: "192.168.1.20", port: 8088, terminalId: "CAJA-02" },
    });

    expect(syncRes.sent).toBe(2);
    expect(syncRes.acked).toBe(2);

    // En Caja 2, el stock actual acumulado debe ser exactamente 7.5000
    const stockCaja2 = getCurrentStock(db2, prodId);
    expect(stockCaja2).toBeDefined();
    expect(stockCaja2?.currentStock).toBe("7.5000");

    // Idempotencia: Enviar manualmente los mismos deltas de nuevo
    const directRes = await client1.sendDeltas({ ip: "192.168.1.20", port: 8088 }, [
      {
        id: movId1,
        originTerminalId: "CAJA-01",
        entityType: "STOCK_MOVEMENT",
        entityId: movId1,
        action: "UPSERT",
        payload: {
          id: movId1,
          productId: prodId,
          terminalId: "CAJA-01",
          quantityDelta: "10.0000",
          movementType: "RESTOCK",
          createdAt: 1001,
        },
        createdAt: 1001,
      },
    ]);

    expect(directRes.status).toBe(200);
    // El stock no debe duplicarse
    const stockAfterDuplicate = getCurrentStock(db2, prodId);
    expect(stockAfterDuplicate?.currentStock).toBe("7.5000");
  });

  it("rechaza sincronización con 403 Forbidden si el tenant_id difiere", async () => {
    const db2 = createTestDb();
    const server2 = new P2pHttpServer({
      ip: "192.168.1.20",
      port: 8088,
      tenantId: TENANT_A,
      terminalId: "CAJA-02",
      db: db2,
    });
    network.register(server2);

    // Cliente con Tenant B intenta inyectar deltas a Caja 2 de Tenant A
    const maliciousClient = new P2pHttpClient({
      tenantId: TENANT_B,
      terminalId: "CAJA-HACK",
      dispatcher: network,
    });

    const res = await maliciousClient.sendDeltas({ ip: "192.168.1.20", port: 8088 }, [
      {
        id: uuidv7(),
        originTerminalId: "CAJA-HACK",
        entityType: "PRODUCT",
        entityId: uuidv7(),
        action: "UPSERT",
        payload: { sku: "HACK", name: "Hack Item" },
        createdAt: Date.now(),
      },
    ]);

    expect(res.status).toBe(403);
    expect(res.error).toContain("Tenant mismatch");

    const count = db2.all<{ count: number }>("SELECT COUNT(*) as count FROM products");
    expect(count[0]?.count).toBe(0);
  });
});
