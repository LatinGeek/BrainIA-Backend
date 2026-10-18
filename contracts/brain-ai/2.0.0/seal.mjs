// Explicit maintainer operation: resealing creates a new approval record, never approval.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './canonical.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url));
fs.copyFileSync(path.resolve(dir,'../../../docs/BRAIN_AI_V2_API_CONTRACT_v2.0.0.md'),path.join(dir,'spec.md'));
const files=Object.fromEntries(fs.readdirSync(dir).filter(n=>n!=='SHA256SUMS.json').sort().map(name=>[name,sha256(fs.readFileSync(path.join(dir,name)))]));
fs.writeFileSync(path.join(dir,'SHA256SUMS.json'),JSON.stringify({algorithm:'sha256',encoding:'exact UTF-8 file bytes; no newline normalization',files},null,2)+'\n','utf8');
console.log('Manifest SHA-256: '+sha256(fs.readFileSync(path.join(dir,'SHA256SUMS.json'))));
