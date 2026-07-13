import { syncArtifacts } from "./artifacts.js";
import type { AutonomyDirector } from "./autonomy-director.js";
import { runWithConflictRetry } from "./conflict-retry.js";
import { commitSnapshot, loadSnapshot } from "./persistence.js";
import type { ProactiveDirector } from "./proactive-director.js";
import type { ReplyGenerator } from "./reply-generator.js";
import {
  acquireResidentLoopLock,
  releaseResidentLoopLock,
  saveResidentLoopStatus,
  type ResidentLoopLock,
  type ResidentLoopStatus,
} from "./resident-monitor.js";
import {
  formatResidentActivity,
  runResidentLoopTick,
  type ResidentLoopConfig,
} from "./resident-loop.js";

export interface ResidentLoopRuntimeOptions {
  snapshotPath: string;
  artifactsDir: string;
  lockPath: string;
  statusPath: string;
  config: ResidentLoopConfig;
  replyDescription: string;
  replyGenerator?: ReplyGenerator | null;
  autonomyDirector?: AutonomyDirector | null;
  proactiveDirector?: ProactiveDirector | null;
  pid?: number;
  now?: () => Date;
  log?: (message: string) => void;
  error?: (message: string) => void;
}

export class ResidentLoopRuntime {
  private readonly options: ResidentLoopRuntimeOptions;
  private readonly status: ResidentLoopStatus;
  private lock: ResidentLoopLock | null = null;
  private timer: NodeJS.Timeout | null = null;
  private tickPromise: Promise<void> | null = null;
  private owned = false;
  private stopping = false;

  constructor(options: ResidentLoopRuntimeOptions) {
    this.options = options;
    const startedAt = this.isoNow();
    this.status = {
      active: false,
      pid: options.pid ?? process.pid,
      startedAt,
      heartbeatAt: startedAt,
      lastTickAt: null,
      lastActivityAt: null,
      lastInternalAt: null,
      lastProactiveAt: null,
      lastTickAttempts: null,
      lastError: null,
      lastInternalActivities: [],
      lastActivities: [],
      reply: options.replyDescription,
      config: options.config,
      stoppedAt: null,
    };
  }

  getStatus(): ResidentLoopStatus {
    return structuredClone(this.status);
  }

  async start(): Promise<void> {
    if (this.owned) {
      return;
    }

    this.lock = await acquireResidentLoopLock(
      this.options.lockPath,
      this.options.pid ?? process.pid,
    );
    this.owned = true;
    this.stopping = false;
    this.status.active = true;
    this.status.stoppedAt = null;
    this.status.lastError = null;
    this.status.heartbeatAt = this.isoNow();

    try {
      await this.flushStatus();
    } catch (error) {
      await releaseResidentLoopLock(this.lock);
      this.lock = null;
      this.owned = false;
      throw error;
    }

    this.timer = setInterval(() => {
      void this.tick();
    }, this.options.config.intervalMs);

    void this.tick();
  }

  async tick(): Promise<void> {
    if (!this.owned || this.stopping) {
      return;
    }

    if (this.tickPromise) {
      return this.tickPromise;
    }

    const work = this.executeTick();
    this.tickPromise = work;

    try {
      await work;
    } finally {
      if (this.tickPromise === work) {
        this.tickPromise = null;
      }
    }
  }

  async stop(reason = "shutdown"): Promise<void> {
    if (!this.owned || this.stopping) {
      return;
    }

    this.stopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    await this.tickPromise;

    const stoppedAt = this.isoNow();
    this.status.active = false;
    this.status.heartbeatAt = stoppedAt;
    this.status.stoppedAt = stoppedAt;
    this.status.lastError = this.status.lastError ?? `stopped:${reason}`;

    try {
      await this.flushStatus();
    } finally {
      if (this.lock) {
        await releaseResidentLoopLock(this.lock);
        this.lock = null;
      }
      this.owned = false;
    }
  }

  private async executeTick(): Promise<void> {
    this.status.heartbeatAt = this.isoNow();

    try {
      const outcome = await runWithConflictRetry({
        operate: async () => {
          const snapshot = await loadSnapshot(this.options.snapshotPath);
          return runResidentLoopTick(snapshot, {
            idleHours: this.options.config.idleHoursPerTick,
            autonomyDirector: this.options.autonomyDirector ?? null,
            replyGenerator: this.options.replyGenerator ?? null,
            proactiveDirector: this.options.proactiveDirector ?? null,
          });
        },
        persist: async (result) => {
          const committed = await commitSnapshot(this.options.snapshotPath, result.snapshot);

          if (!committed.ok) {
            return false;
          }

          await syncArtifacts(committed.snapshot, this.options.artifactsDir);
          return true;
        },
      });

      if (!outcome.ok || !outcome.result) {
        this.status.active = true;
        this.status.heartbeatAt = this.isoNow();
        this.status.lastTickAttempts = outcome.attempts;
        this.status.lastError = "snapshot_revision_conflict";
        await this.flushStatus();
        this.options.error?.("[loop] conflict: snapshot revision changed before save");
        return;
      }

      const result = outcome.result;
      const tickAt = this.isoNow();
      this.status.active = true;
      this.status.heartbeatAt = tickAt;
      this.status.lastTickAt = tickAt;
      this.status.lastTickAttempts = outcome.attempts;
      this.status.lastError = null;
      this.status.lastInternalActivities = result.internalActivities
        .map(formatResidentActivity)
        .slice(-6);
      this.status.lastActivities = result.activities.map(formatResidentActivity).slice(-6);

      if (result.activities.length > 0) {
        this.status.lastActivityAt = tickAt;
      }

      if (result.internalActivities.length > 0) {
        this.status.lastInternalAt = tickAt;
      }

      if (result.proactiveMessage) {
        this.status.lastProactiveAt = tickAt;
      }

      await this.flushStatus();

      for (const activity of result.internalActivities) {
        this.options.log?.(`[loop/internal] ${formatResidentActivity(activity)}`);
      }

      for (const activity of result.outwardActivities) {
        this.options.log?.(`[loop/outward] ${formatResidentActivity(activity)}`);
      }

      if (result.proactiveMessage) {
        this.options.log?.(`hachika* ${result.proactiveMessage}`);
      }
    } catch (error) {
      this.status.active = true;
      this.status.heartbeatAt = this.isoNow();
      this.status.lastTickAttempts = null;
      this.status.lastError =
        error instanceof Error ? error.message : "resident_loop_error";
      await this.flushStatus();
      this.options.error?.(`[loop] error: ${this.status.lastError}`);
    }
  }

  private async flushStatus(): Promise<void> {
    await saveResidentLoopStatus(this.options.statusPath, this.status);
  }

  private isoNow(): string {
    return (this.options.now?.() ?? new Date()).toISOString();
  }
}

export function isResidentLoopAlreadyRunningError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("resident_loop_already_running:");
}
