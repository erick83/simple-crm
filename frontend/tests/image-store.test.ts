import { describe, it, expect, beforeEach } from "vitest";
import sharp from "sharp";
import { createTestDb } from "./helpers";
import { insertProduct } from "../src/database/repositories/product.repository";
import {
  setProductImage,
  removeProductImage,
  MemoryFileStore,
  createDefaultFileStore,
  resolveProductImageUri,
  MAX_BYTES,
  type ImageEncoder,
} from "../src/services/image-compressor.service";
import { P2pSyncService } from "../src/services/p2p-sync.service";
import { uuidv7 } from "../src/utils/uuid7";
import type { SqlDriver } from "../src/database/connection";

const encoder: ImageEncoder = {
  toWebp: async (input, max, quality) =>
    new Uint8Array(
      await sharp(input)
        .resize(max, max, { fit: "inside", withoutEnlargement: true })
        .webp({ quality })
        .toBuffer(),
    ),
};

async function samplePng(w = 200, h = 200): Promise<Uint8Array> {
  const raw = Buffer.alloc(w * h * 3, 128);
  return new Uint8Array(
    await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
      .png()
      .toBuffer(),
  );
}

describe("PR-14: Almacenamiento Local y Selector de Imágenes de Producto (FileStore + Compresor)", () => {
  let db: SqlDriver;
  let fileStore: MemoryFileStore;
  const TENANT = uuidv7();

  beforeEach(() => {
    db = createTestDb();
    fileStore = new MemoryFileStore();
  });

  it("MemoryFileStore escribe, lee, resuelve URI y borra archivos", async () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    await fileStore.writeFile("test.webp", data);

    const read = await fileStore.readFile("test.webp");
    expect(read).toEqual(data);

    const uri = fileStore.resolveUri("test.webp");
    expect(uri).toContain("data:image/webp;base64,");

    await fileStore.deleteFile("test.webp");
    expect(await fileStore.readFile("test.webp")).toBeNull();
    expect(fileStore.resolveUri("test.webp")).toBeNull();
  });

  it("asocia imagen a un producto, guarda en FileStore y encola en peer_sync_outbox", async () => {
    const prodId = insertProduct(db, {
      tenantId: TENANT,
      sku: "PROD-FOTO",
      name: "Producto con Foto",
      priceUsd: "5.0000",
      costUsd: "3.5000",
    });

    const imgBytes = await samplePng();
    const path = await setProductImage({ db, encoder, files: fileStore }, prodId, imgBytes, 1000);

    expect(path).toBe(`images/products/${prodId}-1000.webp`);

    // Verifica SQLite
    const [row] = db.all<{ image_path: string }>("SELECT image_path FROM products WHERE id = ?", [prodId]);
    expect(row?.image_path).toBe(path);

    // Verifica almacenamiento físico en FileStore
    const stored = await fileStore.readFile(path);
    expect(stored).toBeDefined();
    expect(stored!.byteLength).toBeLessThan(MAX_BYTES);

    // Verifica que se generó evento de sincronización en outbox
    const pending = P2pSyncService.getPendingEvents(db, "PEER-X");
    const syncEvent = pending.find((e) => e.entityId === prodId && e.payload.includes(path));
    expect(syncEvent).toBeDefined();
    expect(syncEvent?.entityType).toBe("PRODUCT");
  });

  it("reemplazar la foto elimina físicamente la anterior y actualiza la ruta", async () => {
    const prodId = insertProduct(db, {
      tenantId: TENANT,
      sku: "PROD-REPLACE",
      name: "Producto Reemplazo",
      priceUsd: "2.0000",
      costUsd: "1.0000",
    });

    const png = await samplePng();
    const firstPath = await setProductImage({ db, encoder, files: fileStore }, prodId, png, 1000);
    expect(await fileStore.readFile(firstPath)).not.toBeNull();

    const secondPath = await setProductImage({ db, encoder, files: fileStore }, prodId, png, 2000);
    expect(await fileStore.readFile(firstPath)).toBeNull(); // Archivo viejo eliminado
    expect(await fileStore.readFile(secondPath)).not.toBeNull(); // Archivo nuevo activo

    const [row] = db.all<{ image_path: string }>("SELECT image_path FROM products WHERE id = ?", [prodId]);
    expect(row?.image_path).toBe(secondPath);
  });

  it("removeProductImage elimina el archivo local y limpia image_path en SQLite", async () => {
    const prodId = insertProduct(db, {
      tenantId: TENANT,
      sku: "PROD-DEL",
      name: "Producto Borrar Foto",
      priceUsd: "1.0000",
      costUsd: "0.5000",
    });

    const png = await samplePng();
    const path = await setProductImage({ db, encoder, files: fileStore }, prodId, png, 1000);
    expect(await fileStore.readFile(path)).not.toBeNull();

    await removeProductImage({ db, files: fileStore }, prodId, 2000);
    expect(await fileStore.readFile(path)).toBeNull();

    const [row] = db.all<{ image_path: string | null }>("SELECT image_path FROM products WHERE id = ?", [prodId]);
    expect(row?.image_path).toBeNull();
  });

  it("resolveProductImageUri resuelve URI renderizable o null", () => {
    expect(resolveProductImageUri(fileStore, null)).toBeNull();
    expect(resolveProductImageUri(fileStore, "")).toBeNull();
  });

  it("createDefaultFileStore retorna un FileStore funcional", () => {
    const store = createDefaultFileStore();
    expect(store).toBeDefined();
    expect(typeof store.writeFile).toBe("function");
    expect(typeof store.deleteFile).toBe("function");
  });
});

