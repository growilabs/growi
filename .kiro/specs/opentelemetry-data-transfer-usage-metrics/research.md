# Gap Analysis — opentelemetry-data-transfer-usage-metrics

> 実施日: 2026-11-10 / 対象: requirements.md（未承認の生成版）
> 設計判断は含めない。設計フェーズで選ぶための現状と選択肢を記録する。

## 1. 現状調査

### 1.1 OpenTelemetry 側

- 独自メトリクスは `apps/app/src/features/opentelemetry/server/custom-metrics/` に集約。すべて `ObservableGauge` + `addBatchObservableCallback` で、計測は送信周期のコールバック内で完結し、他機能のコードから呼ばれる API は存在しない。
- Meter は各 `addXxxMetrics()` 内で `metrics.getMeter('growi-<scope>-metrics', '1.0.0')` により取得している。
- 起動順序（`apps/app/src/server/app.ts`）: `initInstrumentation()` → `new Crowi()` / `growi.start()`（ルート・サービス構築）→ `setupAdditionalResourceAttributes()` → `startOpenTelemetry()`（`sdkInstance.start()` → `setupCustomMetrics()`）。
- `@opentelemetry/api` 1.9 の metrics API には trace API のような Proxy プロバイダーが**ない**。`metrics.getMeter()` は呼び出し時点のグローバル MeterProvider（未登録なら `NOOP_METER_PROVIDER`）から Meter を返し、後から SDK が登録されても差し替わらない。
- テストは `vi.mock('@opentelemetry/api')` + `mock<Meter>()`（vitest-mock-extended）で Meter をモックし、co-located `*.spec.ts` に置く。

### 1.2 データアーカイブ側（計測ポイント候補）

| 操作 | 場所 | 成否の確定 | 備考 |
|---|---|---|---|
| 作成 | `server/routes/apiv3/export.js` POST `/` → `exportService.export(collections)` | `ExportService.export()`（`server/service/export.ts:281`）の resolve / reject | ルートは `export()` を **await していない**。非同期の失敗は route の try/catch に届かず、`unhandledRejection` ハンドラ（ログのみ）に流れる |
| ダウンロード | `server/routes/admin.js` `exportService.getFile()` → `res.download()` | `getFile()` の成功時に監査ログを作成している | `res.download()` の送信完了・失敗は未観測 |
| アップロード | `server/routes/apiv3/import.ts:455` POST `/upload` | `parseZipFile()` 失敗（500）／ `importService.validate()` 失敗（バージョン不一致）／成功 | 監査ログは成功時のみ emit |
| インポート | `server/routes/apiv3/import-executor.ts` `executeImport()` | `importService.import()` の結果。`failedCollections.length > 0` または例外は失敗扱い（画面にエラー通知、`ADMIN_GROWI_DATA_IMPORTED` を出さない） | 成否の定義がすでに 1 か所に集約されている |

### 1.3 お引越し（G2G 転送）側

| 役割 | 場所 | 成否の確定 |
|---|---|---|
| 送信側 | `server/service/g2g-transfer.ts:1053` `startTransfer()`（route `/transfer` から await せずバックグラウンド実行） | アーカイブ生成失敗・送信失敗・受信側の部分失敗（`failedCollections` / `importAborted`）・添付ファイル転送失敗はいずれも `admin:g2gProgress` に `ERROR` を emit し throw。全工程完了で `COMPLETED` |
| 受信側 | `server/routes/apiv3/g2g-transfer.ts` POST `/` → `receiveTransferData()` → `g2gTransferReceiverService.importCollections()` | 例外時は `apiv3Err`。正常応答でも `failedCollections` / `importAborted` / `postProcessFailures` 等を含みうる |

- 送信側の `startTransfer()` は内部で **`exportService.export()` を再利用**している。
- 受信側の `importCollections()` は内部で **`importService.import()` を再利用**している（`service/g2g-transfer.ts:1750`）。
- お引越しには監査ログのアクションが無い（`/preflight` には意図的に `addActivity` を付けていない旨のコメントあり）。

## 2. 要件ごとのギャップ

| 要件 | 既存資産 | ギャップ |
|---|---|---|
| R1 データアーカイブの回数 | 各操作の成否確定点は特定済み。監査ログ emit 箇所とほぼ一致 | 回数を記録する仕組みが無い。作成は route が await していないため、失敗（R1.2）を捕捉する箇所が route に無い |
| R1.9 重複なし | — | `ExportService` / `ImportService` の内部で数えると、お引越し経由の実行もアーカイブとして数えてしまう（R2.6 と衝突） |
| R2 お引越しの回数 | 送信側は成功/失敗が `startTransfer()` 内で一意に確定。受信側は応答内容で判定可能 | 受信側の「部分失敗」をどちらに数えるかの定義が要る（送信側・通常インポートは部分失敗＝失敗としている） |
| R3.1–3.2 送信・無効時 | SDK 無効時は global provider が Noop のため、記録しても何も送られない | **SDK 開始前（ルート構築時）に取得した Meter / Counter は Noop のまま固定される**。Counter の生成タイミングを SDK 開始後にする必要がある |
| R3.3/3.5 期間集計・再起動 | OTLP メトリクスは既定で累積値（start time 付き）として送られる | 受信側でのリセット判定（Prometheus 系の `increase()` 等）は受信側の責務。送信側の追加実装は不要の見込み（Research Needed で確認） |
| R3.4 属性 | — | 操作種別・役割・結果の属性名と値の語彙が未定 |
| R4.1 プライバシー | 匿名化は trace 向け（`opentelemetry-anonymization`） | 属性を固定の列挙値に限定すれば追加の匿名化は不要 |
| R4.2–4.3 非干渉 | ObservableGauge 側は try/catch + diag で例外吸収の規約あり | 呼び出し側（route / service）から呼ぶ記録 API にも、例外を外に出さない保証が要る |
| R5 spec の手順 | design.md Layer 3 / Extension Templates | Counter 用の規約・手順・外部モジュールからの呼び出し境界が未定義 |

## 3. 実装アプローチの選択肢

### Option A: 既存ファイルに直接 Counter を埋め込む

各 route / service ファイルで `metrics.getMeter(...).createCounter(...)` を呼び、成否確定点で `add()` する。

- ✅ 新規ファイルが最小
- ❌ Meter 名・メトリクス名・属性語彙が複数ファイルに散らばる（Single source of truth に反する）
- ❌ モジュール読み込み時に生成すると Noop に固定される問題を各所で個別に回避する必要がある
- ❌ opentelemetry spec の境界（Layer 3 が custom-metrics を所有）から外れる

### Option B: custom-metrics に記録用モジュールを新設し、各機能から呼ぶ

`custom-metrics/` に「データ移行の利用回数」を所有するモジュールを新設し、メトリクス名・属性語彙・Counter の生成（SDK 開始後／呼び出し時の遅延取得）・例外吸収を閉じ込める。各機能は `recordXxx({ operation, result })` 相当の関数を呼ぶだけにする。

- ✅ 名前・語彙・Noop 問題・例外吸収が 1 か所に集約される
- ✅ 既存の Layer 3 の所有範囲に収まり、spec への反映（R5）が素直
- ✅ 単体テストは既存と同じ `mock<Meter>()` パターンで書ける
- ❌ 機能側（export/import/g2g）から `features/opentelemetry` への依存が新たに生じる。依存方向の規約化が必要

### Option C: ハイブリッド — 記録 API は B、呼び出し位置は「オーケストレーション層」に限定

B の記録モジュールを用意したうえで、呼び出しは **ルート／executor／`startTransfer()` といった、操作の入口を知っている層** に限定し、`ExportService` / `ImportService` には入れない。作成の失敗捕捉は route が `export()` の Promise に完了・失敗ハンドラを付ける形で行う。

- ✅ お引越し経由の export/import がアーカイブとして二重計上されない（R1.9 / R2.6）
- ✅ 共通サービスに計測の関心事を持ち込まない
- ❌ 計測ポイントが 5〜6 か所の呼び出し側に分散するため、漏れ防止のテストが要る

## 4. Research Needed（設計フェーズで確認）

1. **Counter 生成タイミング**: `metrics.getMeter()` を記録のたびに呼ぶ（Meter はプロバイダー側でキャッシュされる）か、`setupCustomMetrics()` で生成して保持するか。SDK 無効時・テスト時の挙動も含めて確認。
2. **作成の失敗捕捉**: route で `export()` の Promise を扱う形にしたとき、既存の挙動（即時 200 応答、`unhandledRejection` ログ）を変えずに済むか。同時実行時の `'There is an exporting process running.'`（同期 throw ではなく async reject）をどう数えるか。
3. **受信側の部分失敗**: `failedCollections` / `importAborted` / `postProcessFailures` / `rescue` のどれを「失敗」とするか。送信側の判定（`failedCollections.length > 0 || importAborted ...`）と揃えるのが候補。
4. **ダウンロードの計測点**: `getFile()` 成功時点か、`res.download()` のコールバック（送信完了）か。要件上は成否を区別しないため前者で足りる可能性。
5. **累積値のリセット判定**: OTLP の累積メトリクスで、再起動後の start time 変更が受信側（WESEEK のコレクター／バックエンド）で正しくリセットとして扱われるか。受信側担当への確認事項。
6. **属性語彙と命名**: メトリクス名（例: `growi.data_transfer.operations`）と属性キー・値。OTel の命名規約（`.` 区切り、単位 `{operation}` 等）との整合。
7. **依存方向**: `server/routes` / `server/service` から `features/opentelemetry/server` を import することの可否。現状 `features/opentelemetry` を外部から import しているのは `server/app.ts`（起動処理）のみで、業務コードからの呼び出しの前例はない。公開する barrel の範囲を設計で決める。

## 5. 規模とリスク

- **規模: S〜M（2〜4 日）**。記録モジュール自体は小さいが、計測ポイントが 3 ファイル群（export / import / g2g の送受信）に分かれ、それぞれに成否のテストが要る。
- **リスク: 中**。
  - Noop 固定の罠は、テストで Meter をモックすると見逃しやすい（単体テストは通るが本番で何も送られない）。devコンテナ＋ローカルコレクターでの実送信確認が必須。
  - 共通サービスで数えると二重計上になる。
  - 受信側の部分失敗の扱いを誤ると、成功率の解釈がぶれる。

## 6. 設計フェーズへの推奨

- Option C（記録 API を custom-metrics に新設し、呼び出しは操作の入口を知る層に限定）を軸に検討するのがよい。
- Research Needed 1（Counter 生成タイミング）と 3（受信側の部分失敗の定義）は、設計の前提を左右するので最初に決める。
- 要件側の見直し（反映済み）: 一部のデータを取り込めずに終了した場合は管理画面のエラー通知と同じ条件で「失敗」とし（R1.10 / R2.7）、やり直しは独立した 1 回として数える（R1.11 / R2.8）。

## 7. Decision: 失敗は失敗として数え、部分失敗も失敗に含める

- **背景**: 失敗の後にはやり直しが続くことが多く、失敗を数えると回数が水増しされるのではという懸念があった。
- **決定**: 試行 1 回 = 1 カウントとし、結果（成功／失敗）を属性で区別する。部分失敗は 3 値目を設けず失敗に含める。
- **理由**:
  - 結果ラベル付きカウンターは OTel／Prometheus の一般的な形で、受信側で目的別に絞り込める（有無・割合は全試行、利用頻度は成功のみ、安定性は失敗率）。
  - 失敗を捨てると「使おうとして諦めた」インスタンスが見えなくなり、「利用者がいるか」という目的を損なう。
  - 部分失敗は管理画面でエラーと表示される状態であり、通常インポート（`executeImport`）と送信側転送（`startTransfer`）は既に失敗として扱っている。判定をそれと揃えることで、利用者が見た結果と計測が一致する。
- **却下した案**: 失敗を数えない／「部分失敗」の 3 値目を設ける（目的に対して過剰）。

---

# Design Phase Research

## Summary
- **Feature**: `opentelemetry-data-transfer-usage-metrics`
- **Discovery Scope**: Extension（light discovery。新規依存なし）
- **Key Findings**:
  - 送信側の `startTransfer()` は「一部失敗」でも throw せず resolve する（添付ファイル転送は続行し、画面には ERROR を通知）。route 側で Promise の成否だけを見ると部分失敗を成功と誤計上するため、取り込みが不完全だったかを戻り値で返す必要がある。
  - 受信側の `receiveTransferData()` は 9 種のエラー応答と 1 種の成功応答を持ち、成功応答でも取り込みが不完全な場合がある。`apiv3Err` の戻り値は `any` のため、エラー時は明示的に `null` を返す形にする。
  - 通常インポートの route には、受付（`res.apiv3()`）後・`executeImport()` 前に `onErrorForImport` を emit して return する経路が 3 つある。画面のエラー通知と揃えるには、これらも失敗として数える必要がある。

## Research Log

### Research Needed の解決

| # | 項目 | 結論 |
|---|---|---|
| 1 | Counter 生成タイミング | `setupCustomMetrics()`（SDK 開始後）で生成しモジュール内に保持。未生成時の記録は no-op。既存の `addXxxMetrics()` 構成と同じ |
| 2 | 作成の失敗捕捉 | route で `export()` の Promise にハンドラを付ける。応答は即時のまま。実行中の重複要求（async reject）も失敗として数える |
| 3 | 受信側の部分失敗 | 送信側の既存判定式を `isTransferImportIncomplete()` として抽出し、両側で使う |
| 4 | ダウンロードの計測点 | `getFile()` 成功時点。要件上は成否を区別しない |
| 5 | 累積値のリセット判定 | OTLP 既定の累積値（start time 付き）で受信側が判別可能。受信側の設定は本 spec の範囲外として担当者へ共有 |
| 6 | 命名 | `growi.archive.operations`（`{operation}`）、`growi.g2g_transfer.operations`（`{transfer}`） |
| 7 | 依存方向 | routes → `~/features/opentelemetry/server` barrel のみ。内部ファイルへの直接 import は禁止 |

## Design Decisions

### Decision: Counter を 2 つに分ける（アーカイブ用とお引越し用）
- **Context**: 2.6 でアーカイブとお引越しを区別する必要がある。
- **Alternatives Considered**:
  1. 1 つの Counter に `feature` 属性を付ける — お引越しにだけ `role`、アーカイブにだけ `operation` が付き、属性の組が系列ごとに揃わない
  2. 2 つの Counter — 各 Counter の属性が常に同じ組になる
- **Selected Approach**: 2。
- **Rationale**: 系列ごとに属性の有無が変わると受信側のクエリが複雑になる。メトリクス名で機能が分かれていれば集計も読みやすい。
- **Trade-offs**: メトリクス名が 2 つになるが、記録モジュールは 1 ファイルで所有する。

### Decision: 計測はサービス層ではなく、操作の入口を知る層で行う
- **Context**: お引越しが `ExportService` / `ImportService` を再利用している。
- **Selected Approach**: route と `executeImport()` に記録を置く。送信側の部分失敗は `startTransfer()` の戻り値で route に伝える。
- **Rationale**: サービス層で数えるとお引越しがアーカイブとしても計上される（1.9, 2.6 に違反）。
- **Trade-offs**: 計測ポイントが 6 か所に分散する → 結合テストで各箇所 1 回だけ呼ばれることを確認する。

### Decision: 受付前に拒否された要求は数えない（全操作共通）
- **Context**: 2.5 はお引越しの事前確認での中止を数えないと定める。他の操作にも同様の「受付前の拒否」（バリデーション 4xx、`validateTransferKey` 等）がある。
- **Selected Approach**: 操作が受け付けられた後の成否のみを数える。アップロードだけは、受け付けたファイルの解析・検証の失敗を失敗として数える。
- **Rationale**: 受付前の拒否は「利用」ではなく入力不備で、数えると成功率の解釈がぶれる。

### Decision: 記録 API は SDK 開始後に生成した Counter を保持する（呼び出しのたびに getMeter しない）
- **Context**: `@opentelemetry/api` 1.9 の metrics API には Proxy がなく、SDK 登録前に取得した Meter は Noop のまま。
- **Alternatives Considered**:
  1. 記録のたびに `metrics.getMeter().createCounter()` — 同名 instrument の再生成になり、SDK 側のキャッシュ挙動に依存する
  2. `setupCustomMetrics()` で生成して保持 — 既存の `addXxxMetrics()` 構成と同じ
- **Selected Approach**: 2。
- **Follow-up**: Noop 固定の回帰は Meter モックでは検出できないため、実 `MeterProvider` + `InMemoryMetricExporter` でテストし、devコンテナで実送信を確認する。

## Synthesis

- **Generalization**: 記録関数を「機能 × 結果」の型付き関数に限定し、将来ほかの操作を数える場合も語彙（列挙型）の追加で済む形にした。汎用の `recordEvent(name, attrs)` は作らない（自由文字列を受け付けると 4.1 を型で守れなくなる）。
- **Build vs. Adopt**: OTel API の Counter をそのまま使う。独自の集計・永続化は作らない。
- **Simplification**: ダウンロードは成否を区別せず成功のみ記録。受信側の判定は戻り値のみで行い、`res.statusCode` を併用しない。

## Design Review Follow-up（/kiro-validate-design, 2026-11-10）

### Decision: インポートの記録は route の 1 か所に集約し、`executeImport()` は結果を返すだけにする
- **Context**: 初版の設計では、インポート 1 回分の記録が `import.ts`（executeImport 前の失敗 3 経路）と `import-executor.ts`（成功・部分失敗・例外）の 2 ファイルに分散していた。
- **Selected Approach**: `executeImport()` の戻り値を `Promise<OperationResult>` に変え、`import.ts` の受付後バックグラウンド処理で結果変数（初期値 `'failure'`）を持ち、`finally` で 1 回だけ記録する。
- **Rationale**: 失敗経路が追加されても数え漏れ・二重計上が起きにくく、1.9 をコードの構造で保証できる。お引越し送信側（route が `startTransfer()` の戻り値を見て記録）と同じ形になる。`executeImport()` のテストは記録関数のモックではなく戻り値で検証できる。

### Fix: アップロードのファイル無し（400）は数えない
- 「受付前に拒否された要求は数えない」の Decision に揃えた。失敗として数えるのは、受け取ったファイルの解析失敗とバージョン不一致のみ。
