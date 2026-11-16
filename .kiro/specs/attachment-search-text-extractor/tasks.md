# Implementation Plan

> 作業ディレクトリは `apps/attachment-text-extractor/` (`@growi/attachment-text-extractor`)。設計の判断は design.md、計測と決定の根拠は research.md にある。各タスクの細かな計測と経緯は git の履歴にある。

- [x] 1. 土台: package と CI のジョブ
- [x] 1.1 抽出サービスの Node の package を作り、pnpm workspace に入れる
  - `apps/pdf-converter` に倣って、package の設定、TypeScript の設定、vitest の設定、package ごとの `turbo.json` を置く。Node 24 だけを対象にする
  - ルートの `pnpm-workspace.yaml`、`turbo.json`、`vitest.workspace.mts` を変えずに、lint とテストの対象に入る
  - _Requirements: 5.1, 5.6, 5.7_
- [x] 1.2 専用の CI workflow `.github/workflows/ci-attachment-text-extractor.yml` を置く (lint・型の検査・vitest)
  - ほかの workflow がこの package のテストを二重に流さないことを確かめる。`if:` の中にコメントを書かない
  - _Requirements: 7.3_

- [x] 2. ベンチマークとテスト用のファイルの生成器
- [x] 2.1 テスト用のファイル (普通の文書と、細工したファイル) を Node で作る生成器を実装する
  - 暗号化した Office と PDF、XLS、細工した ZIP / XML を含む。旧形式の DOC / PPT だけは Apache POI 由来のファイルを commit し、出典を記録する
  - _Requirements: 1.2, 1.3, 1.8, 1.10, 1.12, 2.6_
- [x] 2.2 検索の品質のベンチマーク (日本語を含む 23 文書と正解、測る道具) を作り、基準値を測って保存する
  - 絶対値の下限は置かない (ユーザー判断。research.md §4.1)
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.9_

- [x] 3. 試作と計測で部品と方式を決める
- [x] 3.1 PDF の部品を選ぶ (`@embedpdf/pdfium`。research.md §4.2)
  - _Requirements: 1.4, 1.10, 1.11, 1.12, 5.4_
- [x] 3.2 子プロセスの作り方と親の見張りを決める (`prlimit` で包んだ `spawn`、worker thread の見張り、`--core=1`。research.md §4.3)
  - _Requirements: 2.5, 2.7, 5.8_
- [x] 3.3 本文の受け取り方と multipart の分解の方法を決める (自前の解析器。research.md §4.4)
  - _Requirements: 2.1, 2.3, 2.9_
- [x] 3.4 OpenAPI の作り方を決める (`hono-openapi` + zod。research.md §4.5)
  - _Requirements: 7.1, 7.6_
- [x] 3.5 テキスト系の部品を選ぶ (research.md §4.6)
  - _Requirements: 1.5, 2.6, 5.4_
- [x] 3.6 仮想メモリの上限の値を決める (research.md §4.7)
  - _Requirements: 2.5, 2.7_
- [x] 3.7 子の最大 RSS の基準値とメモリの予算を取り直し、既定値を決める (既定値は変えない。research.md §4.8、§4.9)
  - _Requirements: 2.6, 2.8, 3.3_
- [x] 3.8 採用した部品を package に入れ、ライセンスを確かめる
  - _Requirements: 5.2, 5.4_

- [x] 4. テストを先に書き、独立したレビューを通す
- [x] 4.1 共有層・設定・変換の層の単体テスト、実行管理の結合テスト、HTTP の層のテストと外から確かめる黒箱のテスト、配備物のテストを書く
  - `essential-test-design` と `essential-test-patterns` に従う
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 1.9, 1.10, 1.11, 1.12, 2.1, 2.2, 2.3, 2.5, 2.6, 2.7, 2.8, 2.9, 6.2_
- [x] 4.2 実装の前に、テストが失敗すること (RED) を記録する
- [x] 4.3 テストを書いた担当とは別の担当がテストをレビューし、承認まで直す

- [x] 5. 実装
- [x] 5.1 共有層 (`contract/`・`formats/`・`wire/`) と設定 (`config/`) を実装する
  - _Requirements: 1.6, 6.3, 6.5_
- [x] 5.2 変換の層 (正規化、テキスト系、OOXML の分割とセル数の検査、anydoc と PDFium の呼び出し、入口) を実装する
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.8, 1.9, 1.10, 1.11, 1.12, 2.6, 5.2, 5.5, 6.2_
- [x] 5.3 子プロセスの入口と、実行管理の層を実装する
  - _Requirements: 2.2, 2.5, 2.6, 2.7, 2.8, 4.2_
- [x] 5.4 HTTP の層と組み立て (`service.ts`・`main.ts`)、経路の定義から作る OpenAPI の文書と書き出しの手順を実装する
  - _Requirements: 1.1, 1.6, 2.1, 2.2, 2.3, 2.9, 4.2, 7.1, 7.6_
- [x] 5.5 層の依存の向きを機械的に確かめるテストを置く
  - _Requirements: 6.1, 6.3, 6.4_
- [x] 5.6 Dockerfile と運用者向けの文書 `docker/README.md` を作る (k8s の manifest の例は持たない)
  - _Requirements: 1.7, 2.4, 3.2, 3.3, 3.4, 5.8_
- [x] 5.7 CI に image の確認 (build、400MB 以下、read-only rootfs・uid 10001・ネットワークなしでの起動、`/readyz`、PDF と DOCX の抽出、`prlimit`、OpenAPI の比較) と、人が起動するメモリの計測を足す
  - _Requirements: 1.7, 2.4, 3.3, 5.8_
- [x] 5.8 ベンチマークを測り、基準値を下回る形式・指標が無いことを確かめる
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.9_

- [x] 6. 実装のレビュー
- [x] 6.1 実装した担当とは別の担当が、欠陥を探す立場でレビューし、承認まで直す

- [x] 7. 配布物と CI の切り替え
- [x] 7.1 docker-compose のエントリを切り替え、commit 済みの `openapi.json` と生成クライアントを作り直し、apps/app の呼び出し側の名前と型の書き方を直す。CI で commit 済みの文書との比較を動かし始める
  - _Requirements: 3.1, 7.2, 7.3, 7.4, 7.5_
- [x] 7.2 配布物と CI を、CI でできる確認と人の確認に分けて確かめる
  - CI の実行をジョブとステップの一覧 (`gh api repos/<org>/<repo>/actions/runs/<id>/jobs`) で確かめた。docker が要る人の確認 (linux-arm64、`docker compose build` と `up`、展開した image の大きさ、メモリの計測を人が起動すること) は未確認のまま残した (ユーザーの決定。research.md §1.6)
  - _Requirements: 1.7, 2.4, 3.1, 3.3_
