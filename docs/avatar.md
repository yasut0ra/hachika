# Hachika Avatar / Embodiment

## Goal

avatar は返答の横に置く感情アイコンではなく、local substrate と world が
外から観測できる身体である。

描画実装が内部状態を直接解釈しないよう、次の3層に分ける。

```text
substrate / world / autonomy history
  -> EmbodimentState
  -> 2D CSS renderer (将来は Live2D / 3D に交換可能)
```

## MVP contract

`src/embodiment.ts` は snapshot から以下を純粋に導出する。

- `posture`: open / settled / guarded / withdrawn
- `gazeTarget`: viewer / lamp / desk / shelf / down / distance
- `action`: observe / recall / hold / drift / touch / speak / rest
- `movementTempo / breathDepth / proximity`
- `expressionWarmth / alertness / tension`
- `motion.manner / gestureAmplitude / gazePersistence / stillness / settlingTimeMs`
- `actionId`: 同種の action が新しく起きた時だけ renderer が再生するための識別子
- `layers.eyes / mouth / hands / blinkIntervalMs`: 顔と手を独立制御する描画意図
- `speech.id / durationMs / remainingMs / cadence / emphasis`: 発話を時間イベントとして描画する情報
- `place / phase`

単一の値と単一の表情を対応させない。たとえば guardedness だけで姿勢を決めず、
tension、mistrust、preservation threat、safety の合成から身体の閉じ方を決める。

## Current renderer

- 透過PNGの全身立ち絵を1体だけ持つ
- 呼吸は常時継続する
- proximity は身体の画面上の距離になる
- warmth / alertness は明るさと彩度へ弱く反映する
- posture は身体の開きと傾きへ反映する
- action は視線対象と位置の小さな移動へ反映する
- learned temperament から `reaching / measured / guarded / searching` の身体癖を導く
- gaze は現在値へ即時ジャンプせず、gazePersistence に応じて直前の対象へ少し残る
- action が rest に戻っても gesture は settlingTimeMs だけ余韻を残す
- actionId が変化した時だけ entrance gesture を再生し、polling では再発火しない
- eyes は個体の blinkIntervalMs で短く閉じ、hold時は身体状態に応じて閉じたままになる
- mouth は speak の間だけ neutral から quiet speaking 差分へ移る
- speech duration は文字量と句読点から1.8〜16秒で導き、cadence / emphasis はactivationや身体状態を反映する
- rendererはremainingMsでmouthを閉じるため、次のUI pollingを待たない
- hands は touch / observe で reach、recall / hold で gather の薄い動作layerを出す
- world place と phase はstageの構造と光へ反映する

prefers-reduced-motion では継続animationを止める。

## Next steps

1. 手のpose差分を作り、残像layerから実poseへ置き換える
2. 発話の句読点単位タイムラインを作り、口の休止位置を文中へ入れる
3. rendererを交換できる adapter contract を定義する
4. snapshot replayで身体の時間変化を回帰確認する

## Layer assets

- `hachika-neutral-v2.png`: identityを固定するbase
- `hachika-blink-v1.png`: 目閉じ差分。rendererは目の周辺だけをclipする
- `hachika-speak-v1.png`: quiet speaking差分。rendererは口の周辺だけをclipする

差分2点はbuilt-in image generationのidentity-preserve editで作成した。全身を切り替えず局所clipで重ねるため、baseの輪郭・衣服・姿勢は常にneutral-v2を正とする。
