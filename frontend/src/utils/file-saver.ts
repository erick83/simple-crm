/**
 * Utilidad unificada para guardar y descargar archivos con ventana de diálogo nativa.
 * - En Windows (Tauri Desktop): Invoca el comando nativo `save_file_dialog` que abre
 *   la ventana de diálogo de Windows (SaveFileDialog / Explorador de archivos).
 * - En Navegadores modernos (Chromium / Edge): Utiliza File System Access API (`showSaveFilePicker`).
 * - En Web estándar: Realiza descarga mediante enlace Blob DOM simulado.
 */
export async function saveFileWithNativeDialog(
  filename: string,
  content: string,
): Promise<{ success: boolean; filePath?: string; cancelled?: boolean }> {
  if (typeof window !== "undefined") {
    // 1. Detección de Tauri Desktop (Windows / Nativo)
    const win = window as unknown as {
      __TAURI_INTERNALS__?: {
        invoke: (cmd: string, args: Record<string, unknown>) => Promise<string>;
      };
      __TAURI__?: {
        invoke: (cmd: string, args: Record<string, unknown>) => Promise<string>;
      };
    };

    const tauri = win.__TAURI_INTERNALS__ || win.__TAURI__;

    if (tauri && typeof tauri.invoke === "function") {
      try {
        const savedPath = await tauri.invoke("save_file_dialog", {
          defaultFilename: filename,
          content,
        });
        return { success: true, filePath: savedPath };
      } catch (err) {
        const errMsg = String(err);
        if (errMsg.includes("cancelado") || errMsg.includes("CANCELLED")) {
          return { success: false, cancelled: true };
        }
        console.warn("Tauri save_file_dialog no disponible o falló:", err);
      }
    }

    // 2. Navegadores con File System Access API (showSaveFilePicker)
    const globalAny = window as unknown as {
      showSaveFilePicker?: (options: {
        suggestedName: string;
        types: Array<{ description: string; accept: Record<string, string[]> }>;
      }) => Promise<{
        createWritable: () => Promise<{
          write: (data: string) => Promise<void>;
          close: () => Promise<void>;
        }>;
      }>;
    };

    if (typeof globalAny.showSaveFilePicker === "function") {
      try {
        const handle = await globalAny.showSaveFilePicker({
          suggestedName: filename,
          types: [
            {
              description: "Archivos JSON (*.json)",
              accept: { "application/json": [".json"] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        return { success: true };
      } catch (err: unknown) {
        const error = err as { name?: string };
        if (error?.name === "AbortError") {
          return { success: false, cancelled: true };
        }
      }
    }

    // 3. Fallback estándar para navegación web clásica
    try {
      if (typeof document !== "undefined") {
        const blob = new Blob([content], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return { success: true };
      }
    } catch {
      return { success: false };
    }
  }

  return { success: false };
}
