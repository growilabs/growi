# Implementation Plan

- [x] 1. Foundation: `formatTruncatedPagePath` の共有配置への移設
  - `apps/app/src/features/search/client/utils/format-truncated-page-path.ts` と `.spec.ts` を `apps/app/src/client/util/` へ移動する(内容は変更しない)
  - `apps/app/src/features/search/client/components/SearchResultPagePath.tsx` の import 元を新しいパスに更新する
  - 移設後、検索モーダルの既存テスト(`format-truncated-page-path.spec.ts`、`SearchResultPagePath.spec.tsx`)を実行し、そのまま green であることを確認する(挙動無変更の証跡)
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 7.1, 7.2_
  - _Boundary: formatTruncatedPagePath_

- [x] 2. Core: 中間省略判定と `LinkedPagePath` の橋渡し純粋関数を実装する
  - `apps/app/src/client/util/build-ancestor-path-nodes.ts` に、`formatTruncatedPagePath` の判定結果からページ名パーツを除いた「祖先のみ」の表示計画を、プレーン/ハイライト双方の `LinkedPagePath` チェーンと結合して返す純粋関数を実装する
  - ルート/0 祖先(ホームアイコンのみ)、3 単位以下(全祖先)、4 単位以上(先頭＋省略記号＋直近祖先のみ)、ハイライト付き(対応する祖先にのみ `highlightedHtml` が設定される)の各ケースを実装する
  - プレーン/ハイライトチェーンの総ノード数が一致しない場合、祖先パス全体をプレーンテキストにフォールバックする防御的分岐を実装する(ノード単位の部分フォールバックにはしない)
  - `build-ancestor-path-nodes.spec.ts` を新規作成し、上記すべてのケースを検証するユニットテストが green であることを確認する
  - _Requirements: 2.1, 2.2, 2.3, 5.1, 5.2, 6.1, 6.2_
  - _Boundary: buildAncestorPathNodes_

- [x] 3. Core: 検索結果一覧専用の祖先パス表示コンポーネントを実装する
  - `apps/app/src/features/search/client/components/SearchResultAncestorPath.tsx` を実装し、`buildAncestorPathNodes` の結果を、生存セグメントは `Link`(ハイライトがあれば markup 込み)、省略記号は非リンクのプレーンテキストとして描画する
  - コンテナに `title` 属性としてページ名を含む完全パスを常時付与する
  - 祖先 0 件の場合は現行の `PagePathHierarchicalLink` root 分岐と同じホーム/ゴミ箱アイコン表現を描画する
  - `SearchResultAncestorPath.module.scss` に、1 行固定・`flex-shrink` によるセグメント単位のオーバーフロー安全網(検索結果一覧の行幅制約に合わせた優先度)を実装する
  - `SearchResultAncestorPath.spec.tsx` を新規作成し、`title` の内容、省略記号が非リンクであること、生存セグメントの `href`、ハイライト markup の反映、祖先 0 件時のアイコン描画のテストが green であることを確認する
  - _Requirements: 1.1, 1.2, 1.3, 3.1, 3.2, 3.3, 4.1, 5.1, 5.2, 6.1, 6.2_
  - _Boundary: SearchResultAncestorPath_

- [ ] 4. Integration: `PageListItemL` のオプトイン配線と `/_search` への適用
- [x] 4.1 `PageListItemL` にオプトイン prop を追加し、祖先パス描画と `evalDatePath` を切り替える
  - 新規 prop `isPathTruncationEnabled?: boolean`(既定 `false`)を追加する
  - `true` のとき、祖先パス描画を `SearchResultAncestorPath` に切り替え、ページ名行が使う `DevidedPagePath` 呼び出しの `evalDatePath` を `true` にする
  - `false`(既定)のときは現行どおり `PagePathHierarchicalLink` ＋ `evalDatePath=false` を使用し、挙動を一切変えない
  - `PageListItemL.spec.tsx` を新規作成し、prop 未指定/`false` 時に現行の描画・チェックボックス・クリック遷移などが変わらないこと、`true` 時に新コンポーネントが描画されページ名行の日付束ねが有効になることのテストが green であることを確認する
  - _Requirements: 7.1, 7.2, 8.1, 9.1, 9.2_
  - _Boundary: PageListItemL_

- [x] 4.2 `SearchResultList` から新オプトイン prop を有効化する
  - `apps/app/src/features/search/client/components/SearchPage/SearchResultList.tsx` の `PageListItemL` 呼び出しに `isPathTruncationEnabled` を渡す
  - 開発サーバーで `/_search` を開き、検索結果一覧の祖先パスが新コンポーネントで描画されることを確認する
  - _Requirements: 8.1_
  - _Boundary: SearchResultList_

- [x] 5. Validation: 実データでの動作確認と回帰確認
  - devcontainer の dev server で `/_search` を開き、階層の深い実データ(または深い階層のテストページ)を検索して、祖先パスが 1 行に収まりホバーでフルパスが確認できること、生存セグメントのクリック遷移、検索キーワードのハイライトが機能することを目視確認する
  - `PageList.tsx`(子ページ一覧)・`IdenticalPathPage.tsx`(パス重複選択画面)を実際に開き、表示が変更前と同じ(全セグメント表示のまま)であることを確認する
  - `turbo run lint --filter @growi/app`・`turbo run test --filter @growi/app`・`turbo run build --filter @growi/app` を実行し、すべて green であることを確認する
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 4.1, 5.1, 5.2, 6.1, 6.2, 7.1, 7.2, 8.1, 9.1, 9.2_

## Implementation Notes

- Task 4.1: `LinkedPagePath`'s constructor always calls `new DevidedPagePath(path)` with no `evalDatePath` argument (always `false`), so re-wrapping an already-`evalDatePath`-bundled string (e.g. a date-bundled page name like `"2024/01/15"`) in a fresh `LinkedPagePath` silently re-splits it and destroys the bundling. When `evalDatePath` needs to reach a piece of UI, read the value directly off the `DevidedPagePath` instance (e.g. `.latter`) rather than passing it through a new `LinkedPagePath`.
- Task 5: this devcontainer's seeded DB has guest access disabled (anonymous `/_search` returns `302` to `/login`), so early attempts assumed authenticated verification was also blocked by a sandbox session-cookie restriction — **a follow-up investigation showed this was a misdiagnosis**: `curl` with a cookie jar can log in (`POST /_api/v3/login`, 200) and fetch `/_search?q=...` authenticated (200) with no issue. The real, confirmed blocker is architectural: `/_search` fetches its result rows client-side via SWR/Elasticsearch after hydration, so `curl`/any HTTP-only tool only ever sees the SSR shell (`__NEXT_DATA__`), never the rendered ancestor-path markup, regardless of auth. Seeing it requires a JS-executing browser (e.g. Playwright), and no browser binary or browser-automation tool was available in this sandbox. All other requirements are covered by the 50 passing unit/component tests plus `turbo run lint/test/build` (lint's only failure is a pre-existing, gitignored, unrelated vendored-plugin config issue under `apps/app/tmp/`). **A human with a real browser must still open `/_search` with a deep/long real path and confirm**: single-line rendering with no overflow, hover tooltip shows the full path, surviving segments navigate correctly, and search-keyword highlighting still works.
