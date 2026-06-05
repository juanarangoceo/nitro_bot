// Cifrado de credenciales por tenant (Shopify/WhatsApp tokens, HMAC secret).
// AES-256-GCM con IV aleatorio por valor. La clave viene de TENANT_SECRET_ENC_KEY
// (32 bytes en base64). Solo se usa del lado del servidor.
//
// Formato del valor cifrado:  v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>

import crypto from "node:crypto";
import { env } from "./env";

const ALGO = "aes-256-gcm";
const PREFIX = "v1";

function getKey(): Buffer {
  const key = Buffer.from(env.TENANT_SECRET_ENC_KEY, "base64");
  if (key.length !== 32) {
    throw new Error(
      `TENANT_SECRET_ENC_KEY debe ser 32 bytes en base64 (actual: ${key.length})`
    );
  }
  return key;
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12); // GCM recomienda IV de 12 bytes
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptSecret(encoded: string): string {
  const parts = encoded.split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error("Formato de secreto cifrado inválido");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = crypto.createDecipheriv(
    ALGO,
    getKey(),
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return plain.toString("utf8");
}
