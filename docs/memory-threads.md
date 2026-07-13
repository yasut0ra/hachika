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

thread の内容は snapshot へ永続化しない。既存の trace と memory から決定的に再構成できるため、古い個体にも適用できる。ユーザーが置いた終了・保留・再開の境界だけは lifecycle event として永続化する。

## thread の内容

各 thread は次を持つ。

- `title`: 複数 trace に最も共有される主題語
- `traceTopics`: 古い順に並べた構成 trace
- `episodes`: trace ごとの時系列上の出来事
- `facts`: 決定済み事項を優先した既知の事実
- `blockers`: 未解決の詰まり
- `nextSteps`: まだ進められる具体的な次の一歩
- `phase`: active / parked / closed / reopened / resolved

`次に触れられる形へ整える` のような trace maintenance 自身が作った空の継続文は、facts / nextSteps へ入れない。

## generation との接続

通常応答では現在 topic と選択 trace から active thread を選ぶ。同じ thread の他 topic は `avoidTopics` に入れず、composition brief へ既知の事実と現在地を渡す。

能動発話では pending topic、state topic、focus trace から thread を選ぶ。proactive director は thread 全体の chronology を見て、古い episode の再演ではなく、最新 episode・blocker・nextStep に本当の続きがある場合だけ発話を通す。

wording generator は、確定済み fact を再質問せず、古い episode を現在の出来事として扱わず、最新 episode から会話を続ける。

## Lifecycle

thread の内容と「いま持ち出してよいか」は分けて扱う。lifecycle transition は `memoryThreadEvents` として snapshot に保存する。

- `active`: 通常の進行中
- `parked`: 「一旦置く」「別の話にする」。忘れないが自分からは再浮上させない
- `closed`: 「この話は終わり」「今後は持ち出さない」。より強い終了境界
- `reopened`: parked / closed の後、ユーザー自身が同じ主題へ戻った
- `resolved`: 構成traceがすべてresolvedまたはarchived

parked / closed thread は次の全経路から局所的に除外する。

- pending initiative の外向き発話
- initiative topic / blocker selection
- archived trace のidle recall
- proactive director のcandidate topics

`force` はこの境界を迂回しない。これは発話間隔のrefractoryではなく、ユーザーが置いた主題境界だからである。

終了turnはinitiative schedulingより先にevent化する。そのため、同じturnのdirectorが終了済みtopicをpendingへ戻すこともできない。再開eventはHachikaのproactive発話では作られず、ユーザーの明示的な再言及またはcontinuation cueだけが作れる。

古いsnapshotにはeventが存在しないため、user memoryとtrace artifact内の明示的な終了文からlegacy lifecycleを推定する。一度新しいeventが保存されたthreadでは、保存eventをauthoritativeに使う。

## Episode frontier

chronologyの末尾と「次に外へ出す価値があるもの」は同じではない。各threadは一つのepisode frontierを持つ。

frontierは次の優先順位で決まる。

1. `open_question`: Hachikaが尋ね、ユーザーの返答を待っているwork topicの問い
2. `open_request`: 未回答のtask request、または未完了のaccepted / renegotiated task
3. `blocked`: 最新episodeまたはthread全体のblocker
4. `next_step`: 具体的に残っている次の一歩
5. `new_episode`: まだ外へ出していない最新episode
6. `settled`: 新しく外へ出す未完了がない

解決済みでarchiveされたepisodeも、意図的な回想の入口として一度だけ`new_episode`になれる。そこでproactive発話したfingerprintをcheckpointするため、内容が進まない限り同じ回想は繰り返さない。

frontierは`phase / kind / sourceTopic / summary`から決定的なfingerprintを作る。Hachikaがそのfrontierについてproactive発話した時点で、fingerprintを`InitiativeActivity.frontierKey`へcheckpointする。

ユーザーがHachikaへ尋ねた未回答質問はfrontierではなくHachika側のcommitmentである。所有者と応答側の区別は[discourse ownership](./discourse-ownership.md)を参照。

同じthreadの現在fingerprintと最後に発話したfingerprintが一致する場合、次を抑制する。

- 既存pending initiativeの発話
- initiative topic / blocker selection
- archived traceのidle recall

ユーザーが戻ったという事実だけでは同じ内容をもう一度話す理由にならない。問いが追加・解決された、blockerが変化した、next stepが変わった、新しいepisodeが加わった場合にだけfingerprintが変わり、再びfrontierが開く。

旧activityには`frontierKey`がないため、最後のproactive発話時刻がthreadの最終更新以後なら、その時点のfrontierはすでに一度外へ出たものとして移行する。
