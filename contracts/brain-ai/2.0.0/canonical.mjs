import { createHash } from 'node:crypto';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function canonical(value) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw Error('Nonfinite JSON number');
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(++i);
        if (!(next >= 0xdc00 && next <= 0xdfff)) throw Error('Lone surrogate');
      } else if (code >= 0xdc00 && code <= 0xdfff) throw Error('Lone surrogate');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (typeof value === 'object') return '{' + Object.keys(value).sort().map(k => canonical(k) + ':' + canonical(value[k])).join(',') + '}';
  throw Error('Not JSON');
}
export const fingerprintInput = e => ({ changeKind: e.changeKind, content: e.content, sourceOccurredAt: e.sourceOccurredAt ?? null, sourceUpdatedAt: e.sourceUpdatedAt ?? null });
export const fingerprint = e => sha256(Buffer.from(canonical(fingerprintInput(e)), 'utf8'));
