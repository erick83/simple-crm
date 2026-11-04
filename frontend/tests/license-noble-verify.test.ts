import { describe, expect, it } from "vitest";
import * as crypto from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { generateEd25519KeyPair } from "./license-test-helper";
import {
  spkiPemToRawPublicKey,
  DEFAULT_EMBEDDED_PUBLIC_KEY,
} from "../src/services/license-validator.service";

describe("PR-26bis: verificación Ed25519 pura (noble) para runtime sin node:crypto", () => {
  it("extrae la llave cruda (32 bytes) del PEM SPKI y valida contra node:crypto", () => {
    const { publicKeyPem, privateKeyPem } = generateEd25519KeyPair();
    const rawPub = spkiPemToRawPublicKey(publicKeyPem);
    expect(rawPub.length).toBe(32);

    const msg = new TextEncoder().encode(JSON.stringify({ tenantId: "t1", hwid: "abc" }));
    const sig = crypto.sign(null, msg, crypto.createPrivateKey(privateKeyPem));

    expect(ed25519.verify(sig, msg, rawPub)).toBe(true);

    const tampered = Uint8Array.from(msg);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    expect(ed25519.verify(sig, tampered, rawPub)).toBe(false);
  });

  it("rechaza PEM que no sea Ed25519 SPKI", () => {
    // Llave RSA/P-256 tendría otro OID; aquí probamos basura directa.
    expect(() => spkiPemToRawPublicKey("no es pem")).toThrow(/invalid|Base64|PEM/i);
  });

  it("la llave pública embebida por defecto es Ed25519 SPKI de 32 bytes", () => {
    const raw = spkiPemToRawPublicKey(DEFAULT_EMBEDDED_PUBLIC_KEY);
    expect(raw.length).toBe(32);
  });
});
