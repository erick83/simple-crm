export const MAX_KEY_GAP_MS = 30;
export const MIN_BARCODE_LENGTH = 4;

export interface BarcodeListenerOptions {
  onScan: (barcode: string) => void;
  /** Máximo entre teclas consecutivas para considerarlas ráfaga de lector. */
  maxGapMs?: number;
  minLength?: number;
}

/**
 * Detector de lectores de código de barras en modo HID (teclado).
 * Acumula teclas imprimibles mientras el intervalo entre ellas sea <= maxGapMs;
 * al recibir `Enter` emite el código si la ráfaga tiene longitud suficiente.
 * Una pausa mayor reinicia el buffer, así el tecleo humano nunca dispara un escaneo.
 */
export function createBarcodeListener(opts: BarcodeListenerOptions) {
  const maxGap = opts.maxGapMs ?? MAX_KEY_GAP_MS;
  const minLength = opts.minLength ?? MIN_BARCODE_LENGTH;
  let buffer = "";
  let lastTs = -Infinity;

  return {
    /** @param key valor de `KeyboardEvent.key`; @param ts milisegundos monotónicos. */
    handleKey(key: string, ts: number): void {
      if (ts - lastTs > maxGap) buffer = "";
      lastTs = ts;

      if (key === "Enter") {
        const code = buffer;
        buffer = "";
        if (code.length >= minLength) opts.onScan(code);
      } else if (key.length === 1) {
        buffer += key;
      } else {
        buffer = ""; // teclas de control (Shift, Tab, flechas...) invalidan la ráfaga
      }
    },
    reset(): void {
      buffer = "";
      lastTs = -Infinity;
    },
  };
}

/** Subconjunto de EventTarget/KeyboardEvent para no depender de la lib DOM. */
export interface KeyEventTargetLike {
  addEventListener(type: "keydown", cb: (e: { key: string; timeStamp: number }) => void): void;
  removeEventListener(type: "keydown", cb: (e: { key: string; timeStamp: number }) => void): void;
}

/** Conecta el detector a un listener global de teclado (window/document). Devuelve función de desconexión. */
export function attachBarcodeListener(target: KeyEventTargetLike, opts: BarcodeListenerOptions): () => void {
  const listener = createBarcodeListener(opts);
  const cb = (e: { key: string; timeStamp: number }) => listener.handleKey(e.key, e.timeStamp);
  target.addEventListener("keydown", cb);
  return () => target.removeEventListener("keydown", cb);
}

