import { describe, expect, it } from "vitest";
import { createTestDb } from "./helpers";
import {
  LicenseValidatorService,
  LicenseTokenPayload,
} from "../src/services/license-validator.service";
import { generateEd25519KeyPair, createSignedLicenseToken } from "./license-test-helper";
import { openShift } from "../src/database/repositories/shift.repository";
import { insertProduct } from "../src/database/repositories/product.repository";
import { createInvoice } from "../src/database/repositories/invoice.repository";
import { uuidv7 } from "../src/utils/uuid7";

describe("PR-09: Validador de Licencia en App, Verificación Ed25519 y Guardia de Reloj Monótono", () => {
  it("calcula HWID determinista basado en SHA-256 de Motherboard + CPU", () => {
    const hwid1 = LicenseValidatorService.computeHwid({
      motherboardUuid: "MB-12345-XYZ",
      cpuSerial: "CPU-98765-ABC",
    });

    const hwid2 = LicenseValidatorService.computeHwid({
      motherboardUuid: "mb-12345-xyz", // insensible a mayúsculas
      cpuSerial: "cpu-98765-abc",
    });

    expect(hwid1).toMatch(/^[0-9a-f]{64}$/);
    expect(hwid1).toBe(hwid2);

    const hwidDifferent = LicenseValidatorService.computeHwid({
      motherboardUuid: "MB-OTHER",
      cpuSerial: "CPU-OTHER",
    });
    expect(hwid1).not.toBe(hwidDifferent);
  });

  it("activa el cobro con licencia válida firmada con Ed25519", () => {
    const db = createTestDb();
    const { publicKeyPem, privateKeyPem } = generateEd25519KeyPair();
    const currentHwid = LicenseValidatorService.computeHwid({
      motherboardUuid: "MB-001",
      cpuSerial: "CPU-001",
    });

    const nowMs = 1700000000000; // t0
    const nowSec = Math.floor(nowMs / 1000);

    const payload: LicenseTokenPayload = {
      tenantId: "tenant-uuid",
      branchId: "branch-uuid",
      terminalId: "C01",
      hwid: currentHwid,
      issuedAt: nowSec - 86400,
      validUntil: nowSec + 30 * 86400, // Válida por 30 días
      gracePeriodDays: 3,
      p2pSyncEnabled: true,
      features: ["pos", "inventory", "shifts"],
    };

    const rawToken = createSignedLicenseToken(payload, privateKeyPem);

    const installResult = LicenseValidatorService.installLicense(
      db,
      rawToken,
      currentHwid,
      publicKeyPem,
      nowMs,
    );

    expect(installResult.status).toBe("ACTIVE");
    expect(installResult.canCheckout).toBe(true);

    const evalResult = LicenseValidatorService.evaluateLicense(db, currentHwid, nowMs);
    expect(evalResult.status).toBe("ACTIVE");
    expect(evalResult.canCheckout).toBe(true);
  });

  it("rechaza licencia si la firma Ed25519 o los datos fueron adulterados (tampered)", () => {
    const db = createTestDb();
    const { publicKeyPem, privateKeyPem } = generateEd25519KeyPair();
    const currentHwid = "hwid-valido-123";

    const payload: LicenseTokenPayload = {
      tenantId: "tenant-1",
      branchId: "branch-1",
      terminalId: "C01",
      hwid: currentHwid,
      issuedAt: 1000,
      validUntil: 9999999999,
      gracePeriodDays: 3,
      p2pSyncEnabled: true,
      features: ["pos"],
    };

    const validTokenJson = createSignedLicenseToken(payload, privateKeyPem);
    const parsed = JSON.parse(validTokenJson);

    // Adulterar maliciosamente la fecha de expiración sin regenerar la firma
    parsed.payload.validUntil = 99999999999;
    const tamperedTokenJson = JSON.stringify(parsed);

    const result = LicenseValidatorService.installLicense(
      db,
      tamperedTokenJson,
      currentHwid,
      publicKeyPem,
      1500000,
    );

    expect(result.status).toBe("TAMPERED");
    expect(result.canCheckout).toBe(false);
    expect(result.message).toMatch(/Firma criptográfica Ed25519 inválida/);
  });

  it("bloquea el cobro si el HWID de la máquina difiere del certificado", () => {
    const db = createTestDb();
    const { publicKeyPem, privateKeyPem } = generateEd25519KeyPair();
    const machineHwid = "hwid-maquina-real";
    const licenseHwid = "hwid-otra-maquina";

    const payload: LicenseTokenPayload = {
      tenantId: "t1",
      branchId: "b1",
      terminalId: "C01",
      hwid: licenseHwid,
      issuedAt: 1000,
      validUntil: 9999999999,
      gracePeriodDays: 3,
      p2pSyncEnabled: true,
      features: ["pos"],
    };

    const token = createSignedLicenseToken(payload, privateKeyPem);

    const result = LicenseValidatorService.installLicense(
      db,
      token,
      machineHwid, // No coincide con licenseHwid
      publicKeyPem,
      1500000,
    );

    expect(result.status).toBe("TAMPERED");
    expect(result.canCheckout).toBe(false);
    expect(result.message).toMatch(/Hardware ID/);
  });

  it("maneja correctamente estados de expiración y período de gracia", () => {
    const db = createTestDb();
    const { publicKeyPem, privateKeyPem } = generateEd25519KeyPair();
    const hwid = "hwid-test-grace";
    const nowSec = 1700000000;
    const nowMs = nowSec * 1000;

    // Caso 1: En período de gracia (expiró hace 1 día, pero tiene 3 días de gracia)
    const payloadGrace: LicenseTokenPayload = {
      tenantId: "t1",
      branchId: "b1",
      terminalId: "C01",
      hwid,
      issuedAt: nowSec - 30 * 86400,
      validUntil: nowSec - 86400, // expiró hace 1 día
      gracePeriodDays: 3,
      p2pSyncEnabled: true,
      features: ["pos"],
    };

    const tokenGrace = createSignedLicenseToken(payloadGrace, privateKeyPem);
    const resGrace = LicenseValidatorService.installLicense(
      db,
      tokenGrace,
      hwid,
      publicKeyPem,
      nowMs,
    );

    expect(resGrace.status).toBe("GRACE");
    expect(resGrace.canCheckout).toBe(true);

    // Caso 2: Expiración definitiva (expiró hace 10 días, supera la gracia)
    const resExpired = LicenseValidatorService.evaluateLicense(
      db,
      hwid,
      nowMs + 10 * 86400 * 1000,
    );
    expect(resExpired.status).toBe("EXPIRED");
    expect(resExpired.canCheckout).toBe(false);
  });

  it("guardia de reloj monótono bloquea la emisión de facturas si el reloj se atrasa", () => {
    const db = createTestDb();
    const { publicKeyPem, privateKeyPem } = generateEd25519KeyPair();
    const hwid = "hwid-clock-test";
    const nowMs = 1700000000000;

    const token = createSignedLicenseToken(
      {
        tenantId: "t1",
        branchId: "b1",
        terminalId: "C01",
        hwid,
        issuedAt: 1600000000,
        validUntil: 1800000000,
        gracePeriodDays: 3,
        p2pSyncEnabled: true,
        features: ["pos"],
      },
      privateKeyPem,
    );

    LicenseValidatorService.installLicense(db, token, hwid, publicKeyPem, nowMs);

    const shiftId = openShift(db, {
      terminalId: "C01",
      cashierName: "Erick",
      exchangeRateApplied: "40.0000",
    });

    const prodId = insertProduct(db, {
      tenantId: uuidv7(),
      sku: "PROD-CLOCK",
      name: "Café",
      priceUsd: "2.0000",
      costUsd: "1.0000",
    });

    // Factura 1 a tiempo normal (nowMs + 1000) -> OK
    createInvoice(
      db,
      {
        shiftId,
        terminalId: "C01",
        exchangeRate: "40.0000",
        paymentMethod: "CASH_USD",
        items: [{ productId: prodId, quantity: "1.0000", unitPriceUsd: "2.0000", unitPriceVes: "80.0000", lineTotalUsd: "2.0000", lineTotalVes: "80.0000" }],
      },
      nowMs + 1000,
    );

    // Intento de atrasar el reloj del sistema a nowMs - 500000 (Fraude)
    expect(() =>
      createInvoice(
        db,
        {
          shiftId,
          terminalId: "C01",
          exchangeRate: "40.0000",
          paymentMethod: "CASH_USD",
          items: [{ productId: prodId, quantity: "1.0000", unitPriceUsd: "2.0000", unitPriceVes: "80.0000", lineTotalUsd: "2.0000", lineTotalVes: "80.0000" }],
        },
        nowMs - 500000,
      ),
    ).toThrow(/el reloj del dispositivo fue atrasado|licencia tampered/i);

    // El estado en base de datos quedó en TAMPERED
    const [row] = db.all<{ status: string }>("SELECT status FROM license_state WHERE id = 'current_license'");
    expect(row?.status).toBe("TAMPERED");
  });
});

