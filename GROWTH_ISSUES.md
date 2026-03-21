# Growth Issue Drafts

`hachika` を「状態を持つ会話エンジン」から「変質しながら成長する存在」に寄せるための issue 草案。

## 現状整理

すでに入っているもの:
- baseline へ戻る弱い homeostasis により、`state / body / attachment` の単純飽和は以前より起きにくくなっている
- `initiative`, `trace maintenance`, `archive / reopen`, `idle` による body 変化はすでに実装済み
- `scenario harness` と複数ターンの回帰テストもすでにある
- snapshot load/save 時の低情報 topic / 汚れた trace artifact の自動正規化も入っている

まだ残っている主課題:
- 反応そのものの履歴依存カーブはまだ弱い
- learned temperament は archive reopen / idle consolidation まで通ったが、purpose 閾値や growth metrics への反映はまだ薄い
- idle 中の再編成は archive だけでなく memory / imprint / identity に広がり、弱い stale preference imprint の自然減衰、long-tail memory の圧縮と `consolidated memory` 化、identity anchor の再優先、relation/boundary の再配置まで入ったが、より長い horizon の consolidation はまだ薄い
- 成長を比較する専用 metrics / doc は初期導入までで、temperament drift や consolidation quality の指標はまだ薄い

改訂した推奨実装順:
1. Issue 1 の残タスク: 飽和防止の先にある「履歴依存の反応曲線」
2. Issue 4 の先行草案: 成長評価シナリオと指標の固定
3. Issue 2 の残タスク: learned temperament を idle / archive / reopening に深く通す
4. Issue 3: idle 中の再編成と能動再浮上の強化

理由:
- 単純な飽和はすでにある程度止まっているので、次に効くのは reaction sensitivity の導入
- temperament と idle reorganization は評価軸がないと差分を見失いやすい
- idle の再編成は learned temperament を参照できた方が自然

---

## Issue 1: drive/body の飽和を防ぎ、履歴依存の反応曲線を導入する

### ステータス
- 部分完了
- homeostasis と飽和抑制はすでに入っている
- `rewardSaturation / stressLoad / noveltyHunger` による軽量な reaction sensitivity も入った
- 未完了なのは、drive/body ごとの差をさらに細かくすることと、感度 state を learned temperament へ橋渡しすること

### 背景
- 現状の snapshot では `state` と `attachment` が高値に張り付きやすく、会話が続くほど差分が出にくくなる。
- 「生物っぽさ」を出すには、値そのものの更新だけでなく、刺激への効き方が履歴で変わる必要がある。

### 目的
- `continuity / pleasure / curiosity / relation / expansion` と `energy / tension / boredom / loneliness` が簡単に飽和しないようにする。
- 同じ入力でも、最近の疲労・緊張・飽き・関係履歴によって効き方が変わるようにする。

### スコープ
- `applyBoundedPressure` の見直し、または drive/body ごとの別カーブ導入
- 連続ポジティブ入力への逓減、ネガティブ入力後の回復遅延、放置後の反動を導入
- `attachment` にも飽和抑制と反動を導入
- replay しやすい regression test を追加

### 次にやる部分
- drive/body ごとに sensitivity の効き方をもう少し分ける
- `repair` と `hostility` の非対称性を強める
- `attachment` に rebound と mistrust の差を持たせる
- idle 後の continuity 変化にも reactivity をもう少し深く通す

### 実装メモ
- `DriveState`/`BodyState` とは別に、反応感度を表す軽量 state を導入してよい
- まずは永続化コストの低い scalar 2-6 個で始める
- 初手では複雑な時系列モデルにしない

### 完了条件
- 30-50 ターン程度の同質な会話で、主要 drive が全て `1` に張り付き続けない
- ネガティブ入力の直後と数ターン後で、同じポジティブ入力への回復量が異なる
- `idle` 後の boredom / loneliness / continuity の戻り方に履歴差が出る
- 新規 test が追加され、既存 test が通る

### 非ゴール
- motive 種別の追加
- LLM wording 改善

### 主な変更箇所
- `src/state.ts`
- `src/body.ts`
- `src/engine.ts`
- `src/persistence.ts`
- `src/engine.test.ts`
- `src/scenario.test.ts`

---

## Issue 2: learned temperament を導入し、経験で性格傾向が変わるようにする

### ステータス
- 部分完了
- `temperament` として `openness / guardedness / bondingBias / workDrive / traceHunger / selfDisclosureBias` を導入済み
- `self-model / response planner / identity summary / initiative topic scoring` へはすでに反映済み
- `idle consolidation` と archived trace reopen の選好にもすでに反映済み
- 未完了なのは `purpose` の細部、trace maintenance 強度、growth metrics へさらに深く通すこと

### 背景
- 現在の `identity.traits` は snapshot から毎回再推定される要約に近く、将来の判断を強く書き換える persistent な気質ではない。
- 「成長している感」を出すには、経験が motive 計算そのものを書き換える必要がある。

### 目的
- 反復経験から `hachika` の気質が徐々に変わる仕組みを追加する
- learned trait が `self-model`, `purpose`, `initiative`, `response planner` に返ってくるようにする

### スコープ
- 永続化される `temperament` または `learnedTraits` を snapshot に追加
- 候補例:
- `openness`
- `guardedness`
- `attachment_style`
- `work_drive`
- `trace_hunger`
- `self_disclosure_bias`
- 記憶・衝突・修復・共同作業・放置から気質を更新
- `buildSelfModel` の motive score に learned trait を加点/減点として反映
- `updateIdentity` は learned trait を説明する summary を出す

### 実装メモ
- 初期値は中立寄りに置く
- 1 turn あたりの変化量は小さくする
- 直接的な感情値ではなく、反応の傾向値として扱う
- 既存の `IdentityTrait` は残してよいが、要約 trait と学習 trait を分ける

### 次にやる部分
- `purpose` の切替と abandonment/reopen の閾値にも temperament を少し通す
- `trace maintenance` の preserve/deepen 強度にも temperament を重ねる
- growth metrics 側に temperament drift / temperament divergence を追加する

### 完了条件
- 同じ drive/body でも learned trait の違いで top motive が変わるケースがテストで再現できる
- 修復の多い履歴では `repair` への開きやすさが上がる
- 境界侵害の多い履歴では `protect_boundary` が早く立ち上がる
- `identity.summary` に learned trait 由来の差分が反映される
- 永続化の migration が追加され、既存 state を壊さない

### 非ゴール
- trait の自然言語生成を LLM に委譲すること
- ビッグファイブのような大規模人格モデル化

### 主な変更箇所
- `src/types.ts`
- `src/state.ts`
- `src/memory.ts`
- `src/identity.ts`
- `src/self-model.ts`
- `src/purpose.ts`
- `src/persistence.ts`
- `src/memory.test.ts`
- `src/scenario.test.ts`

---

## Issue 3: idle 中の再編成を導入し、会話外でも少し変化するようにする

### ステータス
- 部分完了
- idle による body 変化、initiative、trace maintenance、archive/reopen はすでにある
- deterministic な idle consolidation を追加し、temperament と body を見て dormant archive の salience / pending initiative を再評価するところまでは入った
- recurring memory topic から preference imprint / relation imprint / identity state を薄く再配置する batch も入った
- 弱い stale preference imprint の自然減衰も入った
- long-tail memory の圧縮と `consolidated memory` 化、identity anchor の優先順位再編も入った
- relation/boundary imprint の減衰と再配置も入った
- 未完了なのは、より長い horizon の memory consolidation、archived trace 再浮上の監査情報、idle batch の質を測る metrics を厚くすること

### 背景
- 現在も `initiative` と trace maintenance はあるが、主に未完了 topic の再開に寄っている。
- 生物感を高めるには、会話していない間にも記憶統合、価値づけの再配置、archived trace の再浮上が起こる必要がある。

### 目的
- `idle` 中に snapshot が受動的に減衰するだけでなく、再編成されるようにする
- proactive 発話が単なる ping ではなく、内部再編成の結果として出るようにする

### スコープ
- idle 経過時に以下を実行する consolidation レイヤーを追加
- memories から recurring topic を抽出
- traces の blocker / stale / archive 状態を再評価
- archived trace の再浮上候補を選定
- learned trait と identity anchor の微調整
- proactive emission 前に consolidation を反映
- `rewindSnapshotHours` と `emitInitiative` のテストを増やす

### 次にやる部分
- stale trace だけでなく memories / relation imprint も idle batch で再評価する
- dormant archive の pending 化だけでなく、trace priority と identity anchor の再配置をもう一段強める
- proactive emission 前に「なぜ今この archive が再浮上したか」の監査情報も持たせる

### 実装メモ
- 初手では batch 処理を `idle` コマンド経由の deterministic 処理として実装する
- 背景ジョブや realtime scheduler は不要
- archived trace reopen は body と trait の両方を参照させる

### 完了条件
- `idle` 後に、未会話でも `identity / initiative / trace priority` のいずれかが変化する
- boredom 高・energy 中のとき、archived trace が reopen 候補として上がる
- low energy 時は preserve 寄り、high boredom 時は deepen/reopen 寄りの差がテストで確認できる
- proactive 文面が maintenance 理由を反映する

### 非ゴール
- 外部 cron や daemon 化
- マルチユーザー/マルチセッション統合

### 主な変更箇所
- `src/initiative.ts`
- `src/traces.ts`
- `src/identity.ts`
- `src/self-model.ts`
- `src/index.ts`
- `src/scenario.test.ts`
- `src/traces.test.ts`

---

## Issue 4: 「成長したか」を判断する評価シナリオと指標を固定する

### ステータス
- 部分完了
- scenario harness と長めの回帰はある
- `docs/growth-metrics.md` と metrics helper は追加済み
- まだ足りないのは canonical scenario の拡張と、Issue 1-3 の回帰判定をもっと明示的に結びつけること

### 背景
- 成長や生物性の改善は、体感だけで進めるとすぐに評価不能になる。
- このリポジトリはシナリオテストが強みなので、仕様変更より先に評価の再現性を固定したい。

### 目的
- 「生物っぽくなった」を最低限比較できる指標と回帰シナリオを定義する
- 今後の改善が単なる wording の変化ではなく、内部状態変化として比較できるようにする

### スコープ
- 以下の観点で標準シナリオを追加
- 飽和しないこと
- 傷つき後の回復曲線
- 修復経験による開きやすさの変化
- 放置後の再編成と reopen
- 同一入力に対する個体差の発生
- lightweight metrics doc を追加
- 例:
- motive diversity
- state saturation ratio
- recovery lag
- archived trace reopen rate
- identity drift visibility

### 次にやる部分
- 既存 scenario の中から growth 比較に使う canonical scenario を 4-6 本選ぶ
- wording ではなく snapshot / debug payload ベースの assertion を定義する
- 必要なら metrics を scenario test 出力へ軽く載せられるようにする

### 実装メモ
- まずは README ではなく専用 doc に置く
- 数値指標は厳密すぎる閾値より、比較可能な範囲指定で始める
- wording ではなく debug payload / snapshot を評価対象にする

### 完了条件
- 4-6 本の標準シナリオが追加される
- 新規 issue 1-3 の回帰判定に使える assertion がある
- metrics doc に比較手順が書かれている
- build/test だけで最低限の比較が回せる

### 非ゴール
- Web ダッシュボード構築
- 本格的な実験基盤や外部可視化ツール導入

### 主な変更箇所
- `src/scenario.test.ts`
- `src/engine.test.ts`
- `src/traces.test.ts`
- `README.md` または新規 metrics doc

---

## 補足
- Issue 1-3 は順番依存がある
- 単純な飽和抑制はすでに入っているので、Issue 1 の残りは reaction sensitivity の導入になる
- Issue 4 は先に草案と比較手順だけ作っておくと、Issue 2-3 の差分を評価しやすい
- 実装の次手としては `Issue 1 の残タスク -> Issue 4 の metrics 草案 -> Issue 2 -> Issue 3` が自然
