# Brief: activity-access-token-redaction（activity-log の amend spec）

## Amend target

- **対象 spec**: `activity-log`
- **変わる約束**: activity の記録内容。保存される `endpoint` から access_token を必ず伏せ字にすることを、記録経路（middleware 経由 / `createActivity` 直接呼び出し）を問わない約束として activity-log に加える。伏せ字にする場所は middleware からモデルの保存処理に移る。
- **Revalidation Triggers**: activity-log の Revalidation Triggers に触れるかは design で確認する。

この spec は一時的なもので、tasks.md の最後のタスクで activity-log に変更を書き戻し、このディレクトリを削除する。

## Problem

activity の `endpoint` に access_token が平文で残る経路がある。

- `createActivity` を直接呼ぶ経路は記録用 middleware を通らないので、生の URL が保存される。
- 伏せ字処理が入る前に保存された activity には、トークンが平文で残っている。

## Current State

- 伏せ字処理は `add-activity.ts` middleware の中（`redact-access-token-from-endpoint.ts`）にあり、activity-log spec には書かれていない。
- activity-log の design では、文脈は `{ ip, endpoint: req.originalUrl, userId, username, createdAt }` で、`pending-activity-context.ts` の Map に入れてから記録を確定する。
- `createActivity` を直接呼ぶ経路は約 20 か所ある（`login-passport.js`、`search.ts`、`attachment/download.ts`、`pages/utils/activity.ts`、growi-vault、各種エクスポートの cron など）。
- ES の監査ログの索引は `sanitizeEndpointForIndex` でクエリ文字列を丸ごと捨てているので、トークンは入らない。

## Desired Outcome

- どの経路で記録しても、保存される endpoint の access_token は伏せ字になる。
- 既存の activity に残った平文のトークンが、migration で伏せ字になる。

## Scope

- **In**: 伏せ字処理をモデルの保存処理へ移すこと、既存の activity を伏せ字にする migration、activity-log spec への書き戻し。
- **Out**: endpoint 検索まわりの変更（別 spec。検索はパス部分だけで判定するので、伏せ字にしても検索結果は変わらない）。

## 設計で決めること

1. **書き込みの入口の洗い出し**: `models/activity.ts`（Prisma 拡張）の `createByParameters` と `updateByParameters` のどちらが endpoint を書くか。`import-executor.ts` など、activity を直接書く経路がほかにないか。
2. **migration で直せる範囲**: activity は既定で 30 日で消えるので、対象は残っている分だけ。作成済みの監査ログのエクスポートファイルに残ったトークンは直せない。範囲外とするなら Boundary に書く。
3. **migration の問い合わせと負荷**: 条件（endpoint に `?` を含む、id の範囲指定）を Prisma がどんな MongoDB の問い合わせに変換するか、インデックスが効くかを explain で確かめる。endpoint を書き換えると auditlog-es-sync の change stream に件数分の更新イベントが流れる（索引の中身は変わらない）。
4. **メモリ上の生トークン**: 伏せ字をモデル側に移すと、`PendingActivityContext` に生の access_token が入る。将来 context をログに出すと漏れる点をどう扱うか。
