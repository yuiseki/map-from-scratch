# Day 10 · Prompting only

## 制作依頼と成果

この地図は、ユーザーが「画像生成ではなく、サブエージェントにプロンプトを与えて地図を作らせたい」と希望したことを受け、`PROMPT.md` に分けて記録した制作依頼と地図制作プロンプトで AI コードエージェントが実装しました。着手時の未コミット作業ツリーには架空列島を画像生成する案と PNG がありましたが、公式テーマに架空地図の条件はないとのユーザー確認を受け、その案を使わず画像を削除し、実在の公開データを使う地図に変更しました。画像生成モデルや生成画像、既存の地図画像は使っていません。

地図には OurAirports の施設位置と Natural Earth の陸地を使い、独自の TypeScript / Canvas 2D 描画器で表示しています。点の色と大きさは原データの施設種別、明色の輪郭は `scheduled_service=yes` を表します。データに路線ペアがないため、航空路線は推測・描画していません。

OurAirports の固定スナップショットは86,002レコードです。ベイク時に `type=closed` の施設と有効な経度・緯度のない行を除外し、72,520件を描画対象にしました。これはコミュニティが整備する施設位置一覧であり、航空活動の完全な公式台帳ではありません。提供元は正確性や適合性を保証していません。データは提供元の説明により Public domain で、OurAirports は帰属表示を希望しています。背景の Natural Earth 10m Admin 0 v5.1.1 も Public domain です。

## 実装

- ベイク時: Natural Earth の国ポリゴン外周を Equal Earth 座標へ投影し、簡略化してから16ビット量子化します。OurAirports は6種の非閉鎖施設と有効座標を選び、投影済み `x/y`、種別、定期便フラグを6バイトレコードへ格納します。
- 実行時: Canvas 2D が暗い海、投影した経緯線、国境、6種の点を初回にオフスクリーン描画します。パン・ズーム時はキャッシュした地図を合成するため、操作中に全点を再描画しません。地図ライブラリ、画像、タイル、外部データ通信はありません。
- 操作: ドラッグで移動、ポインター位置を保ったままホイールで拡大縮小、ダブルクリックで初期全世界表示へ戻します。
- 既存の `camera.ts` は投影後の画面座標、初期フィット、パン、アンカー付きズームに使用しています。

## 確認

`camera.test.ts` は初期フィット、ポインター位置を固定するズーム、パンを検証します。`airports.test.ts` は Equal Earth の東西南北、正規化座標範囲、固定長エンコード、種別・定期便フラグ保持、壊れたバッファの拒否を検証します。`bench.ts` はレコード数、6種の存在、データ出典・AI実装の開示、ロサンゼルスと羽田の実座標付近の描画を確認し、80フレームのパン・ズームを計測します。

2026-11-06: airport-pixel checks now use `readBack()` so they do not read back the visible canvas. The renderer's unused `sampleAt()` readback method was removed. Previous frame timings are provisional until a corrected three-run browser benchmark is recorded.
