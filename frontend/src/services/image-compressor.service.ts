import type { SqlDriver } from "../database/connection";

export const MAX_DIMENSION = 600;
export const MAX_BYTES = 80 * 1024; // 80 KB
export const QUALITY_STEPS = [75, 65, 55, 45, 35, 25] as const;

export interface ImageEncoder {
  toWebp(input: Uint8Array, maxDimension: number, quality: number): Promise<Uint8Array>;
}

export interface FileStore {
  writeFile(relativePath: string, data: Uint8Array): Promise<void>;
  deleteFile(relativePath: string): Promise<void>;
  readFile?(relativePath: string): Promise<Uint8Array | null>;
}

export class ImageTooLargeError extends Error {
  constructor(bytes: number) {
    super(`No se pudo comprimir la imagen por debajo de ${MAX_BYTES} bytes (mínimo logrado: ${bytes})`);
    this.name = "ImageTooLargeError";
  }
}

export async function compressProductImage(encoder: ImageEncoder, input: Uint8Array): Promise<Uint8Array> {
  let last = 0;
  for (const q of QUALITY_STEPS) {
    const out = await encoder.toWebp(input, MAX_DIMENSION, q);
    if (out.byteLength < MAX_BYTES) return out;
    last = out.byteLength;
  }
  throw new ImageTooLargeError(last);
}

export async function setProductImage(
  deps: { db: SqlDriver; encoder: ImageEncoder; files: FileStore },
  productId: string,
  input: Uint8Array,
  now: number = Date.now(),
): Promise<string> {
  const { db, encoder, files } = deps;
  const [row] = db.all<{ image_path: string | null }>("SELECT image_path FROM products WHERE id = ?", [productId]);
  if (!row) throw new Error(`Producto inexistente: ${productId}`);

  const data = await compressProductImage(encoder, input);
  const path = `images/products/${productId}-${now}.webp`;
  await files.writeFile(path, data);
  try {
    db.run("UPDATE products SET image_path = ?, updated_at = ? WHERE id = ?", [path, now, productId]);
  } catch (e) {
    await files.deleteFile(path);
    throw e;
  }
  if (row.image_path) await files.deleteFile(row.image_path);
  return path;
}

