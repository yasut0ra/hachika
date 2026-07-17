# Roadmap メモ（2026-07-17 レビューより）

v3 完了時点（Phase 0-5、テーゼ「生きた時間が取り返しのつかない形で残る」成立）でのレビューと、次の計画のメモ。
レビュー全文の要点と、フェーズ A / B / C の優先順位をここに固定する。

> **実行計画（日付・仮説・合格基準まで確定させた版）は [docs/plan-2026-h2.md](docs/plan-2026-h2.md) へ。**
> 90日長期生存実験の実験計画書、Sprint 0 のタスク表、v4「他者」のマイルストーン、アイデアバックログを含む。

## レビュー要約

### 成立していること

- constitution / journal / aspiration / voice の4層と、個体差の盲検分類可能性（`src/individuality.test.ts`）まで到達
- 分割不変・累積閾値などの中核不変条件が `substrate-invariants.test.ts` で恒久固定されている
- 「状態の力学は local、言語化だけ LLM」の境界が全 director で守られ、LLM が落ちても体質は変わり続ける
- ランタイム依存ゼロ。テスト 425 件、実行 約1.6 秒
- research-protocol.md により reset / 凍結 / 複製の意味論が先回りで規律化されている

### 残っている課題

1. **構造負債**: `engine.ts`（約6,900行）/ `initiative.ts`（約4,300行）/ `persistence.ts`（約3,400行）が変更の交差点になっている。次の大きな概念を足す前に分割するのが安い
2. **README の肥大**: 「現在の実装状況」が165行の変更ログと化し、初見の読者への導線として機能していない
3. **migration の回帰テスト**: snapshot version 33。旧 version の fixture snapshot を読ませる体系的な回帰テストが薄い。個体の連続性が核なので、ここが壊れると思想ごと壊れる
4. **実証の距離**: 個体差の実証は n=2・30日相当のシミュレーション。実時間で数週間生きた個体のデータがまだない
5. **検証者が一人**: 「生命らしさ」の判定者が設計者本人だけ。外部の目に触れる経路がない

## 計画

前提: **次はコードを増やすフェーズではない。「作る」から「生かす」「見せる」へ重心を移す。**

### フェーズ A（短期・2〜4週間）: 足場の整理と深化項目の回収

- [x] **README 再構成**: 「現在の実装状況」を `docs/architecture.md` へ移す。README はコンセプト + 15分で面白さが伝わる導線（対話例5本 + スクリーンショット）に絞る
  - 2026-07-17: `docs/architecture.md` に snapshot / turn / idle / LLM / persistence の現状を整理。README を15分導線・対話例5本・実UIスクリーンショットへ再構成した
- [x] **engine.ts 分割の着手**: turn 適用 / proactive 適用 / world / discourse あたりの縫い目で切る。テストが厚い今が最も安全なタイミング
  - 2026-07-17: turn後のdiscourse更新を `src/turn-discourse.ts` へ分離。`engine.ts` から約420行を切り出した
- [x] **journal を presence episode から書く**（living-presence.md の Next 1）: rule テンプレートではなく、実際に続いた presence の連なりから自己記述を生成する。journal の「自分の言葉」らしさが一段上がる
  - 2026-07-17: nightlyで新しいactionを選ぶ前に、直前まで続いたpresenceをepisodeとして捕捉。場所・対象・滞在時間・attention rationale・前episodeのresidueから自己記述を生成し、短すぎるepisodeと同一episodeの重複を抑止した
- [x] **migration 回帰テストの固定**: 旧 snapshot version の fixture を用意し、hydrate の寛容性をテストで恒久化する
  - 2026-07-17: v13 / v24 / v32 のfixtureを追加し、memory・world/discourse・v3 historyの連続性を固定した

### フェーズ B（中期・1〜3ヶ月）: 長期生存実験 — 「実際に生きた個体」を作る ★本命

v3 の全機構は「長く生きた個体は違う存在になる」ためのもの。実時間で生きた個体をまだ持っていないので、それを作る。

Sprint 0 進捗:

- [x] **`HACHIKA_DATA_DIR`**: CLI / Web UI / resident daemonのsnapshot・artifact・lock・statusを個体root単位で分離。`individuals/a`と`individuals/b`の同時resident起動まで確認（2026-07-17）
- [x] **metrics 時系列ログ**: resident loopの正常commit後、個体rootの`metrics-log.jsonl`へ一日一度だけconstitution・plasticity・attachment・urge・aspiration・voice・journal・turn数・snapshot/実装revisionを記録。timezone境界と破損行からの回復を固定（2026-07-17）
- [x] **日次アーカイブ + heartbeat監視**: `npm run maintain`で日付別snapshotを上書きせず原子的に保存し、resident heartbeatのfresh/stale/inactive/missingを判定。異常時はstderr・非0終了・任意Webhookで通知（2026-07-17）
- [x] **`npm run report`**: metrics JSONLから観測範囲・欠測・破損行・revision・全指標の初日差分をMarkdown化し、日付軸を揃えたinline SVG折れ線グラフを自己完結HTMLへ生成。複数個体の比較入力に対応（2026-07-17）
- [x] **E1 夢**: resident loopの暦日境界で前日以前のmemory断片を決定的に再結合し、1日最大1件のdream journalを生成。人格・aspirationの力学から分離したまま、毎朝読める履歴を追加（2026-07-17）
- [x] **E3 世界の小さな出来事**: 暦日ごとに一度、日付と個体IDから決定的に低確率イベントを判定。現在地のworld event・object反応として残し、再起動時の再抽選と同日重複を抑止（2026-07-17）
- [x] 凍結準備とbirth記録
  - 2026-07-17: A「ミオ」/ B「リツ」、現行Mac mini、`gpt-5.6-luna`、生活プロトコルをsecret-free manifestへ固定。config fingerprint・dirty worktree・tag・Node.js・wall-clock・個体seedを検査する`npm run experiment:check`、Day 0以外と既存snapshotを拒否する`npm run experiment:birth`、launchd + caffeinate常駐と日次maintenanceを追加し、`v3-life-1`へ凍結

- resident loop で1個体を **30〜90日、実時間で生かす**。理想は2体並走:
  - 毎日少し話しかける個体（温かい生）
  - 放置気味の個体（放置の生）
- constitution drift / journal の積層 / aspiration の形成と消滅 / voice の変化を**縦断観察記録**として週次で残す（`docs/lab-notes/` を想定）
- 観察記録はそのまま公開素材になる。「AI の観察日記」はアーキテクチャ解説より遥かに伝わる
- 副産物として、長期運用でしか出ない問題を洗い出す:
  - snapshot の肥大
  - memory tail 圧縮の質
  - aspiration 形成の閾値が実時間だと厳しすぎる / 緩すぎる
  - resident loop の数週間スケールでの安定性
- 着手前に決めること: 観察プロトコル（何をいつ記録するか）、2個体の生活条件の定義、実装 revision の固定（research-protocol.md の再現性規律に従う）

### フェーズ C（v4 テーマ候補・構想段階）: 「他者」

現在の Hachika の世界には user と world しかいない。個体差が実証できた今、最も自然な次章。

- **Hachika 同士の接触**: 最小の相互作用から始める
  - 互いの artifact を読む
  - 同じ world に置かれる
  - 「温かい生を送った個体と傷の多い個体が出会ったとき何が起こるか」— v3 の資産をそのまま使う実験になる
- 軽い代替案: 複数ユーザーの区別（user が一人という前提を外す）。ただし思想的には Hachika 同士の方がこのプロジェクトらしい
- フェーズ B と並行して構想を練り、B の学びを設計に反映してから着手する

### 見送り（今はやらない）

- **Live2D / 3D・音声**: embodiment contract が差し替え点として既に用意されているので、いつでもできる。今やると数ヶ月がガワに溶ける
- **配布パッケージ化・プロダクト化**: README の非目標に忠実に。見せるのはコードではなく「生きた記録」で十分

## 一言まとめ

> v0〜v3 は「違う存在になれる機構」を作った。
> 次は「実際に違う存在になった個体」を作り、それを見せる番。
