# Brief: opentelemetry-data-transfer-usage-metrics

## Problem

管理画面のデータアーカイブとお引越し機能（G2G 転送）について、WESEEK 側で「使っているインスタンスはあるのか」「どのくらいのインスタンスが、どのくらいの頻度で使っているのか」を把握できない。

## Current State

- データアーカイブの操作（`ADMIN_ARCHIVE_DATA_CREATE` / `DOWNLOAD` / `DELETE` / `UPLOAD`、`ADMIN_GROWI_DATA_IMPORTED`）は監査ログの Large グループにのみ含まれ、監査ログ自体も初期状態で無効のため、多くのインスタンスで記録されない。
- お引越し機能には監査ログのアクションが存在しない。
- 監査ログは各インスタンスの DB に保存されるのみで、外部集計の経路はない。
- OpenTelemetry の独自メトリクスはすべて ObservableGauge（送信時点の状態値）。本番のトレースは 1% サンプリング。

## Desired Outcome

- データアーカイブとお引越し機能の各操作の発生回数が、インスタンス単位で OpenTelemetry メトリクスとして送信される。
- 受信側で「期間内に 1 回以上利用したインスタンス数」「利用インスタンスの割合」「インスタンスごとの期間あたり利用回数」を集計できる。

## Approach

- OpenTelemetry の Counter（イベント発生時に加算）を用いる。監査ログの記録有無に依存しない。
- 計測ポイントは `features/opentelemetry` の外（データアーカイブ・インポート・G2G 転送の各処理）にあるため、それらから記録できる API を custom-metrics 側に設ける。
- 属性は操作の種類・成否・お引越しの送信側/受信側など、個人やコンテンツを特定しない情報に限る。

## Scope

- **In**: 管理画面のデータアーカイブ（作成・ダウンロード・アップロード・インポート）、お引越し機能（送信側・受信側）の利用回数メトリクス。opentelemetry spec への Counter 規約と追加手順の追記。
- **Out**: ページの一括エクスポート（監査ログの Essential グループで常時記録済み）。受信側（コレクター・ダッシュボード）の設定。リリース以前の利用実績の遡及。

## Amend Target

| Target spec | 変更される契約 |
|---|---|
| `opentelemetry` | design.md「Boundary Commitments > Layer 3: Custom Metric」— Observation 実装規約（`ObservableGauge` + `addBatchObservableCallback` のみ）に、イベント型の Counter と、`features/opentelemetry` 外のモジュールから記録するための API を追加する。所有メトリクス一覧に新規メトリクスを追加する |
| `opentelemetry` | design.md「Extension Templates」— Counter 型メトリクスを追加する手順を追加する |
| `opentelemetry` | requirements.md — Counter 型メトリクスに関する要件を末尾に追加する（既存 ID は振り直さない） |

**Revalidation Triggers への影響**: 既存トリガー「受信側ダッシュボード／クエリの参照更新が未完了の状態でメトリクス／ラベル変更を行う → ロールアウト順序の再調整」に該当するため、新規メトリクス名・属性の確定後に受信側の準備状況を確認する。

## Constraints

- 完了時に本 spec の内容を `opentelemetry` spec に反映し、本 spec ディレクトリを削除する（`.claude/rules/spec-lifecycle.md`）。
- 新規 npm 依存は追加しない（`@opentelemetry/api` の Counter で足りる）。
- `OPENTELEMETRY_ENABLED=false` のインスタンスでは何も送信しない（既存の有効化制御に従う）。
