# Semantic Director V2

## Why

今の Hachika は、意味理解が複数の層に分かれています。

- `input-interpreter`
- `turn-director`
- `behavior-director`
- `response-planner`
- `trace-extractor`
- `proactive-director`

この構成は段階的な改善には向いていましたが、次の問題を残しています。

- `誰のことを話しているか` が層ごとにずれる
- `今このターンで何に直接答えるべきか` が一段で決まらない
- semantic topic と durable topic の判断が分散する
- local rule が増えやすく、`engine.ts` と `initiative.ts` が太る

V2 の目的は、LLM に任せるべき曖昧性解消を一箇所へ集約し、local engine を reducer へ寄せることです。

## Keep Local

次は引き続きローカル実装のまま維持します。

- `src/dynamics.ts`
- `src/world.ts`
- `src/persistence.ts`
- `trace / purpose / initiative / memory` の lifecycle reducer
- resident loop の tick、revision conflict、atomic write

ここは Hachika の substrate であり、説明可能性と再現性を保つために local が適しています。

## Unify In LLM

V2 では、次の semantic judgment を一段で返すことを狙います。

- `subject / target`
  - `user | hachika | shared | world`
- `answerMode`
  - `direct | clarify | reflective`
- `relationMove`
  - `naming | repair | attune | boundary | none`
- `topics`
  - 今回の返答で参照する semantic topic
- `stateTopics`
  - memory / trace / purpose へ durable に残してよい topic
- `trace hint`
  - kind, blockers, next-step-worthy hints
- `reply / proactive plan`
  - `act / stance / distance / focus / mentionWorld / askBack`
- `world policy`
  - world を `none / light / full` のどこまで出すか
- `hardening policy`
  - この turn / proactive で state を冷やすか、硬化させるか

## Contract

V2 schema の雛形は [src/semantic-director-schema.ts](/Users/yasut0ra/dev/hachika/src/semantic-director-schema.ts) にあります。

中心は次の型です。

- `SemanticTopicDecision`
- `SemanticTraceHint`
- `SemanticReplyPlan`
- `SemanticProactivePlan`
- `SemanticTurnDirectiveV2`
- `SemanticProactiveDirectiveV2`
- `SemanticDirectiveV2`

重要なのは、`semantic topic` と `durable topic` を同じ topic 配列の中で `durability` によって分けている点です。

## Migration

1. `semantic-director-schema` を追加して、v2 contract を固定する
2. `turn-director` を v2 互換の出力へ寄せる
3. `proactive-director` も同じ contract に寄せる
4. `engine.ts` と `initiative.ts` は semantic judgment を読む reducer に寄せる
5. `composeReply()` と proactive rule builder を thin fallback に落とす
6. 最終的に `input-interpreter / behavior-director / response-planner / trace-extractor` の責務を `semantic-director` へ吸収する

## End State

理想形はこの分離です。

- `local substrate`
  - dynamics / world / persistence
- `semantic-director`
  - turn / proactive の意味理解と行為判断
- `local reducers`
  - memory / trace / purpose / initiative
- `utterance generator`
  - reply / proactive wording

この形に寄せることで、Hachika は `state machine + LLM garnish` から、`local creature substrate + LLM semantic core` に近づきます。
