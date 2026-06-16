# Implementation Plan

> 順序は design review で確定: **(1) ビルドモード変更を単独ゲート**（無関係な型エラーの噴出を切り分け）→ ツール群を TDD で整備 → 一括適用 → 統合 → 無回帰検証。

## Phase 1: 基盤（ビルドモード変更と検証ツール）

- [x] 1. server ビルドの解決モードをゆるい解決へ移行し型シムを棚卸し
  - server 本番ビルドの型チェック解決を、拡張子なしソースを許容するモード（Bundler/Preserve 相当）へ変更する
  - NodeNext 専用に置かれた型解決シム（外部パッケージの型を読むための特別設定）の要否を棚卸しし、不要分を整理・競合分を解消する
  - **観測可能な完了条件**: 現行（`.js` 付き）ソースのまま `build:server` 型チェックがエラー 0 で通る（このタスク単独で、本来の目的と無関係な型エラーが出ないことを確認）
  - _Requirements: 2.1_
  - _Boundary: C4 server build 設定_

- [x] 2. 出力時 `.js` 自動付与ツールをテスト駆動で整備 (P)
- [x] 2.1 付与ロジックの fixture テストを先に書く（red）
  - 拡張子なし相対 → `.js`、ディレクトリ → `/index.js`、`.tsx` 由来の `.jsx` ターゲット、既拡張子の冪等（二重付与しない）、`.json`(import 属性付き)/`.cjs` は不変、解決不能は不変＋警告、の各ケースを期待値で固定
  - **観測可能な完了条件**: 実装前にテストが存在し、未実装ゆえ失敗する（red）
  - _Requirements: 2.2, 4.4_
  - _Boundary: C1 add-js-extensions_
- [x] 2.2 付与ツールを実装し postbuild に組み込む（green）
  - 出力物の各 import を実ファイル照合で解決し拡張子を付与。`bin/postbuild-server.ts` の rename 後に呼び出す
  - **観測可能な完了条件**: 2.1 の全テストが green。拡張子なしソースをビルドした出力の相対 import が `.js`/`/index.js`/`.jsx` 付きになる
  - _Requirements: 2.2_
  - _Boundary: C1 add-js-extensions, postbuild-server_
  - _Depends: 2.1_

- [x] 3. 出力物の全 import 静的網羅解決検証ツールを整備 (P)
  - 出力物（dist）内の全 `from`/動的 import の相対 specifier が、実在するファイル（`.js`/`/index.js`/`.jsx`/`.json`/`.cjs`）を指すかを網羅検査し、1 件でも解決不能なら失敗する
  - dead な `.jsx` emit を「指す先が在るか」だけで判定し誤検出しない / boot 到達に依存せず lazy import も拾うことを、fixture で確認
  - **観測可能な完了条件**: 正常な出力物に対し「解決不能 0」を返し、わざと壊した import を 1 件混ぜると非ゼロ終了で当該箇所を報告する
  - _Requirements: 6.1, 6.2_
  - _Boundary: C5 verify-dist-resolution_

## Phase 2: 中核（規約の一括適用と強制）

- [x] 4. 一括移行 codemod をテスト駆動で整備 (P)
- [x] 4.1 変換ロジックの fixture テストを先に書き master で較正（red）
  - same-dir/descendant/ancestor/sibling-dir → 拡張子なし相対、cross-module → 拡張子なし `~/` alias 維持、value/type 双方の `.js`/`.jsx` 除去、外部/`.json`/`.cjs`/`.scss` は不変、解決先不変。期待値は移行前 master の import 形と一致させる
  - **観測可能な完了条件**: 実装前にテストが存在し失敗する（red）。較正サンプル（AuthorInfo・Comment・NotAvailableForGuest・BookmarkButtons 等）の期待値が master と一致
  - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - _Boundary: C2 normalize-import-convention codemod_
- [x] 4.2 codemod を実装する（green）
  - 既存 `ssr-relative-to-alias.cjs` の AST/helper を再利用し、value/type specifier を新規約へ変換。解決不能は不変＋警告
  - **観測可能な完了条件**: 4.1 の全テストが green
  - _Requirements: 4.1, 4.2, 4.3, 4.5_
  - _Boundary: C2 normalize-import-convention codemod_
  - _Depends: 4.1_

- [x] 5. codemod を apps/app/src 全体へ適用する
  - codemod を全 src（約 740 ファイル）へ適用し、ソースを単一の拡張子なし規約へ移行する
  - 適用結果を較正サンプルで master 形と突き合わせ、`tsgo --noEmit`（ゆるいモード型チェック）がエラー 0 で通ることを確認
  - **観測可能な完了条件**: 相対/`~/` specifier に `.js`/`.jsx` が残存しない（次タスクの lint で 0 件）。`tsgo --noEmit` 0
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - _Boundary: apps/app/src (codemod 一括)_
  - _Depends: 1, 4.2_

- [x] 6. 規約強制 lint を整備し CI 集約へ追加する (P)
  - 相対/`~/` specifier の `.js`/`.jsx` 終端を違反検出する lint を追加し、`lint` 集約スクリプトに含める。任意で単一ファイル自動修正を提供
  - **観測可能な完了条件**: 違反を含む行を検出して非ゼロ終了し、新規約のコードは通過する。fixture テストが green
  - _Requirements: 5.1, 5.2, 5.3_
  - _Boundary: C3 import-extension-guard, package.json_

## Phase 3: 統合（ビルド/CI 配線）

- [x] 7. 出力時付与と出力物検証を本番ビルド/CI に組み込む
  - 本番ビルドで「付与ツール（C1）→ 検証ツール（C5）」が順に走るよう CI（`reusable-app-prod.yml` の build-prod）へ配線し、規約 lint も CI で失敗条件に含める
  - **観測可能な完了条件**: 拡張子なしソースから本番成果物が生成され、`node` で起動して `ERR_MODULE_NOT_FOUND`/`ERR_UNSUPPORTED_DIR_IMPORT` が出ない。CI が C5・lint 失敗時にジョブを落とす
  - _Requirements: 2.2, 2.4, 2.5, 5.2, 6.1, 6.2, 6.3_
  - _Depends: 2.2, 3, 5, 6_

## Phase 4: 検証

- [x] 8. 全ビルド/開発/テストパイプラインの解決を確認する
  - 拡張子なしソースで client ビルド（Turbopack）成功 / 型チェック 0 / テスト緑 / dev サーバ起動 を確認し、いずれも無改修で解決できることを実証
  - **観測可能な完了条件**: `build:client`・`tsgo --noEmit`・`vitest`・dev 起動がすべて成功
  - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - _Depends: 5_

- [x] 9. ランタイム無回帰ゲートを実施する
  - 本番成果物を起動し、esm-migration Phase 6 と同等の機能 smoke（healthcheck 200 / 認可ゲート / SSR / WebSocket）と、認可マトリクス・middleware チェーン・起動/first-request perf の baseline 差分なしを確認。既存テストスイートに新規失敗が無いことを確認
  - **観測可能な完了条件**: 機能 smoke が Phase 6 と同等。認可/perf baseline 差分なし。テストスイート新規失敗 0
  - _Requirements: 7.1, 7.2, 7.3_
  - _Depends: 7, 8_

- [x] 10. 単一規約をドキュメント/steering に明文化する
  - 採用した単一規約（local=拡張子なし相対 / cross-module=拡張子なし `~/`、`.js` はソースに書かない）と「出力時 `.js` 付与 + 出力物網羅検証で安全を担保する」仕組みを `coding-style.md` / steering（tech.md）へ記載。esm-migration 側の関連記述（`.js` 必須前提）も整合更新
  - **観測可能な完了条件**: コーディング規約と steering に新規約と検証方式が明記され、移行前の `.js` 前提記述が解消されている
  - _Requirements: 1.1, 1.2, 1.3_
  - _Depends: 5_
