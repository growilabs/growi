# Implementation Plan

- [ ] 1. Foundation: 設定と共有基盤
- [ ] 1.1 lru-cache 依存の追加（apps/app）
  - apps/app に `lru-cache` を dependencies として追加し、`pnpm install` で解決する（install は他の build/test と同時に走らせない）
  - サーバコードから import 可能なことを確認する
  - _Requirements: 5.1, 5.2_

- [ ] 1.2 送信方式設定 PLANTUML_HTTP_METHOD の追加とクライアント伝播
  - config 定義に `app:plantumlHttpMethod`（`get`|`post`、既定 `get`、enum外は `get` に丸め）を追加し、説明に「自前サーバ前提・公開plantuml.com非対応」を明記
  - `RendererConfig` → configuration-props（share-link版含む）→ atom → renderer.tsx の3登録箇所へ伝播する
  - remark プラグインが新オプションを型として受け入れる最小拡張（`PlantUMLPluginParams` に `plantumlHttpMethod` 追加、GET安全・挙動不変）を含める
  - 形状変更の追従として `PageContentRenderer` モックと config key スナップショットを**本タスクで**更新する（型・既存テストを緑に保つ）
  - 既定(get)で現行と同一、`PLANTUML_HTTP_METHOD=post` でプラグインへ値が届くことを確認する
  - _Requirements: 1.1, 1.3, 3.2, 9.2_

- [ ] 1.3 クライアント/サーバ共有の型・定数
  - 送信方式型、エンドポイントパス、本文サイズ上限・上流タイムアウトの定数を、両側から import できる形で定義する
  - client/server 双方から解決できることを確認する
  - _Requirements: 2.1, 10.2_

- [ ] 2. Core: サーバ側描画プロキシ
- [ ] 2.1 (P) SVGキャッシュ
  - `sha256(source + darkMode)` をキーに、TTL と件数上限を持つ LRU キャッシュを実装する
  - 同一(source,darkMode)で get がヒットし、darkMode 違いで別キーになることを unit で確認する
  - _Requirements: 5.1, 5.2_
  - _Boundary: svg-cache_
  - _Depends: 1.1, 1.3_

- [ ] 2.2 (P) render-plantuml サービス
  - darkMode に応じテーマ（`themes/*.puml.ts` をサーバ import）を前置し、送信先を `plantumlUri` に固定して生テキストを上流へ POST する（responseType text, `maxRedirects: 0`, timeout）
  - **上流ステータスの class を保存して例外化**する（#5）: 上流4xxは `ClientDiagramError`（図ソース/構文エラー。`X-PlantUML-Diagram-Error` を保持可）、上流3xx（誤設定）/5xx（上流失敗）とタイムアウトは別クラス
  - 上流200でSVGを返し、上流400が `ClientDiagramError`・302/5xx/タイムアウトが別クラスで例外になることを観測する
  - _Requirements: 2.2, 2.3, 4.2, 6.3, 7.1, 7.2, 9.1, 9.3, 10.2_
  - _Boundary: render-plantuml_
  - _Depends: 1.3_

- [ ] 2.3 apiv3 プロキシルート
  - `POST /_api/v3/plantuml/svg` を追加。ミドルウェア順は **`certifySharedPage → loginRequiredFactory(crowi, true)`**（＋`rejectLinkSharingDisabled`）で保護する（#2）。body に任意の `pageId`/`shareLinkId` を受け、express-validator で MongoId 検証してから `certifySharedPage` に渡す（共有リンク匿名閲覧者を GET 同等に通す。`certifySharedPage` は必ず `loginRequired` の前）
  - ハンドラ内で本文サイズを明示検査して超過は413（グローバル body parser 済みのためルート limit では効かない前提）
  - キャッシュ参照→miss時 render→成功時 set し、`image/svg+xml` を返す。**エラーマッピング: 400/413/401・403/422（上流4xx=構文エラー, `X-PlantUML-Diagram-Error` 転送可）/502（上流3xx誤設定・上流5xx）/504**（#5）。apiv3 index に登録する
  - 上流モックで200、超過で413、上流400で422、上流302で502、キャッシュヒットで上流未呼出、**匿名＋有効な `pageId`+`shareLinkId` で200／匿名＋共有リンク無しは非公開で拒否** を観測する
  - _Requirements: 2.1, 5.2, 6.3, 9.3, 10.1, 10.2, 10.3_
  - _Boundary: plantuml svg proxy_
  - _Depends: 2.1, 2.2_

- [ ] 3. Core: クライアント側描画
- [ ] 3.1 (P) SVG取得ユーティリティ＋セッションメモ
  - `{source, darkMode, pageId?, shareLinkId?}` をプロキシへ POST して Blob を返す（共有リンク文脈でのみ id を載せる。#2）。メモは**上限付き module-level LRU（max件数＋任意でTTL）**で `Promise<Blob>` を保持し、同一入力の重複POSTと in-flight を排除する（**無制限Mapは不採用**、#9）。メモキーは `sha256(source+darkMode)`（id は含めない）
  - 同一入力の2回目でメモから返り再POSTしないこと、**max件数超過で最古を追い出すこと**を観測する
  - _Requirements: 2.1, 5.1_
  - _Boundary: fetch-plantuml-svg_
  - _Depends: 1.3_

- [ ] 3.2 (P) remarkプラグインのGET/POST出力分岐
  - GET時は現行通り（テーマ前置＋encoded `src`）。POST時はテーマ非前置の生ソース＋darkMode属性を出力し `src` を付けない
  - `sanitizeOption` に POST用の新属性を許可する
  - get=encoded src が不変、post=source属性かつsrc無し を観測する
  - _Requirements: 1.2, 3.1_
  - _Boundary: plantuml.ts remark_
  - _Depends: 1.2_

- [ ] 3.3 PlantUmlViewerのGET/POST描画分岐
  - GETは現行の `<img src>` を維持。POSTは取得Blobから **mount単位の objectURL** を生成して `<img src>` に設定、`onLoad` で完了・`onError` でエラー状態、rendering-status属性を維持、**unmount で自身のURLのみ revoke**（メモ保持のBlobは revoke しない）。共有リンク文脈では `fetchPlantumlSvg(source, darkMode, { pageId, shareLinkId })` に id を渡す（#2）
  - **`fetchPlantumlSvg` が reject した場合（`<img>` 非生成で onLoad/onError 非発火）も `GROWI_IS_CONTENT_RENDERING_ATTR` を `'false'` へ遷移**させる（再スクロール暴走防止、#6/Req 8.2）
  - **POST失敗の文言を method＋プロキシHTTPステータス（413/422/502/504/ネットワーク reject）で分岐**し、GET向けの「URL長・分割」文言は出さない（#3-b/Req 6.3。文言・i18nは本specが所有）
  - 各Viewerが独立に描画・失敗すること
  - post描画/失敗時エラー/**reject時に status='false'**/**method別の失敗文言**/**再mountで壊れない**/get不変 を観測する
  - _Requirements: 3.1, 4.1, 6.1, 6.2, 6.3, 8.1, 8.2_
  - _Boundary: PlantUmlViewer_
  - _Depends: 3.1, 3.2, 3.4_

- [ ] 3.4 POST失敗メッセージの i18n キーを5ロケール追加（本spec所有）
  - `locales/{en_US,ja_JP,fr_FR,ko_KR,zh_CN}/translation.json` に、失敗種別ごとの POST 失敗文言キー（413=サイズ超過, 422=図ソース/構文エラー, 502=上流失敗/誤設定, 504=タイムアウト, ネットワーク=サーバ未到達）を追加する（#3-b/Req 6.4）
  - GET向けの「URL長・分割」文言とは別キーとし、5ロケール全てに存在し `t()` で引けることを確認する
  - _Requirements: 6.3, 6.4_
  - _Boundary: locales_

- [ ] 4. Integration: エンドツーエンド配線
- [ ] 4.1 経路の結線と検証
  - `PLANTUML_HTTP_METHOD=post` ＋上流モックで、ページ内 plantuml がプロキシ経由で描画されることを確認する
  - 既定(get)が現行と完全に同一挙動であることを確認する
  - _Requirements: 1.2, 2.1, 2.2, 3.1_
  - _Depends: 2.3, 3.3_

- [ ] 5. Validation: テスト
- [ ] 5.1 (P) サーバ単体/統合テスト
  - svg-cache unit、render-plantuml unit（送信先固定・darkModeでテーマ切替・**上流400=ClientDiagramError／302/5xx/タイムアウトは別クラス**）、proxy integ（200/413/未認証拒否/**上流400で422**/上流302で502/キャッシュヒットで上流未呼出/**匿名＋有効共有リンクで200・無効で拒否**）
  - 上記が緑になることを観測する
  - _Requirements: 2.2, 2.3, 4.2, 5.1, 5.2, 6.3, 7.1, 7.2, 9.3, 10.1, 10.2, 10.3_
  - _Boundary: svg-cache, render-plantuml, plantuml svg proxy_
  - _Depends: 2.3_

- [ ] 5.2 (P) クライアント単体/コンポーネントテスト
  - plantuml.spec（get/post分岐・sanitizeOption）、PlantUmlViewer.spec（post描画/エラー/**reject時status='false'**（#6）/**method別の失敗文言**（#3-b）/**再mount非破壊**/get不変）、fetch-plantuml-svg のメモ重複排除＋**max超過で最古追い出し**（#9）
  - （※ `PageContentRenderer` モック・config key スナップショットの更新はタスク1.2が所有。本タスクは新規テストケース追加に限定）
  - 上記が緑になることを観測する
  - _Requirements: 1.1, 1.2, 3.1, 4.1, 5.1, 6.1, 6.2, 6.3, 8.1, 8.2_
  - _Boundary: plantuml.ts remark, PlantUmlViewer, fetch-plantuml-svg_
  - _Depends: 3.3_

- [ ] 5.3 手動E2E
  - 自前 plantuml-server ＋ `PLANTUML_HTTP_METHOD=post` で、GETでは414になる大きい図がリネームなしで描画されること、ライト/ダークでテーマ反映を確認する
  - puppeteer 経由エクスポートでのPOST描画の可否を確認し、限界を文書化する
  - ⚠️ Changeset は作成しない（`@growi/app` は `.changeset/config.json` の `ignore` 対象かつ private。追加すると release PR パスが張り付き publish に到達しない。commit `1d0a0d9f7a` 参照。app のリリースノートは release-drafter が担う）
  - _Requirements: 2.1, 2.2, 7.1, 7.2, 9.1_
  - _Depends: 4.1_

- [ ] 6. Req 11: 大きい図へのPOST推奨メッセージ（クロススペック相乗り）
  > ⚠️ 本グループは別spec `plantuml-large-diagram-get` の **GET時エラーUI（`PlantUmlViewer`）完了・マージ済み**が前提。実装/PRは **large-diagram-get 先 → 本グループ後（or 同時）**。
- [ ] 6.1 送信方式（POST可否）判定属性を Viewer へ渡す
  - `plantuml.ts` の GET分岐で `<plantuml>` に送信方式（または POST 可否）を `hProperties`（`data-*`）で付与し、`sanitizeOption` に許可を追加する
  - GET時に当該属性が要素へ付与され、sanitize を通過することを確認する
  - _Requirements: 11.1_
  - _Boundary: plantuml.ts remark_
  - _Depends: 3.2_

- [ ] 6.2 POST推奨メッセージの i18n キーを5ロケール追加
  - `locales/{en_US,ja_JP,fr_FR,ko_KR,zh_CN}/translation.json` に、汎用文言とは別の**POST推奨キー**を追加する
  - 文言は**「自己ホスト運用なら、自前PlantUMLサーバ＋POST送信で解決できる」**旨（自己ホスト前提を明示。cloud等で誤解させない）とする
  - 5ロケール全てに同一キーが存在し `t()` で引けることを確認する
  - _Requirements: 11.3_
  - _Boundary: locales_

- [ ] 6.3 エラーUIへ POST推奨行を相乗り
  - `plantuml-large-diagram-get` が新設したエラーUI（`PlantUmlViewer`）に、**`method==='get'` の時だけ** POST推奨行（`t()`）を追記する
  - GET＋上限超過で推奨行が表示され、**POSTモードや上限内では表示されない**ことを確認する（B未マージ環境＝行が無い＝Req 11.2 を自然充足）
  - _Requirements: 11.1, 11.2_
  - _Boundary: PlantUmlViewer_
  - _Depends: 6.1, 6.2_
  - <!-- クロススペック前提: large-diagram-get のエラーUI完了・マージ済み -->

- [ ] 6.4 POST推奨行のテスト
  - `PlantUmlViewer.spec.tsx` に、GET＋上限超過→推奨行表示／POSTモード・上限内→非表示／文言はi18n（`useTranslation` モック）を検証する
  - 上記が緑であることを確認する
  - _Requirements: 11.1, 11.2, 11.3_
  - _Depends: 6.3_
