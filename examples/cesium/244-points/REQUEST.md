# cesium-244-points

CesiumJS Sandcastle の「Points」のように、3D 地球儀上に 5,000 個の点プリミティブ（PointPrimitiveCollection）を配置し、視線に応じた地平線オクルージョン判定（裏面カリング）とカラーバッチ描画により 60 fps で高速に回転・ズーム表示したい。外部ライブラリなし、Canvas 2D で最速・最小で実装する。

## 元の例
- CesiumJS Sandcastle: [Points](https://sandcastle.cesium.com/?src=points)
