import type { SqlDriver } from "../database/connection";
import * as crypto from "node:crypto";

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
}

/**
 * Llave pública Ed25519 embebida por defecto en la aplicación (producción).
 * En desarrollo/tests se puede inyectar la llave pública correspondiente.
 */
export const DEFAULT_EMBEDDED_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi43Z8p6F3o9s2r3zX8x5J+N7a5Yq6w8p9z3X2s5J+N4=
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

    return crypto.createHash("sha256").update(raw).digest("hex");
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
      const data = Buffer.from(payloadString, "utf8");
      const sig = Buffer.from(signatureHex, "hex");
      const pubKey = crypto.createPublicKey(publicKeyPem);
      return crypto.verify(null, data, pubKey, sig);
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
      const payloadJson = Buffer.from(parts[0], "base64url").toString("utf8");
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

      const nowSec = Math.floor(nowMs / 1000);
      const graceSec = license.grace_period_days * 86400;

      if (nowSec > license.valid_until + graceSec) {
        db.run("UPDATE license_state SET status = 'EXPIRED' WHERE id = 'current_license'");
        return {
          status: "EXPIRED",
          canCheckout: false,
          message: "La licencia ha expirado. Por favor renueve su suscripción.",
        };
      }

      if (nowSec > license.valid_until) {
        db.run("UPDATE license_state SET status = 'GRACE' WHERE id = 'current_license'");
        return {
          status: "GRACE",
          canCheckout: true,
          message: "Licencia en período de gracia. Restan pocos días para expirar.",
        };
      }

      return {
        status: "ACTIVE",
        canCheckout: true,
      };
    }
  }
