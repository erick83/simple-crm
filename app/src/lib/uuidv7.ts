/** Fuente de bytes aleatorios inyectable (en RN: crypto.getRandomValues polyfill). */
export type RandomBytes = (length: number) => Uint8Array;

const defaultRandom: RandomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

let lastMs = -1;
let counter = 0;

/**
 * UUIDv7 (RFC 9562): 48 bits de timestamp ms + versión 7 + variante 10 + aleatorio.
 * Monotónico dentro del mismo milisegundo (contador de 12 bits en rand_a).
 */
export function uuidv7(now: number = Date.now(), random: RandomBytes = defaultRandom): string {
  let ms = Math.max(now, lastMs);
  if (ms === lastMs) {
    counter += 1;
    if (counter > 0xfff) {
      ms += 1;
      counter = 0;
    }
  } else {
    counter = 0;
  }
  lastMs = ms;

  const b = random(10);
  const bytes = new Uint8Array(16);
  // 48 bits timestamp big-endian (sin operadores de 32 bits para no truncar)
  let t = ms;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = t % 256;
    t = Math.floor(t / 256);
  }
  bytes[6] = 0x70 | ((counter >> 8) & 0x0f);
  bytes[7] = counter & 0xff;
  bytes[8] = 0x80 | ((b[0] ?? 0) & 0x3f);
  for (let i = 9; i < 16; i++) bytes[i] = b[i - 8] ?? 0;

  const hex = Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

