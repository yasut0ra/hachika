import { HachikaEngine } from "./engine.js";
import type { ReplyGenerator } from "./reply-generator.js";
import type { HachikaSnapshot, InitiativeActivity } from "./types.js";

export interface ResidentLoopTickOptions {
  idleHours: number;
  now?: Date;
  replyGenerator?: ReplyGenerator | null;
}

export interface ResidentLoopTickResult {
  snapshot: HachikaSnapshot;
  proactiveMessage: string | null;
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

  if (idleHours > 0) {
    engine.rewindIdleHours(idleHours);
  }

  const proactiveMessage = options.replyGenerator
    ? await engine.emitInitiativeAsync({
        ...(options.now ? { now: options.now } : {}),
        replyGenerator: options.replyGenerator,
      })
    : engine.emitInitiative(options.now ? { now: options.now } : {});
  const nextSnapshot = engine.getSnapshot();

  return {
    snapshot: nextSnapshot,
    proactiveMessage,
    activities: diffInitiativeHistory(beforeHistory, nextSnapshot.initiative.history ?? []),
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
  return `${activity.kind}${activity.motive ? `/${activity.motive}` : ""}${activity.topic ? `/${activity.topic}` : ""}${activity.traceTopic && activity.traceTopic !== activity.topic ? ` trace:${activity.traceTopic}` : ""}${activity.blocker ? ` blocker:${activity.blocker}` : ""}${activity.maintenanceAction ? ` action:${activity.maintenanceAction}` : ""}${activity.reopened ? " reopened" : ""}${activity.hours !== null ? ` hours:${activity.hours.toFixed(1)}` : ""} ${activity.summary}`;
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

function parsePositiveNumber(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
