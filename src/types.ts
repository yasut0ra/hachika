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

export interface HachikaSnapshot {
  version: number;
  state: DriveState;
  preferences: Record<string, number>;
  topicCounts: Record<string, number>;
  memories: MemoryEntry[];
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
