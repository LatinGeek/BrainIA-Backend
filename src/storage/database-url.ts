function firstAvailable(...values: Array<string | undefined>) {
  for (const value of values) {
    if (value?.trim()) {
      return value.trim();
    }
  }

  return null;
}

export function resolveRuntimeDatabaseUrl(env: NodeJS.ProcessEnv = process.env) {
  return firstAvailable(env.DATABASE_URL, env.POSTGRES_URL, env.POSTGRES_URL_NO_SSL);
}

export function resolveMigrationDatabaseUrl(env: NodeJS.ProcessEnv = process.env) {
  return firstAvailable(
    env.DATABASE_URL_UNPOOLED,
    env.POSTGRES_URL_NON_POOLING,
    env.DATABASE_URL,
    env.POSTGRES_URL,
    env.POSTGRES_URL_NO_SSL,
  );
}
