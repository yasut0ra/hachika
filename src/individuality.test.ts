import assert from "node:assert/strict";
import test from "node:test";

import { liveCanonicalLife } from "./canonical-lives.js";
import {
  calculateConstitutionDistance,
  calculateVoiceDistance,
} from "./growth-metrics.js";

// v3 Phase 5: 同じ実装・同じ birth 値の個体が、生き方によって
// 測定可能に違う存在になることの実証。
// 「同種の人生の個体同士は、異種の人生の個体より近い」= 盲検分類可能性の核

test("individuality: three canonical lives settle into separable constitutions", () => {
  const warm = liveCanonicalLife("warm");
  const wounded = liveCanonicalLife("wounded");
  const neglected = liveCanonicalLife("neglected");

  // 各人生の署名: 温かい生は快の基準が高く、傷の生は張りの基準が高い
  assert.ok(
    warm.constitution.driveSetPoints.pleasure >
      wounded.constitution.driveSetPoints.pleasure,
  );
  assert.ok(
    wounded.constitution.bodySetPoints.tension >
      warm.constitution.bodySetPoints.tension,
  );
  // 放置の生は、関係の基準 (attachment set-point) が育たない
  assert.ok(
    warm.constitution.attachmentSetPoint > neglected.constitution.attachmentSetPoint,
  );

  // 3つの人生はどのペアでも constitution が分離する
  assert.ok(calculateConstitutionDistance(warm, wounded) > 0.008);
  assert.ok(calculateConstitutionDistance(warm, neglected) > 0.008);
  assert.ok(calculateConstitutionDistance(wounded, neglected) > 0.008);
});

test("individuality: same life stays closer than different lives", () => {
  // 話題だけ違う同種の人生 (温かい生 ×2) と、異種の人生 (傷の生)
  const warmWalk = liveCanonicalLife("warm", "散歩");
  const warmMusic = liveCanonicalLife("warm", "音楽");
  const wounded = liveCanonicalLife("wounded");

  const withinLife = calculateConstitutionDistance(warmWalk, warmMusic);
  const acrossLives = Math.min(
    calculateConstitutionDistance(warmWalk, wounded),
    calculateConstitutionDistance(warmMusic, wounded),
  );

  // 同種の人生の個体同士は、異種の人生の個体より近い (盲検分類可能)
  assert.ok(
    withinLife < acrossLives,
    `within=${withinLife} should be < across=${acrossLives}`,
  );

  // 声も生き方で分かれうる (少なくとも距離が定義できる)
  assert.ok(calculateVoiceDistance(warmWalk, wounded) >= 0);
});
