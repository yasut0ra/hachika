# Hachika life experiment notes

90日長期生存実験のbirth記録と週次観察記録を置く。

## 凍結手順

1. secretを含まない確定manifestを`docs/lab-notes/experiment-config.json`に置く。API keyなどのsecretは書かない
2. 実装とmanifestを同じcommitへ確定し、`v3-life-1`をそのcommitへ付ける
3. `npm run experiment:check`が成功することを確認する。出力された`head`が凍結revisionになる
4. 共通`.env`と個体ごとの起動環境をmanifestに一致させる。`HACHIKA_LOOP_IDLE_HOURS_PER_TICK`は設定しない
5. Day 0に`npm run experiment:birth -- --individual A --individual B`を1回だけ実行する。設定日、clean/tagged revision、既存snapshotを検査したうえで、名前入りrevision-0 snapshotとhash付きbirth記録を排他的に作る
6. [Mac mini launchd手順](../../ops/launchd/README.md)に従ってresidentと日次maintenanceを起動し、生成されたbirth記録のDay 0確認欄を完了する

manifestの`fingerprint:sha256`は誕生コマンドがbirth記録へ自動転記する。secretを含む`.env`そのものはcommitしない。誕生コマンドは2026-08-01（`Asia/Tokyo`）以外では失敗するため、事前確認で個体データを作らない。

## ファイル名

- 実験構成: `experiment-config.json`
- birth: `birth-YYYY-MM-DD-a.md`, `birth-YYYY-MM-DD-b.md`
- 週次: `week-01.md` ... `week-13.md`

一度記録したbirthファイルは訂正で上書きせず、末尾に訂正日時・理由・旧値を追記する。
