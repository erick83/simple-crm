import type { SqlDriver } from "../db/driver";

export const MAX_DIMENSION = 600;
export const MAX_BYTES = 80 * 1024;
/** Calidades WebP probadas en orden descendente hasta caber en MAX_BYTES. */
export const QUALITY_STEPS = [80, 70, 60, 50, 40, 30, 20] as const;

/** Codificador de imagen específico de plataforma (RN: manipulador nativo; tests: sharp). */
export interface ImageEncoder {
  /** Redimensiona dentro de `maxDimension` x `maxDimension` (sin ampliar) y codifica a WebP. */
  toWebp(input: Uint8Array, maxDimension: number, quality: number): Promise<Uint8Array>;
}

/** Acceso al filesystem local de la app. */
export interface FileStore {
  writeFile(relativePath: string, data: Uint8Array): Promise<void>;
  deleteFile(relativePath: string): Promise<void>;
}

export class ImageTooLargeError extends Error {
  constructor(bytes: number) {
    super(`No se pudo comprimir la imagen por debajo de ${MAX_BYTES} bytes (mínimo logrado: ${bytes})`);
  }
}

/** Comprime a WebP ≤600x600 y <80 KB, bajando la calidad de forma progresiva. */
export async function compressProductImage(encoder: ImageEncoder, input: Uint8Array): Promise<Uint8Array> {
  let last = 0;
  for (const q of QUALITY_STEPS) {
    const out = await encoder.toWebp(input, MAX_DIMENSION, q);
    if (out.byteLength < MAX_BYTES) return out;
    last = out.byteLength;
  }
  throw new ImageTooLargeError(last);
}

/**
 * Procesa y guarda la foto de un producto; persiste la ruta relativa en `products.image_path`.
 * Si el UPDATE falla, elimina el archivo recién escrito. Reemplaza (y borra) la imagen previa.
 */
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
  // Nombre con timestamp: evita caché obsoleta y colisiones al reemplazar.
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

