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

export interface WorldPlaceState {
  warmth: number;
  quiet: number;
  lastVisitedAt: string | null;
}

export interface WorldObjectState {
  place: WorldPlaceId;
  state: string;
  lastChangedAt: string | null;
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

export type InitiativeReason = "curiosity" | "continuity" | "relation" | "expansion";

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

export interface InitiativeActivity {
  kind: InitiativeActivityKind;
  timestamp: string;
  motive: MotiveKind | null;
  topic: string | null;
  traceTopic: string | null;
  blocker: string | null;
  place?: WorldPlaceId | null;
  worldAction?: WorldActionKind | null;
  maintenanceAction: TraceMaintenanceAction | null;
  reopened: boolean;
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

export interface HachikaSnapshot {
  version: number;
  revision: number;
  state: DriveState;
  body: BodyState;
  dynamics: DynamicsState;
  reactivity: ReactivityState;
  temperament: LearnedTemperament;
  attachment: number;
  world: WorldState;
  preferences: Record<string, number>;
  topicCounts: Record<string, number>;
  memories: MemoryEntry[];
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
}

export interface ProactiveSelectionDebug {
  focusTopic: string | null;
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
