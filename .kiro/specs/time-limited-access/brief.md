# Brief: time-limited-access（期限付きアクセス）

> umbrella spec: [enhanced-guest](../enhanced-guest/roadmap.md) の sub-spec。
> 依存: なし（直交軸）。`guest-users` と組み合わせて使うことを想定。

## Problem（解決したい課題）

外部パートナーや一時メンバーのアカウントは、用が済んだら**自動的にアクセスできなくなる**べき
だが、現状 GROWI には有効期限の概念が無い。管理者が手動で停止し忘れると、不要になった
アカウントがアクセス可能なまま残り、棚卸しの手間と情報漏洩リスクになる。

これは Enhanced Guest（[#11139](https://github.com/growilabs/growi/discussions/11139)）の
「期限付きアクセス権」に相当する。レビュー指摘のとおり**期限はゲスト固有ではなく、通常
ユーザーにも付けられて良い直交した軸**なので、ゲスト区分に縛らず独立機能として扱う。

## Current State（現状）

- **有効期限の概念が無い**: `User`（`apps/app/src/server/models/user/index.js` / `IUser` =
  `packages/core/src/interfaces/user.ts`）は `status`（`STATUS_ACTIVE` / `STATUS_SUSPENDED`
  など）を持つが、期限による自動遷移は無い。停止は管理者の手動操作のみ。
- **スケジュール基盤**: GROWI には定期ジョブの仕組みがあり、期限切れの自動処理に再利用できる
  （design で具体機構を確認）。
- **認証経路**: ログイン／セッション確立時にユーザーの `status` を参照する箇所がある。ここに
  期限チェックを差し込める。

## Desired Outcome（達成したい状態）

- ユーザー（ゲストに限らず）に**有効期限**を設定できる。
- 期限を過ぎたユーザーは**自動的にアクセスできなくなる**（`STATUS_SUSPENDED` への遷移など、
  既存の停止状態を再利用）。ログイン時にも期限を検証する。
- 管理画面で期限・残り日数を確認でき、設定・延長・解除ができる。
- 期限切れは可逆（延長で復帰可能）。

## Approach（採用アプローチ・暫定）

1. **データモデル**: `User` / `IUser` に `expiredAt?: Date`（仮）を追加。`admin` / `readOnly` と
   並ぶ独立フィールド。
2. **強制**: ログイン／認証時に `expiredAt < now` ならアクセス拒否。加えて定期ジョブで期限切れ
   ユーザーを既存の停止状態へ自動遷移（二経路で取りこぼしを防ぐ）。
3. **UI**: 管理ユーザー画面に期限の表示（残り日数バッジ）・設定・延長・解除を追加。ゲスト招待
   フロー（`guest-users`）からも期限を指定できるよう、フィールドは共通で持つ。

進め方: brief → requirements（EARS）→ `kiro-validate-gap`（認証経路・ジョブ基盤の確認）→
design → tasks。

## Scope

- **In**:
  - `User` への有効期限フィールドと移行（既存ユーザーは期限なし）。
  - ログイン時の期限検証＋定期ジョブによる自動停止。
  - 管理 UI での期限の設定・表示・延長・解除。
- **Out**:
  - ゲスト userType そのもの（`guest-users`）。
  - スコープ単位の権限（`granular-page-permissions`）。
  - grant／ページ単位の期限（アカウント単位に限定。ページ/グループ付与に期限を持たせる案は
    将来検討）。

## Boundary Candidates（責務の境界候補）

- 有効期限フィールドのデータモデル＋移行。
- 期限の強制（ログイン検証＋定期ジョブ自動停止）。
- 管理 UI（設定・表示・延長・解除）。

## Out of Boundary（このスペックが持たない範囲）

- **ページ／グループ付与単位の期限** — アカウント単位に限定する。柔軟だが影響が大きいため将来。
- **ゲスト固有の振る舞い** — `guest-users` が所有。本 spec は全ユーザー共通の期限機能。

## Upstream / Downstream（上流 / 下流）

- **Upstream**: `User` / `IUser`、認証／セッション確立経路、定期ジョブ基盤、管理ユーザー API。
- **Downstream**: `guest-users`（ゲスト招待時に期限を指定して組み合わせる）。

## Existing Spec Touchpoints（既存スペックとの接点）

- **Extends**: なし（新規 sub-spec）。
- **Adjacent**: `guest-users`（兄弟・直交。期限フィールドを共有）、`granular-page-permissions`
  （同じ User モデルに属性が並ぶ）。

## Constraints（制約）

- 期限はアカウント単位（グローバル）。ゲスト区分とは独立で、通常ユーザーにも適用可能。
- 期限切れの自動停止は既存の `status` 遷移を再利用し、新しい状態を増やさない。
- ログイン検証とジョブの二経路を持ち、片方の取りこぼしでもアクセスを許さない。
- 期限切れは可逆（延長で復帰）。
- `kiro-validate-gap` で認証経路とジョブ基盤の実機構を確認してから design する。
