# Legacy Visible 経路の退役計画

## 現状

visible state(`state / body / reactivity / attachment`)は、毎ターン **2つの経路で二重に計算**されている。

- **dynamics 経路(残す側)**
  - `updateDynamicsFromSignals()` が latent な `dynamics` を更新し、
    `deriveVisibleStateFromDynamics()` が visible state を導出する
  - [src/dynamics.ts](../src/dynamics.ts)
- **legacy 経路(退役する側)**
  - `buildLegacyVisibleTurn()` が snapshot を clone して visible state を直接更新し、
    `blendLegacyVisibleState()` が field ごとの weight(0.62〜0.84)で dynamics 側へ混ぜ戻す
  - idle 側は `applyLegacyIdleVisibleShift()` が同じ構造を持つ
  - [src/legacy-visible.ts](../src/legacy-visible.ts) に隔離済み

## なぜ退役するか

- **変更コストが約2〜3倍**: 新しいメカニズム(直近では `mistrust`)を入れるたびに、
  dynamics 経路・legacy turn 経路・legacy idle 経路の3箇所へ同種のロジックを通す必要がある
- **blend weight が「第三の隠れモデル」**: どちらの経路が挙動を支配しているかが
  field ごとの weight に埋まっていて、外から追えない
- **チューニングの解釈が難しい**: 片方の経路の係数を変えても、
  blend 後の実効変化量は weight を掛けた分しか動かない

## 退役の進め方

原則: **挙動比較は wording ではなく snapshot / growth metrics で行う。**
`docs/growth-metrics.md` の saturation / recovery / motive diversity を比較軸に使う。

### Phase 1: 隔離(完了)

- legacy 3関数を `src/legacy-visible.ts` へ移動し、engine / initiative は import するだけにする
- 新規メカニズムは必ず dynamics 経路を primary として実装し、
  legacy 側は「同じ向きの近似」だけを持つ

### Phase 2: dynamics 経路の表現力を揃える(進行中)

完了済み:

- **reactivity の substrate 化**: `updateReactivityFromSignals`(turn)と
  `rewindReactivityHours`(idle)を [src/dynamics.ts](../src/dynamics.ts) に移し、
  reactivity の唯一の更新元にした。legacy 経路は同じ関数を共有するため
  blend 対象から外れた(mistrust の蓄積は scale=0 でも動く)
- **headroom 飽和**: `deriveVisibleStateFromDynamics()` の blend に
  「極値に近い側へ動くほど鈍る」減衰を追加(中央で 1.0 に正規化)
- trust の増加項に `positive` signal を追加(感謝が trust を動かないバグ相当の欠落)

残作業 — **derive 固定点の再キャリブレーション**:

`INITIAL_DYNAMICS` を入れたときの derive 平衡値が `INITIAL_STATE / INITIAL_BODY /
INITIAL_ATTACHMENT` とずれており、legacy blend がこのズレを隠している。
scale=0 では会話内容に関係なく平衡値へ緩和するドリフトが出る。
測定したギャップ(平衡値 − 初期定数):

| field | gap |
| --- | --- |
| pleasure | −0.04 |
| relation | −0.03 |
| curiosity | ≈0 |
| continuity | −0.09 |
| expansion | +0.08 |
| energy | −0.10 |
| tension | +0.07 |
| boredom | +0.18 |
| loneliness | +0.10 |
| attachment | +0.11 |

対応方針: derive の base 定数を初期定数と揃うよう再調整するか、
初期定数側を平衡値に寄せる。どちらも scale=1 の挙動が少し動くため、
growth metrics(saturation / recovery / motive diversity)の比較付きで行う。

完了条件: [src/legacy-scale.test.ts](../src/legacy-scale.test.ts) の
差分不変条件(`lands warmer than hostile`)を絶対不変条件
(`positive turn raises relation and pleasure`)へ戻せること。

### Phase 3: blend weight の段階的引き下げ(ダイヤル導入済み)

- `LEGACY_BLEND_SCALE` を導入済み: 環境変数 `HACHIKA_LEGACY_BLEND_SCALE`
  (default 1.0)または test 用の `setLegacyBlendScale()` で
  turn の state/body/attachment blend と idle の body blend を一括減衰できる
- scale=0(dynamics 単独)の中核不変条件は `src/legacy-scale.test.ts` で固定済み:
  飽和しない / hostile より positive が温かく着地する / mistrust の蓄積と緩release / idle で退屈と孤独が上がる
- 今後: Phase 2 の固定点調整後、default を 1.0 → 0.5 → 0 へ段階的に下げ、
  各段階で `npm test` + growth metrics 比較を回す

### Phase 4: 削除

- `LEGACY_BLEND_SCALE = 0` で全テストが通ったら、
  `src/legacy-visible.ts` と呼び出し(engine の turn 経路、initiative の idle 経路)を削除する
- `applyBoundedPressure` は dynamics 側で使われていなければ一緒に退役する
- README の該当記述を更新する

## 注意

- persistence は visible state をそのまま保存しているため、
  退役しても snapshot 互換性は壊れない(`dynamics` は既に保存されている)。
