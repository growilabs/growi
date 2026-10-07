# Implementation Plan

本 spec は `features/opentelemetry/` の **大局的なメンテナンス spec** であり、新規実装タスクを抱えないドキュメント spec として扱う。実装は既に完了しており、本ファイルは「将来の拡張時に踏むテンプレート」と「Revalidation の手順」を記録する。

## Implementation Notes

### 拡張時のテンプレート参照

新規 Custom Metric / Anonymization Handler の追加手順は [design.md](./design.md) の **File Structure Plan → Extension Templates** を参照する。テンプレートに沿って実装することで、レビューでの差分が局所化され、本 spec の Boundary Commitments を逸脱しない。

### Revalidation 必要時の対応フロー

[design.md](./design.md) の **Boundary Commitments → Revalidation Triggers** に列挙された条件のいずれかが発生したら、以下を順次実施する:

1. 該当する Boundary Commitments セクションを読み返し、変更が境界内で完結するかを評価。
2. 境界をまたぐ場合は新規 spec として切り出すか、本 spec の Revalidation Triggers と Design Decisions を更新する。
3. 受信側ダッシュボード / クエリへの影響がある場合は、PR 説明 / リリースノートに「Removed → Replaced by」の対応表を添える。

### 将来の取り扱い候補（Out of Boundary の再評価候補）

以下は本 spec の Out of Boundary に該当するが、将来の要望次第で別 spec として切り出す候補:

- OpenTelemetry Log Signal の利用開始（pino との統合）。
- CPU / network / GC / event-loop lag メトリクスの追加。
- `deployment.environment.name`（OTel 標準）への対応。
- ブラウザ telemetry（Web SDK）の導入。
- `@opentelemetry/host-metrics` への置き換え（要件 5 を満たせる版がリリースされたら）。

これらは現時点では要件として上がっていないため、追加要望時に新規 spec を起こす。
