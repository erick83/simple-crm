/**
 * Impresión de comprobantes para térmica Xprinter XP-58IIHT (58 mm, ESC/POS).
 *
 * La XP-58IIHT imprime 32 caracteres por línea en fuente A (12×24, 384 puntos),
 * sin cortadora automática y con feeds finales para desgarro manual. El módulo
 * construye un único modelo de líneas y lo serializa por dos caminos:
 *   1) ESC/POS crudo por Web Serial (recomendado: USB COM o Bluetooth emparejado),
 *      con alineados/bold/doble tamaño reales del fabricante.
 *   2) Texto plano de 32 columnas vía el diálogo de impresión del navegador
 *      (fallback cuando la XP-58IIHT ya está instalada con driver "Generic/Text Only").
 *
 * Todo el texto se translitera a ASCII: los code pages del periférico (CP437/858)
 * varían por firmware y no imprimir acentos garantiza cero caracteres basura.
 */
import { PAYMENT_METHOD_LABELS } from "../database/repositories/balance.repository";
import type { InvoiceEntity, InvoiceItemEntity } from "../database/repositories/invoice.repository";
import { parseSplitBreakdown } from "../database/repositories/invoice.repository";
import { formatUsd, formatVes, toDecimal } from "../utils/decimal";

/** Columnas de la XP-58IIHT en fuente A de 58 mm. */
export const RECEIPT_COLS = 32;

const CENTER: ReceiptLine["align"] = "center";

export interface ReceiptLine {
  text: string;
  align?: "left" | "center";
  bold?: boolean;
  /** 2×2 (GS ! 0x11): en 58 mm solo caben ~16 caracteres dobles. */
  wide?: boolean;
}

export interface ReceiptPrintContext {
  branchName?: string;
  /**
   * Resuelve el nombre a imprimir. El segundo argumento es la línea congelada de la factura:
   * si trae `productName`, ese es el texto del documento y no se pregunta por `products`
   * (renombrar un rubro no puede reescribir un ticket ya emitido, auditoría §F2).
   */
  resolveItemName: (
    productId: string,
    item?: Pick<InvoiceItemEntity, "productName" | "productSku" | "productUnit">,
  ) => string;
}

// ---------- utilidades de composición 32 columnas ----------

const ascii = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/≈/g, "~")
    .replace(/•/g, "*")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E]/g, "");

const line = (
  text: string,
  opts: { align?: "left" | "center"; bold?: boolean; wide?: boolean } = {},
): ReceiptLine => ({ text: ascii(text), ...opts });

const rule = (ch = "-") => ch.repeat(RECEIPT_COLS);

/** Etiqueta a la izquierda e importe a la derecha, encajados en los 32 columnas. */
const fitRow = (left: string, right: string): string => {
  const gap = RECEIPT_COLS - left.length - right.length;
  if (gap >= 1) return `${left}${" ".repeat(gap)}${right}`;
  // No cabe ni pegado: se trunca la etiqueta, nunca el importe.
  const room = RECEIPT_COLS - right.length - 1;
  return room > 4 ? `${left.slice(0, room)} ${right}` : right;
}

const centerText = (text: string): string => {
  const pad = Math.max(0, Math.floor((RECEIPT_COLS - text.length) / 2));
  return `${" ".repeat(pad)}${text}`;
};

// ---------- modelo ----------

export function buildReceiptModel(
  invoice: InvoiceEntity,
  ctx: ReceiptPrintContext,
): ReceiptLine[] {
  const out: ReceiptLine[] = [];
  const created = new Date(invoice.createdAt);

  out.push(line("BISYNC POS", { align: CENTER, bold: true, wide: true }));
  for (const part of wrap(ctx.branchName ?? "POS P2P Local-First")) {
    out.push(line(part, { align: CENTER }));
  }
  out.push(line("Comprobante de venta", { align: CENTER }));
  out.push(
    line(`Terminal: ${invoice.terminalId} * Turno #${invoice.shiftId.slice(-4).toUpperCase()}`),
  );
  out.push(line(invoice.invoiceNumber));
  out.push(
    line(
      `${created.toLocaleDateString("es-VE")} ${created.toLocaleTimeString("es-VE", {
        hour: "2-digit",
        minute: "2-digit",
      })}`,
    ),
  );
  out.push(line(rule("=")));

  if (invoice.status === "VOID") {
    out.push(line("*** VENTA ANULADA (DEVOLUCION) ***", { align: CENTER, bold: true }));
    if (invoice.voidReason) {
      for (const part of wrap(`Motivo: ${invoice.voidReason}`)) {
        out.push(line(part, { bold: true }));
      }
    }
    out.push(line(rule("=")));
  }

  out.push(line(fitRow("Producto", "Total"), { bold: true }));
  for (const it of invoice.items) {
    // El nombre congelado en la línea es el texto del documento; el resolutor solo cubre
    // las filas anteriores a la migración (auditoría §F2).
    const name = ascii(it.productName?.trim() || ctx.resolveItemName(it.productId, it));
    for (const part of wrap(name, RECEIPT_COLS)) out.push(line(part));
    const qty = toDecimal(it.quantity).toFixed(4);
    out.push(line(fitRow(`  ${qty} x ${formatUsd(it.unitPriceUsd)}`, formatUsd(it.lineTotalUsd))));
  }
  out.push(line(rule()));

  out.push(line(fitRow("Subtotal:", `${formatUsd(invoice.subtotalUsd)} (${formatVes(invoice.subtotalVes)})`)));
  out.push(line(fitRow("IVA:", `${formatUsd(invoice.taxUsd)} (${formatVes(invoice.taxVes)})`)));
  out.push(line(rule("=")));
  // Doble tamaño solo si el importe total cabe en 16 columnas dobles: si no, se
  // imprime normal — el monto legal jamas se trunca para preservar el formato.
  const totalWide = `TOTAL ${formatUsd(invoice.totalUsd)}`;
  if (totalWide.length <= 16) {
    out.push(line(totalWide, { bold: true, wide: true }));
  } else {
    out.push(line(fitRow("TOTAL LEGAL:", formatUsd(invoice.totalUsd)), { bold: true }));
  }
  out.push(line(`~ ${formatVes(invoice.totalVes)}`));
  out.push(line(rule("=")));
  out.push(line(fitRow("Tasa congelada:", `${formatVes(invoice.exchangeRate)} / USD`)));
  const method = PAYMENT_METHOD_LABELS[invoice.paymentMethod] ?? invoice.paymentMethod;
  out.push(line(fitRow("Metodo de pago:", method)));

  const split = parseSplitBreakdown(invoice.paymentBreakdown);
  if (split) {
    if (split.cashUsd.gt(0)) out.push(line(fitRow("  Efectivo USD:", formatUsd(split.cashUsd.toFixed(4)))));
    if (split.cashVes.gt(0)) out.push(line(fitRow("  Efectivo VES:", formatVes(split.cashVes.toFixed(4)))));
    if (split.pagoMovilVes.gt(0)) out.push(line(fitRow("  Pago Movil:", formatVes(split.pagoMovilVes.toFixed(4)))));
    if (split.cardVes.gt(0)) out.push(line(fitRow("  Tarjeta/Punto:", formatVes(split.cardVes.toFixed(4)))));
  }

  out.push(line(rule()));
  out.push(line("Gracias por su compra", { align: CENTER }));
  out.push(line("Conservar este comprobante", { align: CENTER }));
  out.push(line("para cualquier anulacion", { align: CENTER }));
  return out;
}

/** Parte palabras largas respetando el margen de la XP-58IIHT (nombres de producto). */
export function wrap(text: string, cols: number = RECEIPT_COLS): string[] {
  const parts = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const word of parts) {
    const candidate = cur ? `${cur} ${word}` : word;
    if (candidate.length <= cols) {
      cur = candidate;
    } else {
      if (cur) lines.push(cur);
      cur = word.length > cols ? word.slice(0, cols) : word;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

// ---------- salidas ----------

/** Texto plano de 32 columnas para el driver "Generic/Text Only". */
export function renderReceiptText(model: ReceiptLine[]): string {
  return model
    .map((l) => {
      const body = l.align === "center" ? centerText(l.text) : l.text;
      return body.slice(0, RECEIPT_COLS);
    })
    .join("\n");
}

const ESC = 0x1b;
const GS = 0x1d;

/** ESC/POS crudo: init, alineados, bold, tamaño doble y feeds de desgarro. */
export function encodeEscPos(model: ReceiptLine[]): Uint8Array {
  const bytes: number[] = [ESC, 0x40]; // ESC @: reset de la impresora
  for (const l of model) {
    bytes.push(ESC, 0x61, l.align === CENTER ? 1 : 0); // ESC a n: alineado
    bytes.push(ESC, 0x45, l.bold ? 1 : 0); // ESC E n: negrita
    // GS ! n: ancho (nibble alto) y alto (nibble bajo) en unidades 1..8
    bytes.push(GS, 0x21, l.wide ? 0x11 : 0x00);
    for (const ch of l.text) bytes.push(ch.charCodeAt(0) & 0x7f);
    bytes.push(0x0a); // LF
  }
  bytes.push(ESC, 0x64, 0x03); // ESC d 3: 3 líneas para desgarro manual
  return new Uint8Array(bytes);
}

/** Divide el payload en bloques: algunos puertos COM mueren con escrituras gigantes. */
const CHUNK = 256;

/** MTU ATT por defecto (23) menos cabecera: el writes sin respuesta más seguro en BLE. */
export const BLE_CHUNK = 20;

export function chunkBytes(bytes: Uint8Array, size: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) {
    out.push(bytes.slice(i, i + size));
  }
  return out;
}

export function isWebSerialAvailable(): boolean {
  return typeof navigator !== "undefined" && "serial" in navigator;
}

export function hasWebBluetooth(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

/** Transporte de impresión elegido por el operador; se recuerda entre sesiones. */
export type PrintTransport = "serial" | "bluetooth" | "dialog";

const TRANSPORT_KEY = "bisync.print-transport";
const BT_DEVICE_KEY = "bisync.print-bt-device";

const transportLabels: Record<PrintTransport, string> = {
  serial: "USB/Serie",
  bluetooth: "Bluetooth (BLE)",
  dialog: "Ventana del sistema",
};

const transportShortLabels: Record<PrintTransport, string> = {
  serial: "USB",
  bluetooth: "BT",
  dialog: "SO",
};

export function labelForTransport(t: PrintTransport): string {
  return transportLabels[t];
}

export function shortLabelForTransport(t: PrintTransport): string {
  return transportShortLabels[t];
}

export function getStoredTransport(): PrintTransport | null {
  try {
    const stored = globalThis.localStorage?.getItem(TRANSPORT_KEY);
    return stored === "serial" || stored === "bluetooth" || stored === "dialog" ? stored : null;
  } catch {
    return null;
  }
}

export function storeTransport(t: PrintTransport): void {
  try {
    globalThis.localStorage?.setItem(TRANSPORT_KEY, t);
  } catch {
    // Sin almacenamiento: la preferencia vive solo en memoria
  }
}

/** Sin preferencia guardada: USB/serie es el camino principal; si no, BLE; si no, diálogo. */
export function resolveDefaultTransport(hasSerial: boolean, hasBluetooth: boolean): PrintTransport {
  if (hasSerial) return "serial";
  if (hasBluetooth) return "bluetooth";
  return "dialog";
}

interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  writable: WritableStream<Uint8Array> | null;
}

interface NavigatorWithSerial {
  serial?: {
    requestPort(): Promise<SerialPortLike>;
    getPorts?(): Promise<SerialPortLike[]>;
  };
}

/**
 * Envía ESC/POS por Web Serial. Cubre tanto USB (XP-58IIHT con chip COM) como
 * Bluetooth clásico: al emparejar en Windows, el perfil SPP crea un COM virtual
 * que el navegador expone como puerto serie. Primero reutiliza
 * el puerto ya autorizado (cero diálogo en la venta del día a día); si no hay,
 * abre el selector. 9600 baudios: velocidad por defecto del firmware Xprinter.
 */
export async function printViaWebSerial(bytes: Uint8Array): Promise<void> {
  const nav = navigator as unknown as Navigator & NavigatorWithSerial;
  if (!nav.serial?.requestPort) throw new Error("Este navegador no expone puertos serie");
  let port: SerialPortLike | null = null;
  if (nav.serial.getPorts) {
    const granted = await nav.serial.getPorts();
    port = granted[0] ?? null;
  }
  if (!port) port = await nav.serial.requestPort();
  try {
    await port.open({ baudRate: 9600 });
    const writer = port.writable?.getWriter();
    if (!writer) throw new Error("El puerto no admitio escritura");
    try {
      for (const part of chunkBytes(bytes, CHUNK)) {
        await writer.write(part);
      }
    } finally {
      await writer.close().catch(() => undefined);
    }
  } finally {
    await port.close().catch(() => undefined);
  }
}

// --- Web Bluetooth (BLE GATT): impresoras térmicas XP con perfil BLE ---
// Tipos estructurales mínimos: el lib.dom de TS no cubre getDevices() en esta versión.

export interface BtCharacteristicLike {
  properties: { write?: boolean; writeWithoutResponse?: boolean };
  writeValue(value: ArrayBuffer): Promise<void>;
}

export interface BtServiceLike {
  uuid: string;
  getCharacteristics(): Promise<BtCharacteristicLike[]>;
}

interface BtRemoteServerLike {
  getPrimaryServices(): Promise<BtServiceLike[]>;
}

interface BtDeviceLike {
  id: string;
  name?: string;
  gatt: {
    connect(): Promise<{ server: BtRemoteServerLike }>;
    disconnect?(): void;
    connected?: boolean;
  };
}

interface NavigatorWithBluetooth {
  bluetooth?: {
    requestDevice(options: Record<string, unknown>): Promise<BtDeviceLike>;
    getDevices?(): Promise<BtDeviceLike[]>;
  };
}

/** Servicios de impresión térmica más comunes: Xprinter FF00, HM-10 FFE0, Microchip 18F0. */
const BT_OPTIONAL_SERVICES = [
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb",
  "000018f0-0000-1000-8000-00805f9b34fb",
  "49535343-fe7d-4ae9-8f92-a2f17e59c4eb",
];

const isPrinterServiceUuid = (uuid: string): boolean => {
  const u = uuid.toLowerCase();
  return BT_OPTIONAL_SERVICES.some((s) => s.startsWith(u) || u.startsWith(s.slice(0, 8)));
};

/**
 * Elige la característica de escritura: prefiere las de servicios conocidos de
 * impresora térmica (FF00/FFE2 y afines) y, entre otras, cualquiera writable.
 * Recibe servicios ya expandidos (sync) para poder auditar la prioridad sin
 * dispositivo físico; el llamador real hace el getCharacteristics async.
 */
export function pickBluetoothWriter(
  services: Array<{ uuid: string; characteristics: BtCharacteristicLike[] }>,
): { ch: BtCharacteristicLike; preferential: boolean } | null {
  let chosen: { ch: BtCharacteristicLike; preferential: boolean } | null = null;
  for (const svc of services) {
    const known = isPrinterServiceUuid(svc.uuid) || /ff02|ffe2/i.test(svc.uuid);
    for (const ch of svc.characteristics) {
      if (!ch.properties.writeWithoutResponse && !ch.properties.write) continue;
      if (!chosen || (known && !chosen.preferential)) {
        chosen = { ch, preferential: known };
      }
    }
  }
  return chosen;
}

export async function printViaWebBluetooth(bytes: Uint8Array): Promise<void> {
  const nav = navigator as unknown as Navigator & NavigatorWithBluetooth;
  if (!nav.bluetooth?.requestDevice) {
    throw new Error("Este navegador no expone Web Bluetooth (use Chrome o Edge)");
  }

  let remembered: string | null = null;
  try {
    remembered = globalThis.localStorage?.getItem(BT_DEVICE_KEY) ?? null;
  } catch {
    remembered = null;
  }

  let device: BtDeviceLike | null = null;
  if (nav.bluetooth.getDevices) {
    const known = await nav.bluetooth.getDevices();
    device =
      known.find((d) => d.id === remembered) ??
      known.find((d) => /xp|print|58|tea|ble/i.test(d.name ?? "")) ??
      null;
  }
  if (!device) {
    device = await nav.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: BT_OPTIONAL_SERVICES,
    });
    try {
      globalThis.localStorage?.setItem(BT_DEVICE_KEY, device.id);
    } catch {
      // sin persistencia: se volverá a pedir el dispositivo la próxima sesión
    }
  }

  const { server } = await device.gatt.connect();
  const servicesWithChars: Array<{ uuid: string; characteristics: BtCharacteristicLike[] }> = [];
  for (const svc of await server.getPrimaryServices()) {
    servicesWithChars.push({ uuid: svc.uuid, characteristics: await svc.getCharacteristics() });
  }
  const chosen = pickBluetoothWriter(servicesWithChars);
  if (!chosen) {
    device.gatt.disconnect?.();
    throw new Error("La impresora BLE no expone una caracteristica de escritura");
  }

  try {
    for (const part of chunkBytes(bytes, BLE_CHUNK)) {
      await chosen.ch.writeValue(
        part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) as ArrayBuffer,
      );
    }
  } finally {
    device.gatt.disconnect?.();
  }
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch] as string);

/**
 * Fallback de impresión: ventana oculta con el ticket en monospace a 58 mm.
 * El usuario elige la XP-58IIHT instalada (driver de texto) en el diálogo del SO.
 */
export function printReceiptViaBrowser(text: string): void {
  if (typeof document === "undefined") return;
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentWindow?.document;
  if (!doc) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(
    `<!doctype html><html><head><title>Ticket</title><style>` +
      `@page{size:58mm auto;margin:0 2mm}body{margin:0;font-family:'Courier New',monospace;` +
      `font-size:7.6pt;line-height:1.3;white-space:pre}` +
      `</style></head><body>${escapeHtml(text)}</body></html>`,
  );
  doc.close();
  frame.contentWindow?.focus();
  frame.contentWindow?.print();
  window.setTimeout(() => frame.remove(), 1500);
}
