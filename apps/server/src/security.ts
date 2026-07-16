import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { config } from './config.js';

const key = scryptSync(config.encryptionSecret, 'daye-rss-key-v1', 32);

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptSecret(value: string) {
  const [iv, tag, encrypted] = value.split('.');
  if (!iv || !tag || !encrypted) throw new Error('Invalid encrypted secret');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
}

export function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function signSession(email: string, expiresInDays = 30, version = 1) {
  const payload = Buffer.from(JSON.stringify({ email, exp: Date.now() + expiresInDays * 86400000, version })).toString('base64url');
  const signature = createHmac('sha256', config.tokenSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifySession(token: string) {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', config.tokenSecret).update(payload).digest();
  const received = Buffer.from(signature, 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { email: string; exp: number; version?: number };
    if (data.exp < Date.now() || data.email.toLowerCase() !== config.allowedEmail) return null;
    return { ...data, version: data.version ?? 1 };
  } catch {
    return null;
  }
}

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase().replace(/^::ffff:/, '');
  if (!isIP(normalized)) return true;
  if (normalized.includes('.')) {
    const [a, b, c] = normalized.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return true;
    if (a === 203 && b === 0 && c === 113) return true;
  }
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized) || normalized.startsWith('ff') || normalized.startsWith('2001:db8')) return true;
  return false;
}

function isDevelopmentProxyAddress(address: string) {
  const normalized = address.toLowerCase().replace(/^::ffff:/, '');
  if (!normalized.includes('.')) return false;
  const [a, b] = normalized.split('.').map(Number);
  return a === 198 && (b === 18 || b === 19);
}

async function assertPublicUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP(S) feeds are supported');
  if (url.username || url.password) throw new Error('Credentials in feed URLs are not allowed');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('Non-standard feed ports are not allowed');
  const results = await lookup(url.hostname, { all: true, verbatim: true });
  const allowDevelopmentProxy = process.env.NODE_ENV !== 'production' && !isIP(url.hostname);
  if (!results.length || results.some((item) => isPrivateAddress(item.address) && !(allowDevelopmentProxy && isDevelopmentProxyAddress(item.address)))) throw new Error('Private or unresolved feed address blocked');
  return url;
}

export async function safeFetchText(rawUrl: string, maxBytes = 5_000_000, redirects = 3) {
  let current = rawUrl;
  for (let redirect = 0; redirect <= redirects; redirect += 1) {
    await assertPublicUrl(current);
    const response = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
      headers: { 'user-agent': 'DayeRSS/0.1 (+personal feed reader)', accept: 'application/rss+xml, application/atom+xml, text/xml, application/xml, text/html;q=0.8' }
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Feed redirect missing location');
      current = new URL(location, current).toString();
      continue;
    }
    if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}`);
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > maxBytes) throw new Error('Feed exceeds size limit');
    const reader = response.body?.getReader();
    if (!reader) return '';
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error('Feed exceeds size limit');
      }
      chunks.push(value);
    }
    return new TextDecoder().decode(Buffer.concat(chunks));
  }
  throw new Error('Too many feed redirects');
}
