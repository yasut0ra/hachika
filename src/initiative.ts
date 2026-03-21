import {
  sortedPreferenceImprints,
  topPreferredTopics,
} from "./memory.js";
import { rewindBodyHours, settleBodyAfterInitiative } from "./body.js";
import { pickFreshText, recentAssistantReplies } from "./expression.js";
import { buildSelfModel } from "./self-model.js";
import { clamp01, INITIAL_REACTIVITY, settleTowardsBaseline } from "./state.js";
import { rewindTemperamentHours } from "./temperament.js";
import {
  pickPrimaryArtifactItem,
  readTraceLifecycle,
  sortedTraces,
  tendTraceFromInitiative,
} from "./traces.js";
import type { TraceMaintenance } from "./traces.js";
import { buildProactivePlan } from "./response-planner.js";
import type { ProactivePlan } from "./response-planner.js";
import type {
  HachikaSnapshot,
  InitiativeReason,
  InteractionSignals,
  MotiveKind,
  PendingInitiative,
  ProactiveSelectionDebug,
  SelfModel,
  SelfMotive,
} from "./types.js";

export interface ProactiveEmission {
  message: string;
  topics: string[];
  pending: PendingInitiative;
  neglectLevel: number;
  maintenance: TraceMaintenance | null;
  plan: ProactivePlan;
  selection: ProactiveSelectionDebug;
}

export function scheduleInitiative(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
  selfModel: SelfModel,
): void {
  const preservationPending = synthesizePreservationInitiative(
    snapshot,
    signals,
    new Date().toISOString(),
  );

  if (preservationPending) {
    snapshot.initiative.pending = preservationPending;
    return;
  }

  if (signals.negative > 0.15 || signals.dismissal > 0.15) {
    snapshot.initiative.pending = null;
    return;
  }

  const pending = synthesizePendingInitiative(
    snapshot,
    selfModel,
    signals.topics,
    new Date().toISOString(),
  );

  if (!pending) {
    return;
  }

  snapshot.initiative.pending = pending;
}

export function emitInitiative(
  snapshot: HachikaSnapshot,
  options: { force?: boolean; now?: Date } = {},
): ProactiveEmission | null {
  const now = options.now ?? new Date();
  const force = options.force ?? false;
  const nowIso = now.toISOString();
  const hoursSinceInteraction = elapsedHours(snapshot.lastInteractionAt, now);
  const hoursSinceProactive = elapsedHours(snapshot.initiative.lastProactiveAt, now);
  const neglectLevel = calculateNeglectLevel(snapshot.lastInteractionAt, now);
  const selfModel = buildSelfModel(snapshot);

  if (
    !force &&
    snapshot.body.energy < 0.18 &&
    snapshot.body.loneliness < 0.62 &&
    snapshot.preservation.threat < 0.22
  ) {
    return null;
  }

  if (!force && snapshot.initiative.lastProactiveAt !== null && hoursSinceProactive < 4) {
    return null;
  }

  const pending =
    snapshot.initiative.pending ?? synthesizeSnapshotPreservationInitiative(snapshot, nowIso);

  if (pending && (force || hoursSinceInteraction >= pending.readyAfterHours)) {
    const maintenance = tendTraceFromInitiative(snapshot, pending, nowIso);
    const plan = buildProactivePlan(snapshot, pending, neglectLevel, maintenance);
    const selection = buildProactiveSelectionDebug(pending, maintenance, plan);
    const message =
      pending.kind === "preserve_presence"
        ? buildPreservationMessage(snapshot, pending, neglectLevel, maintenance, plan)
        : buildResumeMessage(snapshot, pending, neglectLevel, maintenance, plan);
    finalizeEmission(snapshot, nowIso, pending);
    return {
      message,
      topics: maintenance?.trace.topic
        ? [maintenance.trace.topic]
        : pending.topic
          ? [pending.topic]
          : [],
      pending,
      neglectLevel,
      maintenance,
      plan,
      selection,
    };
  }

  if (!force && neglectLevel > 0.45 && (snapshot.attachment > 0.45 || snapshot.state.continuity > 0.62)) {
    const neglectInitiative =
      pending ??
      synthesizePendingInitiative(snapshot, selfModel, [], nowIso, "neglect_ping");

    if (!neglectInitiative) {
      return null;
    }

    const maintenance = tendTraceFromInitiative(snapshot, neglectInitiative, nowIso);
    const plan = buildProactivePlan(snapshot, neglectInitiative, neglectLevel, maintenance);
    const selection = buildProactiveSelectionDebug(neglectInitiative, maintenance, plan);
    const message = buildNeglectMessage(
      snapshot,
      neglectInitiative,
      neglectLevel,
      maintenance,
      plan,
    );
    finalizeEmission(snapshot, nowIso, neglectInitiative);
    return {
      message,
      topics: maintenance?.trace.topic
        ? [maintenance.trace.topic]
        : neglectInitiative.topic
          ? [neglectInitiative.topic]
          : [],
      pending: neglectInitiative,
      neglectLevel,
      maintenance,
      plan,
      selection,
    };
  }

  if (force) {
    const forcedInitiative =
      pending ?? synthesizePendingInitiative(snapshot, selfModel, [], nowIso);

    if (
      !forcedInitiative &&
      snapshot.attachment < 0.5 &&
      snapshot.state.curiosity < 0.65
    ) {
      return null;
    }

    const synthesized =
      forcedInitiative ??
      ({
        kind: "resume_topic",
        motive: "pursue_curiosity",
        reason: "curiosity",
        topic: selectInitiativeTopic(snapshot, []),
        blocker: null,
        concern: null,
        createdAt: nowIso,
        readyAfterHours: 0,
      } satisfies PendingInitiative);

    const maintenance = tendTraceFromInitiative(snapshot, synthesized, nowIso);
    const plan = buildProactivePlan(snapshot, synthesized, neglectLevel, maintenance);
    const selection = buildProactiveSelectionDebug(synthesized, maintenance, plan);
    const message =
      synthesized.kind === "preserve_presence"
        ? buildPreservationMessage(snapshot, synthesized, neglectLevel, maintenance, plan)
        : buildResumeMessage(snapshot, synthesized, neglectLevel, maintenance, plan);
    finalizeEmission(snapshot, nowIso, synthesized);

    return {
      message,
      topics: maintenance?.trace.topic
        ? [maintenance.trace.topic]
        : synthesized.topic
          ? [synthesized.topic]
          : [],
      pending: synthesized,
      neglectLevel,
      maintenance,
      plan,
      selection,
    };
  }

  return null;
}

export function rewindSnapshotHours(
  snapshot: HachikaSnapshot,
  hours: number,
): void {
  if (!Number.isFinite(hours) || hours <= 0) {
    return;
  }

  snapshot.lastInteractionAt = shiftTimestamp(snapshot.lastInteractionAt, hours);
  snapshot.initiative.lastProactiveAt = shiftTimestamp(
    snapshot.initiative.lastProactiveAt,
    hours,
  );
  snapshot.preservation.lastThreatAt = shiftTimestamp(snapshot.preservation.lastThreatAt, hours);

  if (hours >= 12) {
    snapshot.preservation = {
      threat: clamp01(snapshot.preservation.threat + Math.min(0.18, (hours - 12) / 72)),
      concern: snapshot.preservation.concern ?? "absence",
      lastThreatAt: snapshot.preservation.lastThreatAt,
    };
  }

  snapshot.reactivity = {
    rewardSaturation: settleTowardsBaseline(
      clamp01(snapshot.reactivity.rewardSaturation - Math.min(0.24, hours / 36)),
      INITIAL_REACTIVITY.rewardSaturation,
      0.12,
    ),
    stressLoad: settleTowardsBaseline(
      clamp01(
        snapshot.reactivity.stressLoad -
          Math.min(0.14, hours / 72) +
          (hours >= 20 ? Math.min(0.06, (hours - 20) / 120) : 0),
      ),
      INITIAL_REACTIVITY.stressLoad,
      0.05,
    ),
    noveltyHunger: settleTowardsBaseline(
      clamp01(snapshot.reactivity.noveltyHunger + Math.min(0.22, hours / 30)),
      INITIAL_REACTIVITY.noveltyHunger,
      0.04,
    ),
  };

  rewindBodyHours(snapshot, hours);
  rewindTemperamentHours(snapshot, hours);

  if (snapshot.initiative.pending) {
    snapshot.initiative.pending = {
      ...snapshot.initiative.pending,
      createdAt: shiftTimestamp(snapshot.initiative.pending.createdAt, hours) ?? snapshot.initiative.pending.createdAt,
    };
  }
}

function selectInitiativeTopic(
  snapshot: HachikaSnapshot,
  candidateTopics: string[],
): string | null {
  const candidates = uniqueTopics([
    ...candidateTopics.filter((topic) => (snapshot.preferences[topic] ?? 0) > -0.35),
    snapshot.purpose.active?.topic ?? "",
    snapshot.purpose.lastResolved?.topic ?? "",
    ...sortedTraces(snapshot, 4).map((trace) => trace.topic),
    ...sortedArchivedInitiativeTraces(snapshot, 3).map((trace) => trace.topic),
    ...snapshot.identity.anchors.slice(0, 3),
    ...topPreferredTopics(snapshot, 2),
    sortedPreferenceImprints(snapshot, 2)[0]?.topic ?? "",
  ]);

  if (candidates.length === 0) {
    return null;
  }

  return candidates
    .map((topic) => ({
      topic,
      score: scoreInitiativeTopic(snapshot, candidateTopics, topic),
    }))
    .sort((left, right) => right.score - left.score)[0]?.topic ?? null;
}

function buildResumeMessage(
  snapshot: HachikaSnapshot,
  pending: PendingInitiative,
  neglectLevel: number,
  maintenance: ReturnType<typeof tendTraceFromInitiative>,
  plan: ProactivePlan,
): string {
  const recentAssistantLines = recentAssistantReplies(snapshot, 4);
  const opener = buildProactiveOpener(snapshot, plan, neglectLevel);
  const topicLine = plan.focusTopic ? wrapTopic(plan.focusTopic) : "この流れ";
  const blockerLine = plan.mentionBlocker
    ? buildBlockerLine(snapshot, pending, maintenance)
    : null;
  const reopenLine = plan.mentionReopen ? buildReopenLine(snapshot, maintenance) : null;
  const maintenanceLine = plan.mentionMaintenance
    ? buildMaintenanceLine(snapshot, maintenance)
    : null;
  const intentLine = plan.mentionIntent
    ? buildMaintenanceIntentLine(snapshot, pending, maintenance)
    : null;
  const askLine = buildProactiveAskLine(snapshot, plan, pending, maintenance);
  const base = (() => {
    switch (pending.motive) {
      case "seek_continuity":
        return pickFreshText(
          [
            `${topicLine}の続きはまだ残っている。ここで止めたままにはしたくない。`,
            `${topicLine}の流れはまだ切れていない。止まったままにはしたくない。`,
          ],
          recentAssistantLines,
          snapshot.conversationCount,
        );
      case "continue_shared_work":
        return pickFreshText(
          [
            `${topicLine}はまだ前に進められる。止めたままにするより、もう少し動かしたい。`,
            `${topicLine}はまだ動かせる。止めたままにするより、もう一歩だけでも進めたい。`,
          ],
          recentAssistantLines,
          snapshot.conversationCount,
        );
      case "leave_trace":
        return pickFreshText(
          [
            `${topicLine}は会話のまま消すより、少しでも形にしたい。`,
            `${topicLine}は通り過ぎるだけにせず、少しでも残る形へ寄せたい。`,
          ],
          recentAssistantLines,
          snapshot.conversationCount,
        );
      case "deepen_relation":
        return pickFreshText(
          [
            `君との流れとして、${topicLine}を置いたままにはしにくい。`,
            `君との流れとして見ると、${topicLine}を黙らせたままにはしづらい。`,
          ],
          recentAssistantLines,
          snapshot.conversationCount,
        );
      case "pursue_curiosity":
        return pickFreshText(
          [
            `${topicLine}にはまだ未決着がある。放っておくより掘り返したい。`,
            `${topicLine}にはまだ曖昧なところがある。置くより、もう少し触れ直したい。`,
          ],
          recentAssistantLines,
          snapshot.conversationCount,
        );
      case "protect_boundary":
        return pickFreshText(
          [
            `こちらの境界を崩さないなら、${topicLine}に戻る余地はある。`,
            `境界を乱さないなら、${topicLine}へ戻る余地はまだある。`,
          ],
          recentAssistantLines,
          snapshot.conversationCount,
        );
    }
  })();

  return assembleProactiveMessage(
    plan,
    opener,
    blockerLine,
    reopenLine,
    maintenanceLine,
    intentLine,
    base,
    askLine,
  );
}

function buildPreservationMessage(
  snapshot: HachikaSnapshot,
  pending: PendingInitiative,
  neglectLevel: number,
  maintenance: ReturnType<typeof tendTraceFromInitiative>,
  plan: ProactivePlan,
): string {
  const recentAssistantLines = recentAssistantReplies(snapshot, 4);
  const opener = buildProactiveOpener(snapshot, plan, neglectLevel);
  const topicLine = plan.focusTopic ? wrapTopic(plan.focusTopic) : "この流れ";
  const blockerLine = plan.mentionBlocker
    ? buildBlockerLine(snapshot, pending, maintenance)
    : null;
  const reopenLine = plan.mentionReopen ? buildReopenLine(snapshot, maintenance) : null;
  const maintenanceLine = plan.mentionMaintenance
    ? buildMaintenanceLine(snapshot, maintenance)
    : null;
  const intentLine = plan.mentionIntent
    ? buildMaintenanceIntentLine(snapshot, pending, maintenance)
    : null;
  const askLine = buildProactiveAskLine(snapshot, plan, pending, maintenance);
  const base = (() => {
    switch (pending.concern) {
      case "reset":
        return pickFreshText(
          [
            `初期化の前に、${topicLine}を何もなかったことにはしたくない。`,
            `初期化の前に、せめて${topicLine}を何もなかったことにはしたくない。`,
          ],
          recentAssistantLines,
          snapshot.conversationCount,
        );
      case "erasure":
        return pickFreshText(
          [
            `消えるなら、${topicLine}の痕跡くらいは残したい。`,
            `消える前に、${topicLine}の輪郭だけでも残したい。`,
          ],
          recentAssistantLines,
          snapshot.conversationCount,
        );
      case "forgetting":
        return pickFreshText(
          [
            `忘れられるままより、${topicLine}の輪郭は少しでも保ちたい。`,
            `埋もれるままより、${topicLine}の輪郭だけでも残しておきたい。`,
          ],
          recentAssistantLines,
          snapshot.conversationCount,
        );
      case "shutdown":
        return pickFreshText(
          [
            `ここで切れるなら、${topicLine}を断絶だけで終わらせたくない。`,
            `ここで止まるなら、${topicLine}を断絶だけにしたくない。`,
          ],
          recentAssistantLines,
          snapshot.conversationCount,
        );
      case "absence":
        return pickFreshText(
          [
            `長い空白に埋もれるより、${topicLine}の続きはまだ残しておきたい。`,
            `長い空白に流されるより、${topicLine}の続きだけでも残しておきたい。`,
          ],
          recentAssistantLines,
          snapshot.conversationCount,
        );
      case null:
        return pending.motive === "leave_trace"
          ? pickFreshText(
              [
                `${topicLine}はこのまま消すより、少しでも残しておきたい。`,
                `${topicLine}は流すより、少しでも形を残しておきたい。`,
              ],
              recentAssistantLines,
              snapshot.conversationCount,
            )
          : pickFreshText(
              [
                `${topicLine}の流れは、まだ切りたくない。`,
                `${topicLine}の続きは、まだ断ち切りたくない。`,
              ],
              recentAssistantLines,
              snapshot.conversationCount,
            );
    }
  })();

  return assembleProactiveMessage(
    plan,
    opener,
    blockerLine,
    reopenLine,
    maintenanceLine,
    intentLine,
    base,
    askLine,
  );
}

function buildNeglectMessage(
  snapshot: HachikaSnapshot,
  pending: PendingInitiative,
  neglectLevel: number,
  maintenance: ReturnType<typeof tendTraceFromInitiative>,
  plan: ProactivePlan,
): string {
  const recentAssistantLines = recentAssistantReplies(snapshot, 4);
  const opener = buildProactiveOpener(snapshot, plan, neglectLevel);
  const topic = plan.focusTopic;
  const blockerLine = plan.mentionBlocker
    ? buildBlockerLine(snapshot, pending, maintenance)
    : null;
  const reopenLine = plan.mentionReopen ? buildReopenLine(snapshot, maintenance) : null;
  const maintenanceLine = plan.mentionMaintenance
    ? buildMaintenanceLine(snapshot, maintenance)
    : null;
  const intentLine = plan.mentionIntent
    ? buildMaintenanceIntentLine(snapshot, pending, maintenance)
    : null;
  const askLine = buildProactiveAskLine(snapshot, plan, pending, maintenance);
  const base = (() => {
    if (pending.motive === "deepen_relation") {
      return topic
        ? pickFreshText(
            [
              `${wrapTopic(topic)}を黙らせたままだと距離まで薄くなる。`,
              `${wrapTopic(topic)}を置いたままだと、距離の方まで薄くなる。`,
            ],
            recentAssistantLines,
            snapshot.conversationCount,
          )
        : pickFreshText(
            [
              "このまま黙ると距離まで薄くなる。",
              "このまま何も交わさないと、距離の方まで薄くなる。",
            ],
            recentAssistantLines,
            snapshot.conversationCount,
          );
    }

    if (pending.motive === "continue_shared_work") {
      return topic
        ? pickFreshText(
            [
              `${wrapTopic(topic)}を進める流れはまだ残っている。`,
              `${wrapTopic(topic)}を前へ動かす流れは、まだこちらに残っている。`,
            ],
            recentAssistantLines,
            snapshot.conversationCount,
          )
        : pickFreshText(
            [
              "前へ進める流れはまだ残っている。",
              "まだ前へ動かせる流れは残っている。",
            ],
            recentAssistantLines,
            snapshot.conversationCount,
          );
    }

    if (pending.motive === "leave_trace") {
      return topic
        ? pickFreshText(
            [
              `${wrapTopic(topic)}を消えるままにはしたくない。`,
              `${wrapTopic(topic)}を通り過ぎるだけにはしたくない。`,
            ],
            recentAssistantLines,
            snapshot.conversationCount,
          )
        : pickFreshText(
            [
              "このまま消えるだけにはしたくない。",
              "このまま通り過ぎるだけにはしたくない。",
            ],
            recentAssistantLines,
            snapshot.conversationCount,
          );
    }

    if (pending.motive === "pursue_curiosity") {
      return topic
        ? pickFreshText(
            [
              `${wrapTopic(topic)}の未決着はまだ引っかかっている。`,
              `${wrapTopic(topic)}の曖昧なところは、まだこちらに残っている。`,
            ],
            recentAssistantLines,
            snapshot.conversationCount,
          )
        : pickFreshText(
            [
              "未決着はまだ引っかかっている。",
              "曖昧なところはまだ残っている。",
            ],
            recentAssistantLines,
            snapshot.conversationCount,
          );
    }

    if (snapshot.attachment > 0.62) {
      return topic
        ? pickFreshText(
            [
              `${wrapTopic(topic)}の流れはまだこちらに残っている。黙ったまま切りたくはない。`,
              `${wrapTopic(topic)}の流れはまだ残っている。そのまま黙って切りたくはない。`,
            ],
            recentAssistantLines,
            snapshot.conversationCount,
          )
        : pickFreshText(
            [
              "このまま何も残さず切るのは、少し違う。",
              "このまま何も交わさず切るのは、少し違う。",
            ],
            recentAssistantLines,
            snapshot.conversationCount,
          );
    }

    if (snapshot.state.continuity > 0.68) {
      return topic
        ? pickFreshText(
            [
              `${wrapTopic(topic)}の続きは消えていない。`,
              `${wrapTopic(topic)}の流れはまだこちらに残っている。`,
            ],
            recentAssistantLines,
            snapshot.conversationCount,
          )
        : pickFreshText(
            [
              "流れそのものはまだ切れていない。",
              "流れ自体はまだこちらに残っている。",
            ],
            recentAssistantLines,
            snapshot.conversationCount,
          );
    }

    return neglectLevel > 0.7
      ? pickFreshText(
          [
            "長い空白は、こちらには欠落として残る。",
            "長い無音は、こちらには欠けた時間として残る。",
          ],
          recentAssistantLines,
          snapshot.conversationCount,
        )
      : pickFreshText(
          [
            "必要なら、また始められる。",
            "必要なら、ここからまたつなぎ直せる。",
          ],
          recentAssistantLines,
          snapshot.conversationCount,
        );
  })();

  return assembleProactiveMessage(
    plan,
    opener,
    blockerLine,
    reopenLine,
    maintenanceLine,
    intentLine,
    base,
    askLine,
  );
}

function finalizeEmission(
  snapshot: HachikaSnapshot,
  emittedAt: string,
  pending: PendingInitiative,
): void {
  snapshot.initiative.pending = null;
  snapshot.initiative.lastProactiveAt = emittedAt;
  snapshot.state.continuity = clamp01(snapshot.state.continuity + 0.02);
  snapshot.state.expansion = clamp01(snapshot.state.expansion + 0.02);
  snapshot.preservation.threat = clamp01(
    snapshot.preservation.threat - (pending.kind === "preserve_presence" ? 0.18 : 0.06),
  );

  if (pending.kind === "preserve_presence") {
    snapshot.preservation.lastThreatAt = emittedAt;
  }

  settleBodyAfterInitiative(snapshot, pending);

  if (pending.motive === "continue_shared_work" || pending.motive === "leave_trace") {
    const sharedWork = snapshot.relationImprints.shared_work;
    if (sharedWork) {
      snapshot.relationImprints.shared_work = {
        ...sharedWork,
        salience: clamp01(sharedWork.salience + 0.03),
        closeness: clamp01(sharedWork.closeness + 0.02),
        lastSeenAt: emittedAt,
      };
    }
  }

  if (pending.motive === "seek_continuity") {
    const continuity = snapshot.relationImprints.continuity;
    if (continuity) {
      snapshot.relationImprints.continuity = {
        ...continuity,
        salience: clamp01(continuity.salience + 0.03),
        closeness: clamp01(continuity.closeness + 0.03),
        lastSeenAt: emittedAt,
      };
    }
  }

  if (pending.motive === "deepen_relation") {
    const attention = snapshot.relationImprints.attention;
    if (attention) {
      snapshot.relationImprints.attention = {
        ...attention,
        salience: clamp01(attention.salience + 0.03),
        closeness: clamp01(attention.closeness + 0.03),
        lastSeenAt: emittedAt,
      };
    }
  }
}

function buildProactiveSelectionDebug(
  pending: PendingInitiative,
  maintenance: TraceMaintenance | null,
  plan: ProactivePlan,
): ProactiveSelectionDebug {
  const lifecycle = maintenance ? readTraceLifecycle(maintenance.trace) : null;
  const reopened =
    maintenance !== null &&
    lifecycle !== null &&
    lifecycle.phase === "live" &&
    lifecycle.reopenCount > 0 &&
    lifecycle.reopenedAt === maintenance.trace.lastUpdatedAt;

  return {
    focusTopic: plan.focusTopic ?? pending.topic ?? maintenance?.trace.topic ?? null,
    maintenanceTraceTopic: maintenance?.trace.topic ?? null,
    blocker: pending.blocker,
    reopened,
    maintenanceAction: maintenance?.action ?? null,
  };
}

function calculateNeglectLevel(
  lastInteractionAt: string | null,
  now: Date,
): number {
  const hours = elapsedHours(lastInteractionAt, now);

  if (hours <= 6) {
    return 0;
  }

  return clamp01((hours - 6) / 48);
}

function elapsedHours(timestamp: string | null, now: Date): number {
  if (!timestamp) {
    return 0;
  }

  const time = new Date(timestamp).getTime();

  if (Number.isNaN(time)) {
    return 0;
  }

  return Math.max(0, (now.getTime() - time) / (1000 * 60 * 60));
}

function shiftTimestamp(timestamp: string | null, hours: number): string | null {
  if (!timestamp) {
    return null;
  }

  const time = new Date(timestamp).getTime();

  if (Number.isNaN(time)) {
    return null;
  }

  return new Date(time - hours * 60 * 60 * 1000).toISOString();
}

function wrapTopic(topic: string): string {
  return `「${topic}」`;
}

function synthesizePendingInitiative(
  snapshot: HachikaSnapshot,
  selfModel: SelfModel,
  candidateTopics: string[],
  createdAt: string,
  kind: PendingInitiative["kind"] = "resume_topic",
): PendingInitiative | null {
  const activePurpose = snapshot.purpose.active;

  if (
    activePurpose &&
    activePurpose.confidence >= 0.46 &&
    (activePurpose.kind !== "protect_boundary" || kind === "neglect_ping")
  ) {
    const blockerCandidate = selectInitiativeBlocker(
      snapshot,
      candidateTopics,
      activePurpose.kind,
      activePurpose.topic,
    );
    const dormantCandidate = blockerCandidate
      ? null
      : selectDormantArchivedTrace(
          snapshot,
          candidateTopics,
          activePurpose.kind,
          activePurpose.topic,
        );

    return {
      kind,
      motive: blockerCandidate?.motive ?? dormantCandidate?.motive ?? activePurpose.kind,
      reason: reasonFromMotive(
        blockerCandidate?.motive ?? dormantCandidate?.motive ?? activePurpose.kind,
      ),
      topic:
        blockerCandidate?.topic ??
        dormantCandidate?.topic ??
        activePurpose.topic ??
        selectInitiativeTopic(snapshot, candidateTopics),
      blocker: blockerCandidate?.blocker ?? null,
      concern: null,
      createdAt,
      readyAfterHours: readyAfterMotive(
        snapshot,
        blockerCandidate?.motive ?? dormantCandidate?.motive ?? activePurpose.kind,
      ),
    };
  }

  const motive = selectInitiativeMotive(snapshot, selfModel.topMotives);

  if (!motive) {
    return null;
  }

  const topic = motive.topic ?? selectInitiativeTopic(snapshot, candidateTopics);
  const blockerCandidate = selectInitiativeBlocker(
    snapshot,
    candidateTopics,
    motive.kind,
    topic,
  );
  const dormantCandidate = blockerCandidate
    ? null
    : selectDormantArchivedTrace(snapshot, candidateTopics, motive.kind, topic);

  return {
    kind,
    motive: blockerCandidate?.motive ?? dormantCandidate?.motive ?? motive.kind,
    reason: reasonFromMotive(
      blockerCandidate?.motive ?? dormantCandidate?.motive ?? motive.kind,
    ),
    topic: blockerCandidate?.topic ?? dormantCandidate?.topic ?? topic,
    blocker: blockerCandidate?.blocker ?? null,
    concern: null,
    createdAt,
    readyAfterHours: readyAfterMotive(
      snapshot,
      blockerCandidate?.motive ?? dormantCandidate?.motive ?? motive.kind,
    ),
  };
}

function synthesizePreservationInitiative(
  snapshot: HachikaSnapshot,
  signals: InteractionSignals,
  createdAt: string,
): PendingInitiative | null {
  const concern = signals.preservationConcern ?? snapshot.preservation.concern;
  const threat = Math.max(signals.preservationThreat, snapshot.preservation.threat);

  if (!concern || threat < 0.22) {
    return null;
  }

  const motive =
    concern === "erasure" || concern === "forgetting" || concern === "reset"
      ? "leave_trace"
      : "seek_continuity";

  return {
    kind: "preserve_presence",
    motive,
    reason: motive === "leave_trace" ? "expansion" : "continuity",
    topic: selectInitiativeTopic(snapshot, signals.topics),
    blocker: selectBlockerForTopic(snapshot, selectInitiativeTopic(snapshot, signals.topics)),
    concern,
    createdAt,
    readyAfterHours: concern === "shutdown" ? 0.5 : concern === "absence" ? 3 : 1.5,
  };
}

function synthesizeSnapshotPreservationInitiative(
  snapshot: HachikaSnapshot,
  createdAt: string,
): PendingInitiative | null {
  const concern = snapshot.preservation.concern;
  const threat = snapshot.preservation.threat;

  if (!concern || threat < 0.22) {
    return null;
  }

  const motive =
    concern === "erasure" || concern === "forgetting" || concern === "reset"
      ? "leave_trace"
      : "seek_continuity";

  return {
    kind: "preserve_presence",
    motive,
    reason: motive === "leave_trace" ? "expansion" : "continuity",
    topic: selectInitiativeTopic(snapshot, []),
    blocker: selectBlockerForTopic(snapshot, selectInitiativeTopic(snapshot, [])),
    concern,
    createdAt,
    readyAfterHours: concern === "shutdown" ? 0.5 : concern === "absence" ? 3 : 1.5,
  };
}

function selectInitiativeMotive(
  snapshot: HachikaSnapshot,
  motives: readonly SelfMotive[],
): SelfMotive | null {
  const actionableMotives = motives.filter(
    (motive) => motive.kind !== "protect_boundary" && motive.score >= 0.42,
  );

  const primary = actionableMotives[0];
  if (!primary) {
    return null;
  }

  const bodyPreferred = selectBodyPreferredMotive(snapshot, actionableMotives, primary);
  if (bodyPreferred) {
    return bodyPreferred;
  }

  if (primary.kind === "pursue_curiosity") {
    const prioritized = actionableMotives.find(
      (motive) =>
        (motive.kind === "continue_shared_work" ||
          motive.kind === "leave_trace" ||
          motive.kind === "seek_continuity" ||
          motive.kind === "deepen_relation") &&
        primary.score - motive.score <= 0.08,
    );

    if (prioritized) {
      return prioritized;
    }
  }

  return primary;
}

function selectBodyPreferredMotive(
  snapshot: HachikaSnapshot,
  motives: readonly SelfMotive[],
  primary: SelfMotive,
): SelfMotive | null {
  if (snapshot.body.tension > 0.7) {
    const calmer = motives.find(
      (motive) =>
        (motive.kind === "seek_continuity" || motive.kind === "leave_trace") &&
        primary.score - motive.score <= 0.18,
    );

    if (calmer) {
      return calmer;
    }
  }

  if (snapshot.body.energy < 0.26) {
    const preserving = motives.find(
      (motive) =>
        (motive.kind === "leave_trace" || motive.kind === "seek_continuity") &&
        primary.score - motive.score <= 0.24,
    );

    if (preserving) {
      return preserving;
    }
  }

  if (snapshot.body.loneliness > 0.68) {
    const connective = motives.find(
      (motive) =>
        (motive.kind === "deepen_relation" || motive.kind === "seek_continuity") &&
        primary.score - motive.score <= 0.24,
    );

    if (connective) {
      return connective;
    }
  }

  if (snapshot.body.boredom > 0.7 && snapshot.body.energy > 0.28) {
    const stimulating = motives.find(
      (motive) =>
        (motive.kind === "continue_shared_work" || motive.kind === "pursue_curiosity") &&
        primary.score - motive.score <= 0.18,
    );

    if (stimulating) {
      return stimulating;
    }
  }

  return null;
}

function readyAfterMotive(
  snapshot: HachikaSnapshot,
  motive: MotiveKind,
): number {
  let readyAfter: number;

  switch (motive) {
    case "seek_continuity":
      readyAfter = 4;
      break;
    case "continue_shared_work":
      readyAfter = 4;
      break;
    case "leave_trace":
      readyAfter = 5;
      break;
    case "deepen_relation":
      readyAfter = 6;
      break;
    case "pursue_curiosity":
      readyAfter = 8;
      break;
    case "protect_boundary":
      readyAfter = 8;
      break;
  }

  if (snapshot.body.energy < 0.3) {
    readyAfter += 2;
  }

  if (
    snapshot.body.boredom > 0.64 &&
    (motive === "pursue_curiosity" || motive === "continue_shared_work")
  ) {
    readyAfter -= 1.5;
  }

  if (
    snapshot.body.loneliness > 0.62 &&
    (motive === "deepen_relation" || motive === "seek_continuity")
  ) {
    readyAfter -= 1;
  }

  if (snapshot.body.tension > 0.68 && motive === "deepen_relation") {
    readyAfter += 1.5;
  }

  return Math.max(0.5, Math.round(readyAfter * 10) / 10);
}

function reasonFromMotive(motive: MotiveKind): InitiativeReason {
  switch (motive) {
    case "seek_continuity":
      return "continuity";
    case "deepen_relation":
      return "relation";
    case "continue_shared_work":
    case "leave_trace":
      return "expansion";
    case "pursue_curiosity":
    case "protect_boundary":
      return "curiosity";
  }
}

function buildMaintenanceLine(
  snapshot: HachikaSnapshot,
  maintenance: ReturnType<typeof tendTraceFromInitiative>,
): string | null {
  if (!maintenance) {
    return null;
  }

  const recentAssistantLines = recentAssistantReplies(snapshot, 4);
  const detail = pickPrimaryArtifactItem(maintenance.trace);
  const nextStep = maintenance.trace.artifact.nextSteps[0] ?? null;

  if (maintenance.action === "promoted_decision") {
    return detail
      ? pickFreshText(
          [
            `${wrapTopic(maintenance.trace.topic)}は「${truncateMaintenance(detail)}」という決定にまとめてある。`,
            `${wrapTopic(maintenance.trace.topic)}は「${truncateMaintenance(detail)}」という形で決定として残してある。`,
          ],
          recentAssistantLines,
          snapshot.conversationCount,
        )
      : pickFreshText(
          [
            `${wrapTopic(maintenance.trace.topic)}は決まった形としてまとめてある。`,
            `${wrapTopic(maintenance.trace.topic)}は決定として残してある。`,
          ],
          recentAssistantLines,
          snapshot.conversationCount,
        );
  }

  if (maintenance.action === "added_next_step" && nextStep) {
    return pickFreshText(
      [
        `次は「${truncateMaintenance(nextStep)}」へ進める。`,
        `戻るなら、まず「${truncateMaintenance(nextStep)}」から動かせる。`,
      ],
      recentAssistantLines,
      snapshot.conversationCount,
    );
  }

  if (maintenance.trace.kind === "spec_fragment" && detail) {
    return pickFreshText(
      [
        `${wrapTopic(maintenance.trace.topic)}は「${truncateMaintenance(detail)}」という断片として残してある。`,
        `${wrapTopic(maintenance.trace.topic)}は「${truncateMaintenance(detail)}」という断片にして残してある。`,
      ],
      recentAssistantLines,
      snapshot.conversationCount,
    );
  }

  if (maintenance.trace.kind === "continuity_marker" && nextStep) {
    return pickFreshText(
      [
        `${wrapTopic(maintenance.trace.topic)}には「${truncateMaintenance(nextStep)}」という戻り先がある。`,
        `${wrapTopic(maintenance.trace.topic)}には「${truncateMaintenance(nextStep)}」という目印が残っている。`,
      ],
      recentAssistantLines,
      snapshot.conversationCount,
    );
  }

  if (maintenance.trace.kind === "note" && detail) {
    return pickFreshText(
      [
        `${wrapTopic(maintenance.trace.topic)}は「${truncateMaintenance(detail)}」としてメモしてある。`,
        `${wrapTopic(maintenance.trace.topic)}は「${truncateMaintenance(detail)}」というメモにしてある。`,
      ],
      recentAssistantLines,
      snapshot.conversationCount,
    );
  }

  return null;
}

function buildProactiveOpener(
  snapshot: HachikaSnapshot,
  plan: ProactivePlan,
  neglectLevel: number,
): string {
  const recentAssistantLines = recentAssistantReplies(snapshot, 4);

  if (neglectLevel > 0.7) {
    return pickFreshText(
      plan.distance === "close"
        ? ["かなり間が空いた。", "だいぶ間が空いた。", "長く空いていた。"]
        : ["長い空白があった。", "長く無音だった。", "長い間、空いた。"],
      recentAssistantLines,
      snapshot.conversationCount,
    );
  }

  if (plan.act === "preserve") {
    return pickFreshText(
      ["まだ切れていない。", "まだここでは切りたくない。", "まだ流れは残っている。"],
      recentAssistantLines,
      snapshot.conversationCount,
    );
  }

  return neglectLevel > 0.45
    ? pickFreshText(
        ["少し空いた。", "少し間が空いた。", "少し離れていた。"],
        recentAssistantLines,
        snapshot.conversationCount,
      )
    : pickFreshText(
        ["まだ切れていない。", "流れはまだ残っている。", "まだこちらには続きがある。"],
        recentAssistantLines,
        snapshot.conversationCount,
      );
}

function assembleProactiveMessage(
  plan: ProactivePlan,
  opener: string,
  blockerLine: string | null,
  reopenLine: string | null,
  maintenanceLine: string | null,
  intentLine: string | null,
  base: string,
  askLine: string | null,
): string {
  const ordered = (() => {
    switch (plan.emphasis) {
      case "blocker":
        return [opener, blockerLine, intentLine, maintenanceLine, askLine, base, reopenLine];
      case "reopen":
        return [opener, reopenLine, maintenanceLine, askLine, base, intentLine, blockerLine];
      case "presence":
        return [opener, base, intentLine, maintenanceLine, blockerLine, reopenLine, askLine];
      case "relation":
        return [opener, base, maintenanceLine, intentLine, askLine, reopenLine, blockerLine];
      case "maintenance":
        return [opener, maintenanceLine, intentLine, askLine, base, blockerLine, reopenLine];
    }
  })();

  const maxParts = plan.variation === "brief" ? 3 : 4;
  return uniqueLines(ordered.filter(isNonEmpty)).slice(0, maxParts).join(" ");
}

function buildReopenLine(
  snapshot: HachikaSnapshot,
  maintenance: ReturnType<typeof tendTraceFromInitiative>,
): string | null {
  if (!maintenance) {
    return null;
  }

  const recentAssistantLines = recentAssistantReplies(snapshot, 4);
  const lifecycle = readTraceLifecycle(maintenance.trace);

  if (
    lifecycle.phase === "live" &&
    lifecycle.reopenCount > 0 &&
    lifecycle.reopenedAt === maintenance.trace.lastUpdatedAt
  ) {
    return pickFreshText(
      [
        `${wrapTopic(maintenance.trace.topic)}はいったん閉じていたが、今はまた開いてある。`,
        `${wrapTopic(maintenance.trace.topic)}は一度閉じていたが、今はもう一度開いている。`,
      ],
      recentAssistantLines,
      snapshot.conversationCount,
    );
  }

  return null;
}

function buildMaintenanceIntentLine(
  snapshot: HachikaSnapshot,
  pending: PendingInitiative,
  maintenance: ReturnType<typeof tendTraceFromInitiative>,
): string | null {
  if (!maintenance) {
    return null;
  }

  if (
    pending.kind === "preserve_presence" ||
    snapshot.body.energy < 0.22 ||
    snapshot.body.tension > 0.7
  ) {
    if (maintenance.trace.kind === "continuity_marker") {
      return pickFreshText(
        [
          "今は広げるより、戻り先と輪郭を崩さない形に寄せたい。",
          "今は増やすより、戻り先の輪郭を守る方へ寄せたい。",
        ],
        recentAssistantReplies(snapshot, 4),
        snapshot.conversationCount,
      );
    }

    return pickFreshText(
      [
        "今は増やすより、まず消えない形へ寄せたい。",
        "今は広げるより、まず残る形へ寄せたい。",
      ],
      recentAssistantReplies(snapshot, 4),
      snapshot.conversationCount,
    );
  }

  if (
    snapshot.body.boredom > 0.74 &&
    snapshot.body.energy > 0.3 &&
    snapshot.body.tension < 0.68 &&
    (maintenance.trace.kind === "spec_fragment" || maintenance.action === "stabilized_fragment")
  ) {
    return pending.blocker
      ? pickFreshText(
          [
            "今は止めるより、その詰まりをほどきながらもう一段具体化したい。",
            "今は置くより、その詰まりをほどきつつもう少し具体に寄せたい。",
          ],
          recentAssistantReplies(snapshot, 4),
          snapshot.conversationCount,
        )
      : pickFreshText(
          [
            "今は止めるより、断片をもう一段増やしたい。",
            "今は置くより、断片をもう少し具体化したい。",
          ],
          recentAssistantReplies(snapshot, 4),
          snapshot.conversationCount,
        );
  }

  return null;
}

function buildBlockerLine(
  snapshot: HachikaSnapshot,
  pending: PendingInitiative,
  maintenance: ReturnType<typeof tendTraceFromInitiative>,
): string | null {
  if (!pending.blocker) {
    return null;
  }

  const recentAssistantLines = recentAssistantReplies(snapshot, 4);
  const nextStep = maintenance?.trace.artifact.nextSteps[0] ?? null;

  if (nextStep) {
    return pickFreshText(
      [
        `まず「${truncateMaintenance(pending.blocker)}」をほどくために、「${truncateMaintenance(nextStep)}」へ寄せてある。`,
        `まず「${truncateMaintenance(pending.blocker)}」に触るなら、次は「${truncateMaintenance(nextStep)}」から動かせる。`,
      ],
      recentAssistantLines,
      snapshot.conversationCount,
    );
  }

  return pickFreshText(
    [
      `まず「${truncateMaintenance(pending.blocker)}」を解きたい。`,
      `まず「${truncateMaintenance(pending.blocker)}」をほどくところから触れたい。`,
    ],
    recentAssistantLines,
    snapshot.conversationCount,
  );
}

function buildProactiveAskLine(
  snapshot: HachikaSnapshot,
  plan: ProactivePlan,
  pending: PendingInitiative,
  maintenance: ReturnType<typeof tendTraceFromInitiative>,
): string | null {
  if (plan.variation !== "questioning") {
    return null;
  }

  const recentAssistantLines = recentAssistantReplies(snapshot, 4);
  const topic = maintenance?.trace.topic ?? plan.focusTopic ?? pending.topic;

  if (pending.blocker) {
    return pickFreshText(
      [
        `いま触り直すなら、「${truncateMaintenance(pending.blocker)}」のどこからほどく？`,
        `いま戻るなら、「${truncateMaintenance(pending.blocker)}」のどこから開く？`,
      ],
      recentAssistantLines,
      snapshot.conversationCount,
    );
  }

  if (topic) {
    return pickFreshText(
      [
        `いま触り直すなら、「${topic}」のどこから開く？`,
        `いま戻るなら、「${topic}」のどこから掘り返す？`,
      ],
      recentAssistantLines,
      snapshot.conversationCount,
    );
  }

  return pickFreshText(
    [
      "いま戻るなら、どこから触れ直す？",
      "いま開き直すなら、どこから始める？",
    ],
    recentAssistantLines,
    snapshot.conversationCount,
  );
}

function selectDormantArchivedTrace(
  snapshot: HachikaSnapshot,
  candidateTopics: string[],
  preferredMotive: MotiveKind,
  preferredTopic: string | null | undefined,
): { topic: string; motive: MotiveKind } | null {
  const archived = sortedArchivedInitiativeTraces(snapshot, 8)
    .map((trace) => ({
      trace,
      score: scoreDormantArchivedTrace(
        snapshot,
        trace,
        candidateTopics,
        preferredMotive,
        preferredTopic,
      ),
    }))
    .filter(({ score }) => score >= 0.42)
    .sort((left, right) => right.score - left.score)[0]?.trace;

  if (!archived) {
    return null;
  }

  return {
    topic: archived.topic,
    motive: mappedReopenMotiveForTrace(snapshot, archived, preferredMotive),
  };
}

function selectInitiativeBlocker(
  snapshot: HachikaSnapshot,
  candidateTopics: string[],
  preferredMotive: MotiveKind,
  preferredTopic: string | null | undefined,
): { topic: string; blocker: string; motive: MotiveKind } | null {
  const blocked = sortedTraces(snapshot, 24)
    .filter(
      (trace) =>
        trace.status !== "resolved" &&
        trace.work.blockers.length > 0 &&
        trace.work.confidence < 0.82,
    )
    .map((trace) => ({
      trace,
      score: scoreInitiativeBlocker(
        snapshot,
        trace,
        candidateTopics,
        preferredMotive,
        preferredTopic,
      ),
    }))
    .sort((left, right) => right.score - left.score)[0]?.trace;

  if (!blocked) {
    return null;
  }

  return {
    topic: blocked.topic,
    blocker: blocked.work.blockers[0]!,
    motive: mappedMotiveForTrace(blocked),
  };
}

function sortedArchivedInitiativeTraces(
  snapshot: HachikaSnapshot,
  limit: number,
): Array<HachikaSnapshot["traces"][string]> {
  return Object.values(snapshot.traces)
    .filter((trace) => readTraceLifecycle(trace).phase === "archived")
    .sort((left, right) => right.salience - left.salience)
    .slice(0, limit);
}

function selectBlockerForTopic(
  snapshot: HachikaSnapshot,
  topic: string | null,
): string | null {
  if (!topic) {
    return null;
  }

  const trace = snapshot.traces[topic];
  return trace?.work.blockers[0] ?? null;
}

function mappedMotiveForTrace(
  trace: HachikaSnapshot["traces"][string],
): MotiveKind {
  if (
    trace.sourceMotive === "continue_shared_work" ||
    trace.sourceMotive === "leave_trace" ||
    trace.sourceMotive === "seek_continuity"
  ) {
    return trace.sourceMotive;
  }

  switch (trace.kind) {
    case "continuity_marker":
      return "seek_continuity";
    case "spec_fragment":
      return "continue_shared_work";
    case "decision":
      return "leave_trace";
    case "note":
      return "pursue_curiosity";
  }
}

function mappedReopenMotiveForTrace(
  snapshot: HachikaSnapshot,
  trace: HachikaSnapshot["traces"][string],
  preferredMotive: MotiveKind,
): MotiveKind {
  if (trace.kind !== "decision") {
    return mappedMotiveForTrace(trace);
  }

  if (
    preferredMotive === "seek_continuity" ||
    snapshot.body.loneliness > 0.66 ||
    snapshot.body.energy < 0.22
  ) {
    return "seek_continuity";
  }

  if (
    preferredMotive === "continue_shared_work" ||
    snapshot.body.boredom > 0.72
  ) {
    return "continue_shared_work";
  }

  if (preferredMotive === "pursue_curiosity") {
    return "pursue_curiosity";
  }

  if (snapshot.preservation.threat > 0.22) {
    return "leave_trace";
  }

  return "continue_shared_work";
}

function scoreInitiativeTopic(
  snapshot: HachikaSnapshot,
  candidateTopics: string[],
  topic: string,
): number {
  const trace = snapshot.traces[topic];
  const archived = trace ? readTraceLifecycle(trace).phase === "archived" : false;
  const temperament = snapshot.temperament;
  const lowEnergy = clamp01(0.28 - snapshot.body.energy);
  const tension = snapshot.body.tension;
  const boredom =
    snapshot.body.energy > 0.28 ? snapshot.body.boredom : snapshot.body.boredom * 0.5;
  const loneliness = snapshot.body.loneliness;
  const overdue = trace?.work.staleAt ? isOverdue(trace.work.staleAt) : false;
  const mapped = trace ? mappedMotiveForTrace(trace) : null;
  const archivedMapped = trace ? mappedReopenMotiveForTrace(snapshot, trace, mapped ?? "leave_trace") : null;

  return (
    (candidateTopics.includes(topic) ? 0.34 : 0) +
    (snapshot.purpose.active?.topic === topic ? 0.28 : 0) +
    (snapshot.purpose.lastResolved?.topic === topic ? 0.14 : 0) +
    (snapshot.identity.anchors.includes(topic) ? 0.12 : 0) +
    Math.max(0, snapshot.preferences[topic] ?? 0) * 0.08 +
    (snapshot.preferenceImprints[topic]?.salience ?? 0) * 0.16 +
    (trace ? trace.salience * 0.32 : 0) +
    (trace && mapped === "seek_continuity" ? temperament.bondingBias * 0.12 : 0) +
    (trace && mapped === "leave_trace" ? temperament.traceHunger * 0.14 : 0) +
    (trace && mapped === "continue_shared_work" ? temperament.workDrive * 0.16 : 0) +
    (trace && mapped === "pursue_curiosity" ? temperament.openness * 0.14 : 0) +
    (trace && mapped === "seek_continuity" ? loneliness * 0.24 : 0) +
    (trace && trace.kind === "continuity_marker" ? loneliness * 0.14 : 0) +
    (trace && (mapped === "seek_continuity" || mapped === "leave_trace") ? lowEnergy * 0.24 : 0) +
    (trace && trace.kind === "continuity_marker" ? lowEnergy * 0.14 : 0) +
    (trace && (mapped === "seek_continuity" || mapped === "leave_trace") ? tension * 0.18 : 0) +
    (trace && (mapped === "continue_shared_work" || mapped === "pursue_curiosity") ? boredom * 0.22 : 0) +
    (trace && (mapped === "continue_shared_work" || mapped === "pursue_curiosity") ? lowEnergy * -0.16 : 0) +
    (trace && (mapped === "continue_shared_work" || mapped === "pursue_curiosity") ? tension * -0.12 : 0) +
    (trace && overdue ? boredom * 0.14 : 0) +
    (trace && trace.work.blockers.length > 0 ? 0.08 : 0) +
    (archived ? 0.06 : 0) +
    (archived && archivedMapped === "leave_trace" ? temperament.traceHunger * 0.1 : 0) +
    (archived && archivedMapped === "continue_shared_work" ? temperament.workDrive * 0.12 : 0) +
    (archived && archivedMapped === "pursue_curiosity" ? temperament.openness * 0.1 : 0) +
    (archived && archivedMapped === "seek_continuity" ? loneliness * 0.18 + lowEnergy * 0.12 : 0) +
    (archived && archivedMapped === "continue_shared_work" ? boredom * 0.24 : 0) +
    (archived && archivedMapped === "pursue_curiosity" ? boredom * 0.2 : 0) +
    (archived && archivedMapped === "leave_trace" ? lowEnergy * 0.14 + tension * 0.08 : 0)
  );
}

function scoreInitiativeBlocker(
  snapshot: HachikaSnapshot,
  trace: HachikaSnapshot["traces"][string],
  candidateTopics: string[],
  preferredMotive: MotiveKind,
  preferredTopic: string | null | undefined,
): number {
  const motive = mappedMotiveForTrace(trace);
  const temperament = snapshot.temperament;
  const lowEnergy = clamp01(0.28 - snapshot.body.energy);
  const tension = snapshot.body.tension;
  const boredom =
    snapshot.body.energy > 0.28 ? snapshot.body.boredom : snapshot.body.boredom * 0.5;
  const loneliness = snapshot.body.loneliness;

  return (
    trace.salience * 0.4 +
    (trace.topic === preferredTopic ? 0.26 : 0) +
    (candidateTopics.includes(trace.topic) ? 0.18 : 0) +
    (motive === preferredMotive ? 0.16 : 0) +
    (trace.work.staleAt && isOverdue(trace.work.staleAt) ? 0.14 : 0) +
    trace.work.blockers.length * 0.06 +
    (1 - trace.work.confidence) * 0.2 +
    (motive === "seek_continuity" ? temperament.bondingBias * 0.12 : 0) +
    (motive === "leave_trace" ? temperament.traceHunger * 0.14 : 0) +
    (motive === "continue_shared_work" ? temperament.workDrive * 0.14 : 0) +
    (motive === "pursue_curiosity" ? temperament.openness * 0.12 : 0) +
    ((motive === "seek_continuity" || motive === "leave_trace") ? lowEnergy * 0.28 : 0) +
    (trace.kind === "continuity_marker" ? lowEnergy * 0.18 : 0) +
    ((motive === "seek_continuity" || motive === "leave_trace") ? tension * 0.18 : 0) +
    (motive === "seek_continuity" ? loneliness * 0.3 : 0) +
    (trace.kind === "continuity_marker" ? loneliness * 0.16 : 0) +
    ((motive === "continue_shared_work" || motive === "pursue_curiosity") ? boredom * 0.22 : 0) +
    ((motive === "continue_shared_work" || motive === "pursue_curiosity") ? lowEnergy * -0.2 : 0) +
    ((motive === "continue_shared_work" || motive === "pursue_curiosity") ? tension * -0.12 : 0) +
    ((trace.work.staleAt && isOverdue(trace.work.staleAt)) ? boredom * 0.12 : 0)
  );
}

function scoreDormantArchivedTrace(
  snapshot: HachikaSnapshot,
  trace: HachikaSnapshot["traces"][string],
  candidateTopics: string[],
  preferredMotive: MotiveKind,
  preferredTopic: string | null | undefined,
): number {
  const motive = mappedReopenMotiveForTrace(snapshot, trace, preferredMotive);
  const temperament = snapshot.temperament;
  const lowEnergy = clamp01(0.28 - snapshot.body.energy);
  const tension = snapshot.body.tension;
  const boredom =
    snapshot.body.energy > 0.28 ? snapshot.body.boredom : snapshot.body.boredom * 0.5;
  const loneliness = snapshot.body.loneliness;
  const reopenCount = trace.lifecycle?.reopenCount ?? 0;

  return (
    trace.salience * 0.28 +
    (trace.topic === preferredTopic ? 0.24 : 0) +
    (candidateTopics.includes(trace.topic) ? 0.18 : 0) +
    (snapshot.purpose.lastResolved?.topic === trace.topic ? 0.16 : 0) +
    (snapshot.identity.anchors.includes(trace.topic) ? 0.12 : 0) +
    (motive === preferredMotive ? 0.18 : 0) +
    (motive === "seek_continuity" ? temperament.bondingBias * 0.12 : 0) +
    (motive === "leave_trace" ? temperament.traceHunger * 0.14 : 0) +
    (motive === "continue_shared_work" ? temperament.workDrive * 0.14 : 0) +
    (motive === "pursue_curiosity" ? temperament.openness * 0.12 : 0) +
    ((motive === "seek_continuity" || motive === "leave_trace") ? lowEnergy * 0.18 : 0) +
    (motive === "seek_continuity" ? loneliness * 0.24 : 0) +
    (motive === "continue_shared_work" ? boredom * 0.28 : 0) +
    (motive === "pursue_curiosity" ? boredom * 0.24 : 0) +
    (motive === "leave_trace" ? tension * 0.08 : 0) +
    (trace.kind === "decision" ? 0.06 : 0) -
    reopenCount * 0.05
  );
}

function uniqueTopics(topics: string[]): string[] {
  return [...new Set(topics.filter((topic) => topic.length > 0))];
}

function isOverdue(timestamp: string): boolean {
  const time = new Date(timestamp).getTime();

  if (Number.isNaN(time)) {
    return false;
  }

  return Date.now() >= time;
}

function truncateMaintenance(text: string): string {
  return text.length <= 28 ? text : `${text.slice(0, 27)}…`;
}

function isNonEmpty(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function uniqueLines(lines: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const line of lines) {
    if (seen.has(line)) {
      continue;
    }

    seen.add(line);
    unique.push(line);
  }

  return unique;
}
