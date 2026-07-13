# Memory threads

## 目的

trace は一つの topic を詳しく保持するには向いているが、実際の会話では一つの出来事が複数の topic に分かれる。

たとえばインターンの話は、選考、参加決定、仕事内容、期間、報酬、大学課題という別々の trace になりうる。これらを平らに列挙すると、Hachika は古い断片を新しい話として繰り返したり、すでに確定した事実をもう一度尋ねたりする。

memory thread は、複数の trace を一つの時系列上の主題として読むための派生 view である。

## 接続規則

`deriveMemoryThreads` は snapshot 内の trace から連結成分を作る。trace 同士は次のいずれかで接続される。

- topic が包含関係にある
- 同じ memory entry 内で共起している
- artifact が相手の topic を直接参照している
- topic / memo / fragment / decision / nextStep / blocker から取った特徴語を共有している

特徴語による接続は、一つの十分に具体的な語、または複数の短い語が一致した場合に限る。`予定`、`決定`、`結果` のような汎用語一つだけでは接続しない。

thread は snapshot へ永続化しない。既存の trace と memory から決定的に再構成できるため、migration を必要とせず、古い個体にも適用できる。

## thread の内容

各 thread は次を持つ。

- `title`: 複数 trace に最も共有される主題語
- `traceTopics`: 古い順に並べた構成 trace
- `episodes`: trace ごとの時系列上の出来事
- `facts`: 決定済み事項を優先した既知の事実
- `blockers`: 未解決の詰まり
- `nextSteps`: まだ進められる具体的な次の一歩
- `phase`: active または resolved

`次に触れられる形へ整える` のような trace maintenance 自身が作った空の継続文は、facts / nextSteps へ入れない。

## generation との接続

通常応答では現在 topic と選択 trace から active thread を選ぶ。同じ thread の他 topic は `avoidTopics` に入れず、composition brief へ既知の事実と現在地を渡す。

能動発話では pending topic、state topic、focus trace から thread を選ぶ。proactive director は thread 全体の chronology を見て、古い episode の再演ではなく、最新 episode・blocker・nextStep に本当の続きがある場合だけ発話を通す。

wording generator は、確定済み fact を再質問せず、古い episode を現在の出来事として扱わず、最新 episode から会話を続ける。
