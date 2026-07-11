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

残作業 — **derive 固定点の再キャリブレーション(部分完了)**:

`INITIAL_DYNAMICS` を入れたときの derive 平衡値が `INITIAL_STATE / INITIAL_BODY /
INITIAL_ATTACHMENT` とずれており、legacy blend がこのズレを隠している。
対応として `remapTarget()`((0,0)-(平衡値→初期定数)-(1,1) の区分線形リマップ)を導入し、
**ギャップの小さい pleasure / relation / curiosity はピン留め済み**。
これにより scale=0 でも「温かい入力で relation / pleasure が上がる」絶対不変条件が成立する。

未ピン留めの field(平衡値 − 初期定数のギャップ):

| field | gap | ピン留めを見送った理由 |
| --- | --- | --- |
| continuity | −0.09 | baseline の motive 序列が変わる(relation より continuity が勝つ) |
| expansion | +0.08 | boundary conflict wording の分岐が変わる |
| energy | −0.10 | preserve 系 wording(低 energy 分岐)が出なくなる |
| tension | +0.07 | 敵意後の回復曲線が速くなりすぎ、痕跡が 6 turn で消える |
| boredom | +0.18 | deepen 系 wording(高 boredom 分岐)が出なくなる |
| loneliness | +0.10 | (単純オフセットでは床が抜ける) |
| attachment | +0.11 | deepen_relation motive が pursue_curiosity に負ける |

これらは**単純な写像では吸収できない**ことがテストで確認済み。ギャップが大きい field は
derive の式自体が reactivity(stressLoad / noveltyHunger)や履歴を見ていないことが原因なので、
写像ではなく式の再設計(tension ← stressLoad、boredom ← noveltyHunger の取り込みと係数再配分)が必要。

**scale=0.5 の検証結果(2026-07-12)**: `HACHIKA_LEGACY_BLEND_SCALE=0.5 npm test` で
9件失敗。全て上記の未ピン留め field(energy / boredom / loneliness の閾値・wording)由来。
つまり body 系の式再設計が終わるまで default は 1.0 のまま。

### Phase 3: blend weight の段階的引き下げ(ダイヤル導入済み)

- `LEGACY_BLEND_SCALE` を導入済み: 環境変数 `HACHIKA_LEGACY_BLEND_SCALE`
  (default 1.0)または test 用の `setLegacyBlendScale()` で
  turn の state/body/attachment blend と idle の body blend を一括減衰できる
- scale=0(dynamics 単独)の中核不変条件は `src/legacy-scale.test.ts` で固定済み:
  温かい入力で relation / pleasure が上がる(絶対) / 飽和しない /
  hostile より positive が温かく着地する / mistrust の蓄積と緩い解け / idle で退屈と孤独が上がる
- 今後: Phase 2 の body 系式再設計後、default を 1.0 → 0.5 → 0 へ段階的に下げ、
  各段階で `npm test` + growth metrics 比較を回す(0.5 の初回検証は上記の通り 9 件 fail)

### Phase 4: 削除

- `LEGACY_BLEND_SCALE = 0` で全テストが通ったら、
  `src/legacy-visible.ts` と呼び出し(engine の turn 経路、initiative の idle 経路)を削除する
- `applyBoundedPressure` は dynamics 側で使われていなければ一緒に退役する
- README の該当記述を更新する

## 注意

- persistence は visible state をそのまま保存しているため、
  退役しても snapshot 互換性は壊れない(`dynamics` は既に保存されている)。
