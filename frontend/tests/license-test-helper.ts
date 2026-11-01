import * as crypto from "node:crypto";
import type { LicenseTokenPayload, SignedLicenseEnvelope } from "../src/services/license-validator.service";

export interface KeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
}

export function generateEd25519KeyPair(): KeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

export function createSignedLicenseToken(
  payload: LicenseTokenPayload,
  privateKeyPem: string,
): string {
  const canonical = JSON.stringify(payload);
  const privKey = crypto.createPrivateKey(privateKeyPem);
  const signature = crypto.sign(null, Buffer.from(canonical, "utf8"), privKey).toString("hex");

  const envelope: SignedLicenseEnvelope = {
    payload,
    signature,
  };

  return JSON.stringify(envelope);
}
