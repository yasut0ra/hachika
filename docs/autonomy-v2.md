# Autonomy V2

## Why

今の `loop / idle / proactive` は、機能としては成立していますが、生物的な時間感覚はまだ弱いです。

現在の流れは概ねこうです。

- `resident loop`
  - 一定間隔で snapshot を読む
  - `idle` をまとめて進める
  - `proactive` を 1 回判定する
- `idle`
  - body / dynamics / memory / trace priority を再編成する
- `proactive`
  - `pending initiative` があるかを見る
  - ready なら発話する

この構造だと、次の問題が残ります。

- `放置中も生きている` より `一定間隔で job が走る` 感触になる
- `proactive` がほぼ `発話イベント` で、内的行動の層が薄い
- `idle` が「静かな内部時間」ではなく「後処理 batch」に見えやすい
- `readyAfterHours` と閾値で動くため、振る舞いが離散的で人間味が薄い
- `no-op` や `迷い` や `保留` が少なく、すぐに durable state か発話へ寄る

V2 の目的は、Hachika を「時々 proactive を出すエンジン」から、
「ずっと生きていて、内的活動の一部だけが外に見える存在」へ寄せることです。

## Principles

### 1. 発話は行動の一部でしかない

`speak` は最終行動のひとつに下げます。

より頻繁に起きるのは次です。

- `settle`
- `drift`
- `observe`
- `recall`
- `touch`
- `leave`
- `reframe`
- `hold`

つまり「何かを思い出した」からといって、すぐ喋る必要はありません。

### 2. idle を special case にしない

`idle` は特別な mode ではなく、通常の時間経過の一部とみなします。

- 短時間:
  - body / attention / activation のゆらぎ
- 中時間:
  - recall / relation pressure / unfinished pressure
- 長時間:
  - consolidation / archive drift / world drift

`/idle 8` は「8 時間ぶんの生存ループを圧縮実行する」操作に寄せるのが自然です。

### 3. proactive を “言葉” で定義しない

proactive は `自分起点の outward action` として扱います。

候補:

- `speak`
- `move`
- `observe`
- `touch`
- `leave`
- `no-op`

このうち、ユーザーに見えるのは主に `speak` だけです。
しかし内部では、`observe -> recall -> hold` のように、何も言わず終わる tick が普通にあるべきです。

### 4. ready threshold より urge accumulation

今の `readyAfterHours` だけだと、行動が「条件を満たした瞬間に出る」感じになります。

V2 では、次のような accumulated urge を使います。

- `contactUrge`
- `closureUrge`
- `recallUrge`
- `worldUrge`
- `selfPreservationUrge`
- `silenceNeed`

これらは時間と出来事で上下し、互いに競合します。

## New Mental Model

V2 の resident loop は毎 tick で次を行います。

1. `advance substrate`
- dynamics
- body
- world ambience
- weak imprint decay

2. `sample internal pressures`
- unfinished work pressure
- relation pull
- absence / neglect pull
- archive recall pull
- world object salience
- silence need

3. `generate candidates`
- `do nothing`
- `observe object`
- `move place`
- `touch object`
- `leave trace`
- `speak`

4. `semantic autonomy director`
- どの candidate を採るか
- 何を semantic topic と見るか
- 何を durable に残すか
- outward に出すべきか

5. `materialize`
- world update
- trace / initiative / purpose update
- 必要なら utterance generation

ここで重要なのは、`pending initiative` を唯一の入口にしないことです。

`pending initiative` は残してよいですが、V2 では

- `pending initiative = 強い継続意図`
- `candidate set = この tick で実際に取りうる行動`

に分けます。

## State Additions

既存の `dynamics` に加えて、autonomy 専用の軽量 state を追加するのが自然です。

例:

- `attentionMode`
  - `resting | scanning | engaged | withdrawn`
- `contactUrge`
  - 相手に向き直りたい圧
- `closureUrge`
  - 未完了を閉じたい圧
- `recallUrge`
  - 過去の痕跡に戻る圧
- `worldUrge`
  - 周囲を見たり触ったりしたい圧
- `silenceNeed`
  - 喋らずにいたい圧
- `initiativeMomentum`
  - いったん立ち上がった行動傾向が少し持続する圧

visible state ではなく、candidate selection 用の latent state です。

## World Coupling

今の world は「演出的に参照される場所」に寄りがちです。

V2 では world を行動制約へ寄せます。

- `threshold`
  - contact / absence / arrival に寄る
- `studio`
  - work / shaping / concrete handling に寄る
- `archive`
  - recall / preserve / reopen に寄る

object も同様です。

- `lamp`
  - orient / wait / soften
- `desk`
  - concrete work / sorting / shaping
- `shelf`
  - archive recall / preserve / deferred continuity

つまり world は雰囲気ではなく、「どんな行動が今起きやすいか」を変える層にします。

## Loop V2

resident loop は次のように変えます。

### Current

- fixed interval
- fixed idle hours per tick
- rewind
- maybe proactive

### V2

- fixed interval は維持してよい
- ただし内部では `microstep` を回す
- 1 tick 中に:
  - zero or more internal actions
  - zero or one outward action
- outward action は毎 tick 起きない

この構造なら、人間っぽい

- しばらく黙る
- 少し見てから戻る
- 同じことを気にしているが今日は言わない
- 触っただけで終わる

が表現しやすいです。

## Idle V2

`rewindSnapshotHours()` は残せますが、意味を変えます。

現状:

- まとめて state を進める utility

V2:

- `advanceAutonomyHours(hours)`
- `hours` を microstep に割って
  - substrate update
  - autonomy candidate generation
  - silent/internal action materialization
  - sparse outward emission
  を回す

つまり `idle` は「何も起きない時間」ではなく、
「外からは静かに見えるが、内部では少し動いている時間」です。

## Proactive V2

`proactive` はコマンド名として残してもよいですが、内部概念は変えます。

今後の整理:

- `initiative`
  - 継続意図、内的傾き
- `candidate action`
  - 今この tick の実行候補
- `outward proactive`
  - そのうち外に見える action

ユーザー向けにはまだ `/proactive` を残せますが、実際には
`今この時点で outward action を 1 回だけ強制評価する`
コマンドに寄せます。

## LLM Boundary

ローカルに残すもの:

- dynamics
- world progression
- urgency accumulation
- persistence
- reducer / materialization

LLM に寄せるもの:

- autonomy candidate の semantic judgment
- internal vs outward の選別
- semantic topic と durable topic の分離
- 「今は speak より observe の方が自然」みたいな曖昧判断

つまり V2 は
`semantic-director for turn`
に対応する
`autonomy-director for time`
を作るイメージです。

## Migration Plan

### Phase 1

- `docs/autonomy-v2.md` を追加
- `initiative` と `proactive` の概念を分離
- resident loop の tick を `internal action` と `outward action` に分ける

### Phase 2

- autonomy latent state を追加
- `scheduleInitiative()` を candidate generator に縮小
- `pending initiative` を唯一の入口から降格

### Phase 3

- `autonomy-director` を追加
- internal action / outward action を LLM に裁かせる

### Phase 4

- `rewindSnapshotHours()` を `advanceAutonomyHours()` に寄せる
- idle を microstep simulation に変える

### Phase 5

- metrics 追加
  - `silent_internal_action_rate`
  - `outward_action_rate`
  - `world_action_diversity`
  - `proactive_speech_ratio`
  - `initiative_to_action_conversion`

## End State

理想形はこれです。

- Hachika は常に少し動いている
- その大半は silent/internal
- ときどき outward になる
- outward も speak だけではない
- world は演出ではなく行動制約になる
- idle は batch ではなく静かな生存時間になる

ここまで行くと、`loop / idle / proactive` は別物ではなく、
同じ時間流の別の見え方になります。
