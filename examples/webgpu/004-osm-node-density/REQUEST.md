# webgpu-004-osm-node-density

04-osm-node-density と同じ依頼 (東京23区の OSM 全ノード 966 万点の密度を、画面の解像度で毎フレーム数え直す) を、WebGPU の compute で数える描画器です。データ、点の並び、カメラの式、色、画面の大きさ、計測の経路を 04 と同じにして、数え方 (WebGL2 の加算ブレンドか、WebGPU compute の atomicAdd か) だけが違う状態で比べます。

計測結果と比較は、計測を終えてから書きます。
