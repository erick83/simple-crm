import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { createTestDb } from "./helpers";
import { insertProduct } from "../src/db/products";
import { MAX_BYTES, setProductImage, type FileStore, type ImageEncoder } from "../src/images/imageService";
import { uuidv7 } from "../src/lib/uuidv7";

const encoder: ImageEncoder = {
  toWebp: async (input, max, quality) =>
    new Uint8Array(await sharp(input).resize(max, max, { fit: "inside", withoutEnlargement: true }).webp({ quality }).toBuffer()),
};

function memoryFiles() {
  const map = new Map<string, Uint8Array>();
  const files: FileStore = {
    writeFile: async (p, d) => void map.set(p, d),
    deleteFile: async (p) => void map.delete(p),
  };
  return { map, files };
}

/** Ruido aleatorio 2000x1500: difícil de comprimir, fuerza el bucle de calidad. */
async function noisyPng(): Promise<Uint8Array> {
  const w = 2000, h = 1500;
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
  return new Uint8Array(await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer());
}

function setup() {
  const db = createTestDb();
  const id = insertProduct(db, { tenantId: uuidv7(), sku: "A1", name: "Item", priceUsd: "1", costUsd: "1" });
  return { db, id, ...memoryFiles() };
}

describe("setProductImage", () => {
  it("guarda WebP ≤600x600 y <80 KB y persiste la ruta", async () => {
    const { db, id, map, files } = setup();
    const path = await setProductImage({ db, encoder, files }, id, await noisyPng());
    const data = map.get(path)!;
    const meta = await sharp(data).metadata();
    expect(meta.format).toBe("webp");
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(600);
    expect(data.byteLength).toBeLessThan(MAX_BYTES);
    const [row] = db.all<{ image_path: string }>("SELECT image_path FROM products WHERE id = ?", [id]);
    expect(row?.image_path).toBe(path);
  });

  it("reemplazar imagen borra la anterior", async () => {
    const { db, id, map, files } = setup();
    const png = await noisyPng();
    const first = await setProductImage({ db, encoder, files }, id, png, 1000);
    const second = await setProductImage({ db, encoder, files }, id, png, 2000);
    expect(map.has(first)).toBe(false);
    expect(map.has(second)).toBe(true);
  });

  it("falla si el producto no existe y no escribe archivos", async () => {
    const { db, map, files } = setup();
    await expect(setProductImage({ db, encoder, files }, uuidv7(), await noisyPng())).rejects.toThrow();
    expect(map.size).toBe(0);
  });
});

