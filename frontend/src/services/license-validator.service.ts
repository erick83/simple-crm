import type { SqlDriver } from "../database/connection";

export interface LicenseTokenPayload {
  tenantId: string;
  branchId: string;
  terminalId: string;
  hwid: string;
  issuedAt: number;
  validUntil: number;
  gracePeriodDays: number;
  p2pSyncEnabled: boolean;
  features: string[];
}

export type LicenseStatus = "ACTIVE" | "GRACE" | "EXPIRED" | "TAMPERED" | "UNLICENSED";

export interface LicenseCheckResult {
  status: LicenseStatus;
  canCheckout: boolean;
  message?: string;
  payload?: LicenseTokenPayload;
}

/**
 * Servicio de Validación de Licencia Offline-First y Guardia de Reloj Monótono.
 */
export class LicenseValidatorService {
  /**
   * Verifica la monotonicidad del reloj.
   * Si el timestamp actual es menor al último registrado, bloquea el sistema (TAMPERED).
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
   * Evalúa el estado de licenciamiento para permitir o bloquear el cobro.
   */
  static evaluateLicense(
    db: SqlDriver,
    currentHwid: string,
    nowMs: number = Date.now(),
  ): LicenseCheckResult {
    const clockCheck = this.verifyMonotonicClock(db, nowMs);
    if (!clockCheck.valid) {
      return {
        status: "TAMPERED",
        canCheckout: false,
        message: "El reloj del dispositivo fue alterado hacia atrás. Operación de cobro bloqueada.",
      };
    }

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
        message: "Terminal no licenciada. Ingrese un certificado válido.",
      };
    }

    if (license.hwid !== currentHwid) {
      return {
        status: "TAMPERED",
        canCheckout: false,
        message: "El identificador de hardware (HWID) no coincide con el certificado.",
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

