import type { PushSubscriptionPayload } from './types';

const BASE64_URL_RE = /^[A-Za-z0-9_-]{16,}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidBase64Url(value: string): boolean {
  return BASE64_URL_RE.test(value) && value.length % 4 !== 1;
}

function decodedBase64UrlByteLength(value: string): number {
  return Math.floor(value.length * 3 / 4);
}

function isPrivateOrLocalEndpointHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::' || host === '::1') return true;
  const mappedIpv4 = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mappedIpv4) return isPrivateOrLocalEndpointHost(mappedIpv4[1]);
  const mappedIpv4Hex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedIpv4Hex) {
    const high = Number.parseInt(mappedIpv4Hex[1], 16);
    const low = Number.parseInt(mappedIpv4Hex[2], 16);
    return isPrivateOrLocalEndpointHost(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  if (host.includes(':') && (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb'))) return true;

  const ipv4Parts = host.split('.');
  if (ipv4Parts.length !== 4 || ipv4Parts.some(part => !/^\d+$/.test(part))) return false;
  const octets = ipv4Parts.map(Number);
  if (octets.some(octet => octet > 255)) return false;

  return octets[0] === 0
    || octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

export function validatePushSubscription(input: unknown): PushSubscriptionPayload {
  if (!isRecord(input)) throw new Error('subscription must be an object');

  const endpoint = input.endpoint;
  if (typeof endpoint !== 'string') throw new Error('endpoint is required');
  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    throw new Error('endpoint must be a valid HTTPS URL');
  }
  if (parsedEndpoint.protocol !== 'https:') throw new Error('endpoint must be a valid HTTPS URL');
  if (isPrivateOrLocalEndpointHost(parsedEndpoint.hostname)) throw new Error('endpoint must not target a local or private host');

  const keys = input.keys;
  if (!isRecord(keys)) throw new Error('keys are required');
  const p256dh = keys.p256dh;
  const auth = keys.auth;
  if (typeof p256dh !== 'string' || !isValidBase64Url(p256dh) || decodedBase64UrlByteLength(p256dh) !== 65) throw new Error('keys.p256dh is invalid');
  if (typeof auth !== 'string' || !isValidBase64Url(auth) || decodedBase64UrlByteLength(auth) !== 16) throw new Error('keys.auth is invalid');

  const expirationTime = input.expirationTime;
  if (expirationTime !== undefined && expirationTime !== null && (typeof expirationTime !== 'number' || !Number.isFinite(expirationTime))) {
    throw new Error('expirationTime is invalid');
  }

  return {
    endpoint,
    expirationTime: expirationTime as number | null | undefined,
    keys: { p256dh, auth },
  };
}
