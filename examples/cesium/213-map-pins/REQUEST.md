# cesium-213-map-pins

CesiumJS の「Map Pins」例のように、宇宙空間の 3D 地球儀上の指定地理座標（ワシントン、東京、ロンドン）に色分けされたピン（マップピン）を配置し、地球の自転・回転に応じて前面（可視）と背面（地球の地平線によるオクルージョン遮蔽・非表示）が正しく切り替わる地図を表示したい。ドラッグで回転、ホイールでズームできること。外部ライブラリなし、Canvas 2D 正射方位 3D 地球儀で最速・最小で実装する。

## 元の例
- CesiumJS Sandcastle: [Map Pins](https://sandcastle.cesium.com/?src=map-pins)
