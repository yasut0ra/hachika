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

### Phase 2: dynamics 経路の表現力を揃える

legacy 経路が今も担っている差分を dynamics 側へ移す。

- signal ごとの細かい非対称性(repair gate / mistrust spike / attachment rebound)は
  すでに両経路にあるが、`applyBoundedPressure` の headroom 逓減
  (値が高いほど増分が減る)に相当する飽和特性が dynamics 側の derive には薄い
- `deriveVisibleStateFromDynamics()` の target 計算に飽和項を足すか、
  blend 率自体を「baseline からの距離」で減衰させる

完了条件: 既存の scenario test(飽和・回復・履歴差)が
legacy weight を落とした状態でも成立する。

### Phase 3: blend weight の段階的引き下げ

- `blendLegacyVisibleState()` の weight を一括で下げられるよう、
  グローバル係数 `LEGACY_BLEND_SCALE`(1.0 → 0.5 → 0)を導入する
- 各段階で `npm test` + growth metrics 比較を回し、
  逸脱した field だけ Phase 2 に戻して dynamics 側を補強する

### Phase 4: 削除

- `LEGACY_BLEND_SCALE = 0` で全テストが通ったら、
  `src/legacy-visible.ts` と呼び出し(engine の turn 経路、initiative の idle 経路)を削除する
- `applyBoundedPressure` は dynamics 側で使われていなければ一緒に退役する
- README の該当記述を更新する

## 注意

- `updateReactivityFromSignals()`(reactivity の signal 直結更新)は legacy 経路の中にあるが、
  reactivity の履歴性(mistrust の蓄積など)は仕様として残したい。
  Phase 2 で dynamics 経路の `deriveVisibleStateFromDynamics()` 内 reactivity 導出へ
  signal 由来の項を統合してから消すこと。
- persistence は visible state をそのまま保存しているため、
  退役しても snapshot 互換性は壊れない(`dynamics` は既に保存されている)。
