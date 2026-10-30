# OpenStreetMap 全球 PMTiles の簡易表示

[z.yuiseki.net の planet.pmtiles](https://z.yuiseki.net/static/openstreetmap/planet/planet.pmtiles)を直接読み、ドラッグとズームで探索できる例です。アーカイブのメタデータは OpenMapTiles 形式の gzip MVT、ズーム0〜14を示しています。約83 GB の全量は取得せず、PMTiles の先頭索引、必要な葉索引、画面に見えるタイルだけを HTTP Range で取得します。

描画対象は **water（水域）、transportation（道路）、place（地名）** の3レイヤーに限定しました。アーカイブには16レイヤーがありますが、残りは形状を復号せずに飛ばします。固定スタイルの Canvas 2D 描画で、水色の水域、白い道路、地名を表示します。建物や公園などは表示しません。東京・京都・ロンドン・ニューヨーク・世界の視点を用意しています。

Cloudflare は URL ごとの最初の Range 要求に HTTP 200 を返し、2回目以降は 206 を返します。そのため応答本文を直ちにキャンセルし、同じ URL で最大4回再試行します。クエリ文字列を変えて再試行すると、毎回が最初の要求になって 200 が続きます。読み込んだ画像タイルは最大64枚保持し、通信回数・通信量・HTTP 200 の再試行数を画面に示します。永続的に HTTP 200 が続く場合はエラーとして表示し、83 GB の本文は読みません。

性能計測は未実施です。Range 応答処理と MVT 復号には小さな自動テストを追加しました。

既存の seamlessphoto（例10・18）と Mapterhorn（例21）の Range 読み込みにも HTTP 200 が混じる可能性があります。その確認と再試行処理の統一は後続の作業です。
