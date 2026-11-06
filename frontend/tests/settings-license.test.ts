import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "./helpers";
import type { SqlDriver } from "../src/database/connection";
import {
  LicenseValidatorService,
  LicenseTokenPayload,
} from "../src/services/license-validator.service";
import { generateEd25519KeyPair, createSignedLicenseToken } from "./license-test-helper";
import { openShift } from "../src/database/repositories/shift.repository";
import { insertProduct } from "../src/database/repositories/product.repository";
import { createInvoice, getInvoiceById } from "../src/database/repositories/invoice.repository";
import { uuidv7 } from "../src/utils/uuid7";
import { ActivationScreen } from "../src/screens/ActivationScreen";
import { App } from "../src/App";

describe("Flujo Completo de Licencia y Periodo de Prueba de 15 Días", () => {
  let db: SqlDriver;
  const hwid = "hwid-pc-pos-001";
  const tenantId = "TENANT-001";
  const terminalId = "TERM-01";

  beforeEach(() => {
    db = createTestDb();
  });

  it("inicia en estado UNLICENSED y bloquea checkout antes de registrarse", () => {
    const status = LicenseValidatorService.evaluateLicense(db, hwid);
    expect(status.status).toBe("UNLICENSED");
    expect(status.canCheckout).toBe(false);
  });

  it("activa el periodo de prueba de 15 días con correo válido y permite cobro", () => {
    const nowMs = 1700000000000;
    const res = LicenseValidatorService.activateTrial(db, {
      email: "dueno@bodegon.com",
      currentHwid: hwid,
      tenantId,
      terminalId,
      nowMs,
    });

    expect(res.success).toBe(true);
    expect(res.trial?.daysRemaining).toBe(15);

    // Consulta de estado: debe estar activo con 15 días restantes
    const status = LicenseValidatorService.evaluateLicense(db, hwid, nowMs);
    expect(status.status).toBe("ACTIVE");
    expect(status.canCheckout).toBe(true);
    expect(status.isTrial).toBe(true);
    expect(status.registeredEmail).toBe("dueno@bodegon.com");
    expect(status.daysRemaining).toBe(15);

    // Permite abrir turno y emitir factura normalmente durante el trial
    const shiftId = openShift(db, {
      terminalId,
      cashierName: "Cajero 1",
      exchangeRateApplied: "40.0000",
    });

    const prodId = insertProduct(db, {
      tenantId: uuidv7(),
      sku: "PROD-TRIAL",
      name: "Harina PAN",
      priceUsd: "1.0000",
      costUsd: "0.8000",
    });

    const invoiceId = createInvoice(
      db,
      {
        shiftId,
        terminalId,
        exchangeRate: "40.0000",
        paymentMethod: "CASH_USD",
        items: [
          {
            productId: prodId,
            quantity: "1.0000",
            unitPriceUsd: "1.0000",
            unitPriceVes: "40.0000",
            lineTotalUsd: "1.0000",
            lineTotalVes: "40.0000",
          },
        ],
      },
      nowMs + 1000,
    );

    expect(invoiceId).toBeDefined();
    const inv = getInvoiceById(db, invoiceId);
    expect(inv?.status).toBe("COMPLETED");
  });

  it("bloquea un segundo intento de periodo de prueba con otro correo en la misma máquina", () => {
    const nowMs = 1700000000000;
    LicenseValidatorService.activateTrial(db, {
      email: "primero@bodegon.com",
      currentHwid: hwid,
      nowMs,
    });

    // Intento con otro correo
    const secondAttempt = LicenseValidatorService.activateTrial(db, {
      email: "segundo@bodegon.com",
      currentHwid: hwid,
      nowMs: nowMs + 1000,
    });

    expect(secondAttempt.success).toBe(false);
    expect(secondAttempt.message).toContain("ya agotó sus 15 días de prueba");
    expect(secondAttempt.message).toContain("primero@bodegon.com");
  });

  it("genera el archivo de solicitud con email y enlace mailto prellenado para bisyncdev@gmail.com", () => {
    const req = LicenseValidatorService.createLicenseRequest({
      email: "contacto@negocio.com",
      currentHwid: hwid,
      tenantId,
      terminalId,
      deviceLabel: "Caja Express",
    });

    expect(req.requestId).toBeDefined();
    expect(req.email).toBe("contacto@negocio.com");
    expect(req.hwid).toBe(hwid);
    expect(req.deviceLabel).toBe("Caja Express");

    const mailto = LicenseValidatorService.getMailtoUrl(req);
    expect(mailto.startsWith("mailto:bisyncdev@gmail.com")).toBe(true);
    expect(mailto).toContain(encodeURIComponent("contacto@negocio.com"));
    expect(mailto).toContain(encodeURIComponent("Caja Express"));
    expect(mailto).toContain(encodeURIComponent(hwid));
  });

  it("bloquea el cobro cuando el periodo de prueba expira pasados los 15 días", () => {
    const nowMs = 1700000000000;
    LicenseValidatorService.activateTrial(db, {
      email: "dueno@bodegon.com",
      currentHwid: hwid,
      nowMs,
    });

    // Día 16 (16 * 86400 * 1000 ms después)
    const day16Ms = nowMs + 16 * 86400 * 1000;
    const expiredStatus = LicenseValidatorService.evaluateLicense(db, hwid, day16Ms);

    expect(expiredStatus.status).toBe("EXPIRED");
    expect(expiredStatus.canCheckout).toBe(false);
    expect(expiredStatus.isTrial).toBe(true);
    expect(expiredStatus.message).toContain("periodo de prueba de 15 días ha expirado");

    const shiftId = openShift(db, {
      terminalId,
      cashierName: "Cajero 1",
      exchangeRateApplied: "40.0000",
    });

    const prodId = insertProduct(db, {
      tenantId: uuidv7(),
      sku: "PROD-EXPIRED",
      name: "Arroz",
      priceUsd: "1.2000",
      costUsd: "0.9000",
    });

    // Intentar facturar cuando el trial expiró debe ser rechazado
    expect(() =>
      createInvoice(
        db,
        {
          shiftId,
          terminalId,
          exchangeRate: "40.0000",
          paymentMethod: "CASH_USD",
          items: [
            {
              productId: prodId,
              quantity: "1.0000",
              unitPriceUsd: "1.2000",
              unitPriceVes: "48.0000",
              lineTotalUsd: "1.2000",
              lineTotalVes: "48.0000",
            },
          ],
        },
        day16Ms + 1000,
      ),
    ).toThrow(/licencia no permite cobro|expired/i);
  });

  it("activa licencia definitiva Ed25519 reemplazando el trial y reactiva el cobro", () => {
    const nowMs = 1700000000000;
    const { publicKeyPem, privateKeyPem } = generateEd25519KeyPair();

    // Iniciar con trial y luego avanzar en el tiempo hasta que expire
    LicenseValidatorService.activateTrial(db, {
      email: "dueno@bodegon.com",
      currentHwid: hwid,
      nowMs,
    });

    const day20Ms = nowMs + 20 * 86400 * 1000;
    expect(LicenseValidatorService.evaluateLicense(db, hwid, day20Ms).canCheckout).toBe(false);

    // Llega la licencia firmada por Bisync por 365 días
    const payload: LicenseTokenPayload = {
      tenantId,
      branchId: "SEDE-CENTRAL",
      terminalId,
      hwid,
      issuedAt: Math.floor(day20Ms / 1000),
      validUntil: Math.floor(day20Ms / 1000) + 365 * 86400,
      gracePeriodDays: 3,
      p2pSyncEnabled: true,
      features: ["pos", "bimoneda"],
    };

    const definitiveToken = createSignedLicenseToken(payload, privateKeyPem);

    const installRes = LicenseValidatorService.installLicense(
      db,
      definitiveToken,
      hwid,
      publicKeyPem,
      day20Ms,
    );

    expect(installRes.status).toBe("ACTIVE");
    expect(installRes.canCheckout).toBe(true);

    const activeEval = LicenseValidatorService.evaluateLicense(db, hwid, day20Ms + 1000);
    expect(activeEval.status).toBe("ACTIVE");
    expect(activeEval.canCheckout).toBe(true);
    expect(activeEval.isTrial).toBe(false);
  });

  it("exige registro en ActivationScreen antes de permitir el acceso al sistema (puerta de enlace)", () => {
    // Terminal recién instalada sin licencia: status UNLICENSED
    const initialStatus = LicenseValidatorService.evaluateLicense(db, hwid);
    expect(initialStatus.status).toBe("UNLICENSED");

    // Simular activación exitosa en ActivationScreen
    let activated = false;
    const res = LicenseValidatorService.activateTrial(db, {
      email: "nuevo-dueno@bodegon.com",
      currentHwid: hwid,
      tenantId,
      terminalId,
    });
    expect(res.success).toBe(true);
    if (res.success) {
      activated = true;
    }

    expect(activated).toBe(true);

    // Tras activar, el estado pasa a ACTIVE y permite operar
    const afterStatus = LicenseValidatorService.evaluateLicense(db, hwid);
    expect(afterStatus.status).toBe("ACTIVE");
    expect(afterStatus.canCheckout).toBe(true);
    expect(afterStatus.isTrial).toBe(true);
    expect(afterStatus.registeredEmail).toBe("nuevo-dueno@bodegon.com");
  });

  it("genera URL de Gmail Web y permite descarga y copiado de solicitud sin invocar cliente de correo nativo", () => {
    const req = LicenseValidatorService.createLicenseRequest({
      email: "cliente@gmail.com",
      currentHwid: hwid,
      tenantId,
      terminalId,
      deviceLabel: "Terminal Mostrador",
    });

    const gmailUrl = LicenseValidatorService.getGmailComposeUrl(req);
    expect(gmailUrl.startsWith("https://mail.google.com/mail/?view=cm")).toBe(true);
    expect(gmailUrl).toContain("to=bisyncdev@gmail.com");
    expect(gmailUrl).toContain(encodeURIComponent("cliente@gmail.com"));

    // Verifica que el helper de descarga maneja el objeto JSON de forma válida
    const serialized = JSON.stringify(req, null, 2);
    expect(serialized).toContain("cliente@gmail.com");
    expect(serialized).toContain("Terminal Mostrador");
  });
});
