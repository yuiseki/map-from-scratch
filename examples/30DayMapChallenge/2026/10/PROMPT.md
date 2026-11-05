# Day 10 · Prompting only · 制作指示の記録

## サブエージェントに渡された初回の制作依頼

> Day 10「Prompting only」を実装してください。ユーザーが明示的に希望しています: 画像生成モデルは使わず、サブエージェントにプロンプトを与えて地図を作る方式に切り替える。親エージェントからの制作プロンプトは次の通りです: 「架空の火山列島を、地理的に整合する地図としてコードで一から作ってください。大きな三日月形の主島、周囲の火山島、尾根と河川、河口デルタ、礁湖、等深線を持つ地形を描き、架空データであることを明記してください。画像生成や既存地図画像・タイル・地図ライブラリは使わず、TypeScriptとCanvas 2Dなど標準APIだけで、独自描画器を実装してください。チャレンジの『Prompting only』として、あなた自身がこの制作プロンプトから地図を仕上げ、使ったプロンプトとAI作業であることをページ上またはREQUEST.mdに正直に記録してください。」既存のDay10は親が画像生成案を途中まで書きましたが、まだ未コミットです。現在の `camera.test.ts`, `camera.ts`, `index.html`, `main.ts`, `renderer.ts`, `PROMPT.md` を使える範囲で再設計し、画像アセット `assets/prompt-archipelago.png` は使わないでください。未追跡PNGは必要なければ削除して構いません。最初にテストを追加して失敗を確認してから実装してください。`.agents/skills/map-from-scratch/SKILL.md`, `.agents/skills/map-from-scratch/references/spec-yaml.md`, `.agents/skills/visual-review/SKILL.md`, `.agents/skills/yuiseki-open-data/SKILL.md` を読み、公式テーマ説明を確認済みの前提です。フル Day10 package: spec.yaml, REQUEST.md, canvas implementation, meaningful unit/browser checks, measurement-ready bench.ts, TODO.md status update after actual pass. Keep data synthetic and explicitly disclose no actual location/data. Read existing parent changes before overwriting. Do not commit or push; parent handles final checks and commit. Do not use image_gen.

## 後から受けた方針更新

> 公式テーマに架空地図の縛りはなく、架空列島は私の提案に過ぎませんでした。fictional限定を外してください。Day10の1つの制作プロンプトからAIが開始から完成まで実在地域/公開データを使って作る地図に変更。`.agents/skills/yuiseki-open-data` カタログで採用データのライセンス・原典・ローカルファイルを照合してください。現実データの公開条件が不明ならデータを選び直すか明示的な合成値にしてください。PROMPT.mdには実際の制作指示を誇張せず正確に残してください。画像生成は使わないまま。

## 実際に地図を作るために用いたプロンプト

> OurAirports の 2026-08-31 固定スナップショットを使って、実在する世界の空港・飛行場を主役にした世界地図を作ってください。Natural Earth の陸地を背景にし、空港種別を色と点の大きさで示し、定期便がある施設は輪郭で区別してください。実データにない航空路や接続関係は描かないでください。Equal Earth 投影を使い、全世界の分布が初期画面で見えるようにしてください。TypeScript と Canvas 2D など標準 API だけで専用描画器を一から実装し、画像生成・既存地図画像・タイル・地図ライブラリを使わないでください。ドラッグで移動、ホイールで拡大縮小できるようにしてください。データのスナップショット日、フィルター、出典、ライセンス、AI エージェントがこのプロンプトから実装したことを画面上に明記してください。プロンプトそのものもページで読めるようにしてください。

上の初回依頼のうち、架空地理と合成データの指定は後の方針更新で撤回されました。地図制作プロンプトはその更新に従い、実データ源を選んだAIコードエージェントが作成して使用したものです。実装・テスト・計測はこのリポジトリの開発規則にも従っています。
