# Design Principles

## Goal

Hachika の目標は、`状態を持つチャットボット` ではなく、
`ローカルな substrate の上で、意味理解と発話を通して振る舞う存在`
へ寄せることです。

そのために、設計は次の 4 層へ分けます。

- `local substrate`
  - dynamics
  - world
  - persistence
- `semantic core`
  - turn / proactive / autonomy の意味判断
- `local reducers`
  - memory / trace / purpose / initiative の更新
- `utterance generation`
  - reply / proactive wording

## 1. Local Is For State, Not Meaning

local 実装は、意味を決める場所ではなく、決まった意味を反映する場所へ寄せます。

local に残すもの:

- dynamics の更新
- world の進行
- persistence / revision / atomic write
- memory / trace / purpose / initiative の reducer

local を薄くするもの:

- topic の主判定
- referent resolution
- direct answer obligation
- relation / world / work の最終裁定

原則:

- local heuristic は `fallback` と `candidate generation` に下げる
- authoritative な semantic judgment は LLM 側で返す

## 2. Topic Is Not The Core Unit

`topic` は便利ですが、Hachika の中心単位にはしません。

topic-first だけだと、次の問題が起きやすいです。

- 単語誤検知がそのまま durable state を汚す
- `誰のことを話しているか` が topic に潰れる
- `質問 / 申告 / 訂正 / 依頼` の違いが薄れる
- relation turn がすぐ擬似 work に変わる

今後の中心単位は次です。

- `referent`
  - user / hachika / shared / world
- `speech act`
  - question / assertion / repair / request / naming
- `attention`
  - 何に向いたか
- `rationale`
  - なぜ向いたか
- `durability`
  - その注意を残すべきか

topic はこの上にある補助表現として扱います。

## 3. Semantic Topic And Durable Topic Must Be Separate

同じ話題でも、

- 今このターンで答えるために見る topic
- memory / trace / purpose に残す topic

は分けます。

原則:

- `semantic topic`
  - 返答や当座の行動のために参照する
- `durable topic`
  - trace / purpose / initiative / preference に残してよい

これにより、

- `棚には何が残ってる？`
- `あなたの名前は？`
- `私はやすとら`

のような turn を、その場で処理しつつ durable hardening しすぎないようにできます。

## 4. Attention Should Carry A Why

主体性は「topic を持つこと」ではなく、
`なぜそれが気になるのか` を持つことで出ます。

今後は、attention に rationale を持たせます。

例:

- `relation_uncertain`
- `unfinished_work`
- `world_pull`
- `recall_pressure`
- `repair_needed`
- `self_definition`

重要なのは、
`気になった topic` ではなく
`気になった理由`
を内部で持つことです。

これにより、

- なぜ今その話を続けるのか
- なぜ今日は話さないのか
- なぜ observe だけで終わるのか

が説明可能になります。

## 5. Facts And Claims Matter More Than Keywords

`私はやすとら` は topic ではなく、
`user_name = やすとら`
という fact です。

同様に、

- `あなたの名前はハチカ`
- `仕様の境界が未定`
- `今日は疲れた`

はすべて keyword の集合ではなく、claim として扱う方が自然です。

原則:

- durable state は keyword ではなく fact / claim / open-question に寄せる
- topic は fact を引くための補助ラベルに留める

## 6. Outward Behavior Is A Subset Of Life

Hachika の主体性は、発話だけではありません。

より自然なのは、

- observe
- hold
- drift
- recall
- touch
- speak

のうち、多くは内部で起き、外に見えるのは一部だけ、という構造です。

原則:

- `proactive = 発話イベント` にしない
- resident loop は `internal action` と `outward action` を分ける
- `no-op` や `silent tick` を普通にする

## 7. World Is A Constraint, Not A Decoration

world は毎回の演出文を足すためのものではなく、
`何が起きやすいかを変える制約`
として使います。

例:

- `threshold`
  - contact / arrival / absence
- `studio`
  - shaping / sorting / concrete work
- `archive`
  - recall / preserve / deferred continuity

object も同様に、

- lamp
- desk
- shelf

が action bias を変えるものとして働くべきです。

## 8. Rule Fallback Should Be Thin

rule-based reply や rule-based semantic 判定は、完全には消しません。
ただし役割は限定します。

原則:

- rule は `最低限壊れないための fallback`
- semantic の主裁定は LLM
- wording の主生成も LLM

避けるべきこと:

- local 定型文が主発話になること
- local cue の合成だけで durable lifecycle が立つこと

## 9. Migration Rule

新しい変更を入れる時は、次を自問します。

1. これは local substrate の責務か
2. これは semantic ambiguity の解消か
3. これは durable hardening に値するか
4. これは topic ではなく fact / rationale で持つべきではないか
5. これは outward action に出す必要があるか

この問いに沿って、次の方向へ寄せます。

- `more local heuristics` ではなく `better semantic contract`
- `more topics` ではなく `better referents / claims / rationales`
- `more proactive speech` ではなく `better internal autonomy`

## Current Direction

いまの大きな移行先は 3 つです。

1. `semantic-director v2`
   - [docs/semantic-director-v2.md](/Users/yasut0ra/dev/hachika/docs/semantic-director-v2.md)
2. `autonomy v2`
   - [docs/autonomy-v2.md](/Users/yasut0ra/dev/hachika/docs/autonomy-v2.md)
3. `attention-and-rationale-first`
   - topic-first からの移行

要するに、

- local は substrate と reducer
- LLM は semantic core
- topic は補助
- attention + rationale + fact が中心

これが今後の基本方針です。
