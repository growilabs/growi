# Requirements Document

## Introduction

esm-migration 完了後、apps/app の import 記法は複数併存している（相対 `./X` / 相対 `.js` / `~/X` alias / `~/X.js` alias / type-only の不統一）。どの記法を使うかは「その import 元ファイルが NodeNext server ビルドのプログラムに含まれるか」という**局所的に不可視な条件**に依存し、新規コードを書く開発者にとって煩わしい。

本 spec は、apps/app/src の import 記法を**「拡張子なし」規約**（相対 `./X` / `../X` および `~/X` alias から `.js` / `.jsx` を排除）に統一し、Node ネイティブ ESM が要求する `.js` 拡張子は**ソースではなく server ビルドの emit 時にのみ**付与する。これにより記法選択から `.js` と「プログラム所属の推測」を排除する。alias と相対のどちらを使うかは lint で強制せず、**base branch（dev/8.0.x）の自然な convention（近い参照=相対 / 遠い・区分跨ぎ=`~/` alias）へ整合**させる（esm-migration が NodeNext 対応で alias 化した近い参照を相対へ戻すことで、PR 差分を最小化する）。ランタイムの挙動・bundling 戦略は変更しない。

技術的成立は PoC（`/tmp/esm-poc`）で実証済み（拡張子なしソース → Bundler 型チェック → emit 後 `.js` 付与 → Node 起動成功）。

## Boundary Context

- **In scope**:
  - apps/app/src（および server ビルドに含まれる config）の import specifier 記法の統一
  - server 本番ビルドの emit 時 `.js` 付与の仕組み
  - 既存記法から新規約への一括移行（codemod）
  - 新規約の自動強制（lint ルール）
  - 失う保証の回収（emit 後成果物の Node 解決可能性検証）
- **Out of scope**:
  - server ランタイムの bundling（モジュール結合）や実行モデルの変更
  - client ビルド（Turbopack）/ dev runner / vitest / tsgo lint の解決ロジック変更（いずれも拡張子なしを既に解決でき、変更不要であることの確認のみ行う）
  - dual-pipeline（NodeNext server + Turbopack client）アーキテクチャそのものの再設計
  - `packages/*`（本 spec は apps/app に限定）
  - 機能・認可・パフォーマンスのランタイム挙動の変更
- **Adjacent expectations**:
  - esm-migration が確立したビルド/起動/CI 基盤に依拠する
  - 既存の検証ゲート（`build:server` / `build:client` / `server:ci` 起動 smoke / 認可マトリクス・perf baseline）が引き続き green であることを前提とする

## Requirements

### Requirement 1: 単一 import 規約

**Objective:** apps/app に新規コードを書く開発者として、import の記法を 1 つに統一したい。どの記法を使うかを都度判断する煩わしさを無くすため。

#### Acceptance Criteria
1. The import-convention は、相対（`./X` / `../X`）および `~/` alias specifier に `.js` / `.jsx` 拡張子を**含めない**ことを唯一の必須ルールとするものとする。
2. The import-convention は、ある参照を相対と `~/` alias のどちらで表すかを lint で強制せず、base branch（dev/8.0.x）の自然な convention（近い参照=相対 / 遠い・区分跨ぎ=`~/` alias）に整合させるものとする（拡張子なしなら両形式とも全パイプラインで等価に解決される）。
3. The import-convention は、value import と type-only import で記法を区別しないものとする。
4. While 新規約が適用された状態において, the apps/app/src のソースは、相対および `~/` alias specifier に `.js` / `.jsx` 拡張子を**含まない**ものとする（外部パッケージ・`.json`・`.cjs`・`.scss` 等の非 TS アセットを除く）。
5. The import-convention は、ある specifier が `.js` 付き alias か拡張子なし相対かを**import 元のプログラム所属に依存して決めることを要求しない**ものとする。

### Requirement 2: server 本番ビルドが拡張子なしソースから実行可能成果物を生成

**Objective:** リリース担当として、拡張子なしソースから Node ネイティブ ESM として起動できる本番成果物を得たい。ランタイムの正当性を保つため。

#### Acceptance Criteria
1. When 拡張子なしソースに対し server 本番ビルドを実行したとき, the server build は型チェックエラーなく完了するものとする。
2. When server 本番ビルドが成果物を出力するとき, the server build は出力中の相対 specifier に Node が解決可能な拡張子（`.js` / `/index.js` / 該当する場合 `.jsx`）を付与するものとする。
3. When `~/` alias を含むソースをビルドするとき, the server build は alias を出力時に相対パスへ変換するものとする（既存挙動の維持）。
4. When 生成された本番成果物を Node ネイティブ ESM として起動したとき, the server は `ERR_MODULE_NOT_FOUND` / `ERR_UNSUPPORTED_DIR_IMPORT` 等のモジュール解決エラーなく起動するものとする。
5. The server build は、ランタイムにモジュール解決フック（loader hook）を本番で新たに必要としないものとする（emit 時解決を維持）。

### Requirement 3: 他パイプラインの解決継続性

**Objective:** 開発者として、規約変更後も client ビルド・dev・テスト・型チェックが従来どおり動作してほしい。開発体験を損なわないため。

#### Acceptance Criteria
1. When 拡張子なしソースを client ビルド（Turbopack）でビルドするとき, the client build はモジュール解決エラーなく完了するものとする。
2. While dev サーバ起動時, the dev runner は拡張子なしソースを解決し起動するものとする。
3. When 型チェック（lint:typecheck）を実行するとき, the typecheck は拡張子なしソースに対しエラーなく完了するものとする。
4. When テストスイートを実行するとき, the test runner は拡張子なしソースを解決しテストを実行するものとする。

### Requirement 4: 既存記法から新規約への一括移行の正確性

**Objective:** 保守者として、既存約 740 ファイルの import を新規約へ機械的かつ安全に移行したい。手作業の漏れや退行を避けるため。

#### Acceptance Criteria
1. When 移行ツールを実行するとき, the migration tool は対象ファイルの相対/`~/` value specifier から `.js` / `.jsx` 拡張子を除去するものとする。
2. When 移行を実行するとき, the migration は esm-migration が NodeNext 対応で `~/...js` alias へ書き換えた近い参照を、base branch の相対形へ戻すものとする（`.js` / `.jsx` 拡張子の除去・`/index` barrel 正規化と併せ、PR 差分を最小化するため）。
3. The migration tool は、各 import の**解決先ファイルを変えない**（振る舞い保存）ものとする。
4. The migration tool は、外部パッケージ・`.json`（import 属性付き）・`.cjs` 設定・`.scss` 等の非 TS specifier を変更しないものとする。
5. If specifier が解決不能なとき, the migration tool は当該箇所を変更せず警告として報告するものとする。

### Requirement 5: 新規約の自動強制

**Objective:** 開発者として、規約違反を書いても自動で検出・修正されてほしい。規約を暗記せずに済むため。

#### Acceptance Criteria
1. When 相対または `~/` alias specifier に `.js` / `.jsx` 拡張子を含むコードを lint にかけたとき, the lint はそれを違反として検出するものとする。
2. While CI 実行時, the CI は規約違反を検出した場合にビルド/チェックを失敗させるものとする。
3. Where 自動修正が可能な場合, the lint は違反 specifier を新規約形へ修正できるものとする。

### Requirement 6: 失う保証の回収（コンパイル時 → 成果物検証）

**Objective:** 保守者として、NodeNext のコンパイル時解決保証を緩める代わりに、成果物が Node 解決可能であることを別手段で担保したい。退行を早期検出するため。

#### Acceptance Criteria
1. When server 本番成果物が生成された後, the verification は emit 後成果物に対し Node ESM 解決可能性チェック（例: NodeNext `--noEmit` 相当）を実行するものとする。
2. If emit 後成果物に Node 解決不能な import が存在するとき, the verification は CI を失敗させるものとする。
3. The verification は、既存の `server:ci` 起動 smoke を引き続き合格条件に含めるものとする。

### Requirement 7: ランタイム挙動の無回帰

**Objective:** 保守者として、import 規約の変更がランタイム挙動を一切変えないことを保証したい。本変更がリファクタリングに留まることを担保するため。

#### Acceptance Criteria
1. When 本変更後に既存テストスイートを実行したとき, the test suite は新規失敗なく合格するものとする。
2. When 本番成果物を起動し機能 smoke を実行したとき, the server は esm-migration の Phase 6 ゲートと同等の結果（healthcheck 200 / 認可ゲート / SSR / WebSocket）を示すものとする。
3. The 本変更は、認可マトリクス・middleware チェーン・起動/first-request perf の既存 baseline に対し有意な差分を生じさせないものとする。
