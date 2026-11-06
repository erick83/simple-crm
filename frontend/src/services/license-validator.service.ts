import type { SqlDriver } from "../database/connection";
import { ed25519 } from "@noble/curves/ed25519.js";
import { uuidv7 } from "../utils/uuid7";

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(n: number, x: number): number {
  return (x >>> n) | (x << (32 - n));
}

function sha256Hex(input: string): string {
  const utf8 = new TextEncoder().encode(input);
  const bitLen = utf8.length * 8;
  const totalBytes = (((utf8.length + 8) >> 6) + 1) << 6;
  const msg = new Uint8Array(totalBytes);
  msg.set(utf8);
  msg[utf8.length] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(totalBytes - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(totalBytes - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < totalBytes; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(7, w[i - 15]!) ^ rotr(18, w[i - 15]!) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(17, w[i - 2]!) ^ rotr(19, w[i - 2]!) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i]! + w[i]!) >>> 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((v) => v.toString(16).padStart(8, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new Error("Hex inválido");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Decodifica base64 estándar (con padding) a bytes crudos. */
function base64ToBytes(b64: string): Uint8Array {
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const str = b64 + pad;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i += 4) {
    const c0 = alphabet.indexOf(str[i]!);
    const c1 = alphabet.indexOf(str[i + 1]!);
    const c2 = str[i + 2] === "=" ? -1 : alphabet.indexOf(str[i + 2]!);
    const c3 = str[i + 3] === "=" ? -1 : alphabet.indexOf(str[i + 3]!);
    if (c0 < 0 || c1 < 0) throw new Error("Base64 inválido");
    bytes.push((c0 << 2) | (c1 >> 4));
    if (c2 >= 0) bytes.push(((c1 & 15) << 4) | (c2 >> 2));
    if (c3 >= 0) bytes.push(((c2 & 3) << 6) | c3);
  }
  return new Uint8Array(bytes);
}

/**
 * Extrae la llave pública Ed25519 cruda (32 bytes) de un PEM SPKI.
 * El DER de Ed25519 es fijo (44 bytes): SEQUENCE + OID 1.3.101.112 (bytes
 * 0x2b 0x65 0x70) + BIT STRING; la llave son los últimos 32 bytes.
 */
export function spkiPemToRawPublicKey(publicKeyPem: string): Uint8Array {
  const body = publicKeyPem
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  const der = base64ToBytes(body);
  if (der.length < 44 || der[6] !== 0x2b || der[7] !== 0x65 || der[8] !== 0x70) {
    throw new Error("Llave pública PEM inválida (no es Ed25519 SPKI)");
  }
  return der.slice(der.length - 32);
}

function decodeBase64UrlUtf8(b64url: string): string {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const str = b64 + pad;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i += 4) {
    const c0 = alphabet.indexOf(str[i]!);
    const c1 = alphabet.indexOf(str[i + 1]!);
    const c2 = str[i + 2] === "=" ? -1 : alphabet.indexOf(str[i + 2]!);
    const c3 = str[i + 3] === "=" ? -1 : alphabet.indexOf(str[i + 3]!);
    if (c0 < 0 || c1 < 0) throw new Error("Base64 inválido");
    bytes.push((c0 << 2) | (c1 >> 4));
    if (c2 >= 0) bytes.push(((c1 & 15) << 4) | (c2 >> 2));
    if (c3 >= 0) bytes.push(((c2 & 3) << 6) | c3);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

type NodeCryptoLike = {
  createPublicKey: (key: string) => unknown;
  verify: (algorithm: null | undefined, data: Uint8Array, key: unknown, signature: Uint8Array) => boolean;
};

function getNodeCrypto(): NodeCryptoLike | undefined {
  try {
    const proc = (
      globalThis as {
        process?: { getBuiltinModule?: (id: string) => unknown; versions?: { node?: string } };
      }
    ).process;
    if (!proc?.versions?.node) return undefined;
    if (typeof proc.getBuiltinModule === "function") {
      return proc.getBuiltinModule("node:crypto") as NodeCryptoLike;
    }
    const dynamicRequire = Function("return typeof require !== 'undefined' ? require : undefined")();
    return dynamicRequire ? (dynamicRequire("node:crypto") as NodeCryptoLike) : undefined;
  } catch {
    return undefined;
  }
}

export interface LicenseTokenPayload {
  tenantId: string;
  branchId: string;
  terminalId: string;
  hwid: string;
  issuedAt: number; // Unix timestamp en segundos
  validUntil: number; // Unix timestamp en segundos
  gracePeriodDays: number;
  p2pSyncEnabled: boolean;
  features: string[];
}

export interface LicenseRequestData {
  requestId: string;
  email: string;
  tenantId: string;
  branchId: string;
  terminalId: string;
  hwid: string;
  deviceLabel: string;
  requestedAt: number; // Unix timestamp en segundos
}

export interface SignedLicenseEnvelope {
  payload: LicenseTokenPayload;
  signature: string; // Firma Ed25519 en formato Hex
}

export type LicenseStatus = "ACTIVE" | "GRACE" | "EXPIRED" | "TAMPERED" | "UNLICENSED";

export interface LicenseCheckResult {
  status: LicenseStatus;
  canCheckout: boolean;
  message?: string;
  payload?: LicenseTokenPayload;
  isTrial?: boolean;
  registeredEmail?: string;
  daysRemaining?: number;
}

/**
 * Llave pública Ed25519 embebida por defecto en la aplicación (producción).
 * En desarrollo/tests se puede inyectar la llave pública correspondiente.
 */
export const DEFAULT_EMBEDDED_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA+99LM4nqAu4U3j900tGK/ifP70VXWO8M9grZ4EZsZ5I=
-----END PUBLIC KEY-----`;

export class LicenseValidatorService {
  /**
   * Genera el Hardware ID inmutable (HWID = SHA256(Motherboard_UUID + CPU_Serial))
   */
  static computeHwid(components: {
    motherboardUuid?: string;
    cpuSerial?: string;
    androidId?: string;
    fallbackSeed?: string;
  }): string {
    const raw =
      components.motherboardUuid && components.cpuSerial
        ? `${components.motherboardUuid.trim().toUpperCase()}:${components.cpuSerial.trim().toUpperCase()}`
        : components.androidId
          ? `ANDROID:${components.androidId.trim()}`
          : `SEED:${components.fallbackSeed ?? "BISYNC-DEV-STANDALONE"}`;

    return sha256Hex(raw);
  }

  /**
   * Valida la firma criptográfica Ed25519 de un payload contra la llave pública embebida.
   */
  static verifySignature(
    payloadString: string,
    signatureHex: string,
    publicKeyPem: string = DEFAULT_EMBEDDED_PUBLIC_KEY,
  ): boolean {
    try {
      const data = new TextEncoder().encode(payloadString);
      const sig = hexToBytes(signatureHex);
      const nodeCrypto = getNodeCrypto();
      if (nodeCrypto) {
        const pubKey = nodeCrypto.createPublicKey(publicKeyPem);
        return nodeCrypto.verify(null, data, pubKey, sig);
      }
      // Runtime sin node:crypto (Android/Web): verificación Ed25519 pura en JS.
      return ed25519.verify(sig, data, spkiPemToRawPublicKey(publicKeyPem));
    } catch {
      return false;
    }
  }

  /**
   * Parsea un token crudo (JSON envelope o 'base64Payload.sigHex')
   */
  static parseToken(rawToken: string): SignedLicenseEnvelope {
    const trimmed = rawToken.trim();
    if (trimmed.startsWith("{")) {
      const parsed = JSON.parse(trimmed) as SignedLicenseEnvelope;
      if (!parsed.payload || !parsed.signature) {
        throw new Error("Formato de token JSON inválido: faltan campos payload o signature");
      }
      return parsed;
    }

    const parts = trimmed.split(".");
    if (parts.length === 2 && parts[0] && parts[1]) {
      const payloadJson = decodeBase64UrlUtf8(parts[0]);
      return {
        payload: JSON.parse(payloadJson) as LicenseTokenPayload,
        signature: parts[1],
      };
    }

    throw new Error("Formato de token irreconocible (use JSON firmado o compact token)");
  }

  /**
   * Instala y activa una nueva licencia en la base de datos SQLite tras verificar
   * criptografía Ed25519, HWID y vigencia inicial.
   */
  static installLicense(
    db: SqlDriver,
    rawToken: string,
    currentHwid: string,
    publicKeyPem: string = DEFAULT_EMBEDDED_PUBLIC_KEY,
    nowMs: number = Date.now(),
  ): LicenseCheckResult {
    const envelope = this.parseToken(rawToken);
    const { payload, signature } = envelope;

    // 1. Verificación criptográfica Ed25519
    const canonicalPayload = JSON.stringify(payload);
    const isValidSignature = this.verifySignature(canonicalPayload, signature, publicKeyPem);
    if (!isValidSignature) {
      return {
        status: "TAMPERED",
        canCheckout: false,
        message: "Firma criptográfica Ed25519 inválida o certificado adulterado.",
      };
    }

    // 2. Hardware Binding
    if (payload.hwid.toLowerCase() !== currentHwid.toLowerCase()) {
      return {
        status: "TAMPERED",
        canCheckout: false,
        message: "El Hardware ID (HWID) del certificado no coincide con este dispositivo.",
      };
    }

    // 3. Evaluar vigencia
    const nowSec = Math.floor(nowMs / 1000);
    const graceSec = (payload.gracePeriodDays ?? 3) * 86400;

    let initialStatus: LicenseStatus = "ACTIVE";
    let canCheckout = true;
    let message: string | undefined;

    if (nowSec > payload.validUntil + graceSec) {
      initialStatus = "EXPIRED";
      canCheckout = false;
      message = "El certificado ingresado ya ha expirado.";
    } else if (nowSec > payload.validUntil) {
      initialStatus = "GRACE";
      canCheckout = true;
      message = "Certificado en período de gracia.";
    }

    // 4. Persistir en la tabla license_state
    db.run(
      `INSERT OR REPLACE INTO license_state (
        id, tenant_id, branch_id, terminal_id, hwid, raw_license_token,
        issued_at, valid_until, grace_period_days, last_recorded_timestamp,
        p2p_sync_enabled, status
      ) VALUES ('current_license', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.tenantId,
        payload.branchId,
        payload.terminalId,
        payload.hwid,
        rawToken,
        payload.issuedAt,
        payload.validUntil,
        payload.gracePeriodDays ?? 3,
        nowMs,
        payload.p2pSyncEnabled ? 1 : 0,
        initialStatus,
      ],
    );

    return {
      status: initialStatus,
      canCheckout,
      message,
      payload,
    };
  }

  /**
   * Guardia de Reloj Monótono anti-fraude:
   * Almacena last_recorded_timestamp en cada operación.
   * Si el reloj del dispositivo se atrasa deliberadamente, el sistema se bloquea (TAMPERED).
   */
  static verifyMonotonicClock(
    db: SqlDriver,
    currentTimestampMs: number = Date.now(),
  ): { valid: boolean; lastTimestamp: number } {
    const [row] = db.all<{ last_recorded_timestamp: number }>(
      "SELECT last_recorded_timestamp FROM license_state WHERE id = 'current_license'",
    );

    const lastTs = row?.last_recorded_timestamp ?? 0;
    if (currentTimestampMs < lastTs) {
      db.run("UPDATE license_state SET status = 'TAMPERED' WHERE id = 'current_license'");
      return { valid: false, lastTimestamp: lastTs };
    }

    if (row) {
      db.run(
        "UPDATE license_state SET last_recorded_timestamp = ? WHERE id = 'current_license'",
        [currentTimestampMs],
      );
    }
    return { valid: true, lastTimestamp: lastTs };
  }

  /**
   * Valida formato básico de correo electrónico.
   */
  static isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  }

  /**
   * Consulta si este Hardware ID ya utilizó su periodo de prueba de 15 días.
   */
  static getDeviceTrial(
    db: SqlDriver,
    currentHwid: string,
  ): { used: boolean; email?: string; startedAt?: number; expiresAt?: number } {
    try {
      const rows = db.all<{ hwid: string; email: string; started_at: number; expires_at: number }>(
        "SELECT hwid, email, started_at, expires_at FROM device_trials WHERE LOWER(hwid) = LOWER(?)",
        [currentHwid.trim()],
      );
      if (rows.length > 0 && rows[0]) {
        return {
          used: true,
          email: rows[0].email,
          startedAt: rows[0].started_at,
          expiresAt: rows[0].expires_at,
        };
      }
    } catch {
      // Tabla no inicializada aún
    }
    return { used: false };
  }

  /**
   * Activa el periodo de prueba de 15 días amarrado al HWID físico del equipo.
   * Rechaza si el HWID ya agotó su prueba previa (regla de 1 solo trial por máquina).
   */
  static activateTrial(
    db: SqlDriver,
    params: {
      email: string;
      currentHwid: string;
      tenantId?: string;
      branchId?: string;
      terminalId?: string;
      nowMs?: number;
    },
  ): { success: boolean; message: string; trial?: { expiresAt: number; daysRemaining: number } } {
    const email = params.email.trim();
    if (!this.isValidEmail(email)) {
      return {
        success: false,
        message: "El formato del correo electrónico ingresado no es válido.",
      };
    }

    const hwid = params.currentHwid.trim();
    const existingTrial = this.getDeviceTrial(db, hwid);
    if (existingTrial.used) {
      return {
        success: false,
        message: `Este equipo ya agotó sus 15 días de prueba (${existingTrial.email ?? "cuenta previa"}). Para reanudar el cobro, instale su licencia oficial.`,
      };
    }

    const nowMs = params.nowMs ?? Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    const expiresAt = nowSec + 15 * 86400; // 15 días exactos

    try {
      db.run(
        "INSERT OR REPLACE INTO device_trials (hwid, email, started_at, expires_at) VALUES (?, ?, ?, ?)",
        [hwid, email, nowSec, expiresAt],
      );
    } catch {
      // Fallback si la tabla no existe en entornos aislados
    }

    const trialPayload: LicenseTokenPayload = {
      tenantId: params.tenantId ?? "TENANT-001",
      branchId: params.branchId ?? "SEDE-CENTRAL",
      terminalId: params.terminalId ?? "TERM-01",
      hwid,
      issuedAt: nowSec,
      validUntil: expiresAt,
      gracePeriodDays: 0,
      p2pSyncEnabled: true,
      features: ["pos", "bimoneda", "trial"],
    };

    const rawTrialToken = JSON.stringify({
      isTrial: true,
      email,
      payload: trialPayload,
    });

    db.run(
      `INSERT OR REPLACE INTO license_state (
        id, tenant_id, branch_id, terminal_id, hwid, raw_license_token,
        issued_at, valid_until, grace_period_days, last_recorded_timestamp,
        p2p_sync_enabled, status
      ) VALUES ('current_license', ?, ?, ?, ?, ?, ?, ?, 0, ?, 1, 'ACTIVE')`,
      [
        trialPayload.tenantId,
        trialPayload.branchId,
        trialPayload.terminalId,
        trialPayload.hwid,
        rawTrialToken,
        trialPayload.issuedAt,
        trialPayload.validUntil,
        nowMs,
      ],
    );

    return {
      success: true,
      message: "Periodo de prueba de 15 días activado exitosamente en este equipo.",
      trial: {
        expiresAt,
        daysRemaining: 15,
      },
    };
  }

  /**
   * Genera la estructura de solicitud de licencia para enviar a bisyncdev@gmail.com
   */
  static createLicenseRequest(params: {
    email: string;
    currentHwid: string;
    tenantId?: string;
    branchId?: string;
    terminalId?: string;
    deviceLabel?: string;
    nowSec?: number;
  }): LicenseRequestData {
    return {
      requestId: uuidv7(),
      email: params.email.trim(),
      tenantId: params.tenantId ?? "TENANT-001",
      branchId: params.branchId ?? "SEDE-CENTRAL",
      terminalId: params.terminalId ?? "TERM-01",
      hwid: params.currentHwid.trim(),
      deviceLabel: params.deviceLabel ?? "Caja Principal",
      requestedAt: params.nowSec ?? Math.floor(Date.now() / 1000),
    };
  }

  /**
   * Construye el enlace mailto: oficial prellenado hacia bisyncdev@gmail.com
   */
  static getMailtoUrl(req: LicenseRequestData): string {
    const subject = encodeURIComponent(`Solicitud de Licencia Bisync POS - ${req.email}`);
    const body = encodeURIComponent(
      `Estimado equipo de Bisync,\n\n` +
      `Solicito la emisión de la licencia comercial para mi terminal:\n\n` +
      `• Correo: ${req.email}\n` +
      `• Dispositivo: ${req.deviceLabel} (${req.terminalId})\n` +
      `• HWID: ${req.hwid}\n` +
      `• ID Solicitud: ${req.requestId}\n\n` +
      `--- DATOS DE CONFIGURACIÓN JSON ---\n` +
      `${JSON.stringify(req, null, 2)}\n\n` +
      `Por favor coordinar los detalles de pago y emisión del token definitivo.\n`
    );
    return `mailto:bisyncdev@gmail.com?subject=${subject}&body=${body}`;
  }

  /**
   * Construye el enlace directo a Gmail en la web (mail.google.com) con asunto y cuerpo prellenados.
   * Evita popups molestos del sistema operativo cuando no hay un cliente local de correo configurado.
   */
  static getGmailComposeUrl(req: LicenseRequestData): string {
    const subject = encodeURIComponent(`Solicitud de Licencia Bisync POS - ${req.email}`);
    const body = encodeURIComponent(
      `Estimado equipo de Bisync,\n\n` +
      `Solicito la emisión de la licencia comercial para mi terminal:\n\n` +
      `• Correo: ${req.email}\n` +
      `• Dispositivo: ${req.deviceLabel} (${req.terminalId})\n` +
      `• HWID: ${req.hwid}\n` +
      `• ID Solicitud: ${req.requestId}\n\n` +
      `--- DATOS DE CONFIGURACIÓN JSON ---\n` +
      `${JSON.stringify(req, null, 2)}\n\n` +
      `Por favor coordinar los detalles de pago y emisión del token definitivo.\n`
    );
    return `https://mail.google.com/mail/?view=cm&fs=1&to=bisyncdev@gmail.com&su=${subject}&body=${body}`;
  }

  /**
   * Descarga directamente un archivo JSON en el navegador o entorno web (carpeta Descargas).
   */
  static downloadJsonFile(filename: string, content: string): boolean {
    if (typeof document !== "undefined") {
      try {
        const blob = new Blob([content], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  /**
   * Copia texto al portapapeles de forma compatible.
   */
  static async copyToClipboard(text: string): Promise<boolean> {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Fallback
      }
    }
    return false;
  }

  /**
   * Evalúa el estado de licenciamiento para permitir o bloquear las funciones de cobro.
   */
  static evaluateLicense(
    db: SqlDriver,
    currentHwid: string,
    nowMs: number = Date.now(),
  ): LicenseCheckResult {
    // 1. Guardia de reloj monótono
    const clockCheck = this.verifyMonotonicClock(db, nowMs);
    if (!clockCheck.valid) {
      return {
        status: "TAMPERED",
        canCheckout: false,
        message: "El reloj del sistema fue alterado hacia atrás. Funciones de cobro bloqueadas.",
      };
    }

    // 2. Consulta de estado en SQLite
    const [license] = db.all<{
      hwid: string;
      valid_until: number;
      grace_period_days: number;
      status: LicenseStatus;
      raw_license_token: string;
    }>("SELECT hwid, valid_until, grace_period_days, status, raw_license_token FROM license_state WHERE id = 'current_license'");

    if (!license) {
      return {
        status: "UNLICENSED",
        canCheckout: false,
        message: "Terminal no licenciada. Ingrese una licencia válida.",
      };
    }

    if (license.status === "TAMPERED" || license.hwid.toLowerCase() !== currentHwid.toLowerCase()) {
      return {
        status: "TAMPERED",
        canCheckout: false,
        message: "El Hardware ID no coincide con el certificado o la licencia fue adulterada.",
      };
    }

    // Extraer metadatos auxiliares de trial o token
    let isTrial = false;
    let registeredEmail: string | undefined;
    let payload: LicenseTokenPayload | undefined;
    try {
      if (license.raw_license_token && license.raw_license_token.startsWith("{")) {
        const parsed = JSON.parse(license.raw_license_token);
        if (parsed.isTrial) {
          isTrial = true;
          registeredEmail = parsed.email;
          payload = parsed.payload;
        } else if (parsed.payload) {
          payload = parsed.payload;
        }
      }
    } catch {
      // Ignorar errores auxiliares de parseo
    }

    const nowSec = Math.floor(nowMs / 1000);
    const graceSec = license.grace_period_days * 86400;
    const daysRemaining = Math.max(0, Math.ceil((license.valid_until - nowSec) / 86400));

    if (nowSec > license.valid_until + graceSec) {
      db.run("UPDATE license_state SET status = 'EXPIRED' WHERE id = 'current_license'");
      return {
        status: "EXPIRED",
        canCheckout: false,
        message: isTrial
          ? "El periodo de prueba de 15 días ha expirado en este equipo. Active su licencia definitiva para reanudar el cobro."
          : "La licencia ha expirado. Por favor renueve su suscripción.",
        isTrial,
        registeredEmail,
        daysRemaining: 0,
        payload,
      };
    }

    if (nowSec > license.valid_until) {
      db.run("UPDATE license_state SET status = 'GRACE' WHERE id = 'current_license'");
      return {
        status: "GRACE",
        canCheckout: true,
        message: isTrial
          ? "Periodo de prueba por vencer (último día)."
          : "Licencia en período de gracia. Restan pocos días para expirar.",
        isTrial,
        registeredEmail,
        daysRemaining: 0,
        payload,
      };
    }

    return {
      status: "ACTIVE",
      canCheckout: true,
      message: isTrial
        ? `Periodo de prueba activo (${daysRemaining} días restantes).`
        : undefined,
      isTrial,
      registeredEmail,
      daysRemaining,
      payload,
    };
  }
}
