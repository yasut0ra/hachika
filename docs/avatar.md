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
- world place と phase はstageの構造と光へ反映する

prefers-reduced-motion では継続animationを止める。

## Next steps

1. habit を導入し、同じ緊張でも「視線を外す」「固まる」など個体ごとの身体癖を分ける
2. 発話を瞬間イベントとして配信し、poll間隔より短い speak gesture も確実に再生する
3. gaze と手の動きを独立layerへ分ける
4. rendererを交換できる adapter contract を定義する
5. snapshot replayで身体の時間変化を回帰確認する
