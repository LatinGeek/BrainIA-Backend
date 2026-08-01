import type { IncomingHttpHeaders } from "node:http";
import type { FastifyReply, FastifyRequest } from "fastify";

export const API_KEY_HEADER = "x-brainia-api-key";
export const CLIENT_ID_HEADER = "x-brainia-client-id";

export type AuthConfig = {
  globalApiKey: string | null;
  clientKeys: Map<string, string>;
};

export type AuthContext = {
  clientId: string | null;
  mode: "disabled" | "global" | "client";
};

export type AuthFailure = {
  ok: false;
  statusCode: 401 | 403;
  error: string;
  message: string;
};

export type AuthResult = AuthContext | AuthFailure;

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

export function resolveAuthContext(
  headers: IncomingHttpHeaders,
  config: AuthConfig,
): AuthResult {
  if (!isAuthEnabled(config)) {
    return {
      clientId: null,
      mode: "disabled",
    };
  }

  const clientId = readHeader(headers, CLIENT_ID_HEADER);
  const apiKey = readHeader(headers, API_KEY_HEADER);

  if (config.clientKeys.size > 0) {
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

    if (apiKey !== expectedKey) {
      return {
        ok: false,
        statusCode: 401,
        error: "invalid_api_key",
        message: `Invalid ${API_KEY_HEADER} header`,
      };
    }

    return {
      clientId,
      mode: "client",
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

  return {
    clientId,
    mode: "global",
  };
}

export function createApiAuthHook(config: AuthConfig) {
  return async function apiAuthHook(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    if (!isAuthEnabled(config)) {
      return;
    }

    const url = request.raw.url ?? "";
    if (!url.startsWith("/api/")) {
      return;
    }

    const cronSecret = process.env.CRON_SECRET?.trim();
    if (url.includes("/cron/") && cronSecret && request.headers.authorization === `Bearer ${cronSecret}`) {
      return;
    }

    const result = resolveAuthContext(request.headers, config);
    if ("ok" in result && !result.ok) {
      return reply.status(result.statusCode).send({
        error: result.error,
        message: result.message,
      });
    }
  };
}
