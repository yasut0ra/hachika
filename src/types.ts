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
  topic: string | null;
  createdAt: string;
  readyAfterHours: number;
}

export interface InitiativeState {
  pending: PendingInitiative | null;
  lastProactiveAt: string | null;
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
  repetition: number;
  neglect: number;
  topics: string[];
}

export interface TurnResult {
  reply: string;
  snapshot: HachikaSnapshot;
  debug: {
    dominantDrive: DriveName;
    mood: MoodLabel;
    signals: InteractionSignals;
  };
}
