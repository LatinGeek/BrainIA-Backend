import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { ApiError, canonicalize } from "../../domain/v2/contracts.js";

// A deployment can share this secret across instances. With no configured
// secret cursors intentionally expire on restart instead of using a public key.
const cursorKey = createHash("sha256").update(process.env.BRAINIA_CURSOR_SECRET || randomBytes(32)).digest();
export function filterKey(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}
export function encodeCursor(owner: string, scope: string, filters: unknown, position: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cursorKey, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ o: filterKey(owner).slice(0,32), s: filterKey(scope).slice(0,32), f: filterKey(filters).slice(0,32), p: position }), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}
export function decodeCursor(cursor: string | undefined, owner: string, scope: string, filters: unknown): string | null {
  if (!cursor) return null;
  try {
    const bytes = Buffer.from(cursor, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", cursorKey, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const data = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
    if (data.o !== filterKey(owner).slice(0,32) || data.s !== filterKey(scope).slice(0,32) || data.f !== filterKey(filters).slice(0,32) || typeof data.p !== "string") throw new Error();
    return data.p;
  } catch {
    throw new ApiError(400, "invalid_request", "Invalid cursor");
  }
}
