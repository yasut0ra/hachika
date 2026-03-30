import { HachikaEngine } from "./engine.js";
import type { AutonomyDirector } from "./autonomy-director.js";
import type { ProactiveDirector } from "./proactive-director.js";
import type { ReplyGenerator } from "./reply-generator.js";
import type { AutonomousFeedEntry, HachikaSnapshot, InitiativeActivity } from "./types.js";

export interface ResidentLoopTickOptions {
  idleHours: number;
  now?: Date;
  autonomyDirector?: AutonomyDirector | null;
  replyGenerator?: ReplyGenerator | null;
  proactiveDirector?: ProactiveDirector | null;
}

export interface ResidentLoopTickResult {
  snapshot: HachikaSnapshot;
  proactiveMessage: string | null;
  internalActivities: InitiativeActivity[];
  outwardActivities: InitiativeActivity[];
  activities: InitiativeActivity[];
}

export interface ResidentLoopConfig {
  intervalMs: number;
  idleHoursPerTick: number;
}

export async function runResidentLoopTick(
  snapshot: HachikaSnapshot,
  options: ResidentLoopTickOptions,
): Promise<ResidentLoopTickResult> {
  const engine = new HachikaEngine(snapshot);
  const beforeHistory = snapshot.initiative.history ?? [];
  const idleHours = Number.isFinite(options.idleHours) ? Math.max(0, options.idleHours) : 0;
  let internalActivities: InitiativeActivity[] = [];

  if (idleHours > 0) {
    if (options.autonomyDirector) {
      await engine.rewindIdleHoursAsync(idleHours, {
        autonomyDirector: options.autonomyDirector,
      });
    } else {
      engine.rewindIdleHours(idleHours);
    }
    const afterIdleSnapshot = engine.getSnapshot();
    internalActivities = diffInitiativeHistory(
      beforeHistory,
      afterIdleSnapshot.initiative.history ?? [],
    );
  }

  const historyBeforeOutward = engine.getSnapshot().initiative.history ?? [];
  const proactiveMessage = options.replyGenerator
    ? await engine.emitInitiativeAsync({
        ...(options.now ? { now: options.now } : {}),
        replyGenerator: options.replyGenerator,
        proactiveDirector: options.proactiveDirector ?? null,
      })
    : engine.emitInitiative(options.now ? { now: options.now } : {});
  const nextSnapshot = engine.getSnapshot();
  const outwardActivities = diffInitiativeHistory(
    historyBeforeOutward,
    nextSnapshot.initiative.history ?? [],
  );
  const activities = [...internalActivities, ...outwardActivities];
  if (proactiveMessage) {
    appendResidentAutonomousMessage(nextSnapshot, proactiveMessage, outwardActivities);
  }

  return {
    snapshot: nextSnapshot,
    proactiveMessage,
    internalActivities,
    outwardActivities,
    activities,
  };
}

export function readResidentLoopConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ResidentLoopConfig {
  return {
    intervalMs: parsePositiveNumber(env.HACHIKA_LOOP_INTERVAL_MS, 15_000),
    idleHoursPerTick: parsePositiveNumber(env.HACHIKA_LOOP_IDLE_HOURS_PER_TICK, 0.5),
  };
}

export function describeResidentLoopConfig(config: ResidentLoopConfig): string {
  return `interval:${config.intervalMs}ms idlePerTick:${config.idleHoursPerTick}h`;
}

export function formatResidentActivity(activity: InitiativeActivity): string {
  return `${activity.autonomyAction ?? "act"} ${activity.kind}${activity.motive ? `/${activity.motive}` : ""}${activity.topic ? `/${activity.topic}` : ""}${activity.traceTopic && activity.traceTopic !== activity.topic ? ` trace:${activity.traceTopic}` : ""}${activity.blocker ? ` blocker:${activity.blocker}` : ""}${activity.maintenanceAction ? ` action:${activity.maintenanceAction}` : ""}${activity.reopened ? " reopened" : ""}${activity.hours !== null ? ` hours:${activity.hours.toFixed(1)}` : ""} ${activity.summary}`;
}

function diffInitiativeHistory(
  previous: InitiativeActivity[],
  current: InitiativeActivity[],
): InitiativeActivity[] {
  if (current.length === 0) {
    return [];
  }

  if (
    previous.length <= current.length &&
    previous.every(
      (activity, index) =>
        initiativeActivityKey(activity) === initiativeActivityKey(current[index]!),
    )
  ) {
    return current.slice(previous.length);
  }

  const previousKeys = new Set(previous.map(initiativeActivityKey));
  return current.filter((activity) => !previousKeys.has(initiativeActivityKey(activity)));
}

function initiativeActivityKey(activity: InitiativeActivity): string {
  return [
    activity.kind,
    activity.autonomyAction ?? "",
    activity.timestamp,
    activity.motive ?? "",
    activity.topic ?? "",
    activity.traceTopic ?? "",
    activity.blocker ?? "",
    activity.maintenanceAction ?? "",
    activity.reopened ? "1" : "0",
    activity.hours ?? "",
    activity.summary,
  ].join("|");
}

function appendResidentAutonomousMessage(
  snapshot: HachikaSnapshot,
  message: string,
  activities: InitiativeActivity[],
): void {
  const proactiveActivity =
    [...activities].reverse().find((activity) => activity.kind === "proactive_emission") ?? null;
  const timestamp = proactiveActivity?.timestamp ?? new Date().toISOString();
  const entry: AutonomousFeedEntry = {
    id: buildAutonomousFeedId(timestamp, message),
    timestamp,
    mode: "proactive",
    source: "resident_loop",
    text: message,
    motive: proactiveActivity?.motive ?? null,
    topic: proactiveActivity?.topic ?? null,
    traceTopic: proactiveActivity?.traceTopic ?? null,
    place: proactiveActivity?.place ?? null,
    worldAction: proactiveActivity?.worldAction ?? null,
  };

  const nextFeed = [...(snapshot.autonomousFeed ?? []), entry].slice(-24);
  const seen = new Set<string>();
  snapshot.autonomousFeed = nextFeed.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

function buildAutonomousFeedId(timestamp: string, message: string): string {
  return `${timestamp}:${message.slice(0, 24)}`;
}

function parsePositiveNumber(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
