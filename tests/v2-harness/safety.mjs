import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import { syncBuiltinESMExports } from 'node:module';

// No dotenv import: validate inherited configuration before any application import.
export function guardEnvironment(env = process.env) {
  for (const [key, value] of Object.entries(env)) {
    if (!value || !/^(?:(?:BRAINIA_)?DATABASE_URL(?:_[A-Z_]+)?|DIRECT_URL|POSTGRES(?:_[A-Z]+)*_URL(?:_[A-Z_]+)?|PGHOST|SUPABASE_URL|(?:BRAINIA_|DEEPSEEK_|TYPESAFE_|OPENAI_)?(?:API_BASE_URL|API_URL|BASE_URL|ENDPOINT))$/i.test(key)) continue;
    if (key === 'PGHOST') {
      if (!['localhost', '127.0.0.1', '::1'].includes(value)) throw new Error(`UNSAFE_TARGET: ${key} is not loopback`);
      continue;
    }
    let url;
    try { url = new URL(value); } catch { throw new Error(`UNSAFE_TARGET: malformed ${key}`); }
    if (!['localhost', '127.0.0.1', '[::1]', 'isolated-test.invalid'].includes(url.hostname) ||
        /prod|production|live/i.test(`${url.hostname}${decodeURIComponent(url.pathname)}`)) {
      throw new Error(`UNSAFE_TARGET: ${key} must be an isolated local target`);
    }
    if (/DATABASE|DIRECT|POSTGRES/.test(key.toUpperCase()) &&
        (!['postgres:', 'postgresql:'].includes(url.protocol) || !/^\/(?:brainia_)?(?:test|isolated)(?:[_-][a-z0-9_-]+)?$/i.test(url.pathname))) {
      // Match the existing PGlite sentinel only; it never connects to this URL.
      if (value !== 'postgres://isolated-test.invalid/brainia') throw new Error(`UNSAFE_TARGET: ${key} requires a test/isolated database name`);
    }
  }
  if (env.PGDATABASE && !/^(?:brainia_)?(?:test|isolated)(?:[_-][a-z0-9_-]+)?$/i.test(env.PGDATABASE)) {
    throw new Error('UNSAFE_TARGET: PGDATABASE is not isolated');
  }
  if (['production', 'live'].includes(env.NODE_ENV)) throw new Error('UNSAFE_TARGET: production NODE_ENV');
}

export function installOfflineBoundary() {
  guardEnvironment();
  const calls = [];
  const deny = function () { calls.push({ transport: 'network', denied: true }); throw new Error('OFFLINE_NETWORK_DENIED'); };
  globalThis.fetch = async () => deny();
  http.request = http.get = https.request = https.get = deny;
  net.connect = net.createConnection = tls.connect = dgram.createSocket = deny;
  net.Socket.prototype.connect = deny;
  syncBuiltinESMExports();
  for (const key of Object.keys(process.env)) if (/(API_KEY|TOKEN|SECRET|PASSWORD)$/.test(key)) delete process.env[key];
  process.env.DATABASE_URL = 'postgres://isolated-test.invalid/brainia';
  process.env.DEEPSEEK_API_KEY = '';
  process.env.TYPESAFE_API_KEY = '';
  process.env.BRAINIA_JEV_MODE = 'off';
  process.env.BRAINIA_INTELLIGENCE_ENABLED = 'false';
  return { calls, provider: async () => { calls.push({ transport: 'stub', denied: false }); return { choices: [{ message: { content: '{}' } }] }; } };
}

export function sanitize(value) {
  return value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<email>')
    .replace(/\b(?:account|cuenta|iban|card|tarjeta)\s*(?:[:#]|ending|terminada en)?\s*([A-Z]{2}\d{10,32}|\d{4,19})\b/gi,
      match => `${match.replace(/([A-Z]{2}\d{10,32}|\d{4,19})$/i, '')}<account>`);
}

export function sanitizerAudit() {
  const original = 'Compra UYU 1.234,56 / USD 1,234.56 / $ 99,00 ref SYN-REF-1 account 123456789 email person@example.org';
  const result = sanitize(original);
  const preserved = ['UYU 1.234,56', 'USD 1,234.56', '$ 99,00', 'SYN-REF-1'].every(value => result.includes(value));
  return { version: 'v2-sanitizer-1', passed: preserved && !result.includes('person@') && !result.includes('123456789'),
    moneySeparatorsPreserved: preserved, relationships: 'synthetic IDs preserved verbatim', personalSources: 0 };
}
