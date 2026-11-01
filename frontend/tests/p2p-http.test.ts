import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./helpers";
import { uuidv7 } from "../src/utils/uuid7";
import { insertProduct, addStockMovement } from "../src/database/repositories/product.repository";
import { insertRate } from "../src/database/repositories/exchange.repository";
import {
  InMemoryP2pNetwork,
  P2pHttpClient,
  P2pHttpServer,
} from "../src/services/p2p-http.service";
import {
  InMemoryMdnsHub,
  InMemoryMdnsTransport,
  P2pDiscoveryService,
} from "../src/services/p2p-discovery.service";
import type { FileStore } from "../src/services/image-compressor.service";

describe("PR-11: Servidor HTTP P2P Embebido y Aislamiento por Cuenta (tenant_id)", () => {
  const TENANT_A = "018f0000-0000-7000-8000-00000000000a";
  const TENANT_B = "018f0000-0000-7000-8000-00000000000b";

  let network: InMemoryP2pNetwork;
  let fileStoreCaja1: FileStore & { files: Map<string, Uint8Array> };

  beforeEach(() => {
    network = new InMemoryP2pNetwork();
    const map = new Map<string, Uint8Array>();
    fileStoreCaja1 = {
      files: map,
      writeFile: async (p, d) => void map.set(p, d),
      deleteFile: async (p) => void map.delete(p),
      readFile: async (p) => map.get(p) ?? null,
    };
  });

  function setupCaja1(tenantId: string = TENANT_A) {
    const db = createTestDb();

    // Insertar un producto con stock y tasa en Caja 1
    const prodId = insertProduct(db, {
      tenantId,
      sku: "HAR-01",
      barcode: "75910001",
      name: "Harina PAN 1kg",
      priceUsd: "1.2500",
      costUsd: "0.9500",
    });

    // Kardex: Stock inicial +20.0000
    addStockMovement(db, {
      productId: prodId,
      terminalId: "CAJA-01",
      delta: "20.0000",
      type: "RESTOCK",
    });

    // Guardar una imagen de prueba en FileStore y actualizar product
    const imgData = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]); // PNG magic bytes
    const imgPath = `images/products/${prodId}.webp`;
    fileStoreCaja1.files.set(imgPath, imgData);
    db.run("UPDATE products SET image_path = ? WHERE id = ?", [imgPath, prodId]);

    // Registrar tasa oficial
    insertRate(db, "2026-11-01", "36.5000", "BCV_AUTO", "Tasa oficial de prueba");

    const server = new P2pHttpServer({
      ip: "192.168.1.100",
      port: 8088,
      tenantId,
      terminalId: "CAJA-01",
      db,
      fileStore: fileStoreCaja1,
    });
    network.register(server);

    return { db, server, prodId, imgPath, imgData };
  }

  it("Caja 2 consulta stock en tiempo real de Caja 1 en <15 ms si comparten el mismo tenant_id", async () => {
    setupCaja1(TENANT_A);

    const clientCaja2 = new P2pHttpClient({
      tenantId: TENANT_A,
      terminalId: "CAJA-02",
      dispatcher: network,
    });

    const start = performance.now();
    const res = await clientCaja2.getStock({ ip: "192.168.1.100", port: 8088 }, { sku: "HAR-01" });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(15);
    expect(res.status).toBe(200);
    expect(res.data).toBeDefined();
    expect(res.data?.sku).toBe("HAR-01");
    expect(res.data?.barcode).toBe("75910001");
    expect(res.data?.currentStock).toBe("20.0000");
    expect(res.data?.priceUsd).toBe("1.2500");
  });

  it("permite consultar stock por barcode o id", async () => {
    const { prodId } = setupCaja1(TENANT_A);

    const client = new P2pHttpClient({
      tenantId: TENANT_A,
      terminalId: "CAJA-02",
      dispatcher: network,
    });

    const resBarcode = await client.getStock({ ip: "192.168.1.100", port: 8088 }, { barcode: "75910001" });
    expect(resBarcode.status).toBe(200);
    expect(resBarcode.data?.sku).toBe("HAR-01");

    const resId = await client.getStock({ ip: "192.168.1.100", port: 8088 }, { id: prodId });
    expect(resId.status).toBe(200);
    expect(resId.data?.productId).toBe(prodId);
  });

  it("rechaza peticiones con 403 Forbidden si el tenant_id difiere (aislamiento por cuenta)", async () => {
    setupCaja1(TENANT_A);

    // Caja ajena con otra cuenta (Tenant B)
    const clientCajaAjena = new P2pHttpClient({
      tenantId: TENANT_B,
      terminalId: "CAJA-X",
      dispatcher: network,
    });

    const res = await clientCajaAjena.getStock({ ip: "192.168.1.100", port: 8088 }, { sku: "HAR-01" });
    expect(res.status).toBe(403);
    expect(res.error).toContain("Tenant mismatch");
    expect(res.data).toBeUndefined();
  });

  it("Caja 2 consulta la tasa de cambio de Caja 1", async () => {
    setupCaja1(TENANT_A);

    const client = new P2pHttpClient({
      tenantId: TENANT_A,
      terminalId: "CAJA-02",
      dispatcher: network,
    });

    const res = await client.getExchangeRate({ ip: "192.168.1.100", port: 8088 });
    expect(res.status).toBe(200);
    expect(res.data?.rateToVes).toBe("36.5000");
    expect(res.data?.rateDate).toBe("2026-11-01");
    expect(res.data?.source).toBe("BCV_AUTO");
  });

  it("Caja 2 consulta y descarga la imagen local en base64 de un producto de Caja 1", async () => {
    const { imgPath, imgData } = setupCaja1(TENANT_A);

    const client = new P2pHttpClient({
      tenantId: TENANT_A,
      terminalId: "CAJA-02",
      dispatcher: network,
    });

    const res = await client.getImage({ ip: "192.168.1.100", port: 8088 }, imgPath);
    expect(res.status).toBe(200);
    expect(res.data?.path).toBe(imgPath);

    const expectedBase64 = Buffer.from(imgData).toString("base64");
    expect(res.data?.base64).toBe(expectedBase64);
  });

  it("retorna 404 cuando el producto o imagen no existe", async () => {
    setupCaja1(TENANT_A);

    const client = new P2pHttpClient({
      tenantId: TENANT_A,
      terminalId: "CAJA-02",
      dispatcher: network,
    });

    const resStock = await client.getStock({ ip: "192.168.1.100", port: 8088 }, { sku: "NO-EXISTE" });
    expect(resStock.status).toBe(404);
    expect(resStock.error).toBe("Producto no encontrado");

    const resImg = await client.getImage({ ip: "192.168.1.100", port: 8088 }, "images/products/inexistente.webp");
    expect(resImg.status).toBe(404);
    expect(resImg.error).toBe("Imagen no encontrada");
  });

  it("bloquea con 400 intentos de directory traversal en imágenes", async () => {
    setupCaja1(TENANT_A);

    const client = new P2pHttpClient({
      tenantId: TENANT_A,
      terminalId: "CAJA-02",
      dispatcher: network,
    });

    const res1 = await client.getImage({ ip: "192.168.1.100", port: 8088 }, "../etc/passwd");
    expect(res1.status).toBe(400);
    expect(res1.error).toBe("Ruta de imagen inválida");

    const res2 = await client.getImage({ ip: "192.168.1.100", port: 8088 }, "/etc/hosts");
    expect(res2.status).toBe(400);

    const res3 = await client.getImage({ ip: "192.168.1.100", port: 8088 }, "images\\products\\escape.webp");
    expect(res3.status).toBe(400);
  });

  it("retorna 503 si el peer no está registrado en la red local", async () => {
    const client = new P2pHttpClient({
      tenantId: TENANT_A,
      terminalId: "CAJA-02",
      dispatcher: network,
    });

    const res = await client.getStock({ ip: "192.168.1.250", port: 8088 }, { sku: "HAR-01" });
    expect(res.status).toBe(503);
    expect(res.error).toContain("Servidor P2P no alcanzable");
  });

  it("P2pDiscoveryService propaga y filtra peers por tenantId", () => {
    const hub = new InMemoryMdnsHub();
    const t1 = new InMemoryMdnsTransport(hub);
    const t2 = new InMemoryMdnsTransport(hub);
    const t3 = new InMemoryMdnsTransport(hub);

    // Caja 1 de Tienda A
    const caja1 = new P2pDiscoveryService({
      terminalId: "CAJA-01",
      name: "Caja 1",
      ip: "192.168.1.10",
      port: 8088,
      tenantId: TENANT_A,
      transport: t1,
    });

    // Caja 2 de Tienda A (misma cuenta)
    const caja2 = new P2pDiscoveryService({
      terminalId: "CAJA-02",
      name: "Caja 2",
      ip: "192.168.1.20",
      port: 8088,
      tenantId: TENANT_A,
      transport: t2,
    });

    // Caja 3 de Tienda B (cuenta distinta en la misma Wi-Fi)
    const caja3 = new P2pDiscoveryService({
      terminalId: "CAJA-03",
      name: "Caja 3",
      ip: "192.168.1.30",
      port: 8088,
      tenantId: TENANT_B,
      transport: t3,
    });

    caja1.start();
    caja2.start();
    caja3.start();

    // Caja 1 ve a ambos en la red física
    expect(caja1.getPeers()).toHaveLength(2);

    // Pero al filtrar por su cuenta (TENANT_A), solo ve a Caja 2
    const sameTenantPeers = caja1.getOnlinePeers(TENANT_A);
    expect(sameTenantPeers).toHaveLength(1);
    expect(sameTenantPeers[0]?.terminalId).toBe("CAJA-02");
    expect(sameTenantPeers[0]?.txtRecord?.tenantId).toBe(TENANT_A);

    caja1.stop();
    caja2.stop();
    caja3.stop();
  });
});

