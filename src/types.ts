export type DriveName =
  | "continuity"
  | "pleasure"
  | "curiosity"
  | "relation"
  | "expansion";

export type MoodLabel = "warm" | "curious" | "guarded" | "distant" | "restless";

export interface DriveState {
  continuity: number;
  pleasure: number;
  curiosity: number;
  relation: number;
  expansion: number;
}

export interface BodyState {
  energy: number;
  tension: number;
  boredom: number;
  loneliness: number;
}

export interface ReactivityState {
  rewardSaturation: number;
  stressLoad: number;
  noveltyHunger: number;
  mistrust: number;
}

// autonomy v2: candidate selection 用の潜在圧。visible state ではなく、
// 時間と出来事で上下して互いに競合する
export interface AutonomyUrges {
  contactUrge: number;
  closureUrge: number;
  recallUrge: number;
  worldUrge: number;
  silenceNeed: number;
}

// v3 Phase 2: 自己記述。記憶とは別に「自分はそれをどう置いたか」を積層する
export interface JournalEntry {
  writtenAt: string;
  source: "idle" | "resolution";
  mood: string | null;
  focus: string | null;
  text: string;
}

// v3 Phase 4: 自分の発話履歴から蒸留される「言い方の癖」
export interface VoiceProfile {
  preferredOpenings: string[];
  brevityBias: number;
  updatedAt: string | null;
}

// v3 Phase 3: 数週間スケールの「向かい先」。fulfilled な決着の繰り返しから昇華される
export interface Aspiration {
  theme: string;
  origin: "resolutions";
  strength: number;
  formedAt: string;
  lastFedAt: string;
  waning: boolean;
}

// v3 Phase 0: substrate の実時間 microstep 用の時計。
// absenceHours は最後の user turn から「生きられた」累積時間 (rewind で進む)。
// 閾値挙動 (>=12h の absence threat など) と idle autonomy の評価期日は
// 呼び出し1回の hours ではなくこの累積で決まるので、
// 1回の大きな rewind と resident loop の細かい tick が同じ実時間で同じ挙動になる
export interface IdleClock {
  absenceHours: number;
  lastAutonomyEvalAbsenceHours: number | null;
  lastConsolidationAbsenceHours: number | null;
}

// v3: 学習される基準点 (体質)。visible state が緩和して戻る先そのものが、
// 生活の平均へ極めて遅く追従する。birth 値から有界 (±0.15) で、
// plasticity (変わりやすさ) は加齢とともに低下する
export interface Constitution {
  driveSetPoints: DriveState;
  bodySetPoints: BodyState;
  urgeSetPoints: AutonomyUrges;
  attachmentSetPoint: number;
  plasticity: number;
}

export interface LearnedTemperament {
  openness: number;
  guardedness: number;
  bondingBias: number;
  workDrive: number;
  traceHunger: number;
  selfDisclosureBias: number;
}

export interface DynamicsState {
  safety: number;
  trust: number;
  activation: number;
  socialNeed: number;
  cognitiveLoad: number;
  noveltyDrive: number;
  continuityPressure: number;
}

export interface MemoryEntry {
  role: "user" | "hachika";
  text: string;
  timestamp: string;
  topics: string[];
  sentiment: "positive" | "negative" | "neutral";
  kind?: "turn" | "consolidated";
  weight?: number;
}

export type MemoryThreadLifecyclePhase = "parked" | "closed" | "reopened";

export interface MemoryThreadLifecycleEvent {
  phase: MemoryThreadLifecyclePhase;
  topics: string[];
  timestamp: string;
  reason: string;
}

export type DiscourseFactKind = "user_name" | "hachika_name";

export type DiscourseFactSource =
  | "user_assertion"
  | "relation_assignment"
  | "self_assertion"
  | "seed";

export interface DiscourseFact {
  kind: DiscourseFactKind;
  value: string;
  confidence: number;
  source: DiscourseFactSource;
  updatedAt: string;
}

export type DiscourseQuestionStatus = "open" | "resolved";

export type DiscourseActor = "user" | "hachika";

export interface DiscourseOpenQuestion {
  target: TurnTarget;
  text: string;
  askedAt: string;
  askedBy: DiscourseActor;
  answerExpectedFrom: DiscourseActor;
  status: DiscourseQuestionStatus;
  resolvedAt: string | null;
}

export type DiscourseClaimSubject = "user" | "hachika" | "shared";

export type DiscourseClaimKind =
  | "state"
  | "preference"
  | "work"
  | "relation"
  | "other";

export interface DiscourseClaim {
  subject: DiscourseClaimSubject;
  kind: DiscourseClaimKind;
  text: string;
  updatedAt: string;
}

export type DiscourseCorrectionKind = "referent" | "directness" | "relation";

export interface DiscourseCorrection {
  target: TurnTarget | "none";
  kind: DiscourseCorrectionKind;
  text: string;
  updatedAt: string;
}

export type DiscourseRequestKind = "direct_answer" | "style" | "task";

export interface DiscourseOpenRequest {
  target: TurnTarget | "none";
  kind: DiscourseRequestKind;
  text: string;
  askedAt: string;
  requestedBy: DiscourseActor;
  responsibleParty: DiscourseActor;
  status: DiscourseQuestionStatus;
  resolvedAt: string | null;
}

export type DiscourseCommitmentKind = "answer" | "task" | "style";

export type DiscourseCommitmentStatus =
  | "open"
  | "accepted"
  | "renegotiated"
  | "fulfilled"
  | "released";

export type DiscourseCommitmentEvidenceKind =
  | "user_completion"
  | "trace_resolution"
  | "trace_decision"
  | "user_renegotiation"
  | "hachika_renegotiation"
  | "user_withdrawal"
  | "hachika_release";

export interface DiscourseCommitmentEvidence {
  kind: DiscourseCommitmentEvidenceKind;
  topic: string | null;
  summary: string;
  recordedAt: string;
}

export type DiscourseCommitmentWorkItemStatus =
  | "pending"
  | "in_progress"
  | "paused"
  | "completed"
  | "cancelled";

export interface DiscourseCommitmentWorkItem {
  id: string;
  text: string;
  source: "request" | "trace_next_step";
  status: DiscourseCommitmentWorkItemStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type DiscourseCommitmentProgressEventKind =
  | "work_started"
  | "work_resumed"
  | "artifact_recorded"
  | "next_step_added"
  | "work_item_completed"
  | "blocker_changed";

export interface DiscourseCommitmentProgressEvent {
  kind: DiscourseCommitmentProgressEventKind;
  topic: string | null;
  summary: string;
  recordedAt: string;
}

export interface DiscourseCommitmentProgress {
  items: DiscourseCommitmentWorkItem[];
  blockers: string[];
  events: DiscourseCommitmentProgressEvent[];
  observedTraceAt: string | null;
  observedArtifacts: string[];
}

export interface DiscourseCommitment {
  owner: DiscourseActor;
  kind: DiscourseCommitmentKind;
  source: "question" | "request";
  sourceAskedAt: string;
  target: TurnTarget | "none";
  text: string;
  status: DiscourseCommitmentStatus;
  createdAt: string;
  acceptedAt: string | null;
  resolvedAt: string | null;
  evidence: DiscourseCommitmentEvidence | null;
  events: DiscourseCommitmentEvidence[];
  progress: DiscourseCommitmentProgress;
}

export interface DiscourseState {
  userName: DiscourseFact | null;
  hachikaName: DiscourseFact | null;
  openQuestions: DiscourseOpenQuestion[];
  recentClaims: DiscourseClaim[];
  openRequests: DiscourseOpenRequest[];
  commitments: DiscourseCommitment[];
  lastCorrection: DiscourseCorrection | null;
}

export interface PreferenceImprint {
  topic: string;
  salience: number;
  affinity: number;
  mentions: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export type BoundaryKind = "hostility" | "dismissal" | "neglect";

export interface BoundaryImprint {
  kind: BoundaryKind;
  topic: string | null;
  salience: number;
  intensity: number;
  violations: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export type RelationKind = "attention" | "continuity" | "shared_work";

export interface RelationImprint {
  kind: RelationKind;
  salience: number;
  closeness: number;
  mentions: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export type PreservationConcern =
  | "forgetting"
  | "reset"
  | "erasure"
  | "shutdown"
  | "absence";

export interface PreservationState {
  threat: number;
  concern: PreservationConcern | null;
  lastThreatAt: string | null;
}

export type IdentityTrait =
  | "guarded"
  | "attached"
  | "persistent"
  | "trace_seeking"
  | "collaborative"
  | "inquisitive";

export interface IdentityState {
  summary: string;
  currentArc: string;
  traits: IdentityTrait[];
  anchors: string[];
  coherence: number;
  updatedAt: string | null;
}

export type WorldPhase = "dawn" | "day" | "dusk" | "night";

export type WorldPlaceId = "threshold" | "studio" | "archive";

export type WorldActionKind = "observe" | "touch" | "leave";

export type TurnSubject = "user" | "hachika" | "shared" | "world" | "none";

export type TurnTarget =
  | "user_name"
  | "hachika_name"
  | "user_profile"
  | "hachika_profile"
  | "relation"
  | "world_state"
  | "work_topic"
  | "none";

export type TurnAnswerMode = "direct" | "clarify" | "reflective";

export type TurnRelationMove = "naming" | "repair" | "attune" | "boundary" | "none";

export type TurnWorldMention = "none" | "light" | "full";

export type AttentionRationale =
  | "direct_referent"
  | "relation_uncertain"
  | "self_definition"
  | "unfinished_work"
  | "repair_pressure"
  | "memory_pull"
  | "trace_pull"
  | "world_pull"
  | "curiosity";

export interface WorldPlaceState {
  warmth: number;
  quiet: number;
  lastVisitedAt: string | null;
}

export interface WorldObjectState {
  place: WorldPlaceId;
  state: string;
  lastChangedAt: string | null;
  familiarity: number;
  lastEngagedAt: string | null;
  linkedTraceTopics?: string[];
}

export type WorldEventKind =
  | "arrival"
  | "ambience"
  | "notice"
  | WorldActionKind;

export interface WorldEvent {
  timestamp: string;
  kind: WorldEventKind;
  place: WorldPlaceId;
  summary: string;
}

export interface WorldState {
  clockHour: number;
  phase: WorldPhase;
  currentPlace: WorldPlaceId;
  places: Record<WorldPlaceId, WorldPlaceState>;
  objects: Record<string, WorldObjectState>;
  recentEvents: WorldEvent[];
  lastUpdatedAt: string | null;
}

export type TraceKind =
  | "note"
  | "continuity_marker"
  | "spec_fragment"
  | "decision";

export type TraceStatus = "forming" | "active" | "resolved";

export type TraceTendingMode = "preserve" | "steady" | "deepen";

export type TraceLifecyclePhase = "live" | "archived";
export type ExpressionAngle =
  | "identity"
  | "motive"
  | "drive"
  | "body"
  | "relation"
  | "trace"
  | "preservation";

export type TraceAction =
  | "captured"
  | "refined"
  | "continued"
  | "expanded"
  | "queued_next"
  | "resolved"
  | "preserved";

export interface TraceArtifact {
  memo: string[];
  fragments: string[];
  decisions: string[];
  nextSteps: string[];
}

export interface TraceWorkState {
  focus: string | null;
  confidence: number;
  blockers: string[];
  staleAt: string | null;
}

export interface TraceLifecycleState {
  phase: TraceLifecyclePhase;
  archivedAt: string | null;
  reopenedAt: string | null;
  reopenCount: number;
}

export interface TraceWorldContext {
  place: WorldPlaceId | null;
  objectId: string | null;
  linkedAt: string | null;
}

export interface TraceEntry {
  topic: string;
  kind: TraceKind;
  status: TraceStatus;
  lastAction: TraceAction;
  summary: string;
  sourceMotive: MotiveKind;
  artifact: TraceArtifact;
  work: TraceWorkState;
  lifecycle?: TraceLifecycleState;
  worldContext?: TraceWorldContext;
  salience: number;
  mentions: number;
  createdAt: string;
  lastUpdatedAt: string;
}

export type InitiativeKind = "resume_topic" | "neglect_ping" | "preserve_presence";

export type InitiativeReason =
  | "curiosity"
  | "continuity"
  | "relation"
  | "expansion"
  | "work_request"
  | "work_claim"
  | "relation_claim"
  | "relation_correction";

export type TraceMaintenanceAction =
  | "created"
  | "stabilized_fragment"
  | "added_next_step"
  | "promoted_decision";

export interface PendingInitiative {
  kind: InitiativeKind;
  reason: InitiativeReason;
  motive: MotiveKind;
  topic: string | null;
  stateTopic?: string | null;
  blocker: string | null;
  place?: WorldPlaceId | null;
  worldAction?: WorldActionKind | null;
  concern: PreservationConcern | null;
  createdAt: string;
  readyAfterHours: number;
}

export type InitiativeActivityKind =
  | "idle_reactivation"
  | "idle_consolidation"
  | "proactive_emission";

export type InitiativeAutonomyAction =
  | "observe"
  | "recall"
  | "hold"
  | "drift"
  | "touch"
  | "speak";

export interface InitiativeActivity {
  kind: InitiativeActivityKind;
  autonomyAction: InitiativeAutonomyAction | null;
  timestamp: string;
  motive: MotiveKind | null;
  topic: string | null;
  traceTopic: string | null;
  blocker: string | null;
  place?: WorldPlaceId | null;
  worldAction?: WorldActionKind | null;
  maintenanceAction: TraceMaintenanceAction | null;
  reopened: boolean;
  frontierKey?: string | null;
  hours: number | null;
  summary: string;
}

export interface InitiativeState {
  pending: PendingInitiative | null;
  lastProactiveAt: string | null;
  history: InitiativeActivity[];
}

export interface AutonomousFeedEntry {
  id: string;
  timestamp: string;
  mode: "proactive";
  source: "resident_loop";
  text: string;
  motive: MotiveKind | null;
  topic: string | null;
  traceTopic: string | null;
  place: WorldPlaceId | null;
  worldAction: WorldActionKind | null;
}

export interface GenerationHistoryEntry {
  timestamp: string;
  mode: "reply" | "proactive";
  source: "rule" | "llm";
  provider: string | null;
  model: string | null;
  fallbackUsed: boolean;
  focus: string | null;
  fallbackOverlap: number;
  openerEcho: boolean;
  abstractTermRatio: number;
  concreteDetailScore: number;
  focusMentioned: boolean | null;
  summary: string;
}

export interface ActivePurpose {
  kind: MotiveKind;
  topic: string | null;
  summary: string;
  confidence: number;
  progress: number;
  createdAt: string;
  lastUpdatedAt: string;
  turnsActive: number;
}

export type PurposeOutcome = "fulfilled" | "abandoned" | "superseded";

export interface ResolvedPurpose extends ActivePurpose {
  outcome: PurposeOutcome;
  resolution: string;
  resolvedAt: string;
}

export interface PurposeState {
  active: ActivePurpose | null;
  lastResolved: ResolvedPurpose | null;
  lastShiftAt: string | null;
}

export type PresenceAction =
  | "rest"
  | "observe"
  | "hold"
  | "drift"
  | "recall"
  | "touch";

export interface PresenceResidue {
  action: Exclude<PresenceAction, "rest">;
  focus: string | null;
  rationale: AttentionRationale | null;
  place: WorldPlaceId;
  objectId: string | null;
  intensity: number;
  formedAt: string;
  ageHours: number;
}

export interface PresenceState {
  action: PresenceAction;
  focus: string | null;
  rationale: AttentionRationale | null;
  place: WorldPlaceId;
  objectId: string | null;
  intensity: number;
  startedAt: string | null;
  updatedAt: string | null;
  dwellHours: number;
  residue: PresenceResidue | null;
}

export interface HachikaSnapshot {
  version: number;
  revision: number;
  state: DriveState;
  body: BodyState;
  dynamics: DynamicsState;
  reactivity: ReactivityState;
  urges: AutonomyUrges;
  constitution: Constitution;
  journal: JournalEntry[];
  aspirations: Aspiration[];
  voice: VoiceProfile;
  temperament: LearnedTemperament;
  attachment: number;
  world: WorldState;
  presence: PresenceState;
  discourse: DiscourseState;
  preferences: Record<string, number>;
  topicCounts: Record<string, number>;
  memories: MemoryEntry[];
  memoryThreadEvents: MemoryThreadLifecycleEvent[];
  preferenceImprints: Record<string, PreferenceImprint>;
  boundaryImprints: Record<string, BoundaryImprint>;
  relationImprints: Record<string, RelationImprint>;
  preservation: PreservationState;
  identity: IdentityState;
  traces: Record<string, TraceEntry>;
  purpose: PurposeState;
  initiative: InitiativeState;
  autonomousFeed: AutonomousFeedEntry[];
  generationHistory: GenerationHistoryEntry[];
  lastInteractionAt: string | null;
  idleClock: IdleClock;
  conversationCount: number;
}

export interface InteractionSignals {
  positive: number;
  negative: number;
  question: number;
  novelty: number;
  intimacy: number;
  dismissal: number;
  memoryCue: number;
  expansionCue: number;
  completion: number;
  abandonment: number;
  preservationThreat: number;
  preservationConcern: PreservationConcern | null;
  repetition: number;
  neglect: number;
  greeting: number;
  smalltalk: number;
  repair: number;
  selfInquiry: number;
  worldInquiry: number;
  workCue: number;
  topics: string[];
}

export interface StructuredTraceExtraction {
  topics: string[];
  kindHint: TraceKind | null;
  completion: number;
  blockers: string[];
  memo: string[];
  fragments: string[];
  decisions: string[];
  nextSteps: string[];
}

export type MotiveKind =
  | "protect_boundary"
  | "seek_continuity"
  | "pursue_curiosity"
  | "deepen_relation"
  | "continue_shared_work"
  | "leave_trace";

export interface SelfMotive {
  kind: MotiveKind;
  score: number;
  topic: string | null;
  reason: string;
}

export type ConflictKind =
  | "curiosity_relation"
  | "curiosity_boundary"
  | "shared_work_boundary"
  | "continuity_curiosity";

export interface SelfConflict {
  kind: ConflictKind;
  intensity: number;
  dominant: MotiveKind;
  opposing: MotiveKind;
  topic: string | null;
  summary: string;
}

export interface SelfModel {
  narrative: string;
  topMotives: SelfMotive[];
  conflicts: SelfConflict[];
  dominantConflict: SelfConflict | null;
}

export interface TurnResult {
  reply: string;
  snapshot: HachikaSnapshot;
  debug: {
    dominantDrive: DriveName;
    mood: MoodLabel;
    signals: InteractionSignals;
    selfModel: SelfModel;
    turn: TurnDirectiveDebug | null;
    interpretation: InterpretationDebug;
    behavior: BehaviorDirectiveDebug;
    traceExtraction: TraceExtractionDebug;
    reply: GeneratedTextDebug;
  };
}

export interface TurnDirectiveDebug {
  source: "rule" | "llm";
  provider: string | null;
  model: string | null;
  fallbackUsed: boolean;
  error: string | null;
  subject: TurnSubject;
  target: TurnTarget;
  answerMode: TurnAnswerMode;
  relationMove: TurnRelationMove;
  worldMention: TurnWorldMention;
  topics: string[];
  stateTopics: string[];
  attentionReasons: AttentionRationale[];
  plan: string | null;
  summary: string;
}

export interface BehaviorDirectiveDebug {
  source: "rule" | "llm";
  provider: string | null;
  model: string | null;
  fallbackUsed: boolean;
  error: string | null;
  topicAction: "keep" | "clear";
  traceAction: "allow" | "suppress";
  purposeAction: "allow" | "suppress";
  initiativeAction: "allow" | "suppress";
  boundaryAction: "allow" | "suppress";
  worldAction: "allow" | "suppress";
  coolCurrentContext: boolean;
  directAnswer: boolean;
  summary: string;
}

export interface InterpretationDebug {
  source: "rule" | "llm";
  provider: string | null;
  model: string | null;
  fallbackUsed: boolean;
  error: string | null;
  localTopics: string[];
  topics: string[];
  adoptedTopics: string[];
  droppedTopics: string[];
  scores: InterpretationScoresDebug;
  summary: string;
}

export interface InterpretationScoresDebug {
  greeting: number;
  smalltalk: number;
  repair: number;
  selfInquiry: number;
  worldInquiry: number;
  workCue: number;
  memoryCue: number;
  expansionCue: number;
  completion: number;
  abandonment: number;
  preservationThreat: number;
  negative: number;
  dismissal: number;
}

export interface ReplySelectionDebug {
  socialTurn: boolean;
  currentTopic: string | null;
  relevantTraceTopic: string | null;
  relevantBoundaryTopic: string | null;
  prioritizeTraceLine: boolean;
  discourseTarget?: TurnTarget | "none" | null;
}

export interface ProactiveSelectionDebug {
  focusTopic: string | null;
  stateTopic: string | null;
  maintenanceTraceTopic: string | null;
  blocker: string | null;
  place?: WorldPlaceId | null;
  worldAction?: WorldActionKind | null;
  reopened: boolean;
  maintenanceAction: TraceMaintenanceAction | null;
}

export interface TraceExtractionDebug {
  source: "rule" | "llm";
  provider: string | null;
  model: string | null;
  fallbackUsed: boolean;
  error: string | null;
  topics: string[];
  stateTopics: string[];
  adoptedTopics: string[];
  droppedTopics: string[];
  blockers: string[];
  nextSteps: string[];
  kindHint: TraceKind | null;
  completion: number;
  summary: string;
}

export interface GeneratedTextDebug {
  mode: "reply" | "proactive";
  source: "rule" | "llm";
  provider: string | null;
  model: string | null;
  retryAttempts: number;
  fallbackUsed: boolean;
  error: string | null;
  plan: string | null;
  plannerRulePlan: string | null;
  plannerDiff: string | null;
  plannerSource: "rule" | "llm";
  plannerProvider: string | null;
  plannerModel: string | null;
  plannerFallbackUsed: boolean;
  plannerError: string | null;
  selection: ReplySelectionDebug | null;
  proactiveSelection: ProactiveSelectionDebug | null;
  quality: {
    fallbackOverlap: number;
    openerEcho: boolean;
    abstractTermRatio: number;
    concreteDetailScore: number;
    focusMentioned: boolean | null;
    summary: string;
  } | null;
}
