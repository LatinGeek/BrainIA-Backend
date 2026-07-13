function getBaseUrl() {
  const value = process.env.EXPO_PUBLIC_BRAINIA_API_BASE_URL?.trim();
  if (!value) {
    return "http://localhost:3000";
  }

  return value;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getBaseUrl()}${path}`, {
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${text}`);
  }

  return response.json() as Promise<T>;
}

export async function getMetrics() {
  return requestJson<{
    rawEventsCount: number;
    classifiedEventsCount: number;
    entitiesCount: number;
    relationsCount: number;
    eventEntitiesCount: number;
    eventRelationsCount: number;
  }>("/api/v1/metrics");
}

export async function inspectKnowledge(query: string) {
  return requestJson<{
    query: string;
    summary: string | null;
    summaryAvailable: boolean;
    graphSummary: {
      nodesCount: number;
      relationsCount: number;
      pathCount: number;
      truncated: boolean;
    } | null;
  }>(`/api/v1/agent/inspect?q=${encodeURIComponent(query)}`);
}

export async function captureSample(kind: "note" | "wallet" | "notification" | "email") {
  const payloadByKind = {
    note: {
      id: `note_${Date.now()}`,
      title: "Quick note",
      body: "Captured from mobile shell",
      raw: { origin: "mobile-shell" },
    },
    wallet: {
      id: `wallet_${Date.now()}`,
      merchant: "Spotify",
      amount: "12.40",
      currency: "USD",
      raw: { origin: "mobile-shell" },
    },
    notification: {
      id: `notification_${Date.now()}`,
      appName: "BrainIA",
      title: "Demo notification",
      body: "Captured from mobile shell",
      raw: { origin: "mobile-shell" },
    },
    email: {
      id: `email_${Date.now()}`,
      subject: "Demo email",
      body: "from: demo@example.com\nto: inbox@example.com",
      from: "demo@example.com",
      to: "inbox@example.com",
      raw: { origin: "mobile-shell" },
    },
  } as const;

  const endpointByKind = {
    note: "/api/v1/capture/note",
    wallet: "/api/v1/capture/wallet",
    notification: "/api/v1/capture/notification",
    email: "/api/v1/capture/email",
  } as const;

  return requestJson<{
    id: string;
    source: string;
    inferredKind: string;
  }>(endpointByKind[kind], {
    method: "POST",
    body: JSON.stringify(payloadByKind[kind]),
  });
}
