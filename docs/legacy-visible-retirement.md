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

**scale=0.5 の検証結果(2026-07-12 再測)**: 9件 → **4件失敗**まで削減。
残りは conflict の種類選択と wording 分岐が scale=1.0 の挙動に較正されていることによる差
(生命らしさの不変条件は scale=0 でも全て成立):

- `self-model surfaces curiosity and relation conflict`(continuity_curiosity へ flip)
- `self-model can keep a topic while surfacing boundary conflict`(conflict 行の強度不足)
- `ordinary reply can surface unresolved trace work`(wording 分岐)
- `scenario: aligned work can persist as a purpose and resolve into a decision`(guarded mood 側の template へ)

これらは「バグ」ではなく scale=0.5 での性格差なので、default を 0.5 へ下げる際に
threshold / template 較正として意図的に取り込むのが正しい。default は 1.0 のまま。

### Phase 3: blend weight の段階的引き下げ(ダイヤル導入済み)

- `LEGACY_BLEND_SCALE` を導入済み: 環境変数 `HACHIKA_LEGACY_BLEND_SCALE`
  (default 1.0)または test 用の `setLegacyBlendScale()` で
  turn の state/body/attachment blend と idle の body blend を一括減衰できる
- scale=0(dynamics 単独)の中核不変条件は `src/legacy-scale.test.ts` で固定済み:
  温かい入力で relation / pleasure が上がる(絶対) / 飽和しない /
  hostile より positive が温かく着地する / mistrust の蓄積と緩い解け / idle で退屈と孤独が上がる
- 今後: default を 0.5 へ下げる際は、残り 4 件(上記)の conflict / wording 較正を
  0.5 の挙動に合わせて意図的に取り込み、`HACHIKA_LEGACY_BLEND_SCALE=0.5 npm test` を
  グリーンにしてから default を切り替える。growth metrics 比較も併走させる

### Phase 4: 削除

- `LEGACY_BLEND_SCALE = 0` で全テストが通ったら、
  `src/legacy-visible.ts` と呼び出し(engine の turn 経路、initiative の idle 経路)を削除する
- `applyBoundedPressure` は dynamics 側で使われていなければ一緒に退役する
- README の該当記述を更新する

## 注意

- persistence は visible state をそのまま保存しているため、
  退役しても snapshot 互換性は壊れない(`dynamics` は既に保存されている)。
