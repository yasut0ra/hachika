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

## Phase 3: contact and recovery

実装済み。

- `touch / rest`をidle autonomyのinternal candidateへ加えた
- energy低下、cognitive load、緊張が一定以上なら、未完了topicがあっても`rest`を優先する
- intentional `rest`は`body_need`を理由に持ち、activation / cognitive load / stress / silence needを実時間で回復させる
- ongoing `rest`はembodimentにも継続中の行動として現れ、休んでいる間は場所を勝手に移らない
- world urgeが高く、近くのobjectにfamiliarityが育っていると`observe`ではなく`touch`を選べる
- familiarなobjectへの`touch`は、未知のobjectより認知costが低く、安全を少し回復させる
- internal `touch`はworld eventとobject stateを一度だけ変え、その後はpresenceのdwellとして続く

## Phase 4: journal from lived episodes

実装済み。

- nightly consolidationは、新しいactionを選ぶ前に直前まで続いたpresenceをepisodeとして捕捉する
- journalは`action / focus / rationale / place / object / dwell`から、その時間に実際にしていたことを書く
- 前episodeのresidueが残っていれば、現在のepisodeへ持ち越された余韻として1行に接続する
- 2時間未満の未成熟なepisodeは書かず、同じongoing episodeをnightlyごとに重複記録しない
- purpose resolution由来のjournalは従来どおり別系統で残す

## Next

1. 同じ不在でも生活史の違う個体が異なるepisodeを辿るscenario testを厚くする
2. familiarityを単一値から、安心・作業・記憶など質の異なる関係へ育てる

## Non-goals

- presence専用の診断dashboardを増やさない
- 行動数や発話数を生命感の代理にしない
- randomな気まぐれだけで差を作らない
- 内面を毎回説明口調で発話させない
