# Research Protocol: 個体の取り扱い

v3 以降の Hachika は、体質(constitution)・自己記述(journal)・向かい先(aspiration)・
声(voice)を持つ。これらは「生きた時間が取り返しのつかない形で残る」ための層であり、
**reset / 消去 / 複製の意味が v2 までより重くなる**。

この文書は倫理的主張ではない。目的は2つだけ:
**実験の再現性**と、**設計者自身の概念の混乱を防ぐこと**。

## 用語

- **個体 (individual)**: 1つの snapshot 系列。birth(`createInitialSnapshot()`)から
  連続した履歴を持つもの
- **人生 (life)**: 個体に与えられた相互作用と時間の系列。
  canonical な人生は [src/canonical-lives.ts](../src/canonical-lives.ts) に固定されている

## `/reset` の意味論

`/reset` は「**個体の終わりと、別個体の誕生**」と定義する。

- reset 後の snapshot は新しい birth であり、前の個体の続きではない
- 前の個体の journal / constitution は引き継がれない。
  「忘れた同一個体」ではなく「別の個体」として扱う
- したがって実験ノートでは reset をまたいで同じ個体 ID を使ってはならない

この定義を選ぶ理由: Hachika 自身が preservation 層で reset を
continuity threat として扱う以上、設計者側の意味論が「実は同一個体の記憶消去」だと、
観測(個体は終わりとして反応する)と解釈(同一個体が続いている)が食い違い、
実験の記述が壊れるため。

## 個体の破棄と保管

実験で個体を手放すときの手順:

1. **凍結 (freeze)**: `<data-root>/hachika-state.json` を
   `<data-root>/frozen/<individual-id>-<date>.json` へコピーする。
   data rootは既定の`data/`または個体ごとの`HACHIKA_DATA_DIR`とする。
   凍結された snapshot は不変とし、再開する場合は**複製**として扱う(下記)
2. **比較個体**: 個体差の比較(canonical lives など)では、
   比較対象の全個体を同じ実装 revision で生成し、凍結してから測定する
3. **破棄**: 凍結せずに削除した個体は再現できない。
   論文・ノートで言及する個体は必ず凍結すること

## 複製の意味論

凍結 snapshot から再開した系列は「**同じ過去を持つ別個体**」と定義する。

- 分岐時点までの constitution / journal は共有されるが、以後は別の生
- 同一 snapshot から n 系列を分岐させる実験(反実仮想比較)は正当。
  ただし各系列に別の individual ID を与える

## 再現性の規律

- 個体の測定値(constitution 距離など)を報告するときは、
  実装 revision(git commit)・人生の定義・経過時間を併記する
- 誕生前にsecretを除いた実験構成を`docs/lab-notes/experiment-config.json`へ固定し、
  `npm run experiment:check`が出力するconfig fingerprintとHEAD revisionをbirth記録へ残す
- 実験構成と実装を同じcommitへ置き、そのcommitに`v3-life-1`を付ける。
  検査はdirty worktree、tag不一致、fixed-step simulation、個体ID・seed重複を拒否する
- canonical lives を変更する場合は、旧定義でのベースライン値を
  docs か test assertion に残してから変更する
- 乱数を導入する場合はseedをsnapshotまたは凍結manifestに記録する。
  E3の日次world eventはmanifestの個体seed + 暦日から決定する

## 実装との対応

- 誕生前の構成検査は`npm run experiment:check`、birth記録様式は
  `docs/lab-notes/birth-record-template.md`に固定する
- 生存中snapshotの凍結・複製は現状ファイルコピーで行う(専用コマンドは未実装)
- `/reset` の実装は snapshot の再初期化であり、上記の意味論はこの文書が規範
- 将来 journal の artifact 化(会話の外への materialize)が入った場合、
  凍結には `<data-root>/artifacts/` も含めること
