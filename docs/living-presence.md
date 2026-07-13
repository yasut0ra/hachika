# Living Presence

## Goal

Hachikaの生命感を、内部状態の項目数や説明文ではなく、経験の循環として作る。

```text
body / urges
  -> attention
  -> sustained action
  -> consequence in body / memory / world
  -> residue
  -> later choice, embodiment, or utterance
```

行動は監査用ラベルではない。選ばれた行動は必ず何かを満たすか消耗させ、世界との関係を変え、次の選択へ余韻を残す。

## Phase 1: ongoing presence and consequences

実装済み。

- `snapshot.presence`は、現在の`action / focus / rationale / place / object / intensity / dwell`と直前の`residue`だけを持つ
- `observe / recall / hold / drift`はidle activityの記録だけで終わらず、対応するurgeとdynamicsを変える
- `observe`とworldに接続した`recall`は実際のworld actionになり、objectの`familiarity / lastEngagedAt`を更新する
- 同じtopicのrecallでも、直近memoryのsentimentによって安全・信頼または緊張・stressへ異なる結果が返る
- user turnはongoing actionを中断するが消去せず、residueへ移す
- embodimentは5分だけのactivity表示ではなくongoing presenceを演じ、return residueも視線に残す
- wording generatorはpresenceを参照できるが、隠れた内部状態を機械的に説明しない

Snapshot versionは33。旧snapshotには静かな`rest` presence、world objectのfamiliarity初期値、residueの経過時間を補う。

## Phase 2: continuous lived time

実装済み。

- autonomy評価は過去の窓を一括で演じず、その時点から始めるactionを選ぶ
- residentの短いwall-clock tickはactivityを増やさず、ongoing presenceのdwellだけを進める
- actionのurge / dynamicsへの作用は実時間を30分単位で確定し、細かいtickでも一括advanceでも総量が変わらない
- action intensityとresidueは実時間の指数減衰になり、呼び出し回数ではなく過ごした時間で薄れる
- wall-clock tickの`updatedAt`は実際のtick時刻を使う

## Next

1. `touch / rest`をinternal candidateへ広げ、行動ごとのcostと回復を深める
2. world objectごとの経験差をcandidate selectionへ戻す
3. journalをrule templateではなく、実際に続いたpresence episodeから書く
4. 同じ不在でも生活史の違う個体が異なるepisodeを辿るscenario testを置く

## Non-goals

- presence専用の診断dashboardを増やさない
- 行動数や発話数を生命感の代理にしない
- randomな気まぐれだけで差を作らない
- 内面を毎回説明口調で発話させない
