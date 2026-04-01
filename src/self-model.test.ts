import assert from "node:assert/strict";
import test from "node:test";

import { buildSelfModel } from "./self-model.js";
import { createInitialSnapshot } from "./state.js";

test("recent work claims boost continue_shared_work and shape its reason", () => {
  const baseline = createInitialSnapshot();
  baseline.identity.anchors = [];
  baseline.state.expansion = 0.42;
  baseline.state.curiosity = 0.34;
  baseline.state.relation = 0.22;
  baseline.attachment = 0.18;
  baseline.body.energy = 0.62;
  baseline.body.boredom = 0.18;
  baseline.body.loneliness = 0.16;
  baseline.temperament.workDrive = 0.68;
  baseline.temperament.bondingBias = 0.26;
  baseline.relationImprints.shared_work = {
    kind: "shared_work",
    salience: 0.22,
    closeness: 0.18,
    mentions: 1,
    firstSeenAt: "2026-04-01T00:00:00.000Z",
    lastSeenAt: "2026-04-01T00:00:00.000Z",
  };

  const withClaim = structuredClone(baseline);
  withClaim.discourse.recentClaims.push({
    subject: "user",
    kind: "work",
    text: "仕様の境界を3つに分けて整理したい",
    updatedAt: "2026-04-01T00:00:00.000Z",
  });

  const baselineWork = findMotive(buildSelfModel(baseline), "continue_shared_work");
  const claimedWork = findMotive(buildSelfModel(withClaim), "continue_shared_work");

  assert.ok(claimedWork.score > baselineWork.score);
  assert.match(claimedWork.reason, /仕様の境界/u);
});

test("unresolved direct referent demand cools relation-first motives", () => {
  const baseline = createInitialSnapshot();
  baseline.identity.anchors = [];
  baseline.state.relation = 0.66;
  baseline.attachment = 0.52;
  baseline.body.loneliness = 0.54;
  baseline.body.energy = 0.58;
  baseline.temperament.bondingBias = 0.82;
  baseline.temperament.selfDisclosureBias = 0.76;
  baseline.temperament.guardedness = 0.18;
  baseline.discourse.recentClaims.push({
    subject: "user",
    kind: "relation",
    text: "今日は少しゆっくり話したい",
    updatedAt: "2026-04-01T00:00:00.000Z",
  });
  baseline.discourse.recentClaims.push({
    subject: "user",
    kind: "state",
    text: "少し疲れてる",
    updatedAt: "2026-04-01T00:00:00.000Z",
  });

  const withDemand = structuredClone(baseline);
  withDemand.discourse.openQuestions.push({
    target: "hachika_name",
    text: "あなたの名前は？",
    askedAt: "2026-04-01T00:00:00.000Z",
    status: "open",
    resolvedAt: null,
  });

  const baselineRelation = findMotive(buildSelfModel(baseline), "deepen_relation");
  const demandedRelation = findMotive(buildSelfModel(withDemand), "deepen_relation");

  assert.ok(demandedRelation.score < baselineRelation.score);
});

test("relation corrections can shape deepen_relation without inventing a topic", () => {
  const snapshot = createInitialSnapshot();
  snapshot.identity.anchors = [];
  snapshot.state.relation = 0.52;
  snapshot.attachment = 0.38;
  snapshot.body.loneliness = 0.36;
  snapshot.temperament.bondingBias = 0.72;
  snapshot.temperament.selfDisclosureBias = 0.68;
  snapshot.discourse.lastCorrection = {
    target: "relation",
    kind: "relation",
    text: "落ち着いて話したい",
    updatedAt: "2026-04-01T00:00:00.000Z",
  };

  const relation = findMotive(buildSelfModel(snapshot), "deepen_relation");

  assert.match(relation.reason, /言い直された距離感/u);
});

function findMotive(
  model: ReturnType<typeof buildSelfModel>,
  kind: ReturnType<typeof buildSelfModel>["topMotives"][number]["kind"],
) {
  const motive = model.topMotives.find((candidate) => candidate.kind === kind);
  if (!motive) {
    throw new Error(`Missing motive: ${kind}`);
  }
  return motive;
}
