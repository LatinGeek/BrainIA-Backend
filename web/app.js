const metricGrid = document.getElementById("metric-grid");
const inspectForm = document.getElementById("inspect-form");
const inspectQuery = document.getElementById("inspect-query");
const inspectDepth = document.getElementById("inspect-depth");
const inspectNodes = document.getElementById("inspect-nodes");
const inspectRelations = document.getElementById("inspect-relations");
const inspectResult = document.getElementById("inspect-result");
const statusPill = document.getElementById("status-pill");
const activityLog = document.getElementById("activity-log");
const refreshMetricsButton = document.getElementById("refresh-metrics");

function addActivity(title, meta, kind = "ok") {
  const entry = document.createElement("div");
  entry.className = `activity-entry ${kind}`;
  entry.innerHTML = `
    <div class="activity-title">${title}</div>
    <div class="activity-meta">${meta}</div>
  `;
  activityLog.prepend(entry);
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });

  const requestId = response.headers.get("x-request-id");
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${response.status} ${text}`);
  }

  return {
    data: text ? JSON.parse(text) : null,
    requestId,
  };
}

function renderMetrics(metrics) {
  const cards = [
    ["Raw events", metrics.rawEventsCount],
    ["Classified", metrics.classifiedEventsCount],
    ["Entities", metrics.entitiesCount],
    ["Relations", metrics.relationsCount],
    ["Event links", metrics.eventEntitiesCount + metrics.eventRelationsCount],
  ];

  metricGrid.innerHTML = cards
    .map(
      ([label, value]) => `
        <article class="metric">
          <div class="metric-label">${label}</div>
          <div class="metric-value">${value}</div>
        </article>
      `,
    )
    .join("");
}

function renderInspect(result) {
  inspectResult.innerHTML = `
    <pre>${escapeHtml(
      JSON.stringify(
        {
          resolution: result.resolution,
          graphSummary: result.graphSummary,
          summary: result.summary,
          model: result.model,
        },
        null,
        2,
      ),
    )}</pre>
  `;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function loadMetrics() {
  try {
    const { data, requestId } = await requestJson("/api/v1/metrics");
    renderMetrics(data);
    statusPill.textContent = `Metrics updated ${requestId ? `(${requestId})` : ""}`.trim();
    addActivity("Metrics loaded", requestId ? `Request ${requestId}` : "No request id");
  } catch (error) {
    statusPill.textContent = "Metrics unavailable";
    addActivity("Metrics failed", error instanceof Error ? error.message : "Unknown error", "error");
  }
}

async function runInspect(event) {
  event.preventDefault();

  const params = new URLSearchParams({
    q: inspectQuery.value.trim(),
    depth: inspectDepth.value,
    maxNodes: inspectNodes.value,
    maxRelations: inspectRelations.value,
  });

  try {
    statusPill.textContent = "Inspecting...";
    const { data, requestId } = await requestJson(`/api/v1/agent/inspect?${params.toString()}`);
    renderInspect(data);
    statusPill.textContent = `Inspect complete ${requestId ? `(${requestId})` : ""}`.trim();
    addActivity("Inspect completed", requestId ? `Request ${requestId}` : "No request id");
  } catch (error) {
    statusPill.textContent = "Inspect failed";
    inspectResult.innerHTML = `<p class="muted">${escapeHtml(error instanceof Error ? error.message : "Unknown error")}</p>`;
    addActivity("Inspect failed", error instanceof Error ? error.message : "Unknown error", "error");
  }
}

async function runCapture(kind) {
  const payloads = {
    note: {
      id: `note_${Date.now()}`,
      title: "Dashboard note",
      body: "Captured from web dashboard",
      raw: { origin: "web-dashboard" },
    },
    wallet: {
      id: `wallet_${Date.now()}`,
      merchant: "Spotify",
      amount: "12.40",
      currency: "USD",
      raw: { origin: "web-dashboard" },
    },
    notification: {
      id: `notification_${Date.now()}`,
      appName: "Dashboard",
      title: "Web alert",
      body: "Captured from web dashboard",
      raw: { origin: "web-dashboard" },
    },
    email: {
      id: `email_${Date.now()}`,
      subject: "Web email",
      body: "from: dashboard@example.com\nto: inbox@example.com",
      from: "dashboard@example.com",
      to: "inbox@example.com",
      raw: { origin: "web-dashboard" },
    },
  };

  const endpoints = {
    note: "/api/v1/capture/note",
    wallet: "/api/v1/capture/wallet",
    notification: "/api/v1/capture/notification",
    email: "/api/v1/capture/email",
  };

  try {
    statusPill.textContent = `Sending ${kind} capture...`;
    const { requestId } = await requestJson(endpoints[kind], {
      method: "POST",
      body: JSON.stringify(payloads[kind]),
    });
    await loadMetrics();
    addActivity(`Capture sent: ${kind}`, requestId ? `Request ${requestId}` : "No request id");
  } catch (error) {
    statusPill.textContent = "Capture failed";
    addActivity(`Capture failed: ${kind}`, error instanceof Error ? error.message : "Unknown error", "error");
  }
}

inspectForm?.addEventListener("submit", runInspect);
refreshMetricsButton?.addEventListener("click", loadMetrics);

document.querySelectorAll("[data-capture]").forEach((button) => {
  button.addEventListener("click", () => runCapture(button.getAttribute("data-capture")));
});

loadMetrics();
