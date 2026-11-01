import type { SqlDriver } from "../database/connection";
import { P2pSyncService } from "./p2p-sync.service";

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
  resolveUri?(relativePath: string): string | null;
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
  deps: { db: SqlDriver; encoder: ImageEncoder; files: FileStore; terminalId?: string },
  productId: string,
  input: Uint8Array,
  now: number = Date.now(),
): Promise<string> {
  const { db, encoder, files, terminalId = "C01" } = deps;
  const [row] = db.all<{ id: string; image_path: string | null; tenant_id: string }>(
    "SELECT id, image_path, tenant_id FROM products WHERE id = ?",
    [productId],
  );
  if (!row) throw new Error(`Producto inexistente: ${productId}`);

  const data = await compressProductImage(encoder, input);
  const path = `images/products/${productId}-${now}.webp`;
  await files.writeFile(path, data);
  try {
    db.run("UPDATE products SET image_path = ?, updated_at = ? WHERE id = ?", [path, now, productId]);
    P2pSyncService.enqueueEvent(
      db,
      {
        originTerminalId: terminalId,
        entityType: "PRODUCT",
        entityId: productId,
        action: "UPSERT",
        payload: {
          id: productId,
          tenantId: row.tenant_id,
          imagePath: path,
          updatedAt: now,
        },
      },
      now,
    );
  } catch (e) {
    await files.deleteFile(path);
    throw e;
  }
  if (row.image_path) await files.deleteFile(row.image_path);
  return path;
}

export async function removeProductImage(
  deps: { db: SqlDriver; files: FileStore; terminalId?: string },
  productId: string,
  now: number = Date.now(),
): Promise<void> {
  const { db, files, terminalId = "C01" } = deps;
  const [row] = db.all<{ id: string; image_path: string | null; tenant_id: string }>(
    "SELECT id, image_path, tenant_id FROM products WHERE id = ?",
    [productId],
  );
  if (!row) throw new Error(`Producto inexistente: ${productId}`);

  if (row.image_path) {
    await files.deleteFile(row.image_path);
    db.run("UPDATE products SET image_path = NULL, updated_at = ? WHERE id = ?", [now, productId]);
    P2pSyncService.enqueueEvent(
      db,
      {
        originTerminalId: terminalId,
        entityType: "PRODUCT",
        entityId: productId,
        action: "UPSERT",
        payload: {
          id: productId,
          tenantId: row.tenant_id,
          imagePath: null,
          updatedAt: now,
        },
      },
      now,
    );
  }
}

/**
 * Adaptador en memoria para pruebas, Web y entornos sin sistema de archivos nativo
 */
export class MemoryFileStore implements FileStore {
  readonly files = new Map<string, Uint8Array>();

  async writeFile(relativePath: string, data: Uint8Array): Promise<void> {
    this.files.set(relativePath, data);
  }

  async readFile(relativePath: string): Promise<Uint8Array | null> {
    return this.files.get(relativePath) ?? null;
  }

  async deleteFile(relativePath: string): Promise<void> {
    this.files.delete(relativePath);
  }

  resolveUri(relativePath: string): string | null {
    const data = this.files.get(relativePath);
    if (!data) return null;
    const base64 = Buffer.from(data).toString("base64");
    return `data:image/webp;base64,${base64}`;
  }
}

/**
 * Adaptador de almacenamiento local usando expo-file-system para Android, iOS y Desktop
 */
export class ExpoFileSystemStore implements FileStore {
  private baseDir: string;

  constructor(customBaseDir?: string) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const FileSystem = require("expo-file-system");
      this.baseDir = customBaseDir ?? (FileSystem.documentDirectory ?? "");
    } catch {
      this.baseDir = customBaseDir ?? "";
    }
  }

  private getFullPath(relativePath: string): string {
    const clean = relativePath.replace(/^[/\\]+/, "");
    return `${this.baseDir}${clean}`;
  }

  async writeFile(relativePath: string, data: Uint8Array): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const FileSystem = require("expo-file-system");
    const fullPath = this.getFullPath(relativePath);
    const parent = fullPath.substring(0, fullPath.lastIndexOf("/"));
    if (parent) {
      await FileSystem.makeDirectoryAsync(parent, { intermediates: true });
    }
    const base64 = Buffer.from(data).toString("base64");
    await FileSystem.writeAsStringAsync(fullPath, base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
  }

  async readFile(relativePath: string): Promise<Uint8Array | null> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const FileSystem = require("expo-file-system");
    const fullPath = this.getFullPath(relativePath);
    const info = await FileSystem.getInfoAsync(fullPath);
    if (!info.exists) return null;
    const base64 = await FileSystem.readAsStringAsync(fullPath, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return Uint8Array.from(Buffer.from(base64, "base64"));
  }

  async deleteFile(relativePath: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const FileSystem = require("expo-file-system");
    const fullPath = this.getFullPath(relativePath);
    await FileSystem.deleteAsync(fullPath, { idempotent: true });
  }

  resolveUri(relativePath: string): string | null {
    if (!relativePath) return null;
    return this.getFullPath(relativePath);
  }
}

/**
 * Resuelve la URI accesible por componentes de imagen (<Image source={{ uri }} />)
 */
export function resolveProductImageUri(fileStore: FileStore, relativePath: string | null): string | null {
  if (!relativePath) return null;
  if (fileStore.resolveUri) {
    return fileStore.resolveUri(relativePath);
  }
  return relativePath;
}

/**
 * Crea la instancia de FileStore adecuada según el entorno de ejecución
 */
export function createDefaultFileStore(): FileStore {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const FileSystem = require("expo-file-system");
    if (FileSystem?.documentDirectory) {
      return new ExpoFileSystemStore();
    }
  } catch {
    // Fallback silencioso
  }
  return new MemoryFileStore();
}
