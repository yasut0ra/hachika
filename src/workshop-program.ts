import type { MaterialKind, NotebookPage, WorkshopMaterial } from "./workshop.js";

export type WorkshopLayout = "scatter" | "stack" | "sequence";
export interface WorkshopProgram {
  version: 1;
  slots: Array<{ kind: MaterialKind | "any"; take: "whole" | "first_sentence" | "last_sentence" }>;
  layout: WorkshopLayout;
  captionStyle: "observation" | "contrast" | "story";
}
export interface WorkshopRecipe {
  id: string;
  name: string;
  program: WorkshopProgram;
  successes: number;
  value: number;
  learnedAt: string;
}
export interface WorkshopMaking {
  recipeId: string;
  recipeName: string;
  program: WorkshopProgram;
  origin: "invented" | "reused";
  provider: string;
  model: string;
}
export interface WorkshopGeneration {
  at: string;
  source: "llm";
  provider: string;
  model: string | null;
  outcome: "created" | "wait" | "error";
  recipeId: string | null;
  error: string | null;
}
export class WorkshopProgramError extends Error {}

const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const text = (x: unknown, max: number): x is string => typeof x === "string" && !!x.trim() && x.length <= max;
const member = (x: unknown, values: string[]) => typeof x === "string" && values.includes(x);

// This is an interpreter for a bounded data format, never model-generated JavaScript.
export function parseWorkshopProgram(raw: unknown): WorkshopProgram {
  if (!record(raw) || raw.version !== 1 || !Array.isArray(raw.slots) || raw.slots.length < 1 || raw.slots.length > 3 ||
    !member(raw.layout, ["scatter", "stack", "sequence"]) || !member(raw.captionStyle, ["observation", "contrast", "story"])) {
    throw new WorkshopProgramError("program_invalid");
  }
  const slots = raw.slots.map((slot) => {
    if (!record(slot) || !member(slot.kind, ["ticket", "leaf", "thread", "paper", "any"]) ||
      !member(slot.take, ["whole", "first_sentence", "last_sentence"])) throw new WorkshopProgramError("slot_invalid");
    return { kind: slot.kind, take: slot.take } as WorkshopProgram["slots"][number];
  });
  return { version: 1, slots, layout: raw.layout as WorkshopLayout, captionStyle: raw.captionStyle as WorkshopProgram["captionStyle"] };
}

export function cutWorkshopText(text: string, take: WorkshopProgram["slots"][number]["take"]): string {
  if (take === "whole") return text;
  const sentences = text.match(/[^。！？.!?]+[。！？.!?]*/gu)?.map((part) => part.trim()).filter(Boolean) ?? [];
  return (take === "first_sentence" ? sentences[0] : sentences.at(-1)) ?? "";
}

export type ExecutedWorkshopDraft =
  | { decision: "wait"; note: string }
  | { decision: "create"; title: string; caption: string; recipe: WorkshopRecipe | null; name: string;
      program: WorkshopProgram; inputs: WorkshopMaterial[]; fragments: NotebookPage["fragments"] };

export function executeWorkshopDraft(raw: unknown, materials: WorkshopMaterial[], recipes: WorkshopRecipe[]): ExecutedWorkshopDraft {
  if (!record(raw)) throw new WorkshopProgramError("draft_invalid");
  if (raw.decision === "wait" && text(raw.note, 160)) return { decision: "wait", note: raw.note.trim() };
  if (raw.decision !== "create" || !text(raw.title, 80) || !text(raw.caption, 240) || !Array.isArray(raw.materialIds) ||
    raw.materialIds.length < 1 || raw.materialIds.length > 3 || new Set(raw.materialIds).size !== raw.materialIds.length) {
    throw new WorkshopProgramError("draft_invalid");
  }
  const inputs = raw.materialIds.map((id) => {
    const material = materials.find((item) => item.id === id && item.place === "studio" && item.uses < 3);
    if (!material) throw new WorkshopProgramError("material_unavailable");
    return material;
  });
  let recipe: WorkshopRecipe | null = null;
  let program: WorkshopProgram;
  let name: string;
  if (typeof raw.reuseRecipeId === "string") {
    recipe = recipes.find((item) => item.id === raw.reuseRecipeId) ?? null;
    if (!recipe || raw.recipe !== null) throw new WorkshopProgramError("recipe_missing");
    program = parseWorkshopProgram(recipe.program);
    name = recipe.name;
  } else {
    if (raw.reuseRecipeId !== null || !record(raw.recipe) || !text(raw.recipe.name, 60)) throw new WorkshopProgramError("recipe_invalid");
    program = parseWorkshopProgram(raw.recipe.program);
    name = raw.recipe.name.trim();
    recipe = recipes.find((item) => JSON.stringify(item.program) === JSON.stringify(program)) ?? null;
  }
  if (program.slots.length !== inputs.length) throw new WorkshopProgramError("slot_count_mismatch");
  const fragments = inputs.map(({ id, kind, label, text, spot }, index) => {
    const slot = program.slots[index]!;
    if (slot.kind !== "any" && slot.kind !== kind) throw new WorkshopProgramError("slot_kind_mismatch");
    const excerpt = cutWorkshopText(text, slot.take);
    if (!excerpt || !text.includes(excerpt)) throw new WorkshopProgramError("excerpt_empty");
    return { id, kind, label, text, spot, excerpt };
  });
  return { decision: "create", title: raw.title.trim(), caption: raw.caption.trim(), recipe, name, program, inputs, fragments };
}

export function hydrateWorkshopRecipes(raw: unknown): WorkshopRecipe[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.flatMap((item) => {
    if (!record(item) || !text(item.id, 80) || !/^[a-zA-Z0-9_-]+$/u.test(item.id) || seen.has(item.id) ||
      !text(item.name, 60) || typeof item.learnedAt !== "string" || !Number.isFinite(Date.parse(item.learnedAt)) ||
      typeof item.successes !== "number" || !Number.isInteger(item.successes) || item.successes < 1 ||
      typeof item.value !== "number" || !Number.isFinite(item.value)) return [];
    try {
      const program = parseWorkshopProgram(item.program);
      seen.add(item.id);
      return [{ id: item.id, name: item.name, program, successes: Math.min(48, item.successes),
        value: Math.max(0, Math.min(1, item.value)), learnedAt: item.learnedAt }];
    } catch { return []; }
  }).slice(0, 12);
}

// Validate saved output against its immutable source, even after the material moves.
export function hydrateWorkshopMaking(raw: unknown, fragments: NotebookPage["fragments"]): WorkshopMaking | undefined {
  if (!record(raw) || !text(raw.recipeId, 80) || !text(raw.recipeName, 60) || !text(raw.provider, 40) || !text(raw.model, 100) ||
    !member(raw.origin, ["invented", "reused"])) return undefined;
  try {
    const program = parseWorkshopProgram(raw.program);
    if (program.slots.length !== fragments.length || fragments.some((fragment, index) => {
      const slot = program.slots[index]!;
      return (slot.kind !== "any" && slot.kind !== fragment.kind) || !fragment.excerpt ||
        fragment.excerpt !== cutWorkshopText(fragment.text, slot.take);
    })) return undefined;
    return { recipeId: raw.recipeId, recipeName: raw.recipeName, program, origin: raw.origin as WorkshopMaking["origin"],
      provider: raw.provider, model: raw.model };
  } catch { return undefined; }
}

export function hydrateWorkshopGeneration(raw: unknown): WorkshopGeneration | null {
  if (!record(raw) || typeof raw.at !== "string" || !Number.isFinite(Date.parse(raw.at)) || raw.source !== "llm" ||
    !text(raw.provider, 40) || !member(raw.outcome, ["created", "wait", "error"])) return null;
  return { at: raw.at, source: "llm", provider: raw.provider, model: text(raw.model, 100) ? raw.model : null,
    outcome: raw.outcome as WorkshopGeneration["outcome"], recipeId: text(raw.recipeId, 80) ? raw.recipeId : null,
    error: text(raw.error, 100) ? raw.error : null };
}
