# Discourse ownership and commitment ledger

会話上の未解決項目は、内容だけではなく「誰が誰に預けたものか」を持つ。

## Question ownership

`DiscourseOpenQuestion` は次を明示する。

- `askedBy`: 問いを発した側 (`user | hachika`)
- `answerExpectedFrom`: 次に答えを持つ側 (`user | hachika`)

ユーザーがHachikaへ質問した場合は `user -> hachika` になる。これはHachika側の回答義務なので、未回答の間は無関係なinitiativeや古いtraceの持ち込みを抑える。

Hachikaの通常返信・proactive発話に実際の疑問文が含まれた場合は `hachika -> user` として記録する。これはユーザーへ課した義務ではなく、Hachikaが返答を待てる状態である。ユーザーが答えたときにresolveされ、必要なら一度だけ穏やかに再訪できる。

memory threadの`open_question` frontierになれるのは `hachika -> user` の問いだけである。`user -> hachika` の問いを、Hachikaがユーザーへ聞き返す材料として扱ってはいけない。

## Request responsibility

`DiscourseOpenRequest` は次を明示する。

- `requestedBy`: 依頼した側
- `responsibleParty`: 引き受けた側

現在のユーザー入力から生じる依頼は `user -> hachika` になる。direct answer / style / taskを区別し、回答または実行が終わったturnでresolvedになる。

## Hachika commitments

`discourse.commitments` はHachikaが引き受けた問い・依頼のledgerである。

- `owner`: 現在は `hachika`
- `kind`: `answer | task | style`
- `source`: `question | request`
- `status`: `open | fulfilled`
- `sourceAskedAt`: 元の問い・依頼との対応キー

同じ入力がquestionとrequestの両方に検出された場合は、より具体的なrequest commitmentを一件だけ残す。履行済みの項目も短い履歴として保持するため、「何を引き受け、何を返したか」を後続turnとdirectorが参照できる。

## Migration

snapshot versionは28。旧questionにactor情報がない場合、旧runtimeでproactive再質問に使われていたopenな`user_name / user_profile / relation`を`hachika -> user`として移行し、それ以外は`user -> hachika`として扱う。旧requestは`user -> hachika`として移行する。

旧snapshotにcommitment ledgerがなくても、hydrate時にquestion/requestから再構成する。保存前の実データを書き換える必要はない。
