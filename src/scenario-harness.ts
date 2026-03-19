import { HachikaEngine } from "./engine.js";
import { createInitialSnapshot } from "./state.js";
import type { HachikaSnapshot, SelfModel, TurnResult } from "./types.js";

export interface UserScenarioStep {
  kind: "user";
  label: string;
  input: string;
}

export interface IdleScenarioStep {
  kind: "idle";
  label: string;
  hours: number;
}

export interface ProactiveScenarioStep {
  kind: "proactive";
  label: string;
  force?: boolean;
  now?: Date;
}

export type ScenarioStep = UserScenarioStep | IdleScenarioStep | ProactiveScenarioStep;

interface ScenarioEventBase {
  label: string;
  snapshot: HachikaSnapshot;
  selfModel: SelfModel;
}

export interface UserScenarioEvent extends ScenarioEventBase {
  kind: "user";
  input: string;
  reply: string;
  debug: TurnResult["debug"];
}

export interface IdleScenarioEvent extends ScenarioEventBase {
  kind: "idle";
  hours: number;
}

export interface ProactiveScenarioEvent extends ScenarioEventBase {
  kind: "proactive";
  force: boolean;
  message: string | null;
}

export type ScenarioEvent =
  | UserScenarioEvent
  | IdleScenarioEvent
  | ProactiveScenarioEvent;

export interface ScenarioRun {
  initialSnapshot: HachikaSnapshot;
  events: ScenarioEvent[];
  finalSnapshot: HachikaSnapshot;
}

export function runScenario(
  steps: readonly ScenarioStep[],
  initialSnapshot: HachikaSnapshot = createInitialSnapshot(),
): ScenarioRun {
  const engine = new HachikaEngine(initialSnapshot);
  const events: ScenarioEvent[] = [];

  for (const step of steps) {
    if (step.kind === "user") {
      const result = engine.respond(step.input);
      events.push({
        kind: "user",
        label: step.label,
        input: step.input,
        reply: result.reply,
        debug: result.debug,
        snapshot: result.snapshot,
        selfModel: result.debug.selfModel,
      });
      continue;
    }

    if (step.kind === "idle") {
      engine.rewindIdleHours(step.hours);
      events.push({
        kind: "idle",
        label: step.label,
        hours: step.hours,
        snapshot: engine.getSnapshot(),
        selfModel: engine.getSelfModel(),
      });
      continue;
    }

    const options: { force?: boolean; now?: Date } = {};
    if (step.force !== undefined) {
      options.force = step.force;
    }
    if (step.now !== undefined) {
      options.now = step.now;
    }
    const message = engine.emitInitiative(options);
    events.push({
      kind: "proactive",
      label: step.label,
      force: step.force ?? false,
      message,
      snapshot: engine.getSnapshot(),
      selfModel: engine.getSelfModel(),
    });
  }

  return {
    initialSnapshot: structuredClone(initialSnapshot),
    events,
    finalSnapshot: engine.getSnapshot(),
  };
}

export function requireScenarioEvent(
  run: ScenarioRun,
  label: string,
): ScenarioEvent;
export function requireScenarioEvent<K extends ScenarioEvent["kind"]>(
  run: ScenarioRun,
  label: string,
  kind: K,
): Extract<ScenarioEvent, { kind: K }>;
export function requireScenarioEvent<K extends ScenarioEvent["kind"]>(
  run: ScenarioRun,
  label: string,
  kind?: K,
): ScenarioEvent {
  const event = run.events.find((candidate) => candidate.label === label);

  if (!event) {
    throw new Error(`scenario event "${label}" was not found`);
  }

  if (kind && event.kind !== kind) {
    throw new Error(`scenario event "${label}" was ${event.kind}, expected ${kind}`);
  }

  return event;
}
