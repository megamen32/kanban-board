import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function decodeBase32(input: string): Buffer {
  const normalized = input.replace(/[=\s-]/g, '').toUpperCase();
  if (!normalized || /[^A-Z2-7]/.test(normalized)) throw new Error('invalid TOTP secret');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of normalized) {
    value = (value << 5) | ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  let value = '';
  let bits = 0;
  let buffer = 0;
  for (const byte of randomBytes(20)) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      value += ALPHABET[(buffer >> bits) & 31];
    }
  }
  if (bits > 0) value += ALPHABET[(buffer << (5 - bits)) & 31];
  return value;
}

export function generateTotp(secret: string, timestampMs = Date.now(), digits = 6): string {
  if (![6, 8].includes(digits)) throw new Error('TOTP digits must be 6 or 8');
  const counter = Math.floor(timestampMs / 30_000);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | (digest[offset + 1] << 16)
    | (digest[offset + 2] << 8)
    | digest[offset + 3];
  return String(binary % (10 ** digits)).padStart(digits, '0');
}

export function verifyTotp(secret: string, code: string, timestampMs = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const supplied = Buffer.from(code);
  for (const skew of [-1, 0, 1]) {
    const candidateTimestamp = timestampMs + skew * 30_000;
    if (candidateTimestamp < 0) continue;
    const expected = Buffer.from(generateTotp(secret, candidateTimestamp));
    if (timingSafeEqual(supplied, expected)) return true;
  }
  return false;
}

export function otpauthUri(secret: string, account: string, issuer = 'Kanban'): string {
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
