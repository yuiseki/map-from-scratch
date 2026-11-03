# Three.js `webgpu_tsl_earth` の再実装

Three.js の Earth 例にならい、地球テクスチャを球面へ貼り、太陽光の陰影と青い大気の縁を付けて自転させます。ドラッグで回転、ホイールで距離を変えられます。WebGL2 の頂点・フラグメントシェーダーとインデックス付き球面メッシュで作り、Three.js 本体やプラグインは実行時に読み込みません。

## 元例との差分

- 元例は Three.js WebGPU と TSL でテクスチャ付き Earth を描きます。この版は WebGL2 の一つのプログラムと一つの球面メッシュで、方向光・昼夜境界・大気のリムをシェーダー内で計算します。
- 元例にある WebGPU backend / TSL interoperability は対象外です。地球の回転と視点操作、画像テクスチャを貼った地球儀を残します。
- 元例の `earth_atmos_2048.jpg` を同じ画像・同じ解像度で同梱し、静的配信します。Three.js example page は Earth テクスチャの由来を Solar System Scope と記載しています。再配布条件は [Solar System Scope Textures](https://shop.solarsystemscope.com/textures/) の CC BY 4.0 に従い、画面内に出典を表示します。

## データ

- `earth.jpg`: Three.js の `examples/textures/planets/earth_atmos_2048.jpg` から取得 (2048×1024、512,606 bytes、SHA-256 `2faa400d1eade3bc44caf6750d1b772bd9bbb6d87362c02bc7c3304e78fa0a9d`)。画像の出典とライセンス: Solar System Scope, CC BY 4.0。

## 検証結果 (2026-11-03)

- TDD の単体テスト6件: 緯度経度の単位球変換、極、経度の正規化、球メッシュの seam / 外向き winding、退化セグメントの拒否、ドラッグ回転とズーム範囲。すべて通過。
- `bin/mfs test`: 467件中465件成功、2件skip、失敗0件。Node / Web / test の TypeScript 検査もすべて成功。
- `bin/mfs bench threejs-006-earth -n 3`: 初回フレーム p50 111.2 ms、frame p95 1.30 ms、GPU p95 0.0553 ms、CPU p95 0.020 ms。4つの実画面 check がすべて3回成功。
- 配布量: コードgzip 5,044 B、Earth画像512,606 B、依存0。
- `results/threejs-006-earth/screenshot.png` で地球・大気・背景星を目視確認。
