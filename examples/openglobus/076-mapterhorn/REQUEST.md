# OpenGlobus Mapterhorn Terrain の再実装

OpenGlobus の Mapterhorn 例のように、Mapterhorn の RGB Terrarium 標高から起伏のある地形を描きます。高さで色を分け、GPU上で斜面の向きに応じて陰影を付けます。ドラッグで向きを変え、ホイールで距離を調整します。

## 元例との差分

- 元例は OpenGlobus の地球儀上で Bing / OpenStreetMap のレイヤーと Mapterhorn 地形を重ねます。この版は Mapterhorn の z12 Terrarium タイル1枚（富士山北側）だけを読み、地形メッシュに専用の WebGL2 描画器で描きます。
- Bing / OSM の画像レイヤー、全球・タイルLOD・レイヤー切替は含めません。元例の地形の高さ、回転・ズーム操作、陰影を一画面の地形ビューに絞っています。
- 512×512 の標高タイルを初期化時に一度CPUでデコードし、128×128頂点へ縮小してGPUへ一度だけアップロードします。フレーム中は頂点を再生成しません。

## データと帰属

- `terrain.webp`: Mapterhorn `https://tiles.mapterhorn.com/12/3627/1615.webp` の Terrarium タイル。元ファイルと同一バイトの512×512 WebP (sha256 `8833f3781fec4b2b6ba05ebc91a6800b59710a4034759d46baba06dcb8b6ba9b`)。
- 帰属: Mapterhorn、および国土地理院「基盤地図情報（数値標高モデル）」使用承認 R 8JHs 131。帰属表示とライセンス情報は[Mapterhorn attribution.json](https://download.mapterhorn.com/attribution.json)に基づきます。

## 検証結果 (2026-11-03)

- TDD単体テスト5件: Terrarium復号、異常寸法の拒否、標高メッシュ、標高段彩、ドラッグ・ズーム範囲。すべて通過。
- `bin/mfs bench openglobus-076-mapterhorn -n 3`: 初回フレーム p50 72.97 ms、回転frame p95 1.035 ms、GPU p95 0.04915 ms。地形表示と回転後ピクセルの2チェックが3回とも通過。
- 配布量: コードgzip 5,410 B、入力WebP 365,200 B、ランタイム依存0。
- GPU: NVIDIA GeForce RTX 3060。スクリーンショット `results/openglobus-076-mapterhorn/screenshot.png` で地形の陰影・段彩を確認。
