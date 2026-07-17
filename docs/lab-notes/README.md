# Hachika life experiment notes

90日長期生存実験のbirth記録と週次観察記録を置く。

## 凍結手順

1. `docs/experiment-config.example.json`を`docs/lab-notes/experiment-config.json`へコピーし、placeholderをすべて確定する。API keyなどのsecretは書かない
2. 実装とmanifestを同じcommitへ確定する
3. `v3-life-1`をそのcommitへ付け、`npm run experiment:check`が成功することを確認する。出力された`head`が凍結revisionになる
4. 個体ごとの`.env`または起動環境をmanifestと一致させる。`HACHIKA_LOOP_IDLE_HOURS_PER_TICK`は設定しない
5. Day 0に新規snapshotを作成し、[birth record template](birth-record-template.md)を個体ごとに複製して記録する

manifestの`fingerprint:sha256`は検査コマンドの出力をbirth記録へ転記する。secretを含む`.env`そのものはcommitしない。

## ファイル名

- 実験構成: `experiment-config.json`
- birth: `birth-YYYY-MM-DD-a.md`, `birth-YYYY-MM-DD-b.md`
- 週次: `week-01.md` ... `week-13.md`

一度記録したbirthファイルは訂正で上書きせず、末尾に訂正日時・理由・旧値を追記する。
