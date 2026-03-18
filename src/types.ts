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

export interface MemoryEntry {
  role: "user" | "hachika";
  text: string;
  timestamp: string;
  topics: string[];
  sentiment: "positive" | "negative" | "neutral";
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

export type InitiativeKind = "resume_topic" | "neglect_ping";

export type InitiativeReason = "curiosity" | "continuity" | "relation" | "expansion";

export interface PendingInitiative {
  kind: InitiativeKind;
  reason: InitiativeReason;
  motive: MotiveKind;
  topic: string | null;
  createdAt: string;
  readyAfterHours: number;
}

export interface InitiativeState {
  pending: PendingInitiative | null;
  lastProactiveAt: string | null;
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
  state: DriveState;
  attachment: number;
  preferences: Record<string, number>;
  topicCounts: Record<string, number>;
  memories: MemoryEntry[];
  preferenceImprints: Record<string, PreferenceImprint>;
  boundaryImprints: Record<string, BoundaryImprint>;
  relationImprints: Record<string, RelationImprint>;
  purpose: PurposeState;
  initiative: InitiativeState;
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
  repetition: number;
  neglect: number;
  topics: string[];
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
  };
}
