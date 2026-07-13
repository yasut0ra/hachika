const messagesNode = document.getElementById("messages");
const avatarStageNode = document.getElementById("avatar-stage");
const avatarActionNode = document.getElementById("avatar-action");
const avatarSummaryNode = document.getElementById("avatar-summary");
const avatarPlaceNode = document.getElementById("avatar-place");
const avatarPostureNode = document.getElementById("avatar-posture");
const avatarGazeNode = document.getElementById("avatar-gaze");
const conversationPlaceNode = document.getElementById("conversation-place");
const conversationCountNode = document.getElementById("conversation-count");
const stateNode = document.getElementById("state-metrics");
const worldNode = document.getElementById("world-panel");
const identityNode = document.getElementById("identity-panel");
const diagnosticsNode = document.getElementById("diagnostics-panel");
const growthNode = document.getElementById("growth-metrics");
const tracesNode = document.getElementById("traces-panel");
const artifactsNode = document.getElementById("artifacts-panel");
const connectionNode = document.getElementById("connection-status");
const flashNode = document.getElementById("flash");
const composer = document.getElementById("composer");
const messageInput = document.getElementById("message-input");
const proactiveButton = document.getElementById("proactive-button");
const idleButton = document.getElementById("idle-button");
const idleHoursInput = document.getElementById("idle-hours");
const observeButton = document.getElementById("observe-button");
const closeObserveButton = document.getElementById("close-observe-button");
const observatoryNode = document.getElementById("observatory");
const resetButton = document.getElementById("reset-button");
const UI_POLL_INTERVAL_MS = 4000;

let currentUi = null;
let knownAutonomousIds = new Set();
let flashTimer = null;
let renderedMessageKeys = null;
let displayedAvatarGaze = null;
let pendingAvatarGaze = null;
let avatarGazeTimer = null;
let displayedAvatarGesture = null;
let avatarGestureTimer = null;
let lastAvatarActionId = null;
let avatarActionFrame = null;
let avatarActionTimer = null;

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "request_failed");
  }

  return payload;
}

function setFlash(text, kind = "info") {
  if (flashTimer !== null) {
    window.clearTimeout(flashTimer);
    flashTimer = null;
  }

  flashNode.textContent = text;
  flashNode.dataset.kind = kind;

  if (text) {
    flashTimer = window.setTimeout(() => {
      flashNode.textContent = "";
      flashTimer = null;
    }, kind === "error" ? 8000 : 4000);
  }
}

function render(ui, options = {}) {
  const announceAutonomy = options.announceAutonomy === true;
  const newAutonomous = syncAutonomousFeed(ui.autonomousFeed, announceAutonomy);
  currentUi = ui;
  setConnectionState(true);
  conversationCountNode.textContent = `${ui.summary.conversationCount} turns`;
  renderAvatar(ui.embodiment);
  renderMessages(ui.memories);
  renderState(ui.summary);
  renderWorld(ui.summary.world);
  renderIdentity(ui.summary, ui.selfModel);
  renderDiagnostics(ui.diagnostics, ui.summary.residentLoop, ui.summary.residentLoopHealth);
  renderGrowth(ui.growth);
  renderTraces(ui.traces);
  renderArtifacts(ui.artifacts);

  if (newAutonomous.length > 0) {
    setFlash("Hachikaが話しかけました");
  }
}

function renderAvatar(embodiment) {
  if (!embodiment) {
    return;
  }

  avatarStageNode.dataset.place = embodiment.place;
  avatarStageNode.dataset.phase = embodiment.phase;
  avatarStageNode.dataset.posture = embodiment.posture;
  avatarStageNode.dataset.action = embodiment.action;
  const motion = embodiment.motion ?? {
    manner: "measured",
    gestureAmplitude: 0.4,
    gazePersistence: 0.5,
    stillness: 0.5,
    settlingTimeMs: 1400,
  };
  avatarStageNode.dataset.manner = motion.manner;
  const postureScale = embodiment.posture === "withdrawn" ? 0.94 : 1;
  avatarStageNode.style.setProperty(
    "--avatar-scale",
    ((0.82 + clamp01(embodiment.proximity) * 0.16) * postureScale).toFixed(3),
  );
  avatarStageNode.style.setProperty(
    "--breath-scale",
    (1.002 + clamp01(embodiment.breathDepth) * 0.009).toFixed(4),
  );
  avatarStageNode.style.setProperty(
    "--motion-duration",
    `${(7.2 - clamp01(embodiment.movementTempo) * 3.4).toFixed(2)}s`,
  );
  avatarStageNode.style.setProperty(
    "--avatar-brightness",
    (0.88 + clamp01(embodiment.expressionWarmth) * 0.18).toFixed(3),
  );
  avatarStageNode.style.setProperty(
    "--avatar-saturation",
    (0.82 + clamp01(embodiment.alertness) * 0.24).toFixed(3),
  );
  avatarStageNode.style.setProperty(
    "--settle-duration",
    `${Math.max(400, Number(motion.settlingTimeMs) || 1400)}ms`,
  );
  avatarStageNode.style.setProperty(
    "--gaze-duration",
    `${(2.2 + clamp01(motion.gazePersistence) * 2.4).toFixed(2)}s`,
  );
  const mannerDirection = {
    reaching: 1,
    measured: 0.35,
    guarded: -0.2,
    searching: -1,
  }[motion.manner] ?? 0.35;
  const sway = clamp01(motion.gestureAmplitude) * (1 - clamp01(motion.stillness) * 0.55);
  avatarStageNode.style.setProperty(
    "--sway-x",
    `${(mannerDirection * sway * 3.2).toFixed(2)}px`,
  );
  avatarStageNode.style.setProperty(
    "--sway-angle",
    `${(mannerDirection * sway * 0.38).toFixed(3)}deg`,
  );
  renderAvatarGaze(embodiment.gazeTarget, embodiment.action, motion);
  renderAvatarGesture(embodiment.action, embodiment.actionId, motion);
  avatarActionNode.textContent = embodiment.action;
  avatarSummaryNode.textContent = embodiment.summary;
  avatarPlaceNode.textContent = `${embodiment.place} · ${embodiment.phase}`;
  conversationPlaceNode.textContent = `${embodiment.place} · ${embodiment.phase}`;
  avatarPostureNode.textContent = embodiment.posture;
}

function renderAvatarGaze(nextGaze, action, motion) {
  if (displayedAvatarGaze === null) {
    applyAvatarGaze(nextGaze);
    return;
  }

  if (nextGaze === displayedAvatarGaze) {
    cancelPendingAvatarGaze();
    return;
  }

  if (nextGaze === pendingAvatarGaze) {
    return;
  }

  cancelPendingAvatarGaze();
  pendingAvatarGaze = nextGaze;
  const delay =
    action === "speak" && nextGaze === "viewer"
      ? 80
      : 180 + clamp01(motion.gazePersistence) * 1200;
  avatarGazeTimer = window.setTimeout(() => {
    applyAvatarGaze(nextGaze);
    pendingAvatarGaze = null;
    avatarGazeTimer = null;
  }, delay);
}

function applyAvatarGaze(gaze) {
  displayedAvatarGaze = gaze;
  avatarStageNode.dataset.gaze = gaze;
  avatarGazeNode.textContent = `gaze · ${gaze}`;
}

function cancelPendingAvatarGaze() {
  if (avatarGazeTimer !== null) {
    window.clearTimeout(avatarGazeTimer);
    avatarGazeTimer = null;
  }
  pendingAvatarGaze = null;
}

function renderAvatarGesture(action, actionId, motion) {
  avatarStageNode.dataset.action = action;
  avatarStageNode.dataset.actionId = actionId || "rest";

  if (displayedAvatarGesture === null) {
    applyAvatarGesture(action);
  } else if (action !== "rest") {
    cancelAvatarGestureTimer();
    applyAvatarGesture(action);
  } else if (displayedAvatarGesture !== "rest" && avatarGestureTimer === null) {
    avatarGestureTimer = window.setTimeout(() => {
      applyAvatarGesture("rest");
      avatarGestureTimer = null;
    }, Math.max(400, Number(motion.settlingTimeMs) || 1400));
  }

  if (action !== "rest" && actionId && actionId !== lastAvatarActionId) {
    replayAvatarAction(actionId, motion);
  }
  lastAvatarActionId = actionId;
}

function applyAvatarGesture(gesture) {
  displayedAvatarGesture = gesture;
  avatarStageNode.dataset.gesture = gesture;
}

function cancelAvatarGestureTimer() {
  if (avatarGestureTimer !== null) {
    window.clearTimeout(avatarGestureTimer);
    avatarGestureTimer = null;
  }
}

function replayAvatarAction(actionId, motion) {
  if (avatarActionFrame !== null) {
    window.cancelAnimationFrame(avatarActionFrame);
  }
  if (avatarActionTimer !== null) {
    window.clearTimeout(avatarActionTimer);
  }

  avatarStageNode.classList.remove("avatar-action-enter");
  avatarStageNode.style.setProperty(
    "--gesture-amplitude",
    (0.65 + clamp01(motion.gestureAmplitude) * 0.7).toFixed(3),
  );
  avatarActionFrame = window.requestAnimationFrame(() => {
    avatarStageNode.classList.add("avatar-action-enter");
    avatarActionFrame = null;
    avatarActionTimer = window.setTimeout(() => {
      avatarStageNode.classList.remove("avatar-action-enter");
      avatarActionTimer = null;
    }, 1200);
  });
}

function renderMessages(memories) {
  const visibleMemories = memories.slice(-14);
  const nextKeys = buildMessageKeys(visibleMemories);

  // Polling で同じ state が返った時は、チャット DOM と scroll に一切触れない。
  if (
    renderedMessageKeys !== null &&
    renderedMessageKeys.length === nextKeys.length &&
    renderedMessageKeys.every((key, index) => key === nextKeys[index])
  ) {
    return;
  }

  const initialRender = renderedMessageKeys === null;
  const wasNearBottom =
    messagesNode.scrollHeight - messagesNode.scrollTop - messagesNode.clientHeight < 48;
  const existingCards = new Map(
    [...messagesNode.querySelectorAll("[data-message-key]")].map((card) => [
      card.dataset.messageKey,
      card,
    ]),
  );
  const desiredKeys = new Set(nextKeys);

  for (const [key, card] of existingCards) {
    if (!desiredKeys.has(key)) {
      card.remove();
      existingCards.delete(key);
    }
  }

  if (visibleMemories.length === 0) {
    messagesNode.replaceChildren(createEmptyConversation());
    renderedMessageKeys = nextKeys;
    return;
  }

  messagesNode.querySelector(".empty")?.remove();

  let cursor = messagesNode.firstElementChild;
  for (let index = 0; index < visibleMemories.length; index += 1) {
    const memory = visibleMemories[index];
    const key = nextKeys[index];
    const card = existingCards.get(key) ?? createMessageCard(memory, key);

    if (card !== cursor) {
      messagesNode.insertBefore(card, cursor);
    }
    cursor = card.nextElementSibling;
  }

  renderedMessageKeys = nextKeys;

  if (initialRender || wasNearBottom) {
    messagesNode.scrollTop = messagesNode.scrollHeight;
  }
}

function buildMessageKeys(memories) {
  const occurrences = new Map();

  return memories.map((memory) => {
    const base = JSON.stringify([
      memory.timestamp,
      memory.role,
      memory.text,
      memory.topics,
    ]);
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    return `${base}::${occurrence}`;
  });
}

function createMessageCard(memory, key) {
  const card = document.createElement("article");
  card.className = `message ${memory.role}`;
  card.dataset.messageKey = key;

  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = `${memory.role === "hachika" ? "hachika" : "you"}${
    memory.topics.length ? ` · ${memory.topics.join(", ")}` : ""
  }`;

  const body = document.createElement("p");
  body.textContent = memory.text;
  card.append(meta, body);
  return card;
}

function createEmptyConversation() {
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent = "まだ会話はありません。";
  return empty;
}

function renderState(summary) {
  const sections = [
    ["Drive", summary.state],
    ["Body", summary.body],
    ["Reactivity", summary.reactivity],
    ["Temperament", summary.temperament],
  ];

  stateNode.innerHTML = "";

  for (const [label, values] of sections) {
    const block = document.createElement("section");
    block.className = "metric-block";
    block.innerHTML = `<h3>${label}</h3>`;

    for (const [key, value] of Object.entries(values)) {
      const row = document.createElement("div");
      row.className = "metric-row";
      row.innerHTML = `
        <span>${key}</span>
        <span class="metric-track"><i style="width:${(clamp01(value) * 100).toFixed(1)}%"></i></span>
        <strong>${formatNumber(value)}</strong>
      `;
      block.append(row);
    }

    stateNode.append(block);
  }

  const footer = document.createElement("section");
  footer.className = "metric-block";
  footer.innerHTML = `
    <h3>Frame</h3>
    <div class="metric-row simple"><span>attachment</span><strong>${formatNumber(summary.attachment)}</strong></div>
    <div class="metric-row simple"><span>conversations</span><strong>${summary.conversationCount}</strong></div>
    <div class="metric-row simple"><span>last interaction</span><strong>${summary.lastInteractionAt ?? "none"}</strong></div>
    <div class="metric-row simple"><span>resident loop</span><strong>${formatResidentLoop(summary.residentLoop, summary.residentLoopHealth)}</strong></div>
  `;
  stateNode.append(footer);
}

function renderIdentity(summary, selfModel) {
  identityNode.innerHTML = "";
  identityNode.append(
    stackCard("Identity", summary.identity.summary),
    stackCard("Arc", summary.identity.currentArc),
    stackCard("Traits", summary.identity.traits.join(", ") || "none"),
    stackCard("Anchors", summary.identity.anchors.join(", ") || "none"),
    stackCard(
      "Purpose",
      summary.purpose.active
        ? `${summary.purpose.active.kind}${summary.purpose.active.topic ? ` · ${summary.purpose.active.topic}` : ""}`
        : "none",
    ),
    stackCard(
      "Pending",
      summary.pendingInitiative
        ? `${summary.pendingInitiative.kind}${
            summary.pendingInitiative.topic ? ` · ${summary.pendingInitiative.topic}` : ""
          }`
        : "none",
    ),
    stackCard("Narrative", selfModel.narrative),
  );
}

function renderWorld(world) {
  worldNode.innerHTML = "";

  const events =
    world.recentEvents.length > 0
      ? world.recentEvents
          .slice(-4)
          .reverse()
          .map((event) => `${event.kind} · ${event.place} · ${event.summary}`)
          .join("<br />")
      : "none";

  const objects = Object.entries(world.objects)
    .map(
      ([id, object]) =>
        `${id}@${object.place} · ${object.state}${
          object.linkedTraceTopics?.length ? ` · traces ${object.linkedTraceTopics.join(", ")}` : ""
        }`,
    )
    .join("<br />");

  worldNode.append(
    stackCard("Clock", `${formatWorldClock(world.clockHour)} · ${world.phase}`),
    stackCard("Current Place", world.currentPlace),
    stackCard(
      "Places",
      Object.entries(world.places)
        .map(
          ([place, state]) =>
            `${place} · warmth ${formatNumber(state.warmth)} · quiet ${formatNumber(state.quiet)}`,
        )
        .join("<br />"),
    ),
    stackCard("Objects", objects || "none"),
    stackCard("Recent Events", events),
  );
}

function renderDiagnostics(diagnostics, residentLoop, residentLoopHealth) {
  diagnosticsNode.innerHTML = "";
  diagnosticsNode.append(
    stackCard("Resident Loop", formatResidentLoopDetail(residentLoop, residentLoopHealth)),
    stackCard("Last Reply", formatGenerated(diagnostics.lastReply)),
    stackCard("Last Response", formatGenerated(diagnostics.lastResponse)),
    stackCard("Last Proactive", formatGenerated(diagnostics.lastProactive)),
    stackCard("Interpretation", formatInterpretation(diagnostics.lastInterpretation)),
    stackCard("Trace", formatTrace(diagnostics.lastTrace)),
  );
}

function renderGrowth(growth) {
  growthNode.innerHTML = "";

  const block = document.createElement("section");
  block.className = "metric-block";
  block.innerHTML = "<h3>Live Signals</h3>";

  const rows = [
    ["state saturation", formatNumber(growth.stateSaturationRatio)],
    ["archive reopen", formatNumber(growth.archiveReopenRate)],
    ["archived trace share", formatNumber(growth.archivedTraceShare)],
    ["activity count", String(growth.autonomousActivityCount)],
    ["recent activity", String(growth.recentAutonomousActivityCount)],
    ["idle consolidation", formatNumber(growth.idleConsolidationShare)],
    ["proactive maintenance", formatNumber(growth.proactiveMaintenanceRate)],
    ["silent internal action", formatNumber(growth.silentInternalActionRate)],
    ["outward action", formatNumber(growth.outwardActionRate)],
    ["world action diversity", formatNumber(growth.worldActionDiversity)],
    ["initiative conversion", formatNumber(growth.initiativeToActionConversion)],
    ["recent generated", String(growth.recentGeneratedCount)],
    ["generation fallback", formatNumber(growth.generationFallbackRate)],
    ["generation overlap", formatNumber(growth.generationAverageOverlap)],
    ["generation abstract", formatNumber(growth.generationAbstractRatio)],
    ["generation concrete", formatNumber(growth.generationConcreteDetail)],
    ["generation echo", formatNumber(growth.generationOpenerEchoRate)],
    [
      "generation focus",
      growth.generationFocusMentionRate === null
        ? "n/a"
        : formatNumber(growth.generationFocusMentionRate),
    ],
  ];

  for (const [label, value] of rows) {
    const row = document.createElement("div");
    row.className = "metric-row simple";
    row.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    block.append(row);
  }

  growthNode.append(block);
}

function renderTraces(traces) {
  tracesNode.innerHTML = "";

  if (traces.length === 0) {
    tracesNode.innerHTML = '<p class="empty">trace はまだありません。</p>';
    return;
  }

  for (const trace of traces) {
    const card = document.createElement("article");
    card.className = "trace-card";
    card.innerHTML = `
      <header>
        <strong>${trace.topic}</strong>
        <span>${trace.kind} / ${trace.status} / ${trace.tending}</span>
      </header>
      <p>${trace.summary}</p>
      <div class="mini-grid">
        <span>focus: ${trace.focus ?? "none"}</span>
        <span>confidence: ${formatNumber(trace.confidence)}</span>
        <span>lifecycle: ${trace.lifecycle}</span>
        <span>stale: ${trace.effectiveStaleAt ?? trace.staleAt ?? "none"}</span>
        <span>place: ${trace.place ?? "none"}</span>
        <span>object: ${trace.objectId ?? "none"}</span>
      </div>
      <div class="chips">${trace.blockers.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
    `;
    tracesNode.append(card);
  }
}

function renderArtifacts(artifacts) {
  artifactsNode.innerHTML = "";

  if (artifacts.length === 0) {
    artifactsNode.innerHTML = '<p class="empty">artifact はまだ materialize されていません。</p>';
    return;
  }

  for (const artifact of artifacts.slice(0, 14)) {
    const card = document.createElement("article");
    card.className = "artifact-card";
    card.innerHTML = `
      <header>
        <strong>${artifact.topic}</strong>
        <span>${artifact.tending} / ${artifact.lifecyclePhase}</span>
      </header>
      <p>${artifact.relativePath}</p>
      <div class="mini-grid">
        <span>focus: ${artifact.focus ?? "none"}</span>
        <span>confidence: ${formatNumber(artifact.confidence)}</span>
        <span>pending: ${artifact.pendingNextStep ?? "none"}</span>
        <span>updated: ${artifact.updatedAt}</span>
        <span>place: ${artifact.place ?? "none"}</span>
        <span>object: ${artifact.objectId ?? "none"}</span>
      </div>
    `;
    artifactsNode.append(card);
  }
}

function syncAutonomousFeed(feed, announce) {
  const nextIds = new Set(feed.map((entry) => entry.id));

  if (!announce) {
    knownAutonomousIds = nextIds;
    return [];
  }

  const newEntries = feed.filter((entry) => !knownAutonomousIds.has(entry.id));
  knownAutonomousIds = nextIds;
  return newEntries;
}

function stackCard(label, value) {
  const card = document.createElement("section");
  card.className = "stack-card";
  card.innerHTML = `<h3>${label}</h3><p>${value || "none"}</p>`;
  return card;
}

function formatGenerated(debug) {
  if (!debug) {
    return "none";
  }

  const planner = `planner:${debug.plannerSource}`;
  const quality = debug.quality ? ` · ${debug.quality.summary}` : "";
  const retry =
    typeof debug.retryAttempts === "number" && debug.retryAttempts > 1
      ? ` · retry ${debug.retryAttempts}`
      : "";
  return `${debug.mode}:${debug.source}${debug.provider ? ` via:${debug.provider}` : ""}${
    debug.fallbackUsed ? " fallback" : ""
  }${retry}${debug.plan ? ` · ${debug.plan}` : ""} · ${planner}${quality}`;
}

function formatInterpretation(debug) {
  if (!debug) {
    return "none";
  }

  return `${debug.source}${debug.provider ? ` via:${debug.provider}` : ""} · ${
    debug.summary
  } · local:${debug.localTopics.join(", ") || "none"} · final:${debug.topics.join(", ") || "none"}`;
}

function formatTrace(debug) {
  if (!debug) {
    return "none";
  }

  return `${debug.source}${debug.provider ? ` via:${debug.provider}` : ""} · ${
    debug.summary
  } · extract:${debug.topics.join(", ") || "none"} · state:${
    debug.stateTopics.join(", ") || "none"
  }${debug.adoptedTopics.length ? ` · add:${debug.adoptedTopics.join(", ")}` : ""}${
    debug.droppedTopics.length ? ` · drop:${debug.droppedTopics.join(", ")}` : ""
  }`;
}

function formatResidentLoop(status, health) {
  if (!status) {
    return "none";
  }

  const state = health?.state ?? (status.active ? "active" : "inactive");
  const heartbeat = status.heartbeatAt ? ` · beat ${status.heartbeatAt}` : "";
  const proactive = status.lastProactiveAt ? ` · proactive ${status.lastProactiveAt}` : "";
  const attempts =
    typeof status.lastTickAttempts === "number" && status.lastTickAttempts > 1
      ? ` · retry ${status.lastTickAttempts}`
      : "";
  const error = status.lastError ? ` · err ${status.lastError}` : "";
  return `${state}${heartbeat}${proactive}${attempts}${error}`;
}

function formatResidentLoopDetail(status, health) {
  if (!status) {
    return "none";
  }

  const summary = [
    health?.state ?? (status.active ? "active" : "inactive"),
    status.pid !== null ? `pid ${status.pid}` : null,
    status.heartbeatAt ? `beat ${status.heartbeatAt}` : null,
    health?.heartbeatAgeMs !== null && health?.heartbeatAgeMs !== undefined
      ? `age ${formatDurationMs(health.heartbeatAgeMs)}`
      : null,
    health?.staleAfterMs !== null && health?.staleAfterMs !== undefined
      ? `stale after ${formatDurationMs(health.staleAfterMs)}`
      : null,
    status.lastTickAt ? `tick ${status.lastTickAt}` : null,
    status.lastActivityAt ? `activity ${status.lastActivityAt}` : null,
    status.lastInternalAt ? `internal ${status.lastInternalAt}` : null,
    status.lastProactiveAt ? `proactive ${status.lastProactiveAt}` : null,
    typeof status.lastTickAttempts === "number" ? `attempts ${status.lastTickAttempts}` : null,
    status.config
      ? `interval ${status.config.intervalMs}ms / idle ${status.config.idleHoursPerTick}h`
      : null,
    status.lastInternalActivities.length > 0
      ? `internal recent ${status.lastInternalActivities.slice(-2).join(" | ")}`
      : null,
    status.lastActivities.length > 0
      ? `recent ${status.lastActivities.slice(-2).join(" | ")}`
      : null,
    status.lastError ? `error ${status.lastError}` : null,
    status.stoppedAt ? `stopped ${status.stoppedAt}` : null,
  ].filter(Boolean);

  return summary.join(" · ");
}

function formatNumber(value) {
  return typeof value === "number" ? value.toFixed(2) : String(value);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

function setConnectionState(online) {
  connectionNode.dataset.state = online ? "online" : "offline";
  const label = connectionNode.querySelector("span");
  if (label) {
    label.textContent = online ? "local" : "offline";
  }
}

function setObservatoryOpen(open) {
  observatoryNode.hidden = !open;
  observeButton.setAttribute("aria-expanded", String(open));
  observeButton.classList.toggle("is-active", open);

  if (open) {
    observatoryNode.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function formatDurationMs(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }

  if (ms < 3600000) {
    return `${(ms / 60000).toFixed(1)}m`;
  }

  return `${(ms / 3600000).toFixed(1)}h`;
}

function formatWorldClock(clockHour) {
  const hours = Math.floor(clockHour);
  const minutes = Math.round((clockHour - hours) * 60);
  const normalizedMinutes = minutes === 60 ? 0 : minutes;
  const normalizedHours = minutes === 60 ? (hours + 1) % 24 : hours;
  return `${String((normalizedHours + 24) % 24).padStart(2, "0")}:${String(normalizedMinutes).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();

  if (!text) {
    return;
  }

  setFlash("送信中…");

  try {
    const payload = await request("/api/message", {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    render(payload.ui);
    messageInput.value = "";
    setFlash("");
  } catch (error) {
    setFlash(error instanceof Error ? error.message : "send_failed", "error");
  }
});

messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    composer.requestSubmit();
  }
});

observeButton.addEventListener("click", () => {
  setObservatoryOpen(observatoryNode.hidden);
});

closeObserveButton.addEventListener("click", () => {
  setObservatoryOpen(false);
  document.getElementById("top")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

proactiveButton.addEventListener("click", async () => {
  setFlash("呼びかけを待っています…");

  try {
    const payload = await request("/api/proactive", {
      method: "POST",
      body: JSON.stringify({ force: true }),
    });
    render(payload.ui);
    setFlash(payload.message ? "Hachikaが話しかけました" : "今は静かなままです");
  } catch (error) {
    setFlash(error instanceof Error ? error.message : "proactive_failed", "error");
  }
});

idleButton.addEventListener("click", async () => {
  const hours = Number(idleHoursInput.value);
  setFlash("時間を進めています…");

  try {
    const payload = await request("/api/idle", {
      method: "POST",
      body: JSON.stringify({ hours }),
    });
    render(payload.ui);
    setFlash(payload.proactive ? `${payload.hours}h · Hachikaが話しかけました` : `${payload.hours}h進めました`);
  } catch (error) {
    setFlash(error instanceof Error ? error.message : "idle_failed", "error");
  }
});

resetButton.addEventListener("click", async () => {
  if (!window.confirm("Hachikaの状態と記憶をResetしますか？")) {
    return;
  }

  setFlash("Resetしています…");

  try {
    const payload = await request("/api/reset", {
      method: "POST",
      body: JSON.stringify({}),
    });
    render(payload.ui);
    setObservatoryOpen(false);
    setFlash("Resetしました");
  } catch (error) {
    setFlash(error instanceof Error ? error.message : "reset_failed", "error");
  }
});

request("/api/state")
  .then((ui) => {
    render(ui);
    startPolling();
  })
  .catch((error) => {
    setConnectionState(false);
    setFlash(error instanceof Error ? error.message : "initial_load_failed", "error");
  });

function startPolling() {
  window.setInterval(async () => {
    try {
      const ui = await request("/api/state");
      render(ui, { announceAutonomy: true });
    } catch (error) {
      setConnectionState(false);
      setFlash(error instanceof Error ? error.message : "poll_failed", "error");
    }
  }, UI_POLL_INTERVAL_MS);
}
