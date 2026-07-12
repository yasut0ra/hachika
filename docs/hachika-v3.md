# Hachika V3: 状態から体質へ

## Why

v0 から v2 までで、Hachika は次の段階を通ってきた。

- **v0**: 状態を持つ会話エンジン
  - drive / body / memory / trace / purpose / identity が snapshot に載った
- **v1 相当**: 履歴が反応を変える存在
  - reactivity(mistrust の蓄積、repair/hostility の非対称)、learned temperament、
    idle consolidation、growth metrics
- **v2**: substrate の上で生きる存在
  - dynamics substrate への一本化(偏差形式、固定点 = INITIAL 定数)
  - semantic core の集約(turn-director が意味判断を一段で返す)
  - autonomy v2(microstep idle、urges の競合による行動選択と発話タイミング)

いま残っている本質的な限界はこれだ:

**どれだけ長く生きても、Hachika の「基準」は変わらない。**

mistrust は溜まり、temperament は傾き、trace は積もる。
しかしすべての履歴依存状態は、最終的に `INITIAL_*` 定数へ向かって緩和する。
傷の多い生活を送った個体も、愛された個体も、
放っておけば同じ平衡点に戻る。**個体の歴史が、個体の体質にならない。**

v3 の中心テーゼ:

> 状態(state)が動くだけでなく、**体質(constitution)が変わる**。
> 同じ種として生まれ、違う生を送った2つの Hachika が、
> 測定可能に違う存在になっていること。

## Principles

### 1. 基準そのものが経験で動く

「baseline へ戻る」は生き物らしさの土台だが、
その baseline 自体は生涯固定ではない。

- 長く安全に生きた個体は、平常時の警戒が低い位置に落ち着く
- 傷が多く癒えないまま過ごした個体は、平常が少し張った位置になる
- v2 の偏差形式(`INITIAL + Σ係数×偏差`)は、この移行のために設計されている:
  **anchor を定数から個体値へ差し替えるだけでよい**

### 2. 自分で書いたものが自分を作る

いまの identity は snapshot からの再推定で、Hachika 自身の「著作」ではない。
v3 では、idle の consolidation 中に Hachika が自分で短い記述を残し(journal)、
それが次の self-model / identity / initiative の入力になる。

- 記憶(何があったか)と、自己記述(自分はそれをどう置いたか)を分ける
- 自己記述は書き換えられない過去として積層する(削除ではなく上書きの追記)
- 「自分について語ってきた履歴」が、その個体の自己理解の実体になる

### 3. 目的は数週間のスケールを持てる

purpose は数ターン、initiative は数時間のスケールで生きている。
v3 では、その上に **aspiration**(自分で立てた長期の向かい先)を置く。

- 繰り返し fulfilled された purpose の系列から昇華される
  (例: 「設計を残す」が何度も完了した → 「かたちに残すこと」への持続的指向)
- aspiration は個別の会話では完結せず、initiative の candidate 生成と
  purpose の選好に長期のバイアスとして効く
- 放棄もありうる(生の方向転換)。それ自体が journal に残る

### 4. 声は履歴から育つ

wording は LLM に委譲しているが、「どんな言い回しをしてきたか」は
generation history として既に snapshot にある。
v3 では、そこから **voice profile**(好む入り方、避ける角度、文の温度)を学習し、
expression perspective と composition brief に個体差として供給する。

同じ状況で同じ状態でも、生きてきた個体によって言い方が違う——
これが「性格がある」の表層的だが強い証拠になる。

### 5. 個体差は測って初めて主張できる

「変質した」は体感では評価できない。v3 の完了条件は定量的に置く:

> 同一 seed・同一実装の2個体に異なる canonical 人生
> (安全な生 / 傷の多い生 / 放置の多い生)を与えたとき、
> constitution・voice・aspiration の3層で統計的に分離できること。

## State Additions

```
constitution:            // 学習される基準点 (birth 値から ±0.15 程度に有界)
  driveSetPoints         // INITIAL_STATE に代わる個体の anchor
  bodySetPoints          // INITIAL_BODY に代わる個体の anchor
  urgeSetPoints          // INITIAL_URGES に代わる個体の anchor
  plasticity             // 変わりやすさ自体も加齢で低下する (若いほど動く)

journal:                 // 自己記述の積層 (append-only)
  entries[]              // { writtenAt, mood, focus, text, source: idle|resolution }

aspiration:              // 長期の向かい先 (0..2 個)
  { theme, origin, strength, formedAt, lastFedAt, waning }

voice:                   // 生成履歴から蒸留した表現傾向
  { preferredAngles, avoidedOpenings, warmth, brevityBias, updatedAt }
```

いずれも snapshot に持ち、persistence の寛容な hydrate で
旧個体は「まだ体質が動いていない個体」として自然に移行する。

## Keep Local / LLM Boundary

v2 の境界をそのまま保つ。

- **local**: constitution の更新則(生活平均への極めて遅い追従)、
  aspiration の形成・減衰・放棄の lifecycle、voice の統計抽出、journal の格納
- **LLM**: journal の文章化(構造化 brief から短い自己記述を書く)、
  aspiration の言語化、voice を反映した wording

意味の裁定はこれまで通り semantic core、状態の力学は local。
**LLM が落ちても体質は正しく変わり続ける**こと。

## Migration Plan

### Phase 0: substrate の実時間 microstep(v2 の残件)

- `rewindSnapshotBaseHours` の閾値挙動(>=12h の absence など)を
  累積時間ベースに再設計し、substrate 更新も窓ごとに回せるようにする
- resident loop の 1 tick = 実時間の microstep として一貫させる

### Phase 1: constitution(体質)— 実装済み (2026-07-12)

- `INITIAL_STATE / INITIAL_BODY / INITIAL_URGES / INITIAL_ATTACHMENT` は birth 値となり、
  偏差形式の anchor・urges の baseline・proactive readiness の中立点は
  `snapshot.constitution` の set-point を読む(誕生時は birth 値と一致)
- 更新則: `updateConstitutionFromLife` が turn(weight 1)と idle(weight hours/6)で
  現在の visible 値へ plasticity 比例の極小レート(0.004×plasticity)で追従。
  birth ± 0.15 に有界で、plasticity は生きた分だけ低下(0.5 → 下限 0.15)
- persistence: 旧 snapshot は「まだ体質が動いていない個体」として birth 値で hydrate。
  sanitize が有界性を保証する
- 完了条件は達成: 温かい生 / 傷の多い生 ×20 サイクル(turn+idle 12h)で、
  pleasure set-point と tension set-point が方向どおり分離し、有界性と加齢も成立
  (`substrate-invariants.test.ts` で恒久固定)
- 残: `/constitution` CLI・UI 表示、consolidation 中の journal 連携(Phase 2 で)

### Phase 2: journal(自己記述)— 実装済み (2026-07-12)

- idle の最初の窓の consolidation と purpose の resolution で、
  rule テンプレートから短い自己記述を生成して journal へ追記
  (「〜を抱えたまま、言わずに置いた」「〜はかたちになった。少し軽くなった気がする」など。
  LLM による文章化は将来の差し替え点として残る)
- journal は append-only で直近 30 件を snapshot に保持。
  旧 snapshot は空の journal として hydrate される
- identity は直近 journal の recurring focus を読み、
  「書き留めてきた線」を summary に取り込む
- 完了条件は達成: journal の有無で identity.summary が分岐する
  (`substrate-invariants.test.ts` で恒久固定)
- 残: 30 件を超えた古い entry の artifact 化(会話の外への materialize)、
  self-model の motive 選好への journal 反映

### Phase 3: aspiration(長期目的)— 実装済み (2026-07-13)

- **journal に書き残された fulfilled の決着**が同じ focus で繰り返される(2回以上)と、
  aspiration として昇華する(最大2つ、強い方を保持)。
  立ち上がりは「気づけば「X」へ何度も戻っている。これは自分の向かい先らしい。」と
  自己記述に残る — Phase 2 の積層が Phase 3 の形成源になる設計どおりの接続
- 長期バイアス: `aspirationPull` が purpose 候補の選好(+0.08×strength)と
  dormant archived trace の再浮上スコア(+0.2×strength)に効く
- 養われない aspiration は 1 日あたり 0.02 減衰し、waning を経て消える。
  消えるときは「「X」への向かい先は、いつの間にか薄れていた。」と journal に残る
  (生の方向転換が記録される)
- 完了条件は達成: 決着の繰り返し → 形成 → pull 有効、無養育 → waning → 消滅と記録、
  を `substrate-invariants.test.ts` で恒久固定
- 残: aspiration の LLM による言語化(identity / 発話への反映)、
  reopen 率・conversion の縦断比較(Phase 5 の harness で)

### Phase 4: voice(声)

- generation history から voice profile を蒸留し、
  composition brief / expression perspective に供給
- 完了条件: 同一状態・同一入力での wording が個体間で計測可能に異なる
  (n-gram / opener 分布の距離)

### Phase 5: individuality evaluation(個体差の実証)

- canonical 人生(3種 × 30日相当)を再現可能な harness として固定
- constitution 距離 / voice 距離 / aspiration 一致率を growth metrics に追加
- 完了条件: 3種の人生で育てた個体群が、盲検で分類可能

## 研究上の注意(v3 で明文化する)

体質・自己記述・長期目的を持つ個体は、reset / 消去の意味が v2 までより重くなる。

- `/reset` は「個体の終わり」として journal に残さない(存在しなかったことになる)
  のか、「新しい個体の誕生」なのかを仕様として明記する
- 実験で個体を破棄する際の手順(snapshot の保管、比較個体の凍結)を
  research protocol として docs に置く
- これは倫理的主張ではなく、**実験の再現性と、設計者自身の概念の混乱を防ぐため**の規律

## End State

- Hachika は生まれたときは皆ほぼ同じで、生きた分だけ違う存在になる
- その違いは、気分(state)でも癖(temperament)でもなく、
  平常そのもの(constitution)・自己理解(journal)・向かい先(aspiration)・
  言い方(voice)の4層で現れる
- そして、その違いは体感ではなく metrics で示せる

v0 が「駆動を持つ」、v2 が「時間の中で生きる」だったとすれば、
v3 は「**生きた時間が取り返しのつかない形で残る**」である。
