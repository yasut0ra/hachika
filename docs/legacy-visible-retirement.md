# Legacy Visible 経路の退役計画

> **✅ 退役完了(2026-07-12)**: `src/legacy-visible.ts` と `LEGACY_BLEND_SCALE` は削除済み。
> visible state は dynamics substrate から一本で導出される。
> substrate の中核不変条件は `src/substrate-invariants.test.ts` で固定している。
> 以下は退役の経緯と判断の記録として残す。

## 当時の現状

visible state(`state / body / reactivity / attachment`)は、毎ターン **2つの経路で二重に計算**されていた。

- **dynamics 経路(残した側)**
  - `updateDynamicsFromSignals()` が latent な `dynamics` を更新し、
    `deriveVisibleStateFromDynamics()` が visible state を導出する
  - [src/dynamics.ts](../src/dynamics.ts)
- **legacy 経路(退役した側)**
  - `buildLegacyVisibleTurn()` が snapshot を clone して visible state を直接更新し、
    `blendLegacyVisibleState()` が field ごとの weight(0.62〜0.84)で dynamics 側へ混ぜ戻す
  - idle 側は `applyLegacyIdleVisibleShift()` が同じ構造を持っていた

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

**derive 固定点の再キャリブレーション(完了)**:

derive target を全 field「**偏差形式**」(`INITIAL 定数 + Σ 係数 × (現在値 − 初期値)`)に
書き換え、全10 field の固定点が INITIAL 定数と**完全一致**(max gap 0.000)。
一時導入していた `remapTarget` は撤去した。あわせて:

- **reactivity 結合**: tension ← stressLoad(0.22)+ mistrust(0.15)、
  boredom ← noveltyHunger(0.35)、energy ← −stressLoad(0.15)、
  loneliness ← mistrust(0.12)。「傷や飽きの履歴が体に残る」が dynamics 単独で成立する
- **body 慣性**: body の derive blend rate を state より遅くした
  (energy 0.2 / tension 0.34 / boredom・loneliness 0.3)。
  体は物理なので、1 ターンで極端な疲労や退屈が消えない
- **body の床/天井**: body target は [0.02, 0.98] に収め、完全な 0/1 貼り付きを防ぐ
- **reactivity seeding**: revision 0 の snapshot で body だけ手で設定されている場合、
  `reseedDynamicsFromVisibleState` が boredom → noveltyHunger、tension → stressLoad を
  補完する(明示的に設定された reactivity は尊重。低 energy は静かな疲労として stress 扱いしない)
- **下流の再較正**: attachment 平衡の是正(~0.51 → 0.4)に伴い、
  `curiosity_relation` conflict の dominance margin を 0.2 → 0.17 へ調整。
  boundary 系 conflict の intensity には mistrust 由来の wounded boost を追加
  (雑に扱われた記憶が残る間は境界の葛藤を強く感じる)

**scale=0.5 較正(2026-07-12 完了)**: 残っていた4件を較正し、
**scale=1.0 / 0.5 の両方で全テストがグリーン**になった。較正内容:

- dominant conflict の選択に top-motive 関与ボーナス(+0.1)を追加:
  baseline 水準の近接だけで立つ葛藤が、今向かいたい方向の葛藤を覆い隠さない
- wounded boost 係数 0.45 → 0.55
- reply の detailLine 優先順位を調整: 強い境界葛藤と「このターンで動いたばかりの trace
  (決定への昇格など)」は、受動的な記憶想起行より先に出る
- mood の curious 判定しきい値 0.65 → 0.61(dynamics 側では question が
  noveltyDrive を満たして下げるため、旧しきい値は legacy の水増しに較正されていた)

### Phase 3: blend weight の段階的引き下げ(第1段階完了: default 0.5)

- `LEGACY_BLEND_SCALE` 導入済み: 環境変数 `HACHIKA_LEGACY_BLEND_SCALE` または
  test 用の `setLegacyBlendScale()` で一括減衰できる
- **2026-07-12: default を 1.0 → 0.5 に引き下げた。**
  scale=1.0(`HACHIKA_LEGACY_BLEND_SCALE=1`)も全テストグリーンでロールバック可能
- growth metrics 比較(関係形成→共同作業→衝突→修復→放置→再開 の canonical 会話):

  | metric | scale=1.0 | scale=0.5 |
  | --- | --- | --- |
  | state saturation | 0.033 | 0.011(改善) |
  | motive diversity | 3.0 | 3.0 |
  | stress recovery lag | null(即時) | 3 turn(回復曲線が可視化) |
  | identity drift | 1.0 | 1.0 |

- scale=0(dynamics 単独)の中核不変条件は `src/legacy-scale.test.ts` で固定済み:
  温かい入力で relation / pleasure が上がる(絶対) / 飽和しない /
  hostile より positive が温かく着地する / mistrust の蓄積と緩い解け / idle で退屈と孤独が上がる
- **次の関門(scale=0)**: `HACHIKA_LEGACY_BLEND_SCALE=0 npm test` は現在 12 件 fail。
  positive turn の即時反応の弱さ(energy/loneliness の1ターン回復)、mood/wording の較正、
  purpose fulfillment 周りが残り。0.5 と同じ手順(1件ずつ原因分析 → 両スケール検証)で潰す

### Phase 4: 削除(完了: 2026-07-12)

scale=0 で全テストが通ったため、同日中に削除を実施した:

- `src/legacy-visible.ts` と `LEGACY_BLEND_SCALE`(env / setter)を削除
- engine の turn 経路から `buildLegacyVisibleTurn / blendLegacyVisibleState` を除去
  (preference affinity の attachment ボーナスだけ本体へ移植)
- initiative の idle 経路から `applyLegacyIdleVisibleShift` を除去
- legacy 専用だった `applyBodyFromSignals / rewindBodyHours`(body.ts)と
  `applyBoundedPressure`(state.ts)も退役(body.ts は `settleBodyAfterInitiative` のみに)
- `legacy-scale.test.ts` は `substrate-invariants.test.ts` に改名し、
  substrate の恒久的な不変条件テストとして残した

scale=0 到達までの主な較正(いずれも scale=1.0 / 0.5 / 0 の3点で検証):

- 温かさへの substrate 応答強化(safety の socialWarmth 係数、trust への positive 追加)
- pleasure の cognitiveLoad ペナルティ緩和(仕事を頼まれた温かい turn が不快にならない)
- mistrust → tension 結合の強化(stress が抜けても警戒が残る間は体が張る)
- question は noveltyDrive を「満たす」のではなく刺激する側に変更
- boredom / loneliness の慣性強化と seed 強化(退屈・孤独が1ターンで消えない)
- 明示的な completion の purpose progress 寄与を強化
- energy 下限帯の圧縮(平衡 0.56 / 床 0.02)に合わせた gate 再較正(0.22-0.26 → 0.3)

## 注意

- persistence は visible state をそのまま保存しているため、
  退役しても snapshot 互換性は壊れない(`dynamics` は既に保存されている)。
