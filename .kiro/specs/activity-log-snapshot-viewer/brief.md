# Brief: activity-log-snapshot-viewer（snapshot 表示 UI）

> activity log サブシステムの **read（表示）側** を担う spec。管理画面の監査ログで、記録された snapshot を管理者が閲覧できるようにする。write（記録）側の `activity-log`（記録ゲート）/ `activity-log-snapshot`（snapshot データ）とは責務が分かれる。

## Problem

PR #11393 で snapshot（`ACTION_ATTACHMENT_REMOVE` の `originalName` / `pagePath` / `pageId` / `fileSize`）は DB 保存も API 応答も通っているが、管理画面テーブル `ActivityTable.tsx` は `snapshot.username` しか描画していない。管理者が「どのページのどの添付ファイルが削除されたか」等を UI から追えない（データはあるのに見えない）。

## Current State

- **テーブル**: `client/components/Admin/AuditLog/ActivityTable.tsx`。列は user / date / action / ip / url。snapshot は `username` のみ利用、追加フィールドの描画なし。
- **API**: `routes/apiv3/activity.ts` の GET `/activity` が snapshot を応答に含める（`...rest` 展開。OpenAPI に `originalName` 等の記載あり）。SWR フック `useSWRxActivity`（`stores/activity.ts`）。
- **型**: `apps/app/src/interfaces/activity.ts` に判別可能ユニオン（`DefaultSnapshot` = `{ username? }` / `AttachmentRemoveSnapshot`）と型ガード `isAttachmentRemoveActivity`。判別子は snapshot 自身ではなく activity の `action`。
- **整形の仕組み**: action ごとの整形コンポーネントは存在しない。i18n キー `admin:audit_log_action.<action>` で action 名を訳すだけ。
- 添付フィールドはすべて optional 設計（builder が解決できない値は undefined のまま残す）。

## Desired Outcome

- 管理者が監査ログ画面で **全 action の生（raw）snapshot** を確認できる（最低ライン）。
- **添付系 action は整形表示**する。ファイル名・ファイルサイズ・所属ページへのリンク、実体が残るケース（添付追加 ADD）はダウンロードリンク。実体が消えるケース（添付削除 REMOVE）はダウンロードリンクを出さず、ページも削除済みならフォールバック表示。

## Approach

- `ActivityTable` に snapshot 詳細（展開行 or 「対象」列）を追加する。
- action ごとの整形は、拡張可能な **per-action renderer** パターンを新設する（`isAttachmentRemoveActivity` 等で narrow し、未対応 action は raw fallback にフォールスルー）。ハードコードの mode 分岐ではなく、対応 action を宣言的に持たせて汎用に描き分ける方針を検討する。
- 全フィールド optional 前提でフォールバック表示（`pagePath` は削除済みページで undefined、`fileSize` は bytes 数値なので人間可読へ整形）。

## Scope

- **In**:
  - 全 action の raw snapshot 表示（汎用ビューア）。
  - 添付系 action の整形表示（ファイル名・サイズ・ページリンク、ADD の DL リンク）。
  - 追加ラベルの i18n（en/ja/ko/zh/fr の全ロケール）。
- **Out**:
  - 非添付 action の整形（raw 表示のみ）。
  - snapshot データの capture 自体（`activity-log-snapshot` が担当）。添付 ADD の整形に必要な ADD 用 snapshot は `activity-log-snapshot` の拡張に依存する。
  - 記録可否（`activity-log` の記録ゲート）。
  - `target × targetModel` の全面的な polymorphic「対象」列（将来課題）。

## Boundary Candidates

- 汎用の raw snapshot ビューア。
- per-action 整形 renderer（まず添付系）。
- i18n ラベル。

## Out of Boundary

- snapshot の capture（`activity-log-snapshot`）。
- 記録ゲート（`activity-log`）。

## Upstream / Downstream

- **Upstream**: `activity-log-snapshot`（表示する snapshot データを供給する。特に添付 ADD の整形表示は、ADD 用 snapshot capture の完了に依存）。既存の `apiv3/activity` API・`useSWRxActivity`・`interfaces/activity.ts` の型・i18n 基盤。
- **Downstream**: 将来の polymorphic「対象」列、他 action の整形拡張。

## Existing Spec Touchpoints

- **Depends on**: `activity-log-snapshot`。raw 表示と `ACTION_ATTACHMENT_REMOVE` の整形表示は既存データで着手できる（#11393 済み）。添付追加 ADD の整形表示は `activity-log-snapshot` 側の capture 拡張が入ってから。

## Constraints

- 判別子は snapshot ではなく `action`。narrow は必ず型ガード（`isAttachmentRemoveActivity` 等）を経由する。
- 削除済みファイルには DL リンクを張らない。
- 全フィールド optional → 欠損時フォールバック必須。
- テスト: `ActivityTable` の component spec は未整備。追加時は essential-test-design（観察可能な契約をテスト）と essential-test-patterns（Vitest / RTL / 型安全モック）に従う。
