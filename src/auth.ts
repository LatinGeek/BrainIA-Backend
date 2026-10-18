import type { IncomingHttpHeaders } from "node:http";
import type { FastifyReply, FastifyRequest } from "fastify";

export const API_KEY_HEADER = "x-brainia-api-key";
export const CLIENT_ID_HEADER = "x-brainia-client-id";
// Owner selection headers are never trusted. They are rejected outright so a
// caller cannot claim another owner's data by sending a header.
export const OWNER_HEADERS = ["x-brainia-owner-id", "x-owner-id"] as const;

export type AuthConfig = {
  globalApiKey: string | null;
  clientKeys: Map<string, string>;
};

export type Principal = {
  ownerId: string | null;
  clientId: string | null;
  mode: "disabled" | "global" | "client" | "cron";
  scopes: string[];
  authenticated: boolean;
};

export type AuthContext = Principal;

export type AuthFailure = {
  ok: false;
  statusCode: 401 | 403 | 503;
  error: string;
  message: string;
};

export type AuthResult = AuthContext | AuthFailure;

declare module "fastify" {
  interface FastifyRequest {
    principal?: Principal;
  }
}

export class AuthzError extends Error {
  statusCode: 401 | 403;
  code: string;
  constructor(code: string, statusCode: 401 | 403 = 403, message = code) {
    super(message);
    this.name = "AuthzError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function readHeader(headers: IncomingHttpHeaders, key: string) {
  const value = headers[key];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

export function parseClientKeyPairs(raw: string | undefined | null) {
  const entries = new Map<string, string>();
  if (!raw) {
    return entries;
  }

  for (const chunk of raw.split(/[,\n]/)) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) {
      throw new Error(
        "BRAINIA_CLIENT_KEYS must use the format clientId:key,clientId2:key2",
      );
    }

    const clientId = trimmed.slice(0, separatorIndex).trim();
    const apiKey = trimmed.slice(separatorIndex + 1).trim();

    if (!clientId || !apiKey) {
      throw new Error(
        "BRAINIA_CLIENT_KEYS must use the format clientId:key,clientId2:key2",
      );
    }

    entries.set(clientId, apiKey);
  }

  return entries;
}

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  return {
    globalApiKey: env.BRAINIA_API_KEY?.trim() || null,
    clientKeys: parseClientKeyPairs(env.BRAINIA_CLIENT_KEYS),
  };
}

export function isAuthEnabled(config: AuthConfig) {
  return Boolean(config.globalApiKey || config.clientKeys.size > 0);
}

// Deployed environments must never run with authentication disabled. Tests and
// local development may opt out explicitly.
export function isAuthRequired(env: NodeJS.ProcessEnv = process.env) {
  const flag = env.BRAINIA_REQUIRE_AUTH?.trim().toLowerCase();
  if (flag === "true") return true;
  if (flag === "false") return false;
  return env.NODE_ENV === "production" || env.VERCEL === "1";
}

export function resolveAuthContext(
  headers: IncomingHttpHeaders,
  config: AuthConfig,
): AuthResult {
  if (!isAuthEnabled(config)) {
    // Development/test only: the hook rejects this in required-auth
    // environments. The legacy client id is kept for local smoke flows.
    const clientId = readHeader(headers, CLIENT_ID_HEADER)?.trim() || null;
    return {
      clientId,
      ownerId: clientId,
      mode: "disabled",
      scopes: ["dev"],
      authenticated: false,
    };
  }

  const apiKey = readHeader(headers, API_KEY_HEADER);

  if (config.clientKeys.size > 0) {
    const clientId = readHeader(headers, CLIENT_ID_HEADER)?.trim();
    if (!clientId) {
      return {
        ok: false,
        statusCode: 401,
        error: "missing_client_id",
        message: `Missing ${CLIENT_ID_HEADER} header`,
      };
    }

    const expectedKey = config.clientKeys.get(clientId);
    if (!expectedKey) {
      return {
        ok: false,
        statusCode: 403,
        error: "unknown_client",
        message: "The provided client id is not registered",
      };
    }

    if (!apiKey || apiKey !== expectedKey) {
      return {
        ok: false,
        statusCode: 401,
        error: "invalid_api_key",
        message: `Invalid ${API_KEY_HEADER} header`,
      };
    }

    return {
      clientId,
      ownerId: clientId,
      mode: "client",
      scopes: ["owner"],
      authenticated: true,
    };
  }

  if (!apiKey || apiKey !== config.globalApiKey) {
    return {
      ok: false,
      statusCode: 401,
      error: "invalid_api_key",
      message: `Invalid ${API_KEY_HEADER} header`,
    };
  }

  // A global key is administrative. It carries no owner identity: data routes
  // must receive an explicit owner scope through an approved channel, not a
  // client-supplied header.
  return {
    clientId: null,
    ownerId: null,
    mode: "global",
    scopes: ["admin"],
    authenticated: true,
  };
}

function rejectedOwnerHeader(headers: IncomingHttpHeaders): AuthFailure | null {
  for (const header of OWNER_HEADERS) {
    if (readHeader(headers, header) !== null) {
      return {
        ok: false,
        statusCode: 403,
        error: "owner_header_not_accepted",
        message: `The ${header} header is not accepted; the owner is resolved from the authenticated credential`,
      };
    }
  }
  return null;
}

export function principalFromRequest(request: FastifyRequest): Principal {
  if (!request.principal) {
    throw new AuthzError("principal_not_resolved", 401);
  }
  return request.principal;
}

export function requireOwnerId(request: FastifyRequest): string {
  const principal = principalFromRequest(request);
  if (!principal.ownerId) {
    throw new AuthzError("owner_scope_required", 403);
  }
  return principal.ownerId;
}

// Route-level owner scope. Authenticated owners always return their id; the
// legacy disabled (test/local) mode returns undefined so existing local flows
// remain unscoped, matching the pre-B06 development behavior. Production can
// never reach this branch because isAuthRequired() fails closed in the hook.
export function ownerScope(request: FastifyRequest, config?: AuthConfig): string | undefined {
  if (!request.principal) {
    if (!config) throw new AuthzError("principal_not_resolved", 401);
    const resolved = resolveAuthContext(request.headers, config);
    if ("ok" in resolved && !resolved.ok) {
      throw new AuthzError(resolved.error, resolved.statusCode === 503 ? 403 : resolved.statusCode);
    }
    request.principal = resolved as AuthContext;
  }
  const principal = principalFromRequest(request);
  if (principal.mode === "disabled") return principal.ownerId ?? undefined;
  if (!principal.ownerId) throw new AuthzError("owner_scope_required", 403);
  return principal.ownerId;
}

export function requireScope(request: FastifyRequest, scope: string) {
  const principal = principalFromRequest(request);
  // Development/test mode is explicitly unscoped; production cannot reach it.
  if (principal.mode === "disabled") return principal;
  if (!principal.scopes.includes(scope)) {
    throw new AuthzError("insufficient_scope", 403);
  }
  return principal;
}

export function createApiAuthHook(config: AuthConfig) {
  return async function apiAuthHook(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const url = request.raw.url ?? "";
    if (!url.startsWith("/api/")) {
      return;
    }

    const cronSecret = process.env.CRON_SECRET?.trim();
    const path = url.split("?")[0] ?? "";
    if (/(^|\/)cron(\/|$)/.test(path) && cronSecret && request.headers.authorization === `Bearer ${cronSecret}`) {
      request.principal = {
        ownerId: null,
        clientId: null,
        mode: "cron",
        scopes: ["jobs"],
        authenticated: true,
      };
      return;
    }

    if (!isAuthEnabled(config)) {
      if (isAuthRequired()) {
        return reply.status(503).send({
          error: "auth_not_configured",
          message: "API authentication is required but no credentials are configured",
        });
      }
      const result = resolveAuthContext(request.headers, config) as AuthContext;
      request.principal = result;
      return;
    }

    const spoofed = rejectedOwnerHeader(request.headers);
    if (spoofed) {
      return reply.status(spoofed.statusCode).send({
        error: spoofed.error,
        message: spoofed.message,
      });
    }

    const result = resolveAuthContext(request.headers, config);
    if ("ok" in result && !result.ok) {
      return reply.status(result.statusCode).send({
        error: result.error,
        message: result.message,
      });
    }

    request.principal = result as AuthContext;
  };
}
