# Requirements Document

## Introduction

GROWI は現在 5 言語（en_US / ja_JP / zh_CN / fr_FR / ko_KR）を提供しているが、翻訳に貢献するには GitHub アカウント・fork・手動での JSON 編集・PR 作成が必要で、wiki 利用者にとってハードルが高い。その結果、`ko_KR/commons.json` の 92 キー欠損をはじめとする言語間の翻訳漏れが放置されている。

本 spec は、翻訳管理サービス（TMS）として POEditor を受け皿に採用し、(1) GitHub 操作を知らない利用者でも翻訳に貢献できる導線、(2) リポジトリと POEditor の間の双方向同期、(3) 貢献された翻訳の品質を落とさずに取り込むレビュー体制を定義する。翻訳ファイルは実行時も引き続き git にコミットされたものを使い、POEditor への実行時依存は作らない。

## Boundary Context

- **In scope**: POEditor への OSS プラン申請と条件充足の確認、POEditor プロジェクト構成の決定、リポジトリ⇔POEditor の双方向同期、GitHub を使わない貢献者向けの参加導線とガイド、変更の種類に応じたレビュー体制（既存キーの訳文更新は自動反映・キーの追加/削除/リネームを伴う変更は人によるレビュー必須）、翻訳進捗の可視化（POEditor 自体の画面を使う）
- **Out of scope**: 翻訳そのものを埋める作業、`apps/app/resource/locales/` 配下（`welcome.md` 等の markdown・メール ejs テンプレート）、i18next の namespace 再編、機械翻訳の導入や翻訳内容そのものの品質保証、GROWI 側での独自の進捗表示 UI の構築
- **Adjacent expectations**: 同期は既存の i18n CI ゲート（未使用キー・言語間欠損・存在しないキー参照の検出）を迂回してはならず、このゲートは自動反映・レビュー必須のどちらの経路でも同じように適用される。`packages/editor` の `toolbar.*` キーは `apps/app` の `translation.json` に同居しているため、本機能の同期対象に含まれる

## Requirements

### Requirement 1: GitHub を使わない貢献導線

**Objective:** As a 翻訳したい GROWI 利用者, I want GitHub アカウントや fork・PR の知識なしに翻訳を投稿できること, so that 技術的な背景に関わらず翻訳に貢献できる

#### Acceptance Criteria

1. When 翻訳への貢献を希望する利用者が公開されている参加導線（join page 等）を訪れたとき、the Translation Program shall GitHub アカウントを要求せずに POEditor プロジェクトへの参加手段を提示する
2. When 利用者が POEditor プロジェクトへの参加を完了したとき、the Translation Program shall POEditor のプロジェクト画面上で直接、翻訳文字列を投稿できる状態にする
3. The Translation Program shall 貢献の手順（参加方法・翻訳の投稿方法）を、GROWI の公開リポジトリまたは公式サイトから辿れる場所に文書化する

### Requirement 2: ソース言語のリポジトリ→POEditor 同期

**Objective:** As a GROWI メンテナー, I want リポジトリ上の en_US（ソース言語）キーの変更が自動的に POEditor へ反映されること, so that 翻訳者が常に最新のソース文字列を基準に翻訳できる

#### Acceptance Criteria

1. When default branch 上のソース言語の翻訳ファイルにキーの追加・削除・文言変更が起きたとき、the Sync Workflow shall 対応する POEditor プロジェクトの内容を人手のコピーなしに追随させる
2. While ソース言語の同期が行われている間、the Sync Workflow shall 変更のないキーに対する既存の翻訳を保持し、意図せず消去しない
3. If 同期設定が参照する namespace ファイルが同期実行時にリポジトリ側で見つからない場合、the Sync Workflow shall 同期を失敗として扱い、namespace を黙ってスキップしない

### Requirement 3: 変更の種類に応じたレビュー体制（POEditor→リポジトリ同期）

**Objective:** As a GROWI メンテナー, I want 既存キーの訳文更新は自動でリポジトリに反映され、キー構造に影響する変更は人がレビューしてから反映されること, so that 定常的な翻訳作業がメンテナーのボトルネックにならず、かつ構造的な変更のリスクは人の目でチェックできる

#### Acceptance Criteria

1. When POEditor から取り込む更新が既存キーの訳文のみを変更しており、かつ既存の i18n CI ゲートを通過したとき、the Sync Workflow shall 人による承認を必要とせず default branch へ反映する
2. When POEditor から取り込む更新がキーの追加・削除・リネームを含むとき、the Sync Workflow shall その更新を人によるレビューを経る変更提案（pull request 等）として提示し、承認されるまで default branch へ反映しない
3. If POEditor から取り込む更新が既存の i18n CI ゲート（未使用キー・言語間欠損・存在しないキー参照の検出）に失敗した場合、the Sync Workflow shall その更新が default branch へ反映されることを止め、メンテナーに知らせる
4. The Sync Workflow shall 自動反映・レビュー必須のどちらの経路であっても、既存の i18n CI ゲートを迂回しない

### Requirement 4: 実行時の外部サービス非依存

**Objective:** As GROWI をオンプレミスで運用するオペレーター, I want 実行時に配信される翻訳内容が git にコミットされたファイルのみに由来すること, so that GROWI の可用性が外部の翻訳サービスに依存しない

#### Acceptance Criteria

1. The GROWI アプリケーション shall 実行時に配信する翻訳内容を、ビルド時点でリポジトリにコミットされているロケールファイルのみから提供する
2. The Sync Workflow shall POEditor と通信する唯一の経路であり、稼働中の GROWI アプリケーション自体は実行時に POEditor へ問い合わせない

### Requirement 5: 翻訳進捗の可視化

**Objective:** As a 貢献者またはメンテナー, I want 言語ごとの翻訳進捗（何%埋まっているか）を確認できること, so that どの言語の翻訳が不足しているかが分かる

#### Acceptance Criteria

1. When 貢献者またはメンテナーが言語ごとの翻訳進捗を確認したいとき、the Translation Program shall POEditor 自体のプロジェクト画面上の進捗表示に誘導する
2. The Translation Program shall 進捗表示のために GROWI 側で独自の画面や仕組みを新たに構築しない

### Requirement 6: 隣接パッケージのキーを同期範囲に含める

**Objective:** As a GROWI メンテナー, I want `packages/editor` が依存する `toolbar.*` キーも本機能の同期対象に含まれること, so that エディタツールバーの翻訳だけが同期から漏れて古いまま取り残されることがない

#### Acceptance Criteria

1. The Translation Program shall `packages/editor` が参照する `toolbar.*` キーを、`apps/app` の他の翻訳キーと同じ同期範囲に含める

### Requirement 7: POEditor OSS プランでの運用

**Objective:** As a GROWI メンテナー, I want POEditor を文字列数・言語数・貢献者数の上限がない条件で利用できること, so that コミュニティ翻訳者や翻訳キーが増えても有償プランの上限に突き当たらない

#### Acceptance Criteria

1. The Translation Program shall 文字列数・言語数・貢献者数に数値上限のない POEditor のプラン（OSS プラン）の下で運用する
2. If POEditor の OSS プラン申請が承認されない場合、the Translation Program shall 同等の規模を満たす代替プランまたは代替サービスが確認できるまで、本番運用への移行を進めない

### Requirement 8: 同期失敗の可視性

**Objective:** As a GROWI メンテナー, I want リポジトリ⇔POEditor 間の同期が何らかの理由で失敗したときに気づけること, so that 翻訳の反映漏れやドリフトが放置されない

#### Acceptance Criteria

1. If Sync Workflow の実行がエラー（POEditor 側 API エラー、通信エラー等）で完了しなかった場合、the Sync Workflow shall その失敗をメンテナーに分かる形で知らせ、黙って結果をスキップしない
