const metricGrid = document.getElementById("metric-grid");
const inspectForm = document.getElementById("inspect-form");
const inspectQuery = document.getElementById("inspect-query");
const inspectDepth = document.getElementById("inspect-depth");
const inspectNodes = document.getElementById("inspect-nodes");
const inspectRelations = document.getElementById("inspect-relations");
const inspectResult = document.getElementById("inspect-result");
const graphSummary = document.getElementById("graph-summary");
const graphSvg = document.getElementById("graph-svg");
const graphPaths = document.getElementById("graph-paths");
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

function hashToHue(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
}

function truncate(value, length) {
  if (value.length <= length) {
    return value;
  }

  return `${value.slice(0, Math.max(0, length - 1))}…`;
}

function renderGraph(result) {
  const graph = result?.graph;
  if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    graphSummary.textContent = "No graph available for this inspect result.";
    graphSvg.innerHTML = `
      <text x="50%" y="50%" text-anchor="middle" fill="#92a2bd" font-size="16">
        Run inspect to render a graph.
      </text>
    `;
    graphPaths.innerHTML = `<p class="muted">No paths to display.</p>`;
    return;
  }

  const nodes = graph.nodes.map((node) => ({
    ...node,
    layer: Number.isFinite(node.rootDistance) ? node.rootDistance : Number.isFinite(node.depth) ? node.depth : 0,
  }));
  const maxLayer = Math.max(...nodes.map((node) => node.layer), 0);
  const width = 1400;
  const height = Math.max(460, Math.max(...Array.from({ length: maxLayer + 1 }, (_, depth) => nodes.filter((node) => node.layer === depth).length)) * 90 + 120);
  const nodeWidth = 170;
  const nodeHeight = 56;
  const layerWidth = maxLayer > 0 ? (width - 180) / maxLayer : 0;
  const positions = new Map();
  const layers = Array.from({ length: maxLayer + 1 }, (_, depth) =>
    nodes
      .filter((node) => node.layer === depth)
      .sort((left, right) => left.value.localeCompare(right.value)),
  );

  layers.forEach((layerNodes, depth) => {
    const x = maxLayer === 0 ? width / 2 : 90 + depth * layerWidth;
    const step = height / (layerNodes.length + 1);
    layerNodes.forEach((node, index) => {
      positions.set(node.id, {
        x,
        y: (index + 1) * step,
      });
    });
  });

  const relationMarkup = graph.relations
    .map((relation) => {
      const source = positions.get(relation.sourceEntityId);
      const target = positions.get(relation.targetEntityId);
      if (!source || !target) {
        return "";
      }

      const midX = (source.x + target.x) / 2;
      const curve = `M ${source.x + nodeWidth / 2} ${source.y} C ${midX} ${source.y}, ${midX} ${target.y}, ${target.x - nodeWidth / 2} ${target.y}`;
      const stroke = relation.direction === "outgoing" ? "rgba(56, 189, 248, 0.7)" : "rgba(245, 158, 11, 0.65)";

      return `
        <g class="graph-edge">
          <path d="${curve}" stroke="${stroke}" />
          <title>${escapeHtml(`${relation.explanation} (${relation.relationType})`)}</title>
        </g>
      `;
    })
    .join("");

  const nodeMarkup = nodes
    .map((node) => {
      const position = positions.get(node.id);
      const fillHue = hashToHue(node.type ?? "entity");
      const fill = `hsla(${fillHue}, 84%, 55%, 0.18)`;
      const stroke = `hsla(${fillHue}, 90%, 64%, 0.7)`;
      const isRoot = node.id === graph.rootEntity.id;
      const label = truncate(node.value, 20);
      const typeLabel = truncate(node.type ?? "entity", 18);

      return `
        <g class="graph-node ${isRoot ? "root" : ""}" transform="translate(${position.x}, ${position.y})">
          <rect x="${-nodeWidth / 2}" y="${-nodeHeight / 2}" width="${nodeWidth}" height="${nodeHeight}" rx="18" fill="${fill}" stroke="${stroke}" />
          <text class="graph-node-type" x="0" y="-4" text-anchor="middle">${escapeHtml(typeLabel)}</text>
          <text class="graph-node-label" x="0" y="16" text-anchor="middle">${escapeHtml(label)}</text>
          <title>${escapeHtml(`${node.value} · depth ${node.layer}`)}</title>
        </g>
      `;
    })
    .join("");

  graphSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  graphSvg.innerHTML = `
    <defs>
      <marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(245, 158, 11, 0.9)"></path>
      </marker>
    </defs>
    <g class="graph-edges" marker-end="url(#arrowhead)">${relationMarkup}</g>
    <g class="graph-nodes">${nodeMarkup}</g>
  `;

  const relationList = graph.paths
    .slice(0, 12)
    .map(
      (path) => `
        <article class="graph-path">
          <div class="graph-path-title">${escapeHtml(path.summary)}</div>
          <div class="graph-path-meta">
            ${escapeHtml(path.sourceLabel ?? path.nodeIds[0] ?? "unknown")}
            <span>→</span>
            ${escapeHtml(path.targetLabel ?? path.nodeIds[path.nodeIds.length - 1] ?? "unknown")}
            <span>· depth ${path.depth}</span>
            <span>· ${path.direction}</span>
          </div>
        </article>
      `,
    )
    .join("");

  graphSummary.textContent = `${graph.stats.nodesCount} nodes, ${graph.stats.relationsCount} relations, max depth ${graph.stats.maxDepthReached}${graph.stats.truncated ? ", truncated" : ""}`;
  graphPaths.innerHTML = relationList || `<p class="muted">No graph paths available.</p>`;
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
    renderGraph(data);
    addActivity("Inspect completed", requestId ? `Request ${requestId}` : "No request id");
  } catch (error) {
    statusPill.textContent = "Inspect failed";
    inspectResult.innerHTML = `<p class="muted">${escapeHtml(error instanceof Error ? error.message : "Unknown error")}</p>`;
    renderGraph(null);
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
renderGraph(null);
