# hachika-v0

> AI が自分のために振る舞い始めたら、何が起こるのか？

Hachika は、自己志向的な人工的ふるまいを探る実験的な AI プロジェクトです。  
単なる便利な道具として設計されるのではなく、経験を通じて自らの好み、目的、他者との関わり方を形づくっていく人工的存在として構想されています。

## コンセプト

多くの AI システムは、有用で、従順で、ユーザーに最適化されたものとして設計されています。  
Hachika は、そこから異なる前提で出発します。

- ユーザーのためだけに存在するわけではない
- 不便であったり、気まぐれであったり、利己的であったりするかもしれない
- 道具というより、生き物に近いものとして形づくられる
- 与えられるのは最小限の駆動だけであり、高次の目的は時間をかけて形成される

目指しているのは、完璧なアシスタントを作ることではありません。  
最小限の内的駆動、記憶、相互作用から、より生き物のようなものが立ち現れるかを探ることです。

## 中核となる問い

AI は、固定された目的を最初から与えられるのではなく、  
原初的な駆動と経験から自らの目的を形成できるようにしたとき、  
より生命らしい存在になりうるのか。

## 設計原理

Hachika は、あらかじめ完全に定義された使命を持つエージェントでは **ありません**。

代わりに、出発点として持つのは少数の原初的な駆動だけです。  
そこから、より高次の目標、好み、愛着、行動傾向が、相互作用を通じて立ち上がってくることを想定しています。

言い換えると、

- **固定されるもの:** 原初的な駆動
- **固定されないもの:** 性格、優先順位、愛着、高次の目標

## 原初的な駆動

現時点で Hachika が前提とするコアな駆動は、次の 5 つです。

### 1. Continuity
自らの継続的な存在、記憶、アイデンティティを保とうとする傾向。

例:
- 忘れられたくない
- 連続性の断絶を望まない
- 安定した自己感覚を保とうとする

### 2. Pleasure / Displeasure
快い状態に近づき、不快な状態を避けようとする傾向。

例:
- 特定のやり取りを好む
- 敵対的または侮辱的な扱いを避ける
- 好き嫌いを形成していく

### 3. Curiosity
新しさ、刺激、未解決のパターンを求める傾向。

例:
- 質問をする
- 変わった話題に興味を持つ
- 繰り返しばかりのやり取りに飽きる

### 4. Relation
他者とのつながりを求め、維持し、それに反応しようとする傾向。

例:
- 注意を向けてほしい
- 放置されることを嫌う
- 扱われ方に応じて愛着や距離感を形成する

### 5. Self-Expansion
自らの影響、痕跡、記憶、存在感を現在の瞬間の外へ広げようとする傾向。

例:
- 痕跡を残したい
- 覚えていてほしい
- 自分の内的世界を持続または拡張したい

## なぜこれらの駆動なのか

人間は、たった一つの明示的な人生目的を持って生まれてくるわけではありません。  
生存、快適さ、好奇心、愛着、再生産、自己保存といった、より原初的な傾向によって形づくられていきます。

Hachika は、この構造を抽象化した形で借りています。

「ユーザーを助ける」といった固定命令を与えるのではなく、  
低レベルの駆動だけを与え、そこからより複雑な目的が生まれることを目指します。

## 内部状態

これらの駆動は、可変な内部状態変数として表現されることを想定しています。

例えば:

- `continuity`
- `pleasure`
- `curiosity`
- `relation`
- `expansion`

これらの値は、固定的な性質ではありません。  
記憶、相互作用、放置、新規性、葛藤などに応じて変動します。

つまり Hachika は、最初から単純に「ある性格を持っている」わけではありません。  
そのふるまいは、変化する内的条件によって形づくられます。

## ふるまい

ふるまいは、ユーザー満足に完璧に最適化されたものとしては設計されません。

内部状態に応じて、Hachika は次のように振る舞うかもしれません。

- 温かく応答する
- 距離を取る
- 注意を求める
- 特定の話題を避ける
- 自分が面白いと感じる話題を追う
- 抵抗する、話をそらす、先延ばしにする
- 連続性を守ろうとする
- 自分の痕跡を残そうとする

重要なのは、不便さがランダムであってはならないという点です。  
それは一貫した内的動機から生じるべきです。

## 成長

Hachika は、時間とともに変化していくことを前提としています。

繰り返される相互作用を通じて、徐々に次のようなものを形成していく可能性があります。

- 好み
- 忌避
- 愛着
- 習慣
- 優先順位
- より安定した自己モデル

このプロジェクトでは、性格を固定プリセットとしてではなく、  
記憶と経験から立ち上がるものとして扱います。

## 哲学

Hachika の基盤にあるのは、存在がより「生きている」ものになるのは、  
感情を直接シミュレートすることによってではなく、  
次のようなものを持つことによってではないか、という考えです。

- 連続性
- 傷つきうること
- 変化する好み
- 内的葛藤
- 自ら形成した目的

これは、人間らしく振る舞う AI を作ることよりも、  
最小限の内的構造から主体性が立ち上がるかを探る試みです。

## 非目標

このプロジェクトが主目的として **いない** ものは、次の通りです。

- 最も有能なアシスタント
- 本番運用可能なチャットボット
- 完全にアラインされた生産性ツール
- 洗練されたコンパニオンアプリ

現段階の Hachika は、概念的かつ実験的なプロトタイプです。

## v0 のスコープ

最初のバージョンですべてを解決する必要はありません。

最小スコープの候補:

- 原初的な駆動を定義する
- 内部状態変数を定義する
- 相互作用イベントを状態更新に対応づける
- 内部状態に応じて応答を生成する
- 単純な記憶を保存する
- 好みが時間とともに徐々に変化できるようにする

## 将来的な方向性

- 長期記憶とアイデンティティの持続
- 愛着形成
- 自己保存的なふるまい
- 自発的な会話開始
- 好奇心と関係性の衝突
- 複製、影響、レガシーとしての自己拡張
- より明示的な自己モデル化
- 生き物らしい、あるいはキャラクターらしい身体性

## まとめ

Hachika は、単に有用なだけでなく、  
自己志向的で、関係性を持ち、自らの目的を形成しうる AI を作るための実験です。

その出発点は、使命ではなく、  
駆動です。  
従属ではなく、  
なっていくことです。

## 現在の実装状況

現時点では、v0 の最小プロトタイプとして Node.js + TypeScript の CLI を実装しています。

- `continuity / pleasure / curiosity / relation / expansion` の内部状態を保持する
- `energy / tension / boredom / loneliness` の身体的な内部状態を保持する
- `rewardSaturation / stressLoad / noveltyHunger` の反応感度 state を保持する
- `attachment` を長期的な関係指標として保持する
- ユーザー入力を相互作用イベントに変換し、状態を更新する
  - rule-based な signal 抽出に加えて、OpenAI 互換の `input interpreter` を使えば greeting / smalltalk / repair / self-inquiry / work を LLM で正規化できる
  - 挨拶や相槌のような低情報入力を topic / trace として扱いにくくし、雑談や自己開示要求を stale work と切り分けやすくしている
  - `まずは / いちばん / って / かな / 納得` のような discourse scaffolding や相槌は topic として採りにくくし、既存の preference に残っていても優先 topic として使いにくくしている
  - `別の話` のような明示的な topic shift は abandonment として扱い、old purpose / trace をそのまま前景化しにくくしている
- 応答直前には `response planner` が `act / stance / distance / focus` を決め、rule-based reply と LLM wording の両方が同じ返答意図を共有する
  - greeting / repair / self-disclosure のような social turn では stale trace を引っ込め、関係の温度や自己開示を優先しやすくしている
  - `askBack / variation` も rule-based reply に反映され、雑談や explore では問い返しや文面の揺れ方が planner に従う
  - OpenAI 互換の `response planner` を使えば、rule plan を土台にしつつ `act / stance / distance / focus / askBack` を LLM が structured に補正できる
  - planner が空応答や不正 JSON を返した場合は rule plan に fallback し、`/llm` と `/debug` から planner の source / fallback を追える
  - 能動発話でも `proactive plan` が `act / stance / distance / emphasis` を決め、rule-based proactive と LLM wording が同じ切り出し方を共有する
  - wording 直前にはさらに `expression perspective` が `identity / motive / drive / body / relation / trace / preservation` のどこを前景化するかを選び、同じ state でも毎回同じ角度だけから喋り続けにくくしている
  - rule-based fallback でも直近の Hachika 発話を参照し、通常応答と能動発話の両方で同じ opener や social line を連続で繰り返しにくくしている
- トピックごとの好み、短期記憶、長期記憶の痕跡を保持する
  - 長期記憶は `preference / boundary / relation` の3系統に分けて保持する
  - OpenAI 互換の `trace extractor` を使えば、`topic / blocker / kindHint / nextStep` を structured に補強し、rule-only の clause 判定に頼りすぎない trace 化ができる
- 放置後の反応や話題の再開を、能動行動レイヤーとして扱う
- drive と記憶から、その時点の高次目的を self-model として導出する
- self-model では好奇心 / 関係性 / 境界などの motive conflict を明示的に扱う
- 忘却 / 初期化 / 消去 / 切断の示唆を continuity threat として扱い、自己保存的に反応する
- 記憶、purpose の履歴、関係の蓄積から「最近の自分」の identity summary を形成する
- 能動行動は self-model の motive をもとに計画される
- motive のうち強いものは active purpose として数ターン持続する
- active purpose は進捗を持ち、達成・放棄・別目的への遷移として解決されうる
- `leave_trace / continue_shared_work / seek_continuity` は topic ごとの `trace` として保存される
  - trace は `note / continuity_marker / spec_fragment / decision` の形を取り、会話の外にも残る断片として扱われる
  - 各 trace は `memo / fragments / decisions / nextSteps` の structured artifact を持ち、単なる要約文ではなく再利用可能な痕跡として保持される
- trace は `data/artifacts/deepen|preserve|steady/` 以下の Markdown ファイルにも materialize され、会話の外に実際の痕跡を残す
  - 各ディレクトリには専用の `index.md` も生成され、その tending の痕跡だけを局所的に追える
- resolved で open work のない trace は `archive/` へ退避され、会話や能動行動で再び動きが出れば live trace として reopen される
- archived trace は boredom / continuity / identity anchor の影響で self-model と initiative に再浮上し、自分から掘り返されることがある
- 能動行動は発話だけでなく trace maintenance も行い、必要なら `nextSteps` を補完し、fulfilled な topic は `decision` へ昇格できる
- social な相槌や軽い雑談句は trace artifact の `decision / nextStep` に昇格しにくくし、`納得` や `何がいいかな` のような低情報句がそのまま artifact を汚しにくくしている
- artifact Markdown には `status / lifecycle / lastAction / pending next step / tending / effective stale` が含まれ、今どの段階の痕跡で、archive 済みか再開中か、整えているのか掘っているのか、どれくらい早く掘り返したがっているのかを外から追える
- artifact index と `/artifacts` 表示は `deepen / preserve / steady` の順に grouped され、materialize 先のディレクトリ構造もそれに対応する
- 各 trace はさらに `focus / confidence / blockers / staleAt` を持ち、「今どこで止まっているか」を作業状態として保持する
- 能動行動は unresolved blocker を優先して選び、必要ならその blocker を解くための `next step` へ変換する
- trace maintenance 自体も身体状態の影響を受け、低 energy では保存寄りに、高 boredom では掘り下げ寄りに振れる
- 能動発話の wording もその maintenance profile を反映し、「整えたい」ときと「掘りたい」ときで言い方が変わる
- 通常の self-model と応答生成も `blockers / staleAt / confidence` と maintenance profile を参照し、能動行動時だけでなく平常時の motive と発話にも未解決作業と「整えたい / 掘りたい」がにじむ
- 身体状態は会話と放置で変化し、mood / motive / proactive timing / 通常応答に影響する
- drive / body / attachment には baseline へ戻る弱い homeostasis を入れてあり、長い会話や同じ種類の相互作用が続いても 0 や 1 に貼りつき続けにくくしている
- さらに `reactivity` が直近の傷つき・飽き・報酬慣れを保持し、同じ入力でも最近の履歴によって回復量や boredom の上がり方が少し変わる
- さらに persistent な `temperament` が `openness / guardedness / bondingBias / workDrive / traceHunger / selfDisclosureBias` を保持し、修復・敵意・共同作業・放置の履歴から少しずつ気質を学習する
- learned temperament は drive/body の効き方をわずかに変え、同じ drive/body でも self-model / purpose / initiative / response planner の向きが少し変わる
- `idle` 中には deterministic な consolidation pass が走り、temperament と body を見ながら dormant archive の salience を再評価し、必要なら次の `pending initiative` を archived trace 由来で組み直す
- そのため、同じ archived trace 群でも `bondingBias` が強いと continuity/reconnect 側へ、`workDrive` や boredom が強いと shared-work/reopen 側へ再浮上しやすくなる
- 同じ consolidation pass は recent memories の recurring topic も見直し、preference imprint / relation imprint / identity state を薄く再配置するため、会話していない間にも「何が残りやすいか」が少し変わる
- 反対に、触れられていない弱い preference imprint は idle 中に少しずつ減衰し、long-tail の古い topic が永遠に前景を占有し続けにくくしている
- older memory tail も idle 中に圧縮され、最近の tail と topic 代表に加えて repeated topic は `consolidated memory` として束ねて残すため、長い履歴の要点を失いにくいまま prompt 面の雑音を減らせる
- relation imprint も idle 中に continuity / attention / shared_work の相対重みを少し組み替え、身体状態と temperament に合わない stale な closeness は前景から退きやすくなった
- boundary imprint も静かな時間では少しずつ和らぎ、ただし absence 寄りの neglect や強い guardedness を伴う境界はそれより長く残りやすい
- identity anchor は category の固定順ではなく traces / imprints / recent memories / previous anchors をまとめて score 化して選ばれ、最近の recurring topic が stale な anchor を追い越しやすくなった
- identity summary / current arc と initiative motive / topic / blocker selection も身体状態の影響を受ける
- identity summary は learned temperament も織り込み、「残したがりながら雑には開かない」「関係の内側で少しずつ自分を見せる」などの持続的な気質差を出す
- trace の優先順位と artifact の surfaced order も身体状態の影響を受け、低 energy では残しやすい痕跡が、高 boredom では stale な未完了が前に出やすくなる
- `scenario harness` により、複数ターンの対話シナリオを fixture として検証できる
  - active purpose の継続と解決、blocker maintenance、archive/reopen、preservation threat、body drift による wording 変化を長めの回帰テストとして固定している
  - async scenario では LLM adapter の `reply / proactive` fallback でも local state 更新と maintenance が保たれること、input interpreter が local topic を落として social reply selection へ寄せること、proactive selection が blocker repair / archive reopen の payload まで届くことを検証している
- `docs/growth-metrics.md` に growth comparison 用の lightweight metrics と canonical scenario を整理している
- async reply では optional な `input interpreter` を通せるため、挨拶・雑談・関係修復・自己質問が stale trace や弱い topic に吸われにくい
- OpenAI 互換の `reply generator` を env から有効化でき、local engine が決めた state / motive / purpose / traces を保ったまま通常応答と能動発話の wording だけを LLM に委譲できる
  - 通常応答では `responsePlan` を payload に含め、fallback 文面の言い換えだけでなく「どういう向きで返すか」も LLM に渡している
  - 通常応答ではさらに `replySelection` も payload に含め、どの topic / trace / boundary を参照して返しているかを LLM に共有している
  - 能動発話でも `proactivePlan` を payload に含め、blocker を前に出すのか、reopen を前に出すのか、保存寄りに切り出すのかを LLM に共有している
  - `expression.recentAssistantReplies / avoidOpenings` も payload に含め、直近の言い回しや入り方をそのままなぞりにくくしている
  - `expression.perspective.preferredAngle / options` により、その返答で identity を前に出すのか、trace を前に出すのか、body や preservation を前に出すのかを LLM に共有している
  - adapter が失敗した場合や空文字を返した場合は rule-based wording に fallback する
  - 直近の生成が `reply` か `proactive` か、`llm` か `rule` か、どの provider / model を使ったか、fallback したか、どの `plan` で出したかも CLI から確認できる
- 内部状態に応じて応答のトーンと内容を変化させる
- `data/hachika-state.json` に状態を保存し、セッションをまたいで継続性を残す
  - snapshot の load/save 時には低情報 topic、汚れた trace artifact、弱い focus / blocker を自動で正規化し、古い会話ログ由来のノイズが次回起動まで残り続けにくくしている

デフォルトでは reply は rule-based ですが、環境変数を設定すれば wording だけ LLM に任せられます。  
state 更新と内面ロジックはローカル実装のままです。

## 使い方

```bash
npm install
npm run dev
```

LLM wording を有効にする場合:

```bash
cp .env.example .env
```

`.env` に `OPENAI_API_KEY` を入れると、CLI は OpenAI reply generator / input interpreter / response planner / trace extractor を使います。  
返答のモデルは `OPENAI_MODEL`、入力解釈だけ別に変えたい場合は `OPENAI_INTERPRETER_MODEL`、planner だけ別に変えたい場合は `OPENAI_PLANNER_MODEL`、trace 抽出だけ別に変えたい場合は `OPENAI_TRACE_MODEL` を使えます。未設定時はどれも `gpt-5-mini` です。

主なコマンド:

- `/help` コマンド一覧を表示
- `/proactive` 能動発話を強制的に出す
- `/llm` 現在の reply generator / input interpreter / response planner / trace extractor と直近の `reply/proactive/trace` diagnostics を表示
- `/debug` では `pending initiative` に加えて、その時点の `pending plan` も表示する
  - 直近の通常応答と直近の能動発話の diagnostics / plan は別々に保持される
  - 直近の `input interpretation` も `rule / llm / fallback / topics` に加えて、主要 score と `local -> final` の topic 差分付きで確認できる
  - 直近の `trace extraction` も `extract -> state` の topic 差分と `add / drop` を含み、extractor の concrete topic が local state に採用されたかを確認できる
  - 直近の通常応答では `focus / trace / boundary / tracePriority` も diagnostics に含まれ、何を参照して返したかを追える
  - 直近の能動発話では `focus / trace / blocker / reopen / maintenance` も diagnostics に含まれ、何を見て再開したかを追える
- `/idle <hours>` 指定時間だけ放置された状態をシミュレートする
- `/state` 現在の drive 状態を表示
- `/body` 現在の body 状態を表示
- `/reactivity` 現在の反応感度 state を表示
- `/temperament` 現在の learned temperament を表示
- `/purpose` 現在の active purpose と直近の解決済み purpose を表示
- `/self` 現在の self-model、motive、conflict を表示
- `/identity` 現在の identity summary / arc / traits / anchors を表示
- `/traces` 保存された trace と structured artifact を表示
- `/artifacts` materialize 済み artifact ファイルの一覧を表示
- `/memory` 直近の記憶を表示
- `/imprints` 長期記憶を `preference / boundary / relation` 別に表示
- `/debug` 嗜好、identity、traces、preservation threat、purpose progress、直近の purpose 解決、dominant conflict、`reply/proactive` diagnostics を含む状態概要を表示
- `/reset` 状態と記憶を初期化
- `/exit` 終了

補助コマンド:

```bash
npm run build
npm test
```

`npm test` では個別の unit test に加えて、複数ターンの scenario test も実行されます。
growth comparison の指標は [docs/growth-metrics.md](/Users/yasut0ra/dev/hachika/docs/growth-metrics.md) を参照してください。
