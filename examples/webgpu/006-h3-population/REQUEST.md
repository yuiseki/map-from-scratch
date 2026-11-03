# Kontur 人口データを WebGPU で 3D 六角柱として見る

Hugging Face で公開されている [Kontur Population 2023-11-01 の 22km データセット](https://huggingface.co/datasets/yuiseki/kontur-population-2023-11-01-22km)（全世界の 71,283 個の H3 解像度4セル）を、WebGPU を用いて人口に比例した高さの 3D 六角柱（Extruded Hexagon Columns）として立体可視化する例です。

既存の `19-kontur-h3-population` は Canvas 2D による平面塗り分けでしたが、WebGPU のパイプラインを活用することで、以下の機能を実現します：

1. **3D 押し出し六角柱（3D Extrusion）**:
   - 各 H3 セルの推計人口（1〜1,000万人超）を対数スケールで高さ $Z$ に押し出し、3D の摩天楼のように密集度を可視化。
   - 凸六角形の外周リングから上面（6三角形）および側面（12三角形）の計 18 三角形を自動生成。全世界 71,283 セル（計約 385 万頂点）を 1 つの頂点バッファにまとめ、**わずか 1 回のドローコール**で 60 fps 描画。
2. **リアルタイム高さアニメーション**:
   - 頂点バッファに高さ比率（$0$ または $1$）とセル人口をエンコードし、頂点シェーダー内で均一バッファの `heightScale` を乗算。頂点バッファの再送なしにスライダーで高さを瞬時に伸縮可能。
3. **指向性ライティング（Directional Sunlight）**:
   - 上面法線 $(0, 0, 1)$ と側面水平法線 $(nx, ny, 0)$ を備え、太陽光ベクトルとの内積による自然な陰影付け（Diffuse + Ambient）で 3D の立体感を強調。
4. **ヒートマップカラーグラデーション**:
   - 人口密度に応じた滑らかなカラーパレット（藍色 → 青緑 → 黄緑 → 橙 → 鮮紅 → 白）。
5. **Reversed-Z 深度バッファ**:
   - `depth32float` と `depthCompare: 'greater'` により、世界全体から都市レベルへの極端なズームイン・アウトでも z-fighting を完全防止。
6. **インタラクティブなカメラ操作 & ピッキング**:
   - ドラッグで回転（Orbit）、右ドラッグでパン、ホイールで拡大縮小。
   - マウスホバーで該当セルの H3 ID、推計人口、世界人口比を瞬時に表示。

元データは Kontur Population dataset © Kontur（CC BY 4.0）です。
ベイクデータは `19-kontur-h3-population` と同じ `data/baked/19-kontur-h3-population/cells.bin` を読み込みます。
