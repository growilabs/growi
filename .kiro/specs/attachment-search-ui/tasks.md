# Implementation Plan

> 本 spec (`attachment-search-ui`) は上流 `attachment-search-indexing` が提供する DTO (`IPageWithSearchMeta.attachmentHits[]`, `IAttachmentHit`, `ISnippetSegment`, `ExtractionOutcome`)、apiv3 エンドポイント、Config キー、Socket.io イベント、SSR prop `searchConfig.isAttachmentFullTextSearchEnabled` を**消費するだけ**の client 側 UI 統合である。サーバ実装は一切行わない。
>
> Boundary 原則: 各タスクは `_Boundary:_` で示された単一責務境界の内側で完結する。既存コンポーネント (`SearchPage.tsx` / `SearchResultList.tsx` / `SearchResultContent.tsx` / `PageAttachmentList.tsx` / `ElasticsearchManagement.tsx`) への optional prop 注入と conditional render は明示的な integration タスクに分離する。

## 1. Foundation: 機能ゲートと共有 UI 型の土台整備

- [ ] 1. 機能ゲートと共有 UI 型の土台整備
- [ ] 1.1 UI 消費用 view 型と snippet 描画契約を定義する
  - 共有 props base 型 `AttachmentHitViewProps` (添付 ID / ファイル名 / MIME / ファイルサイズ / pageNumber / label / snippet / score / viewerHref) を feature module の interfaces 配下に宣言する
  - `SnippetSegment` 型 (text / highlighted の 2 フィールド) を同モジュールに宣言し、上流 `ISnippetSegment` からの射影であることをコメントで明記する
  - 射影ユーティリティ (上流 `IAttachmentHit` → `AttachmentHitViewProps` および既存添付ビューアルーティング規約に基づく `viewerHref` 合成) を pure function として抽出する
  - Observable: `apps/app/src/features/search-attachments/interfaces/` 配下に view 型ファイルと射影関数ファイルが存在し、型が `readonly` で宣言され、unit テストで射影関数が境界値 (`pageNumber=null` / `label=null` / 空 snippet) を正しく扱うことを示す
  - _Requirements: 1.2, 2.2_
  - _Boundary: features/search-attachments/interfaces_

- [ ] 1.2 (P) SSR hydrated 機能ゲート atom を states/server-configurations 配下に追加する
  - `isAttachmentFullTextSearchEnabledAtom` を `~/states/server-configurations/is-attachment-full-text-search-enabled-atom.ts` に default `false` で宣言する
  - feature module の stores 配下には**置かない** (basic-layout → feature の逆依存回避、既存 `isSearchServiceConfiguredAtom` と同列扱い)
  - atom 定義と既存 server configurations の index barrel への re-export を整合させる
  - Observable: atom import テストで default 値が `false` であること、`useAtomValue` 経由で同期的に boolean を取得できることを示す
  - _Requirements: 3.5, 4.4, 6.3, 7.2_
  - _Boundary: states/server-configurations_

- [ ] 1.3 基本レイアウトの hydrate 層に `isAttachmentFullTextSearchEnabled` 注入を追加する
  - `apps/app/src/pages/basic-layout-page/hydrate.ts` に `searchConfig?.isAttachmentFullTextSearchEnabled ?? false` の正規化ロジックを追加し atom に注入する (Open Question #11 の missing 正規化に対応)
  - error page / maintenance page / storybook fixtures 等で SSR prop が欠落するケースでも `undefined` ではなく `false` で初期化されることを保証する
  - 既存 `isSearchServiceConfiguredAtom` 等と同じ hydrate 経路を踏襲する
  - Observable: jest/vitest で `searchConfig` に当該フィールドがないケースでも atom が `false` に hydrate されることを検証する
  - _Requirements: 3.5, 4.4, 6.3, 7.2_
  - _Depends: 1.2_
  - _Boundary: pages/basic-layout-page/hydrate_

- [ ] 1.4 (P) 機能ゲート hook を実装する
  - `use-search-attachments-enabled` hook が `isAttachmentFullTextSearchEnabledAtom` を `useAtomValue` で同期的に読み boolean を返すだけの薄いラッパとして実装する
  - admin config API への依存を持たず、非 admin ユーザ環境でも 403 を発生させない構造にする
  - Observable: hook のテストで atom=false のとき false、atom=true のとき true を同期的に返すこと、loading 状態を持たないことを確認する
  - _Requirements: 3.5, 4.4_
  - _Depends: 1.2_
  - _Boundary: features/search-attachments/client/services_

- [ ] 1.5 (P) ファセット state 用の feature-local Jotai atom を追加する
  - `activeFacetAtom` (型 `'all' | 'pages' | 'attachments'`、default `'all'`) を feature module の stores 配下に宣言する
  - これは純粋な UI state であり server configuration ではないため、server-configurations 配下には**置かない**
  - Observable: atom の初期値が `'all'` であること、`useAtom` で値変更がフィーチャー横断で共有されることを unit test で示す
  - _Requirements: 3.2_
  - _Boundary: features/search-attachments/client/stores_

- [ ] 1.6 (P) snippet 描画の XSS-safe 共通コンポーネントを抽出する
  - `SnippetSegment[]` を受け取り React text node + `<mark>` 要素として描画する小さな presentational component (または pure function) を定義する
  - `dangerouslySetInnerHTML` を使用しないことを実装レベルで保証する
  - 上流の highlight escape 契約が変化した場合のテストフックを担う
  - Observable: unit test で `<script>alert(1)</script>` を含む `seg.text` を描画してもレンダリング DOM 内に script / img 要素が生成されないこと、`highlighted=true` な segment のみ `<mark>` 配下にレンダリングされることを検証する
  - _Requirements: 1.2, 2.2_
  - _Boundary: features/search-attachments/client/components/SearchPage_

- [ ] 1.7 (P) i18n 文言キー (`attachment_full_text_search.*` namespace) を ja / en 両言語で追加する
  - ファセットタブラベル (全体 / ページ / 添付ファイル)、サブエントリ / カードの見出し、再抽出 toast (success / serviceUnreachable / timeout / serviceBusy / unsupported / tooLarge / failed の 7 種)、admin 設定ガイダンス、token 入力プレースホルダ ("設定済み (値は表示されません)")、token 削除ボタン、allowlist エラー (`invalid_extractor_uri`)、失敗ログテーブル列ヘッダ、"追加読み込み" ボタン (slot B 誘導) を網羅する
  - 既存 i18n ディレクトリの namespace 分割方針に従う
  - Observable: ja / en の翻訳 JSON に全キーが存在し、`i18next.t()` がすべてのキーで missing を返さないことを snapshot test で確認する
  - _Requirements: 3.1, 4.2, 4.3, 5.2, 5.3, 7.1_
  - _Boundary: i18n resources_

## 2. 検索結果左ペイン (Page 集約 + 添付サブエントリ)

- [ ] 2. 検索結果左ペイン (Page 集約 + 添付サブエントリ)
- [ ] 2.1 `AttachmentSubEntry` コンポーネントを実装する
  - Page カード内に「この添付にもマッチ」サブエントリを表示する。添付ファイル名 / ファイル形式アイコン (MIME ベース) / `label` / マッチスニペットを含める
  - 複数ヒット時は `[...hits].sort((a, b) => b.score - a.score)` で score 降順に並べ替えた**先頭 1 件のみ展開**、残りはアコーディオン折りたたみにする (配列順非依存の明示契約)
  - `hits.length === 0` のとき `null` を返す防御的分岐を入れる
  - snippet は Task 1.6 の XSS-safe コンポーネントで描画する
  - クリック時に `onHitClick(attachmentId)` を呼び出す
  - 折りたたみ切替は `aria-expanded` / `aria-controls` を付与する
  - Observable: component test で単独ヒット / 複数ヒット (2 件目以降が collapsed) / ヒットなし (null 返却) / score 降順確認の 4 ケース、および XSS payload 描画が text node 化されることを確認する
  - _Requirements: 1.2, 1.3, 1.4, 1.5_
  - _Boundary: features/search-attachments/client/components/SearchPage/AttachmentSubEntry_

- [ ] 2.2 (P) ファセットタブコンポーネント `SearchResultFacetTabs` を実装する
  - 「全体 / ページ / 添付ファイル」3 択タブを `role="tablist"` / `aria-selected` 付きで表示する
  - `use-search-attachments-enabled` が false を返すとき `null` を返す (Req 3.5)
  - タブクリック時に `activeFacetAtom` を即時更新する
  - キーボードナビゲーション (`ArrowLeft` / `ArrowRight`) に対応する
  - Observable: component test で enabled=false 時に null、enabled=true 時にタブ描画 + クリックで atom 更新 + キーボード操作でアクティブ切替が反映されることを検証する
  - _Requirements: 3.1, 3.2, 3.5_
  - _Depends: 1.4, 1.5_
  - _Boundary: features/search-attachments/client/components/SearchPage/SearchResultFacetTabs_

- [ ] 2.3 既存 `SearchResultList.tsx` に添付サブエントリを統合する (integration)
  - Page カードレンダリング関数内で `page.attachmentHits?.length > 0` のとき `AttachmentSubEntry` を差し込む
  - 添付のみヒットのページも Page カードとして含まれるよう既存レンダリング条件を維持・調整する (Req 1.5)
  - 添付サブエントリクリックで既存の選択ページ state を更新し、右ペイン切替経路に値を渡す
  - 機能無効時 (atom=false) は差分ゼロ (既存挙動完全一致) になることを保証する
  - Observable: integration test で検索応答に `attachmentHits` を含む page と含まない page を混在させ、前者のみ SubEntry が render され、クリックで選択 state が更新されることを確認する
  - _Requirements: 1.1, 1.2, 1.3, 1.5_
  - _Depends: 2.1_
  - _Boundary: features/search/client/components/SearchPage/SearchResultList (既存拡張)_

## 3. 検索結果右ペイン (添付ヒットカード)

- [ ] 3. 検索結果右ペイン (添付ヒットカード)
- [ ] 3.1 `AttachmentHitCard` コンポーネントを実装する
  - 右ペインプレビュー最上部にカードを描画し、添付ファイル名 / ファイル形式アイコン / ファイルサイズ / `label` / マッチスニペット / 添付本体を開くリンク (`viewerHref`) を含める
  - `hits.length === 0` のとき `null` を返す二重防御
  - 複数ヒット時は `score desc` で sort し最上位を展開、残りは折りたたみ切替ボタン
  - snippet は Task 1.6 の XSS-safe コンポーネントで描画する
  - `viewerHref` クリックは既存添付ビューア遷移に委譲する (新規タブ判定は既存 Link コンポーネントに任せる)
  - Observable: component test で単独ヒット / 複数ヒット折りたたみ / ヒットなし null / viewerHref クリックで既存ビューア遷移 API が呼ばれること、XSS payload が text node 化されることを確認する
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - _Boundary: features/search-attachments/client/components/SearchPage/AttachmentHitCard_

- [ ] 3.2 既存 `SearchResultContent.tsx` に添付ヒットカードを統合する (integration)
  - 選択ページに `attachmentHits` がある場合のみプレビュー最上部に `AttachmentHitCard` を render する
  - 選択ページに添付ヒットなし / 機能無効時は既存プレビュー描画と完全一致する
  - `IAttachmentHit` → `AttachmentHitViewProps` への射影 (Task 1.1) をこの境界で 1 度だけ行い、子コンポーネントには view 型のみを渡す
  - Observable: integration test で `attachmentHits` 持ちページ選択時にカードが最上部に描画、未持ちページ選択時に非描画、機能 OFF 時にも非描画であることを確認する
  - _Requirements: 2.1, 2.5_
  - _Depends: 3.1, 1.1_
  - _Boundary: features/search/client/components/SearchPage/SearchResultContent (既存拡張)_

## 4. 検索結果ファセット統合と二段階検索 UX

- [ ] 4. 検索結果ファセット統合と二段階検索 UX
- [ ] 4.1 既存 `SearchPage.tsx` にファセットタブと facet クエリ反映を統合する (integration)
  - 検索結果ヘッダ近傍に `SearchResultFacetTabs` を配置する
  - `activeFacet` を既存検索 SWR の query key に反映し、上流 apiv3 `/search` の `facet` パラメータ (`all` / `pages` / `attachments`) に渡す
  - facet 値変更時に SWR が自動 revalidate されることを確認する
  - 機能無効時はタブ非表示かつ既存 query (facet なし) に完全一致する
  - Observable: integration test で facet 変更のたびに fetch URL が `facet=` 付きで更新されること、機能 OFF 時は facet パラメータが付与されないことを確認する
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - _Depends: 2.2_
  - _Boundary: features/search/client/components/SearchPage/SearchPage (既存拡張)_

- [ ] 4.2 `facet=attachments` primary の `primaryResultIncomplete` 対応「追加読み込み」ボタンを実装する
  - 検索応答に `primaryResultIncomplete: true` が含まれる場合、結果リスト末尾に「検索結果が不足しています。追加読み込み」ボタンを描画し、クリックで `nextCursor` を使った次ページ取得を既存 SWR pagination 経路で発火する (auto retry は行わない)
  - `primaryResultIncomplete` が true でない / facet=attachments でないときはボタンを描画しない
  - Observable: integration test で `primaryResultIncomplete=true` のモック応答でボタンが表示され、クリックで cursor 付き次ページ fetch が走ること、false では表示されないことを確認する
  - _Requirements: 3.4_
  - _Depends: 4.1_
  - _Boundary: features/search-attachments/client/components/SearchPage_

- [ ] 4.3 `facet=all` の slot B 優先モード誘導 UX を実装する
  - `facet=all` で 1 ページ目の primary と secondary 交差が少ない (ヒットドロップ有) 状態を検知し、"snippet のみの hit を見落としている可能性があるため添付ファイル ファセットに切り替えますか?" のガイダンス UI を結果ヘッダ近傍に表示する (i18n 文言は Task 1.7 で追加済み)
  - クリックで `activeFacetAtom` を `'attachments'` に更新する
  - 検知ロジックは design に従い primary / secondary の pageId 集合差分を使う pure function として抽出する
  - Observable: unit test で差分ありケースにガイダンスが出、ボタンで facet 切替が走ること、差分なしケースで非表示を確認する
  - _Requirements: 3.4_
  - _Depends: 4.1_
  - _Boundary: features/search-attachments/client/components/SearchPage_

- [ ] 4.4 secondary endpoint (GET /search/attachments) client 統合と progressive enrichment を実装する
  - primary 描画完了後に `GET /_api/v3/search/attachments?q=...&pageIds=...` を SWR で呼び出し、secondary 応答で既存検索結果の `attachmentHits` を進行的に埋め込む
  - primary が facet=pages のときは secondary を呼ばない (上流契約と整合)
  - secondary fetch 失敗時は primary 表示を阻害しない (fallback silent)
  - Observable: integration test で primary paint 完了後に secondary fetch が 1 回走り、応答到着後に該当 page カードの SubEntry / HitCard が追加描画されること、失敗時に primary が維持されることを確認する
  - _Requirements: 1.2, 2.1_
  - _Depends: 4.1_
  - _Boundary: features/search-attachments/client/services_

## 5. 添付ファイル一覧モーダルの再抽出 UI

- [ ] 5. 添付ファイル一覧モーダルの再抽出 UI
- [ ] 5.1 (P) 再抽出 SWR mutation hook を実装する
  - `use-attachment-reextract` hook が `POST /_api/v3/attachments/:id/reextract` を `useSWRMutation` パターンで呼び出し、`{ ok, outcome: ExtractionOutcome }` を返す trigger を提供する
  - 成功時に関連する attachment list SWR キー (`/_api/v3/attachment/list?pageId=...`) を `mutate` する
  - `isMutating` 状態を expose する
  - Observable: hook の unit test で成功系 (outcome.kind=success) で SWR key mutate が呼ばれること、各失敗系 kind (`serviceUnreachable` / `timeout` / `serviceBusy` / `unsupported` / `tooLarge` / `failed`) で outcome が propagate されることを確認する
  - _Requirements: 4.2, 4.3_
  - _Boundary: features/search-attachments/client/services_

- [ ] 5.2 `ReextractButton` コンポーネントを実装する
  - 行アクションとして再抽出ボタンを描画する
  - `use-search-attachments-enabled` が false を返すとき `null` (Req 4.4)
  - クリックで Task 5.1 の hook を trigger し、処理中は button disabled + spinner + `aria-busy` (連打防止)
  - 成功時に success toast (i18n)、失敗時に `outcome.kind` に応じた toast (`serviceUnreachable` / `timeout` / `serviceBusy` / `unsupported` / `tooLarge` / `failed` の 6 分岐 + `failed` は `message` を併記)
  - Observable: component test で 機能 OFF 時に null、クリックで hook trigger、各 outcome kind が対応 i18n キーで toast 発火することを確認する
  - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - _Depends: 1.4, 5.1_
  - _Boundary: features/search-attachments/client/components/PageAttachment/ReextractButton_

- [ ] 5.3 既存 `PageAttachmentList.tsx` に `ReextractButton` を統合する (integration)
  - `@growi/ui` の `Attachment` 行コンポーネントに既存 `onAttachmentDeleteClicked` と同パターンで `ReextractButton` を行アクションとして注入する
  - 機能無効時 (`ReextractButton` が null 返却) で既存モーダル表示は導入前と完全一致する
  - Observable: integration test で機能 ON 時に各行に再抽出ボタンが描画、OFF 時に行アクション構造が既存と完全一致することを snapshot 比較で確認する
  - _Requirements: 4.1, 4.4_
  - _Depends: 5.2_
  - _Boundary: client/components/PageAttachment/PageAttachmentList (既存拡張)_

## 6. 管理画面の設定フォーム (URI + Bearer token + limits)

- [ ] 6. 管理画面の設定フォーム (URI + Bearer token + limits)
- [ ] 6.1 admin config SWR hook `use-attachment-search-config` を実装する
  - キャッシュキー `['search-attachments', 'admin', 'config']` で `GET /_api/v3/admin/attachment-search/config` を SWR fetch する
  - 返却 shape は `{ extractorUri, hasExtractorToken, timeoutMs, maxFileSizeBytes }` ( `extractorToken` 値は GET に含まれず存在フラグのみ)
  - `save(next)` が PUT 成功後に内部で `mutate()` を呼び同キャッシュキーを更新する (既存 `useSWRxAppSettings` + `mutate()` パターン同型)
  - `extractorToken` を送信しない場合はサーバ既設値を維持、`null` を送ると削除される上流契約に合わせる
  - Observable: hook の test で GET 応答 shape が反映されること、save 成功後に同キーの次回読み出しが更新データを返すこと、400 `invalid_extractor_uri` エラーが呼び出し側に propagate されることを確認する
  - _Requirements: 5.1, 5.3_
  - _Boundary: features/search-attachments/client/services_

- [ ] 6.2 `AttachmentSearchSettings` フォームコンポーネントを実装する
  - `extractorUri` / `extractorToken` / `timeoutMs` / `maxFileSizeBytes` の 4 フィールドを描画する。独立した有効/無効トグルは**提供しない**
  - `extractorToken` 入力欄は `<input type="password">` + 可視化トグル (👁) で、既設時プレースホルダに "設定済み (値は表示されません)" を表示。空欄保存時は token を送信しない (既設維持)
  - 明示的な「token を削除」ボタンを別途提供し、クリックで `extractorToken: null` を PUT (soft-disable 手段)
  - form validation: `extractorUri` は空または有効な URI 形式、数値項目は `>= 1`。エラー時に保存ボタン disabled + フィールド近傍にインラインエラー
  - 保存時 `extractorUri` が空→非空に遷移した場合のみ、保存成功後に一括再インデックス誘導のガイダンスを表示する (Req 5.2)
  - 400 `invalid_extractor_uri` エラー時に scheme 違反 / クラウドメタデータ endpoint を指している旨の inline エラー + toast を表示する
  - Observable: component test で valid / invalid URI、token 空欄保存 (既設維持) / token 削除ボタン / URI 空→非空でガイダンス表示 / 400 エラー表示 / 数値下限バリデーションの各ケースを確認する
  - _Requirements: 5.1, 5.2, 5.3_
  - _Depends: 6.1_
  - _Boundary: features/search-attachments/client/components/Admin/AttachmentSearchSettings_

## 7. 管理画面の抽出失敗可視化パネル

- [ ] 7. 管理画面の抽出失敗可視化パネル
- [ ] 7.1 (P) 失敗ログ取得 SWR hook `use-attachment-extraction-failures` を実装する
  - キャッシュキー `['search-attachments', 'admin', 'failures', limit]` で `GET /_api/v3/admin/attachment-search/failures` を SWR fetch する (default limit=20)
  - 返却 shape は `ExtractionFailureView[]` (attachmentId / pageId / fileName / fileFormat / fileSize / reasonCode / occurredAt) と `total`
  - `dedupingInterval` を 30s 程度に設定し同一画面再表示の多重リクエストを抑制する
  - Observable: hook test で loading / success / error 状態を expose し、deduping でキャッシュヒット時に fetch が走らないことを確認する
  - _Requirements: 7.1, 7.3_
  - _Boundary: features/search-attachments/client/services_

- [ ] 7.2 `AttachmentExtractionFailures` パネルコンポーネントを実装する
  - 失敗件数合計 + 直近失敗サンプルを表形式で描画する (attachmentId / fileFormat / fileSize / reasonCode / occurredAt / pageId)
  - **admin 画面内の機能ゲートは `use-attachment-search-config` を参照** (`config.extractorUri` 非空 AND `config.hasExtractorToken` true) し、どちらかが偽なら `null` を返す (Req 7.2、in-page reactivity 確保のため admin 画面内では SSR atom を使わない)
  - API エラー時はセクション内にエラーメッセージを表示し、画面全体を閉塞させない
  - 重量テーブルライブラリを使う場合は `dynamic({ ssr: false })` でコード分割する
  - Observable: component test で loading / success (rows 描画) / error (セクション内エラー表示) / 機能無効 (null) の 4 ケース、および `save()` 後の mutate で表示/非表示が即時切替わることを確認する
  - _Requirements: 7.1, 7.2, 7.3_
  - _Depends: 6.1, 7.1_
  - _Boundary: features/search-attachments/client/components/Admin/AttachmentExtractionFailures_

## 8. 管理画面の一括再インデックス拡張

- [ ] 8. 管理画面の一括再インデックス拡張
- [ ] 8.1 `RebuildWithAttachmentsCheckbox` コンポーネントを実装する
  - `checked` / `onChange` / `disabled` を props に取る controlled checkbox を実装する
  - 機能有効時はデフォルト `checked=true` (親側で初期化)
  - 機能ゲート判定は親側で `use-attachment-search-config` を使って conditional render (本コンポーネント自身は SWR を呼ばない)
  - Observable: component test で `onChange` がクリックで呼ばれること、`disabled=true` でクリック無効、`checked` state が props 反映されることを確認する
  - _Requirements: 6.1, 6.3_
  - _Boundary: features/search-attachments/client/components/Admin/RebuildWithAttachmentsCheckbox_

- [ ] 8.2 既存 `ElasticsearchManagement.tsx` に admin 画面の機能拡張を統合する (integration)
  - `use-attachment-search-config` を本画面で subscribe し、`config.extractorUri` 非空 AND `config.hasExtractorToken` true の両条件で feature-gated 兄弟 UI (`RebuildWithAttachmentsCheckbox` / `AttachmentSearchSettings` / `AttachmentExtractionFailures`) の conditional render を決定する (in-page reactivity: save → mutate で即時切替)
  - `RebuildWithAttachmentsCheckbox` を rebuild ボタン近傍に配置し、既定で `checked=true` に初期化する
  - Rebuild ボタンクリック時の `PUT /_api/v3/search/indices` payload に `includeAttachments: <checked>` を注入する
  - `AttachmentSearchSettings` / `AttachmentExtractionFailures` セクションを同画面内に配置する
  - `AddAttachmentProgress` / `FinishAddAttachment` Socket.io listener を追加し、既存 `AddPageProgress` と同じ進捗 UI に添付件数を合流表示する (Req 6.2)
  - 機能無効時は導入前と既存画面表示・挙動が完全一致する (R14.1)
  - Observable: integration test で config ON/OFF 両方でレンダリング差分を確認、保存直後の `mutate()` で同画面内の兄弟 UI が即時表示/非表示に切り替わること、PUT payload に `includeAttachments` が含まれること、Socket.io モックで進捗イベントが UI に反映されることを確認する
  - _Requirements: 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 7.1, 7.2_
  - _Depends: 6.2, 7.2, 8.1_
  - _Boundary: client/components/Admin/ElasticsearchManagement (既存拡張)_

## 9. Validation: E2E / 統合シナリオ / アクセシビリティ / SSR 到達性

- [ ] 9. Validation: E2E / 統合シナリオ / アクセシビリティ / SSR 到達性
- [ ] 9.1 (P) 検索結果 E2E: 左ペイン集約 / 右ペインカード / ファセット切替
  - 検索クエリ → 添付ヒット持ちページの左ペイン SubEntry 表示 → クリックで右ペイン HitCard 切替
  - ファセット「添付ファイル」選択 → 本文ヒットのみのページが消え、添付ヒットのみ残ることを確認する
  - `primaryResultIncomplete=true` 応答で「追加読み込み」ボタン動作、`facet=all` ヒットドロップで slot B 誘導 UX 表示を確認する
  - 添付のみヒットページも Page カードとして表示されることを確認する (Req 1.5)
  - Observable: Playwright / integration テストで上記シナリオが UI 操作ベースで緑になる
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5_
  - _Depends: 2.3, 3.2, 4.1, 4.2, 4.3, 4.4_
  - _Boundary: E2E SearchPage_

- [ ] 9.2 (P) 添付モーダル E2E: 再抽出 success / 各 failure 分岐
  - 添付モーダルで再抽出ボタン → 成功時に success toast + 一覧 mutate
  - 各 outcome kind (`serviceUnreachable` / `timeout` / `serviceBusy` / `unsupported` / `tooLarge` / `failed`) のモック応答に対し対応 toast 文言が表示される
  - 機能 OFF モックでボタンが描画されないことを確認する
  - Observable: 上記すべてのブランチで toast の i18n キーが検出される
  - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - _Depends: 5.3_
  - _Boundary: E2E PageAttachmentList_

- [ ] 9.3 (P) 管理画面 E2E: 設定保存 / in-page reactivity / allowlist エラー / token ライフサイクル / rebuild with attachments
  - `extractorUri` 空→非空 かつ `extractorToken` 設定して保存 → ガイダンス表示 → **同画面内で即座に** rebuild チェックボックス / 失敗ログパネルが表示される (`use-attachment-search-config` の `mutate()` reactivity)
  - `extractorUri` を空文字にクリア or `extractorToken` 削除ボタン → 同画面内で即座に feature-gated 兄弟 UI が非表示
  - `extractorUri` に `http://169.254.169.254/...` を入力 → 400 `invalid_extractor_uri` で inline エラー + toast
  - `http://localhost/...` / `http://markitdown.default.svc.cluster.local/...` は正常受理
  - `extractorToken` 既設時に空欄のまま他フィールド保存 → token 維持
  - Rebuild クリック → PUT payload に `includeAttachments: true`、Socket.io `AddAttachmentProgress` / `FinishAddAttachment` で進捗表示
  - Observable: 上記すべてのシナリオで UI 挙動が期待通り緑になる
  - _Requirements: 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 7.1, 7.2, 7.3_
  - _Depends: 8.2_
  - _Boundary: E2E ElasticsearchManagement_

- [ ] 9.4 (P) アクセシビリティ検証
  - ファセットタブの `role="tablist"` / `aria-selected` / キーボード (`ArrowLeft`/`ArrowRight`) 動作
  - 添付サブエントリ / ヒットカードの折りたたみで `aria-expanded` / `aria-controls`
  - 再抽出ボタンの loading 中 `aria-busy`
  - toast の `role="status"` または `aria-live="polite"`
  - Observable: axe / testing-library で上記属性が検証され、violation が 0 件
  - _Requirements: 3.1, 4.2_
  - _Depends: 2.2, 2.1, 3.1, 5.2_
  - _Boundary: accessibility_

- [ ] 9.5 SSR 到達性 / Turbopack ビルド検証
  - `turbo run build --filter @growi/app` を実行し、新規コンポーネントの import チェーンに server 専用依存 (`packages/markitdown-client` / mongoose / pino / ES client 等) が混入しないことを確認する
  - 重量 UI (失敗ログテーブル等) は `dynamic({ ssr: false })` で分離されていることを確認する
  - 機能無効時に既存 SearchPage / PageAttachmentList / ElasticsearchManagement の snapshot が導入前と完全一致することを確認する (R14.1 に相当する非互換ゼロ要件)
  - Observable: build が success、bundle analyzer で server-only チェーンが client バンドルに含まれないこと、機能 OFF snapshot が既存と diff ゼロ
  - _Requirements: 3.5, 4.4, 6.3, 7.2_
  - _Depends: 2.3, 3.2, 4.1, 5.3, 8.2_
  - _Boundary: build / SSR 到達性_

- [ ] 9.6 XSS 防御回帰テスト (snippet render)
  - `SnippetSegment[]` に `<script>alert(1)</script>` / `<img src=x onerror=alert(1)>` / `javascript:` を含むテキストを持つ payload を用意し、`AttachmentSubEntry` / `AttachmentHitCard` 両方で text node 化されること、`<script>` / `<img>` 要素が DOM に生成されないこと、`highlighted=true` segment のみ `<mark>` 配下にレンダリングされることを確認する
  - `dangerouslySetInnerHTML` が feature module 配下の grep で 0 件であることを lint ルールとして保証する (既存 lint 設定に追加または spec test で検出)
  - Observable: unit test が上記 payload すべてで assertion を通過、grep check が CI で 0 件を確認
  - _Requirements: 1.2, 2.2_
  - _Depends: 1.6, 2.1, 3.1_
  - _Boundary: features/search-attachments/client (XSS 防御境界)_
