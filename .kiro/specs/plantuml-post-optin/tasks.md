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
  - 3xx/非2xx/タイムアウトを例外化する（誤設定検知・過負荷保護）
  - 上流200でSVGを返し、302/タイムアウトで例外になることを観測する
  - _Requirements: 2.2, 2.3, 4.2, 7.1, 7.2, 9.1, 9.3, 10.2_
  - _Boundary: render-plantuml_
  - _Depends: 1.3_

- [ ] 2.3 apiv3 プロキシルート
  - `POST /_api/v3/plantuml/svg` を追加し、`loginRequired`（ゲスト許可はインスタンス設定に追従）で保護する
  - ハンドラ内で本文サイズを明示検査して超過は413（グローバル body parser 済みのためルート limit では効かない前提）
  - キャッシュ参照→miss時 render→成功時 set し、`image/svg+xml` を返す。400/413/401/502/504 のエラーマッピングを行い、apiv3 index に登録する
  - 上流モックで200、超過で413、未認証で拒否、上流302で502、キャッシュヒットで上流未呼出 を観測する
  - _Requirements: 2.1, 5.2, 9.3, 10.1, 10.2_
  - _Boundary: plantuml svg proxy_
  - _Depends: 2.1, 2.2_

- [ ] 3. Core: クライアント側描画
- [ ] 3.1 (P) SVG取得ユーティリティ＋セッションメモ
  - `{source, darkMode}` をプロキシへ POST して Blob を返す。メモ（module-level Map）は `Promise<Blob>` を保持し、同一入力の重複POSTと in-flight を排除する
  - 同一入力の2回目呼び出しで再POSTが発生しないことを観測する
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
  - GETは現行の `<img src>` を維持。POSTは取得Blobから **mount単位の objectURL** を生成して `<img src>` に設定、`onLoad` で完了・`onError` でエラー状態、rendering-status属性を維持、**unmount で自身のURLのみ revoke**（メモ保持のBlobは revoke しない）
  - 各Viewerが独立に描画・失敗すること
  - post描画/失敗時エラー/**再mountで壊れない**/get不変 を観測する
  - _Requirements: 3.1, 4.1, 6.1, 6.2, 8.1_
  - _Boundary: PlantUmlViewer_
  - _Depends: 3.1, 3.2_

- [ ] 4. Integration: エンドツーエンド配線
- [ ] 4.1 経路の結線と検証
  - `PLANTUML_HTTP_METHOD=post` ＋上流モックで、ページ内 plantuml がプロキシ経由で描画されることを確認する
  - 既定(get)が現行と完全に同一挙動であることを確認する
  - _Requirements: 1.2, 2.1, 2.2, 3.1_
  - _Depends: 2.3, 3.3_

- [ ] 5. Validation: テスト
- [ ] 5.1 (P) サーバ単体/統合テスト
  - svg-cache unit、render-plantuml unit（送信先固定・darkModeでテーマ切替・302/タイムアウト例外）、proxy integ（200/413/未認証拒否/上流302で502/キャッシュヒットで上流未呼出）
  - 上記が緑になることを観測する
  - _Requirements: 2.2, 2.3, 4.2, 5.1, 5.2, 7.1, 7.2, 9.3, 10.1, 10.2_
  - _Boundary: svg-cache, render-plantuml, plantuml svg proxy_
  - _Depends: 2.3_

- [ ] 5.2 (P) クライアント単体/コンポーネントテスト
  - plantuml.spec（get/post分岐・sanitizeOption）、PlantUmlViewer.spec（post描画/エラー/**再mount非破壊**/get不変）、fetch-plantuml-svg のメモ重複排除
  - （※ `PageContentRenderer` モック・config key スナップショットの更新はタスク1.2が所有。本タスクは新規テストケース追加に限定）
  - 上記が緑になることを観測する
  - _Requirements: 1.1, 1.2, 3.1, 4.1, 5.1, 6.1, 6.2, 8.1_
  - _Boundary: plantuml.ts remark, PlantUmlViewer, fetch-plantuml-svg_
  - _Depends: 3.3_

- [ ] 5.3 手動E2E＋Changeset
  - 自前 plantuml-server ＋ `PLANTUML_HTTP_METHOD=post` で、GETでは414になる大きい図がリネームなしで描画されること、ライト/ダークでテーマ反映を確認する
  - puppeteer 経由エクスポートでのPOST描画の可否を確認し、限界を文書化する
  - changeset を追加する
  - _Requirements: 2.1, 2.2, 7.1, 7.2, 9.1_
  - _Depends: 4.1_
