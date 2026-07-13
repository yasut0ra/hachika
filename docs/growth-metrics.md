# Growth Metrics

`hachika` の「成長」を wording ではなく snapshot / debug payload の差分として比較するための最小指標。

## 方針

- 比較対象は会話文面ではなく `ScenarioRun` と各 event の snapshot
- 指標は厳密な真値ではなく、実装の変化を見失わないための lightweight baseline
- まずは `npm test` で回る再現可能な scenario を使う

## 現在の指標

### 1. `averageStateSaturationRatio`

- 対象: `continuity / pleasure / curiosity / relation / expansion / energy / tension / boredom / loneliness / attachment`
- 定義: 各 snapshot で `<= 0.05` または `>= 0.95` に入っている scalar の比率を平均したもの
- 目的: 長い会話で値が張り付き続けていないかを見る

### 2. `finalStateSaturationRatio`

- 対象: 最終 snapshot のみ
- 目的: scenario 終了時に極端な張り付きが残っていないかを見る

### 3. `motiveDiversity`

- 対象: 各 event の `selfModel.topMotives[0]`
- 定義: scenario 中に現れた top motive kind のユニーク数
- 目的: 全ターンが同じ motive に吸われていないかを見る

### 4. `identityDriftVisibility`

- 対象: `identity.summary / currentArc / anchors`
- 定義: 隣接 snapshot 間で identity 要約が変化した遷移の比率
- 目的: 経験が identity に見える形で返ってきているかを見る

### 5. `archiveReopenRate`

- 対象: lifecycle を持つ trace
- 定義: archived に到達した trace のうち、`reopenCount > 0` になったものの比率
- 目的: archived trace が本当に再浮上しているかを見る

### 6. `stressRecoveryLag`

- 対象: `reactivity.stressLoad` と `body.tension`
- 定義: stress spike の検出後、初期近傍まで戻るまでにかかった event 数
- 目的: 傷つき後の回復曲線を wording 以外で比較する

### 7. `autonomousActivityVisibility`

- 対象: `idle` / `proactive` event 後の `initiative.history`
- 定義: 非 user event のうち、少なくとも 1 件の autonomous activity が history に追加された event の比率
- 目的: 自律行動が snapshot 上に可視な形で残っているかを見る

### 8. `idleConsolidationCoverage`

- 対象: `idle` event
- 定義: `idle_consolidation` または `idle_reactivation` を history に追加した idle event の比率
- 目的: 放置中の再編成が実際に走っているかを見る

### 9. `proactiveMaintenanceRate`

- 対象: `proactive` event
- 定義: `proactive_emission` のうち、`maintenanceAction` または `reopened` または `traceTopic` を持つものの比率
- 目的: 能動発話が単なる台詞でなく、trace maintenance を伴っているかを見る

### 10. `silentInternalActionRate` / `outwardActionRate`(autonomy v2 Phase 5)

- 対象: `initiative.history`
- 定義: 履歴のうち silent な internal action(observe / hold / drift / recall)の比率と、outward(proactive_emission / speak)の比率
- 目的: 「発話は行動の一部でしかない」— 内的活動の大半が silent であることを見る

### 11. `worldActionDiversity`(autonomy v2 Phase 5)

- 対象: `initiative.history` の `worldAction`
- 定義: observe / touch / leave の3語彙のうち、直近履歴で使われた種類数 / 3
- 目的: world への関わり方が単調(常に observe)になっていないかを見る

### 12. `initiativeToActionConversion`(autonomy v2 Phase 5)

- 対象: `initiative.history`
- 定義: `proactive_emission / (idle_reactivation + proactive_emission)`
- 目的: 掘り返した継続意図のうち、どれだけが outward action まで届いたかを見る

### 13. `outwardIntentEchoRate`

- 対象: 直近の `proactive_emission / speak`
- 定義: user replyを挟まずに、同じ motive と blocker で連続した outward 発話の比率
- 目的: 文面の言い換えでは隠れる「同じ意図でもう一度呼びかけた」を見る。通常運用ではlocal refractoryにより0へ近づく

### 14. `constitutionDistance / voiceDistance / aspirationOverlap`(v3 Phase 5)

- 対象: 2つの snapshot(個体)
- 定義: constitution 全 set-point の平均絶対差 / 声の opening 集合の非一致 + brevity 差 / aspiration theme の Jaccard 一致率
- 目的: 違う生を送った個体が測定可能に分離しているかを見る(canonical lives は [src/canonical-lives.ts](../src/canonical-lives.ts))

## canonical scenario 候補

### A. aligned work

- 目的: motive diversity / identity drift / trace decision 化
- 例: `設計を一緒に進めて、記録として残したい。 -> 責務を切り分ける -> 保存した`

### B. stress recovery

- 目的: stress recovery lag
- 例: hostile turn の後に数ターンの calm turn を置く

### C. archive reopen

- 目的: archive reopen rate
- 例: archived trace を持つ snapshot から `? -> /proactive`

### D. repetition then idle

- 目的: saturation / novelty hunger / idle aftermath
- 例: 同 topic の反復後に `idle`

### E. idle and proactive agency

- 目的: autonomous activity visibility / idle consolidation coverage / proactive maintenance rate
- 例: `実装を残したい -> idle -> /proactive`

## 使い方

- 実装: [src/growth-metrics.ts](../src/growth-metrics.ts)
- 回帰: [src/growth-metrics.test.ts](../src/growth-metrics.test.ts)
- scenario 基盤: [src/scenario-harness.ts](../src/scenario-harness.ts)
- live summary: CLI の `/metrics` と UI の `Growth` panel

比較はまず `npm test` を通し、その上で必要なら対象 scenario を増やしていく。
