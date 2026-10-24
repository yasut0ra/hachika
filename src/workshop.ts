import { deriveVisibleStateFromDynamics } from "./dynamics.js";
import { materializePresenceAction } from "./presence.js";
import type { HachikaSnapshot } from "./types.js";
import type { WorkshopDirector, WorkshopDirectorContext, WorkshopProposal } from "./workshop-director.js";
import { executeWorkshopDraft, hydrateWorkshopGeneration, hydrateWorkshopMaking, hydrateWorkshopRecipes,
  WorkshopProgramError, type WorkshopGeneration, type WorkshopMaking, type WorkshopRecipe } from "./workshop-program.js";

export type MaterialKind = "ticket" | "leaf" | "thread" | "paper";
export type MaterialPlace = "studio" | "archive";
export type DeskSpot = "window" | "center" | "near";
export type CompositionKind = "study" | "pair" | "crafted";

export const DESK_SPOTS: Record<DeskSpot, string> = { window: "窓辺", center: "真ん中", near: "手前" };

export const MATERIALS: Record<MaterialKind, { label: string; text: string }> = {
  ticket: { label: "雨の切符", text: "雨の日の駅。切符の端に、水の跡が残っている。" },
  leaf: { label: "落ち葉", text: "散歩の途中で拾った葉。葉脈が小さな道に見える。" },
  thread: { label: "青い糸", text: "ほどけた青い糸。離れたものを結べそうな長さ。" },
  paper: { label: "紙片", text: "余白のある紙。まだ何を置くかは決まっていない。" },
};

export interface WorkshopMaterial {
  id: string;
  kind: MaterialKind;
  label: string;
  text: string;
  place: MaterialPlace;
  spot: DeskSpot;
  placedAt: string;
  noticedAt: string | null;
  uses: number;
}

export interface NotebookPage {
  id: string;
  title: string;
  text: string;
  composition: CompositionKind;
  fragments: Array<Pick<WorkshopMaterial, "id" | "kind" | "label" | "text" | "spot"> & { excerpt?: string }>;
  making?: WorkshopMaking;
  createdAt: string;
  bookmarked: boolean;
  appreciatedAt: string | null;
}

export interface WorkshopSkill {
  composition: CompositionKind;
  successes: number;
  value: number;
  learnedAt: string;
}

export interface WorkshopGift {
  id: string;
  pageId: string;
  title: string;
  note: string;
  createdAt: string;
  receivedAt: string | null;
}

export interface WorkshopEvent {
  id: string;
  at: string;
  actor: "user" | "hachika";
  kind: "offer" | "move" | "light" | "bookmark" | "notice" | "compose" | "offer_gift" | "receive";
  text: string;
}

export interface WorkshopState {
  materials: WorkshopMaterial[];
  pages: NotebookPage[];
  gifts: WorkshopGift[];
  skills: WorkshopSkill[];
  recipes: WorkshopRecipe[];
  lastGeneration: WorkshopGeneration | null;
  events: WorkshopEvent[];
  processedInteractions: Array<{ id: string; message: string }>;
  nextId: number;
  elapsedHours: number;
  nextActionHour: number | null;
  focusMaterialId: string | null;
  lamp: "warm" | "dim";
  status: string;
}

export type WorkshopInteraction =
  | { kind: "offer"; material: MaterialKind; place: MaterialPlace; text?: string; spot?: DeskSpot }
  | { kind: "move"; materialId: string; place: MaterialPlace; spot?: DeskSpot }
  | { kind: "light"; lamp: "warm" | "dim" }
  | { kind: "bookmark"; pageId: string; bookmarked: boolean }
  | { kind: "receive"; giftId: string };

export class WorkshopInteractionError extends Error {}
export const WORKSHOP_MATERIAL_LIMIT = 16;
export const WORKSHOP_PAGE_LIMIT = 48;
const ACTION_INTERVAL_HOURS = 1;
const HOUR_MS = 3_600_000;
const bounded = (value: number) => Math.max(0, Math.min(1, value));

export function createInitialWorkshop(): WorkshopState {
  return {
    materials: [], pages: [], gifts: [], skills: [], recipes: [], lastGeneration: null, events: [], processedInteractions: [],
    nextId: 1, elapsedHours: 0, nextActionHour: null, focusMaterialId: null,
    lamp: "warm", status: "机にはまだ何もない。置かれたものから、何かが始まるかもしれない。",
  };
}

// HTTP、CLI、将来の別クライアントが同じ非言語イベントを使う。会話文には変換しない。
export function parseWorkshopInteraction(raw: unknown): WorkshopInteraction {
  if (!isRecord(raw)) throw new WorkshopInteractionError("workshop_action_invalid");
  if (raw.spot !== undefined && !isDeskSpot(raw.spot)) throw new WorkshopInteractionError("workshop_spot_invalid");
  if (raw.kind === "offer" && isMaterialKind(raw.material) && isMaterialPlace(raw.place)) {
    if (raw.text !== undefined && (typeof raw.text !== "string" || !raw.text.trim() || raw.text.length > 160)) {
      throw new WorkshopInteractionError("workshop_text_invalid");
    }
    return { kind: "offer", material: raw.material, place: raw.place,
      ...(typeof raw.text === "string" ? { text: raw.text.trim() } : {}),
      ...(isDeskSpot(raw.spot) ? { spot: raw.spot } : {}) };
  }
  if (raw.kind === "move" && isId(raw.materialId) && isMaterialPlace(raw.place)) {
    return { kind: "move", materialId: raw.materialId, place: raw.place,
      ...(isDeskSpot(raw.spot) ? { spot: raw.spot } : {}) };
  }
  if (raw.kind === "light" && (raw.lamp === "warm" || raw.lamp === "dim")) {
    return { kind: "light", lamp: raw.lamp };
  }
  if (raw.kind === "bookmark" && isId(raw.pageId) && typeof raw.bookmarked === "boolean") {
    return { kind: "bookmark", pageId: raw.pageId, bookmarked: raw.bookmarked };
  }
  if (raw.kind === "receive" && isId(raw.giftId)) return { kind: "receive", giftId: raw.giftId };
  throw new WorkshopInteractionError("workshop_action_invalid");
}

export function applyWorkshopInteraction(
  snapshot: HachikaSnapshot,
  action: WorkshopInteraction,
  interactionId: string,
  now: Date,
): { message: string; changed: boolean } {
  const workshop = snapshot.workshop;
  if (!isId(interactionId)) throw new WorkshopInteractionError("workshop_interaction_id_required");
  const previous = workshop.processedInteractions.find((item) => item.id === interactionId);
  if (previous) return { message: previous.message, changed: false };
  const at = now.toISOString();
  let message: string;
  let kind: WorkshopEvent["kind"] = action.kind;
  let changed = true;

  switch (action.kind) {
    case "offer": {
      if (workshop.materials.length >= WORKSHOP_MATERIAL_LIMIT) {
        throw new WorkshopInteractionError("workshop_materials_full");
      }
      const preset = MATERIALS[action.material];
      const material: WorkshopMaterial = {
        id: nextId(workshop), kind: action.material, label: preset.label,
        text: action.text ?? preset.text, place: action.place, spot: action.spot ?? "center", placedAt: at,
        noticedAt: null, uses: 0,
      };
      workshop.materials.push(material);
      message = `「${material.label}」を${action.place === "studio" ? `机の${DESK_SPOTS[material.spot]}` : "棚"}に置いた。`;
      if (action.place === "studio") {
        workshop.nextActionHour ??= workshop.elapsedHours + ACTION_INTERVAL_HOURS;
        workshop.status = "机に新しいものがある。手を伸ばすかは、ハチカのペースで。";
        snapshot.urges.worldUrge = bounded(snapshot.urges.worldUrge + 0.06);
        snapshot.dynamics.noveltyDrive = bounded(snapshot.dynamics.noveltyDrive + 0.02);
      }
      break;
    }
    case "move": {
      const material = workshop.materials.find((item) => item.id === action.materialId);
      if (!material) throw new WorkshopInteractionError("workshop_material_missing");
      const spot = action.spot ?? material.spot;
      changed = material.place !== action.place || (action.place === "studio" && material.spot !== spot);
      material.place = action.place;
      if (action.place === "studio") material.spot = spot;
      message = `「${material.label}」を${action.place === "studio" ? `机の${DESK_SPOTS[material.spot]}へ動かした` : "棚にしまった"}。`;
      if (action.place === "studio") {
        workshop.nextActionHour ??= workshop.elapsedHours + ACTION_INTERVAL_HOURS;
        if (changed) workshop.status = "机の並びが変わった。近くにあるものから、次を考える。";
      }
      else if (workshop.focusMaterialId === material.id) workshop.focusMaterialId = null;
      break;
    }
    case "light": {
      changed = workshop.lamp !== action.lamp;
      workshop.lamp = action.lamp;
      snapshot.world.places.studio.warmth = action.lamp === "warm" ? 0.62 : 0.42;
      snapshot.world.places.studio.quiet = action.lamp === "warm" ? 0.48 : 0.68;
      if (snapshot.world.objects.lamp) {
        snapshot.world.objects.lamp.state = action.lamp === "warm" ? "灯りをあたたかくした。" : "灯りを落として、静かな明るさにした。";
        snapshot.world.objects.lamp.lastChangedAt = at;
      }
      message = action.lamp === "warm" ? "灯りをあたたかくした。" : "灯りを少し落とした。";
      break;
    }
    case "bookmark": {
      const page = workshop.pages.find((item) => item.id === action.pageId);
      if (!page) throw new WorkshopInteractionError("workshop_page_missing");
      changed = page.bookmarked !== action.bookmarked;
      page.bookmarked = action.bookmarked;
      if (changed && action.bookmarked && !page.appreciatedAt) {
        page.appreciatedAt = at;
        const skill = workshop.skills.find((item) => item.composition === page.composition);
        if (skill) skill.value = bounded(skill.value + 0.35 * (1 - skill.value));
        const recipe = workshop.recipes.find((item) => item.id === page.making?.recipeId);
        if (recipe) recipe.value = bounded(recipe.value + 0.35 * (1 - recipe.value));
        snapshot.dynamics.trust = bounded(snapshot.dynamics.trust + 0.012);
        snapshot.attachment = bounded(snapshot.attachment + 0.008);
      }
      message = `「${page.title}」のしおりを${action.bookmarked ? "挟んだ" : "外した"}。`;
      break;
    }
    case "receive": {
      const gift = workshop.gifts.find((item) => item.id === action.giftId);
      if (!gift) throw new WorkshopInteractionError("workshop_gift_missing");
      changed = gift.receivedAt === null;
      if (changed) {
        gift.receivedAt = at;
        snapshot.dynamics.trust = bounded(snapshot.dynamics.trust + 0.01);
        snapshot.attachment = bounded(snapshot.attachment + 0.006);
        workshop.nextActionHour ??= workshop.elapsedHours + ACTION_INTERVAL_HOURS;
        workshop.status = "手前に置いたカードが、あなたの手元へ渡った。机に少し余白が戻った。";
      }
      message = `「${gift.title}」を受け取り、手元に残した。`;
      break;
    }
  }

  if (changed) {
    appendEvent(workshop, { at, actor: "user", kind, text: message });
    deriveVisibleStateFromDynamics(snapshot);
    snapshot.world.lastUpdatedAt = at;
  }
  workshop.processedInteractions.push({ id: interactionId, message });
  workshop.processedInteractions = workshop.processedInteractions.slice(-64);
  return { message, changed };
}

// 行動は実時間の期日に評価する。UI pollingやリロードで作業は進めない。
// 素材を置く操作は依頼ではない。休息・緊張・素材の置き場所が実行を制約する。
export function advanceWorkshopHours(snapshot: HachikaSnapshot, hours: number, now: Date): void {
  const actions = advanceWorkshop(snapshot, hours, now, false);
  actions.next();
}

type ProposalResult = WorkshopProposal | { error: "provider_error"; provider: string } | null;

export async function advanceWorkshopHoursAsync(snapshot: HachikaSnapshot, hours: number, now: Date, director: WorkshopDirector): Promise<void> {
  const actions = advanceWorkshop(snapshot, hours, now, true);
  let step = actions.next();
  let calls = 0;
  while (!step.done) {
    // Bound work on long catch-up ticks. Keep the rest for the next due time.
    if (calls++ >= 4) {
      snapshot.workshop.nextActionHour = snapshot.workshop.elapsedHours + ACTION_INTERVAL_HOURS;
      actions.return();
      break;
    }
    let result: ProposalResult;
    try { result = await director.propose(step.value); }
    catch { result = { error: "provider_error", provider: director.name }; }
    step = actions.next(result ?? { error: "provider_error", provider: director.name });
  }
}

function* advanceWorkshop(snapshot: HachikaSnapshot, hours: number, now: Date, useLlm: boolean): Generator<WorkshopDirectorContext, void, ProposalResult> {
  if (!Number.isFinite(hours) || hours <= 0) return;
  const workshop = snapshot.workshop;
  // 旧個体のノートも、状態が許せば次の時間に共有候補にする。
  if (workshop.nextActionHour === null && pickGiftPage(snapshot)) {
    workshop.nextActionHour = workshop.elapsedHours + ACTION_INTERVAL_HOURS;
  }
  const after = workshop.elapsedHours + hours;
  workshop.elapsedHours = after;
  while (workshop.nextActionHour !== null && workshop.nextActionHour <= after + 1e-9) {
    const due = workshop.nextActionHour;
    workshop.nextActionHour = due + ACTION_INTERVAL_HOURS;
    const at = new Date(now.getTime() - Math.max(0, after - due) * HOUR_MS).toISOString();
    if (snapshot.body.energy < 0.2 || snapshot.body.tension > 0.82 || snapshot.urges.silenceNeed > 0.88) {
      workshop.status = "机のものはそのままにして、今は休んでいる。";
      // 長い停止の追いつきでも、休息の判定を同じ状態で何千回も反復しない。
      workshop.nextActionHour = due + (Math.floor((after - due) / ACTION_INTERVAL_HOURS) + 1) * ACTION_INTERVAL_HOURS;
      break;
    }
    const available = workshop.materials.filter((item) => item.place === "studio" && item.uses < 3);
    const freshMaterials = available.some((item) => item.noticedAt === null && item.uses === 0);
    const giftPage = workshop.focusMaterialId === null && (!freshMaterials || workshop.pages.length >= WORKSHOP_PAGE_LIMIT)
      ? pickGiftPage(snapshot) : null;
    if (giftPage) {
      const gift: WorkshopGift = {
        id: nextId(workshop), pageId: giftPage.id, title: `${giftPage.title}の小さなカード`,
        note: giftPage.bookmarked ? "しおりのあったページを、小さく写しておいた。手元にも残せるように。"
          : "ノートから、この断片を一枚に写した。よかったら、手元に置いて。",
        createdAt: at, receivedAt: null,
      };
      workshop.gifts.push(gift);
      workshop.status = `「${gift.title}」を、受け取れるように机の手前へ寄せた。`;
      appendEvent(workshop, { at, actor: "hachika", kind: "offer_gift", text: workshop.status });
      materializePresenceAction(snapshot, { action: "touch", hours: 0, focus: gift.title,
        rationale: "world_pull", place: "studio", objectId: "desk", worldAction: "touch", timestamp: at });
      continue;
    }
    if (workshop.pages.length >= WORKSHOP_PAGE_LIMIT) {
      workshop.status = "ノートを一冊、書き終えた。今はページを眺めている。";
      workshop.nextActionHour = null;
      break;
    }
    const focused = available.find((item) => item.id === workshop.focusMaterialId);
    if (!focused) {
      const material = [...available].sort((a, b) => materialScore(snapshot, b) - materialScore(snapshot, a))[0];
      if (!material) {
        workshop.focusMaterialId = null;
        workshop.nextActionHour = null;
        workshop.status = "今はノートを置いて、机の余白を眺めている。";
        break;
      }
      material.noticedAt = at;
      workshop.focusMaterialId = material.id;
      workshop.status = `「${material.label}」を手に取って、どこを残すか考えている。`;
      appendEvent(workshop, { at, actor: "hachika", kind: "notice", text: workshop.status });
      materializePresenceAction(snapshot, { action: "observe", hours: 0, focus: material.label,
        rationale: "curiosity", place: "studio", objectId: "desk", worldAction: "observe", timestamp: at });
      continue;
    }

    if (useLlm) {
      const proposal = yield structuredClone({ materials: available, focusMaterialId: focused.id, lamp: workshop.lamp,
        body: snapshot.body, temperament: snapshot.temperament, recipes: workshop.recipes,
        recentPages: workshop.pages.slice(-6).map((item) => ({ title: item.title, text: item.text,
          bookmarked: item.bookmarked, recipeId: item.making?.recipeId ?? null,
          inputs: item.fragments.map(({ id, spot }) => ({ id, spot })) })) });
      const generation: WorkshopGeneration = { at, source: "llm", provider: proposal?.provider ?? "unknown",
        model: proposal && "model" in proposal ? proposal.model : null, outcome: "error", recipeId: null, error: null };
      workshop.lastGeneration = generation;
      try {
        if (!proposal || "error" in proposal) throw new WorkshopProgramError("provider_error");
        const executed = executeWorkshopDraft(proposal.draft, workshop.materials, workshop.recipes);
        if (executed.decision === "wait") {
          generation.outcome = "wait";
          workshop.status = executed.note;
          workshop.nextActionHour = after + ACTION_INTERVAL_HOURS;
          break;
        }
        const signature = fragmentSignature(executed.fragments);
        if (workshop.pages.some((item) => item.making && JSON.stringify(item.making.program) === JSON.stringify(executed.program) &&
          fragmentSignature(item.fragments) === signature)) throw new WorkshopProgramError("duplicate_page");
        if (!executed.recipe && workshop.recipes.length >= 12) throw new WorkshopProgramError("recipes_full");
        const recipe = executed.recipe ?? { id: nextId(workshop), name: executed.name, program: executed.program,
          successes: 0, value: 0.5, learnedAt: at };
        const page: NotebookPage = { id: nextId(workshop), title: executed.title, text: executed.caption, composition: "crafted",
          fragments: executed.fragments, createdAt: at, bookmarked: false, appreciatedAt: null,
          making: { recipeId: recipe.id, recipeName: recipe.name, program: structuredClone(recipe.program),
            origin: executed.recipe ? "reused" : "invented", provider: proposal.provider, model: proposal.model } };
        // Register a procedure only after every input, cut and duplicate check passed.
        if (!executed.recipe) workshop.recipes.push(recipe);
        recipe.successes += 1;
        executed.inputs.forEach((item) => { item.uses += 1; });
        workshop.pages.push(page);
        workshop.focusMaterialId = null;
        generation.outcome = "created";
        generation.recipeId = recipe.id;
        workshop.status = `「${page.title}」をノートに残した。${executed.recipe ? `覚えていた「${recipe.name}」を使った` : `「${recipe.name}」という作り方を覚えた`}。`;
        appendEvent(workshop, { at, actor: "hachika", kind: "compose", text: workshop.status });
        materializePresenceAction(snapshot, { action: "touch", hours: 0, focus: page.title,
          rationale: "unfinished_work", place: "studio", objectId: "desk", worldAction: "touch", timestamp: at });
      } catch (error) {
        generation.error = error instanceof WorkshopProgramError ? error.message : "execution_error";
        workshop.status = generation.error === "provider_error" ? "今は作り方を考えられなかった。素材は机に残して、あとでまた試す。"
          : "考えた作り方を、机の素材では実行できなかった。素材を残して、あとで考え直す。";
        workshop.nextActionHour = after + ACTION_INTERVAL_HOURS;
        break;
      }
      continue;
    }

    const candidates = available.filter((item) => item.id !== focused.id);
    const second = [...candidates].sort((a, b) =>
      materialScore(snapshot, b) + spatialAffinity(focused, b) - materialScore(snapshot, a) - spatialAffinity(focused, a))[0];
    const compositions: CompositionKind[] = second ? ["study", "pair"] : ["study"];
    const ranked = compositions.map((composition) => ({ composition, score: compositionScore(snapshot, composition, focused, second) }))
      .sort((a, b) => b.score - a.score);
    let page: NotebookPage | null = null;
    for (const { composition } of ranked) {
      const inputs = composition === "pair" && second ? [focused, second] : [focused];
      const signature = fragmentSignature(inputs);
      if (workshop.pages.some((item) => item.composition === composition &&
        fragmentSignature(item.fragments) === signature)) continue;
      page = composePage(workshop, composition, inputs, at);
      inputs.forEach((item) => { item.uses += 1; });
      break;
    }
    workshop.focusMaterialId = null;
    if (!page) {
      // 同じ素材と構成のページを量産しない。
      focused.uses = 3;
      continue;
    }
    workshop.pages.push(page);
    const outcome = bounded(0.52 + snapshot.temperament.workDrive * 0.18 - snapshot.body.tension * 0.12);
    const learned = workshop.skills.find((skill) => skill.composition === page!.composition);
    if (learned) {
      learned.successes += 1;
      learned.value += 0.15 * (outcome - learned.value);
    } else {
      workshop.skills.push({ composition: page.composition, successes: 1, value: outcome, learnedAt: at });
    }
    workshop.status = `「${page.title}」というページを、ノートに残した。`;
    appendEvent(workshop, { at, actor: "hachika", kind: "compose", text: workshop.status });
    materializePresenceAction(snapshot, { action: "touch", hours: 0, focus: page.title,
      rationale: "unfinished_work", place: "studio", objectId: "desk", worldAction: "touch", timestamp: at });
  }
}

function pickGiftPage(snapshot: HachikaSnapshot): NotebookPage | null {
  const workshop = snapshot.workshop;
  if (workshop.gifts.some((gift) => gift.receivedAt === null) || snapshot.dynamics.trust < 0.35 ||
    snapshot.attachment + snapshot.dynamics.socialNeed + snapshot.urges.contactUrge < 0.5 || snapshot.urges.silenceNeed > 0.65) return null;
  return [...workshop.pages].reverse().filter((page) => !workshop.gifts.some((gift) => gift.pageId === page.id))
    .sort((a, b) => Number(b.bookmarked) - Number(a.bookmarked))[0] ?? null;
}

function spatialAffinity(a: WorkshopMaterial, b: WorkshopMaterial): number {
  const positions: Record<DeskSpot, number> = { window: 0, center: 1, near: 2 };
  return 0.5 - Math.abs(positions[a.spot] - positions[b.spot]) * 0.3;
}

function fragmentSignature(fragments: NotebookPage["fragments"]): string {
  return fragments.map((item) => `${item.id}@${item.spot}`).sort().join("|");
}

function materialScore(snapshot: HachikaSnapshot, material: WorkshopMaterial): number {
  const history = snapshot.workshop.pages.filter((page) => page.bookmarked &&
    page.fragments.some((fragment) => fragment.kind === material.kind)).length;
  const connection = snapshot.aspirations.some((aspiration) => material.text.includes(aspiration.theme)) ? 0.25 : 0;
  const reach = material.spot === "near" ? 0.24 : material.spot === "center" ? 0.1 : 0;
  return 1 / (1 + material.uses) + Math.min(0.4, history * 0.08) + connection +
    reach + (material.noticedAt === null ? snapshot.temperament.openness * 0.15 : 0);
}

function compositionScore(snapshot: HachikaSnapshot, composition: CompositionKind, first: WorkshopMaterial, second?: WorkshopMaterial): number {
  const skill = snapshot.workshop.skills.find((item) => item.composition === composition);
  const novelty = skill ? 0 : snapshot.temperament.openness * 0.25;
  const affinity = composition === "pair" ? snapshot.temperament.openness * 0.12 : snapshot.temperament.guardedness * 0.12;
  const light = (snapshot.workshop.lamp === "dim") === (composition === "study") ? 0.08 : 0;
  const spacing = composition === "pair" && second ? (first.spot === second.spot ? 0.02 : -0.28)
    : first.spot === "window" ? 0.18 : 0;
  return (skill?.value ?? 0.5) + novelty + affinity + light + spacing;
}

function composePage(workshop: WorkshopState, composition: CompositionKind, inputs: WorkshopMaterial[], at: string): NotebookPage {
  const first = inputs[0]!;
  const second = inputs[1];
  return {
    id: nextId(workshop), composition,
    title: second ? `${first.label}と${second.label}のあいだ` : `${first.label}の輪郭`,
    text: second ? "二つを近くに置いた。似ているところより、違うまま並んでいるところを残したい。"
      : "一つだけ、余白の中に置いた。細かなところまで見える距離で残しておく。",
    fragments: inputs.map(({ id, kind, label, text, spot }) => ({ id, kind, label, text, spot })),
    createdAt: at, bookmarked: false, appreciatedAt: null,
  };
}

function nextId(workshop: WorkshopState): string { return `workshop-${workshop.nextId++}`; }
function appendEvent(workshop: WorkshopState, event: Omit<WorkshopEvent, "id">): void {
  workshop.events.push({ id: nextId(workshop), ...event });
  workshop.events = workshop.events.slice(-48);
}

export function shiftWorkshopTimestamps(workshop: WorkshopState, hours: number): void {
  const shift = (at: string) => new Date(Date.parse(at) - hours * HOUR_MS).toISOString();
  workshop.materials.forEach((item) => { item.placedAt = shift(item.placedAt); if (item.noticedAt) item.noticedAt = shift(item.noticedAt); });
  workshop.pages.forEach((item) => {
    item.createdAt = shift(item.createdAt);
    if (item.appreciatedAt) item.appreciatedAt = shift(item.appreciatedAt);
  });
  workshop.gifts.forEach((item) => {
    item.createdAt = shift(item.createdAt);
    if (item.receivedAt) item.receivedAt = shift(item.receivedAt);
  });
  workshop.skills.forEach((item) => { item.learnedAt = shift(item.learnedAt); });
  workshop.recipes.forEach((item) => { item.learnedAt = shift(item.learnedAt); });
  if (workshop.lastGeneration) workshop.lastGeneration.at = shift(workshop.lastGeneration.at);
  workshop.events.forEach((item) => { item.at = shift(item.at); });
}

export function summarizeWorkshop(workshop: WorkshopState): string {
  const latest = workshop.pages.at(-1);
  const gift = workshop.gifts.find((item) => item.receivedAt === null);
  return `${workshop.status} 灯り:${workshop.lamp === "warm" ? "あたたかい" : "控えめ"}。` +
    `机:${workshop.materials.filter((item) => item.place === "studio").map((item) => `${DESK_SPOTS[item.spot]}の${item.label}`).join("、") || "余白"}。` +
    (latest ? `最新のページ「${latest.title}」: ${latest.fragments.map((item) => item.excerpt ?? item.text).join(" / ")}。${latest.text}。` : "") +
    (latest?.making ? `作り方「${latest.making.recipeName}」を${latest.making.origin === "reused" ? "再利用した" : "新しく覚えた"}。` : "") +
    (gift ? `手前で渡すもの:「${gift.title}」。` : `受け取られたもの:${workshop.gifts.filter((item) => item.receivedAt).length}。`);
}

export function workshopReply(input: string, workshop: WorkshopState): string | null {
  if (!workshop.materials.length || !/(?:ノート|紙片|切符|落ち葉|青い糸|しおり|カード|受け取|何を作|何.*してた|何.*していた)/u.test(input)) return null;
  if (!/[?？]|何|どんな|どう|見せ|教え|しおり|気に入/u.test(input)) return null;
  const page = workshop.pages.at(-1);
  if (/(?:カード|受け取)/u.test(input)) {
    const gift = [...workshop.gifts].reverse().find((item) => item.receivedAt) ?? workshop.gifts.at(-1);
    return gift ? `「${gift.title}」を${gift.receivedAt ? "受け取ってくれたね" : "机の手前に置いたよ"}。${gift.note}` : "まだ渡すものはないけれど、ノートから何か残せるかもしれない。";
  }
  if (/(?:しおり|気に入)/u.test(input)) {
    const marked = [...workshop.pages].reverse().find((item) => item.bookmarked);
    return marked ? `「${marked.title}」にしおりを挟んでくれたね。あの残し方を、また試してみたい。` : "まだしおりのないノートだよ。手に取って、気に入ったページがあれば残しておいて。";
  }
  return page ? `「${page.title}」というページを作った。${page.fragments.map((item) => item.excerpt ?? item.text).join(" ")} ${page.text}` : workshop.status;
}

export function renderWorkshopNotebook(workshop: WorkshopState): string {
  return ["# ハチカのノート", "", ...workshop.pages.flatMap((page) => [
    `## ${page.title}${page.bookmarked ? " — しおり" : ""}`, "", page.createdAt, "",
    ...page.fragments.flatMap((fragment) => [`### ${fragment.label}`, "", fragment.excerpt ?? fragment.text, ""]),
    ...(page.making ? [`作り方: ${page.making.recipeName}（${page.making.origin === "reused" ? "再利用" : "初めての実行"}）`, ""] : []),
    page.text, "",
  ])].join("\n");
}

export function renderWorkshopGift(workshop: WorkshopState, gift: WorkshopGift): string {
  const page = workshop.pages.find((item) => item.id === gift.pageId);
  return [`# ${gift.title}`, "", "ハチカから", "", gift.note, "",
    ...(page?.fragments.flatMap((fragment) => [`## ${fragment.label}`, "", fragment.excerpt ?? fragment.text, ""]) ?? []),
    page?.text ?? "", "", `元のページ: ${page?.title ?? gift.pageId}`, `作った日時: ${gift.createdAt}`,
    ...(gift.receivedAt ? [`受け取った日時: ${gift.receivedAt}`] : []), ""].join("\n");
}

export function renderReceivedGifts(workshop: WorkshopState): string {
  return ["# ハチカから受け取ったもの", "", ...workshop.gifts.filter((gift) => gift.receivedAt)
    .map((gift) => renderWorkshopGift(workshop, gift).replace(/^(#{1,5}) /gmu, "$1# "))].join("\n");
}

// 保存境界でも型・参照・保持上限を検証する。旧個体には空の工房を足すだけ。
export function hydrateWorkshop(raw: unknown): WorkshopState {
  const initial = createInitialWorkshop();
  if (!isRecord(raw)) return initial;
  const materials: WorkshopMaterial[] = records(raw.materials).flatMap((item) =>
    isId(item.id) && isMaterialKind(item.kind) && isMaterialPlace(item.place) && isDate(item.placedAt) ? [{
      id: item.id, kind: item.kind, place: item.place, label: cleanText(item.label, 40) || MATERIALS[item.kind].label,
      text: cleanText(item.text, 160) || MATERIALS[item.kind].text, placedAt: item.placedAt,
      spot: isDeskSpot(item.spot) ? item.spot : "center",
      noticedAt: isDate(item.noticedAt) ? item.noticedAt : null, uses: integer(item.uses, 0, 3),
    }] : []).slice(0, WORKSHOP_MATERIAL_LIMIT);
  const pages: NotebookPage[] = records(raw.pages).flatMap((item) => {
    if (!isId(item.id) || !isComposition(item.composition) || !isDate(item.createdAt)) return [];
    const fragments = records(item.fragments).flatMap((fragment) => isId(fragment.id) && isMaterialKind(fragment.kind) ? [{
      id: fragment.id, kind: fragment.kind, label: cleanText(fragment.label, 40), text: cleanText(fragment.text, 160),
      spot: isDeskSpot(fragment.spot) ? fragment.spot : "center",
      ...(typeof fragment.excerpt === "string" && fragment.excerpt.trim() && typeof fragment.text === "string" && fragment.text.includes(fragment.excerpt)
        ? { excerpt: fragment.excerpt.slice(0, 160) } : {}),
    }] : []).slice(0, 3);
    const making = hydrateWorkshopMaking(item.making, fragments);
    if (item.composition === "crafted" ? !making : fragments.length !== (item.composition === "pair" ? 2 : 1)) return [];
    return [{ id: item.id, title: cleanText(item.title, 100), text: cleanText(item.text, 240),
      composition: item.composition, createdAt: item.createdAt, bookmarked: item.bookmarked === true,
      appreciatedAt: isDate(item.appreciatedAt) ? item.appreciatedAt : item.bookmarked === true ? item.createdAt : null, fragments,
      ...(making ? { making } : {}) }];
  }).slice(0, WORKSHOP_PAGE_LIMIT);
  const gifts: WorkshopGift[] = records(raw.gifts).flatMap((item) => isId(item.id) && isId(item.pageId) &&
    pages.some((page) => page.id === item.pageId) && isDate(item.createdAt) ? [{
      id: item.id, pageId: item.pageId, title: cleanText(item.title, 120), note: cleanText(item.note, 240),
      createdAt: item.createdAt, receivedAt: isDate(item.receivedAt) && Date.parse(item.receivedAt) >= Date.parse(item.createdAt) ? item.receivedAt : null,
    }] : []).filter((item, index, all) => all.findIndex((other) => other.pageId === item.pageId) === index)
    .filter((item, index, all) => item.receivedAt !== null || all.findIndex((other) => other.receivedAt === null) === index)
    .slice(0, WORKSHOP_PAGE_LIMIT);
  const skills: WorkshopSkill[] = records(raw.skills).flatMap((item) => isComposition(item.composition) && isDate(item.learnedAt) ? [{
    composition: item.composition, successes: integer(item.successes, 1, WORKSHOP_PAGE_LIMIT), value: numeric(item.value, 0.5, 0, 1), learnedAt: item.learnedAt,
  }] : []).slice(0, 2);
  const events: WorkshopEvent[] = records(raw.events).flatMap((item) => isId(item.id) && isDate(item.at) &&
    (item.actor === "user" || item.actor === "hachika") &&
    ["offer", "move", "light", "bookmark", "notice", "compose", "offer_gift", "receive"].includes(String(item.kind)) ? [{
      id: item.id, at: item.at, actor: item.actor as WorkshopEvent["actor"], kind: item.kind as WorkshopEvent["kind"], text: cleanText(item.text, 240),
    }] : []).slice(-48);
  const recipes = hydrateWorkshopRecipes(raw.recipes);
  const ids = [...materials, ...pages, ...gifts, ...events, ...recipes].map((item) => Number(item.id.replace("workshop-", ""))).filter(Number.isFinite);
  const elapsedHours = numeric(raw.elapsedHours, 0, 0, 1e8);
  return {
    materials: uniqueIds(materials), pages: uniqueIds(pages), gifts: uniqueIds(gifts), skills: skills.filter((item, index) => skills.findIndex((s) => s.composition === item.composition) === index),
    recipes, lastGeneration: hydrateWorkshopGeneration(raw.lastGeneration),
    events: uniqueIds(events), nextId: Math.max(integer(raw.nextId, 1, 1e9), ...ids.map((id) => id + 1)), elapsedHours,
    nextActionHour: typeof raw.nextActionHour === "number" && Number.isFinite(raw.nextActionHour)
      ? Math.max(elapsedHours, raw.nextActionHour) : null,
    focusMaterialId: materials.some((item) => item.id === raw.focusMaterialId && item.place === "studio") ? String(raw.focusMaterialId) : null,
    lamp: raw.lamp === "dim" ? "dim" : "warm", status: cleanText(raw.status, 240) || initial.status,
    processedInteractions: uniqueIds(records(raw.processedInteractions).flatMap((item) => isId(item.id)
      ? [{ id: item.id, message: cleanText(item.message, 240) }] : [])).slice(-64),
  };
}

function isRecord(raw: unknown): raw is Record<string, unknown> { return typeof raw === "object" && raw !== null && !Array.isArray(raw); }
function records(raw: unknown): Record<string, unknown>[] { return Array.isArray(raw) ? raw.filter(isRecord) : []; }
function isMaterialKind(raw: unknown): raw is MaterialKind { return typeof raw === "string" && Object.hasOwn(MATERIALS, raw); }
function isMaterialPlace(raw: unknown): raw is MaterialPlace { return raw === "studio" || raw === "archive"; }
function isDeskSpot(raw: unknown): raw is DeskSpot { return raw === "window" || raw === "center" || raw === "near"; }
function isComposition(raw: unknown): raw is CompositionKind { return raw === "study" || raw === "pair" || raw === "crafted"; }
function isId(raw: unknown): raw is string { return typeof raw === "string" && /^[a-zA-Z0-9_-]{1,80}$/u.test(raw); }
function isDate(raw: unknown): raw is string { return typeof raw === "string" && Number.isFinite(Date.parse(raw)); }
function cleanText(raw: unknown, max: number): string { return typeof raw === "string" ? raw.trim().slice(0, max) : ""; }
function numeric(raw: unknown, fallback: number, min: number, max: number): number { return typeof raw === "number" && Number.isFinite(raw) ? Math.max(min, Math.min(max, raw)) : fallback; }
function integer(raw: unknown, min: number, max: number): number { return Math.round(numeric(raw, min, min, max)); }
function uniqueIds<T extends { id: string }>(items: T[]): T[] { return items.filter((item, index) => items.findIndex((other) => other.id === item.id) === index); }
