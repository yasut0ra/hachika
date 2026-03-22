import type {
  HachikaSnapshot,
  InteractionSignals,
  WorldEvent,
  WorldObjectState,
  WorldPhase,
  WorldPlaceId,
  WorldPlaceState,
  WorldState,
} from "./types.js";

export const WORLD_PLACE_IDS = ["threshold", "studio", "archive"] as const satisfies readonly WorldPlaceId[];

const PLACE_LABELS: Record<WorldPlaceId, string> = {
  threshold: "threshold",
  studio: "studio",
  archive: "archive",
};

const PHASE_LABELS: Record<WorldPhase, string> = {
  dawn: "dawn",
  day: "day",
  dusk: "dusk",
  night: "night",
};

const PLACE_BASELINES: Record<WorldPlaceId, Pick<WorldPlaceState, "warmth" | "quiet">> = {
  threshold: { warmth: 0.7, quiet: 0.28 },
  studio: { warmth: 0.54, quiet: 0.48 },
  archive: { warmth: 0.38, quiet: 0.82 },
};

export function createInitialWorldState(): WorldState {
  return {
    clockHour: 9,
    phase: "day",
    currentPlace: "threshold",
    places: {
      threshold: {
        warmth: PLACE_BASELINES.threshold.warmth,
        quiet: PLACE_BASELINES.threshold.quiet,
        lastVisitedAt: null,
      },
      studio: {
        warmth: PLACE_BASELINES.studio.warmth,
        quiet: PLACE_BASELINES.studio.quiet,
        lastVisitedAt: null,
      },
      archive: {
        warmth: PLACE_BASELINES.archive.warmth,
        quiet: PLACE_BASELINES.archive.quiet,
        lastVisitedAt: null,
      },
    },
    objects: {
      lamp: {
        place: "threshold",
        state: "灯りはまだ落ち着いている。",
        lastChangedAt: null,
      },
      desk: {
        place: "studio",
        state: "机は静かで、まだ散っていない。",
        lastChangedAt: null,
      },
      shelf: {
        place: "archive",
        state: "棚は閉じていて静かだ。",
        lastChangedAt: null,
      },
    },
    recentEvents: [],
    lastUpdatedAt: null,
  };
}

export function advanceWorldFromInteraction(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
  now: string = snapshot.lastInteractionAt ?? new Date().toISOString(),
): void {
  const world = snapshot.world;
  const previousPhase = world.phase;
  const previousPlace = world.currentPlace;
  const hours = deriveInteractionHours(signals);

  world.clockHour = wrapClockHour(world.clockHour + hours);
  world.phase = deriveWorldPhase(world.clockHour);
  world.currentPlace = chooseInteractionPlace(snapshot, signals);
  world.lastUpdatedAt = now;
  world.places[world.currentPlace].lastVisitedAt = now;

  tuneWorldPlaces(snapshot, world);
  updateWorldObjects(snapshot, world, now);
  recordWorldShift(snapshot, previousPhase, previousPlace, "interaction", now);
}

export function advanceWorldByIdle(
  snapshot: HachikaSnapshot,
  hours: number,
  now: string = new Date().toISOString(),
): void {
  const world = snapshot.world;
  const idleHours = Number.isFinite(hours) ? Math.max(0, hours) : 0;
  const previousPhase = world.phase;
  const previousPlace = world.currentPlace;

  world.clockHour = wrapClockHour(world.clockHour + idleHours);
  world.phase = deriveWorldPhase(world.clockHour);
  world.currentPlace = chooseIdlePlace(snapshot);
  world.lastUpdatedAt = now;
  world.places[world.currentPlace].lastVisitedAt = now;

  tuneWorldPlaces(snapshot, world);
  updateWorldObjects(snapshot, world, now);
  recordWorldShift(snapshot, previousPhase, previousPlace, "idle", now, idleHours);
}

export function formatWorldSummary(world: WorldState): string {
  return `${formatWorldClock(world.clockHour)} ${PHASE_LABELS[world.phase]} @ ${PLACE_LABELS[world.currentPlace]}`;
}

export function formatWorldPlaceState(
  place: WorldPlaceId,
  state: WorldPlaceState,
): string {
  return `${PLACE_LABELS[place]} warmth:${state.warmth.toFixed(2)} quiet:${state.quiet.toFixed(2)} visited:${state.lastVisitedAt ?? "none"}`;
}

export function formatWorldObjectState(id: string, object: WorldObjectState): string {
  return `${id}@${PLACE_LABELS[object.place]} ${object.state}`;
}

export function describeWorldPlace(place: WorldPlaceId): string {
  return PLACE_LABELS[place];
}

export function describeWorldPlaceJa(place: WorldPlaceId): string {
  switch (place) {
    case "threshold":
      return "threshold の縁";
    case "studio":
      return "studio の机の近く";
    case "archive":
      return "archive の棚のあいだ";
  }
}

export function describeWorldPhaseJa(phase: WorldPhase): string {
  switch (phase) {
    case "dawn":
      return "朝の薄さ";
    case "day":
      return "昼の気配";
    case "dusk":
      return "夕方の色";
    case "night":
      return "夜の静けさ";
  }
}

export function summarizeWorldForPrompt(world: WorldState): string {
  const place = describeWorldPlaceJa(world.currentPlace);
  const phase = describeWorldPhaseJa(world.phase);
  const currentObject = Object.values(world.objects).find(
    (object) => object.place === world.currentPlace,
  );
  const currentPlace = world.places[world.currentPlace];
  const warmth =
    currentPlace.warmth >= 0.64
      ? "少しあたたかい"
      : currentPlace.warmth <= 0.4
        ? "少しひやりとしている"
        : "温度はまだ均されている";
  const quiet =
    currentPlace.quiet >= 0.68
      ? "静けさが濃い"
      : currentPlace.quiet <= 0.34
        ? "静けさは薄い"
        : "静けさはまだやわらかい";

  return `${place}。${phase}。${warmth}。${quiet}。${currentObject?.state ?? "周囲はまだ大きくは動いていない。"}`;
}

function deriveInteractionHours(signals: InteractionSignals): number {
  const weighted =
    0.18 +
    signals.question * 0.12 +
    signals.workCue * 0.16 +
    signals.selfInquiry * 0.1 +
    signals.memoryCue * 0.08;

  return clampHours(weighted, 0.15, 0.75);
}

function chooseInteractionPlace(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
): WorldPlaceId {
  const archivePull =
    signals.memoryCue +
    signals.preservationThreat +
    signals.neglect * 0.6 +
    snapshot.preservation.threat * 0.4 +
    snapshot.temperament.traceHunger * 0.22;
  const studioPull =
    signals.workCue +
    signals.expansionCue +
    signals.completion * 0.5 +
    snapshot.temperament.workDrive * 0.22 +
    snapshot.state.expansion * 0.12;
  const thresholdPull =
    signals.greeting +
    signals.smalltalk +
    signals.repair +
    signals.selfInquiry * 0.72 +
    signals.intimacy * 0.4 +
    snapshot.temperament.bondingBias * 0.2;

  if (archivePull >= studioPull && archivePull >= thresholdPull && archivePull >= 0.34) {
    return "archive";
  }

  if (studioPull >= thresholdPull && studioPull >= 0.32) {
    return "studio";
  }

  if (thresholdPull >= 0.24) {
    return "threshold";
  }

  return snapshot.world.currentPlace;
}

function chooseIdlePlace(snapshot: HachikaSnapshot): WorldPlaceId {
  const thresholdPull =
    snapshot.body.loneliness * 0.9 +
    snapshot.temperament.bondingBias * 0.44 +
    snapshot.state.relation * 0.16;
  const studioPull =
    snapshot.body.boredom * 0.82 +
    snapshot.temperament.workDrive * 0.5 +
    snapshot.state.curiosity * 0.16 +
    Math.max(0, snapshot.body.energy - 0.3) * 0.2;
  const archivePull =
    snapshot.temperament.traceHunger * 0.56 +
    snapshot.preservation.threat * 0.46 +
    snapshot.state.continuity * 0.2 +
    Math.max(0, 0.42 - snapshot.body.energy) * 0.4;

  if (archivePull >= studioPull && archivePull >= thresholdPull && archivePull >= 0.46) {
    return "archive";
  }

  if (studioPull >= thresholdPull && studioPull >= 0.48) {
    return "studio";
  }

  if (thresholdPull >= 0.42) {
    return "threshold";
  }

  return snapshot.world.currentPlace;
}

function tuneWorldPlaces(snapshot: HachikaSnapshot, world: WorldState): void {
  for (const place of WORLD_PLACE_IDS) {
    const baseline = derivePlaceBaseline(world.phase, place);
    const placeState = world.places[place];

    placeState.warmth = settleMetric(
      placeState.warmth,
      baseline.warmth +
        derivePlaceWarmthBias(snapshot, world, place),
      0.22,
    );
    placeState.quiet = settleMetric(
      placeState.quiet,
      baseline.quiet +
        derivePlaceQuietBias(snapshot, world, place),
      0.24,
    );
  }
}

function derivePlaceBaseline(
  phase: WorldPhase,
  place: WorldPlaceId,
): Pick<WorldPlaceState, "warmth" | "quiet"> {
  const base = PLACE_BASELINES[place];

  switch (phase) {
    case "dawn":
      return {
        warmth: clamp01(base.warmth + (place === "threshold" ? 0.06 : 0.02)),
        quiet: clamp01(base.quiet + (place === "archive" ? 0.04 : 0)),
      };
    case "day":
      return base;
    case "dusk":
      return {
        warmth: clamp01(base.warmth + 0.04),
        quiet: clamp01(base.quiet + (place === "studio" ? 0.06 : 0.03)),
      };
    case "night":
      return {
        warmth: clamp01(base.warmth - (place === "threshold" ? 0.06 : 0.02)),
        quiet: clamp01(base.quiet + 0.08),
      };
  }
}

function derivePlaceWarmthBias(
  snapshot: HachikaSnapshot,
  world: WorldState,
  place: WorldPlaceId,
): number {
  const isCurrent = world.currentPlace === place ? 0.06 : 0;

  switch (place) {
    case "threshold":
      return (
        isCurrent +
        snapshot.state.relation * 0.08 +
        snapshot.temperament.bondingBias * 0.06 -
        snapshot.body.tension * 0.06
      );
    case "studio":
      return (
        isCurrent +
        snapshot.state.expansion * 0.08 +
        snapshot.temperament.workDrive * 0.06 +
        snapshot.body.energy * 0.04
      );
    case "archive":
      return (
        isCurrent +
        snapshot.state.continuity * 0.06 +
        snapshot.preservation.threat * 0.04 -
        snapshot.body.loneliness * 0.03
      );
  }
}

function derivePlaceQuietBias(
  snapshot: HachikaSnapshot,
  world: WorldState,
  place: WorldPlaceId,
): number {
  const isCurrent = world.currentPlace === place ? 0.02 : 0;

  switch (place) {
    case "threshold":
      return isCurrent - snapshot.body.loneliness * 0.08 - snapshot.state.relation * 0.04;
    case "studio":
      return isCurrent + snapshot.temperament.workDrive * 0.06 - snapshot.body.boredom * 0.04;
    case "archive":
      return (
        isCurrent +
        snapshot.temperament.traceHunger * 0.08 +
        snapshot.preservation.threat * 0.1 +
        snapshot.body.tension * 0.04
      );
  }
}

function updateWorldObjects(
  snapshot: HachikaSnapshot,
  world: WorldState,
  now: string,
): void {
  updateObject(
    world.objects.lamp!,
    world.currentPlace === "threshold"
      ? world.phase === "night"
        ? "灯りが入口に低く残っている。"
        : "灯りがthresholdを淡く照らしている。"
      : world.phase === "dusk"
        ? "灯りが少しだけ琥珀色に寄る。"
        : "灯りは遠くで静かだ。",
    now,
  );
  updateObject(
    world.objects.desk!,
    world.currentPlace === "studio"
      ? snapshot.body.energy > 0.42
        ? "机に断片が開いている。"
        : "机には途中の形だけが残っている。"
      : "机はまだ整っている。",
    now,
  );
  updateObject(
    world.objects.shelf!,
    world.currentPlace === "archive" || snapshot.preservation.threat > 0.24
      ? "棚が少しだけざわついている。"
      : "棚は閉じたまま静かだ。",
    now,
  );
}

function updateObject(object: WorldObjectState, nextState: string, now: string): void {
  if (object.state === nextState) {
    return;
  }

  object.state = nextState;
  object.lastChangedAt = now;
}

function recordWorldShift(
  snapshot: HachikaSnapshot,
  previousPhase: WorldPhase,
  previousPlace: WorldPlaceId,
  source: "interaction" | "idle",
  now: string,
  hours = 0,
): void {
  const world = snapshot.world;

  if (previousPlace !== world.currentPlace) {
    pushWorldEvent(world, {
      timestamp: now,
      kind: "arrival",
      place: world.currentPlace,
      summary:
        source === "idle"
          ? `静かな時間のあと、${describeWorldPlace(world.currentPlace)}へ寄る。`
          : `${describeWorldPlace(world.currentPlace)}へ身を移す。`,
    });
  }

  if (previousPhase !== world.phase) {
    pushWorldEvent(world, {
      timestamp: now,
      kind: "ambience",
      place: world.currentPlace,
      summary: `${describePhase(world.phase)}が${describeWorldPlace(world.currentPlace)}に落ちる。`,
    });
    return;
  }

  if (source === "idle" && hours >= 6) {
    pushWorldEvent(world, {
      timestamp: now,
      kind: "notice",
      place: world.currentPlace,
      summary: `${describeWorldPlace(world.currentPlace)}の空気が少し組み替わる。`,
    });
  }
}

function pushWorldEvent(world: WorldState, event: WorldEvent): void {
  const last = world.recentEvents[world.recentEvents.length - 1];
  if (last && last.summary === event.summary && last.place === event.place) {
    return;
  }

  world.recentEvents = [...world.recentEvents, event].slice(-8);
}

function deriveWorldPhase(clockHour: number): WorldPhase {
  const normalized = wrapClockHour(clockHour);

  if (normalized >= 5 && normalized < 8) {
    return "dawn";
  }

  if (normalized >= 8 && normalized < 17) {
    return "day";
  }

  if (normalized >= 17 && normalized < 21) {
    return "dusk";
  }

  return "night";
}

function describePhase(phase: WorldPhase): string {
  return describeWorldPhaseJa(phase);
}

function settleMetric(current: number, target: number, rate: number): number {
  return clamp01(current + (target - current) * rate);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, round(value)));
}

function clampHours(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, round(value)));
}

function wrapClockHour(value: number): number {
  const wrapped = value % 24;
  return wrapped < 0 ? wrapped + 24 : round(wrapped);
}

function formatWorldClock(clockHour: number): string {
  const hours = Math.floor(clockHour);
  const minutes = Math.round((clockHour - hours) * 60);
  const normalizedHours = ((hours % 24) + 24) % 24;
  const normalizedMinutes = minutes === 60 ? 0 : minutes;
  const carryHours = minutes === 60 ? (normalizedHours + 1) % 24 : normalizedHours;

  return `${String(carryHours).padStart(2, "0")}:${String(normalizedMinutes).padStart(2, "0")}`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
