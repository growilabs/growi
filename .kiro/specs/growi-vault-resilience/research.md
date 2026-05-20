# Gap Analysis: growi-vault-resilience

**生成日**: 2026-05-20
**対象 spec**: `.kiro/specs/growi-vault-resilience/requirements.md`（6 要件、env 3 値化済み）
**前提**: `growi-vault-gateway` / `growi-vault-manager` は cleanup 済み reference として残置

---

## 1. Analysis Summary

- **既存資産は再利用可能な土台がほぼ揃っている**: `VaultBootstrapper` (state machine + cursor resume + failure 記録 + 二重起動 guard) と `VaultDispatcher`（coalesce + bulk-upsert 経路）、`VaultMaintenanceScheduler`（5 分 tick）、`vault_sync_state` singleton は全て本 spec の責務に拡張可能な構造。
- **完全に新規が必要な領域**: drift 検出 / 補修機構（要件 4）。`grep -r "drift|reconcil|verify"` で vault feature 内に該当コードなし、green-field。
- **既存挙動の変更が必要な領域**: `vault-bootstrapper.ts` の Step 4（unconditional `reset-all` 発行）と Step 1 二重起動 guard、`vault-namespace-builder.ts` の `applyResetAll` 意味論、`config-definition.ts` の `boolean → 'true'|'false'|'force'` 型変更、`VaultInstructionOp` への新規 op 追加。
- **Admin UI は拡張前提**: 既存 `VaultAdminSettings.tsx`（5 セクション構成）にセクション追加する形で surface 可能。新規画面の独立構築は不要。
- **audit log 基盤も既存パターン流用**: `activity.ts` の `ACTION_VAULT_*` 定数 + `createActivity?.({...})` パターンに `vault.resilience.*` 系を追加する形で実装可能。

---

## 2. Requirement-to-Asset Map

凡例: ✓ = 既存資産で対応可、🔧 = 既存を改変、➕ = 新規追加、❓ = 設計判断要

### 要件 1: Bootstrap 完了状態の信頼性と起動トリガー semantics

| 受け入れ基準 | 対応資産 | ステータス | 備考 |
|---|---|---|---|
| 1.1 completeness check (processed vs estimated) | `vault-bootstrapper.ts:159-166`（estimatedDocumentCount）, `bootstrapProcessed` フィールド | 🔧 | 完了遷移直前の if-check 追加。`failed` 遷移経路 (L284) を再利用 |
| 1.2 完了時 cursor リセット | `vault-bootstrapper.ts:264-272`（Step 7 done 遷移）| 🔧 | `$set: { bootstrapCursor: null }` を 1 行追加 |
| 1.3 `true` + done → no-op | `index.ts:396-404` および bootstrapper.start() | 🔧 | start() 内の state 判定追加（または initializeVaultFeature 側でショートサーキット）|
| 1.4 `true` + pending/failed/異常 running → 自動開始 | 既存 fire-and-forget `start()` | 🔧 | 異常終了 running 検知ロジック新規 |
| 1.5 `false` → 自動開始しない | `index.ts:400`（else 分岐）| ✓ | 既に boolean false で何もしない |
| 1.6 `force` → 全 wipe + 新規 bootstrap | `vault-bootstrapper.ts` start() | 🔧+➕ | `force` 検知 → 全 wipe instruction + 既存 stream 経路 |
| 1.7 force 起動時の startup log / audit log | `activity.ts` + `createActivity` パターン | ➕ | `ACTION_VAULT_RESILIENCE_FORCE_BOOTSTRAP_START` 追加 |
| 1.8 force 完了時の強警告 | 同上 | ➕ | `ACTION_VAULT_RESILIENCE_FORCE_BOOTSTRAP_COMPLETED` + admin UI banner（要件 5.6）|
| 1.9 二重起動防止（既存）| `vault-bootstrapper.ts:113-124` | ✓ | 既存挙動を維持 |
| 1.10 admin UI 経由の done 状態からの再 bootstrap 確認手順 | `VaultAdminSettings.tsx:127-182`（"Prepare GROWI Vault" ボタン）| 🔧 | 確認ダイアログ追加 |
| 1.11 state model（過渡状態の区別）| `vault-sync-state.ts:10` `BootstrapState` 型 | 🔧 | 型拡張: `'verifying'` / `'retrying'` 等の追加要否は design 判断 |
| 1.12 `getStatus()` 観測可能 | `vault-bootstrapper.ts:295-319` | 🔧 | 既存 status に新規フィールド追加 |
| 1.13 不明値フォールバック | `config-definition.ts:555-559` | 🔧 | boolean → string enum 型変更 |

### 要件 2: Resume 意味論の再定義

| 受け入れ基準 | 対応資産 | ステータス | 備考 |
|---|---|---|---|
| 2.1 resume では reset-all 発行しない | `vault-bootstrapper.ts:171-175`（Step 4）| 🔧 | resumeCursor の有無で分岐 |
| 2.2 初回 bootstrap は全 wipe + bulk-upsert | 同上 | 🔧 | force/初回判定経路 |
| 2.3 vault-manager 側「明示的全 wipe」処理 | `vault-namespace-builder.ts:632-648` `applyResetAll` | ✓ or 🔧 | 既存 `reset-all` op の意味を保持するか、新 op に分岐するかは要件 2.5 次第 |
| 2.4 resume 続行で既存 ref を保持 | （現状 reset-all が走る = NG）| 🔧 | 2.1 の修正で自動的に成立 |
| 2.5 新規 op / 拡張型 `@growi/core` | `packages/core/src/interfaces/vault/vault-instruction.ts:2-8` | ➕❓ | 設計選択: (a) 既存 `reset-all` の意味再定義 (b) 新規 op `reset-all-explicit` 追加 (c) payload にフラグ追加 |
| 2.6 責務境界（apps/app 判定、vault-manager は op 従属）| `applyResetAll` + dispatcher の素朴な switch | ✓ | 既存パターンと整合 |

### 要件 3: 起動時自動再試行と escalation

| 受け入れ基準 | 対応資産 | ステータス | 備考 |
|---|---|---|---|
| 3.1 failed → exponential backoff 再試行 | （現状なし、fire-and-forget で握り潰し）| ➕ | 新規再試行ループ。env: `VAULT_BOOTSTRAP_RETRY_MAX` / `_BACKOFF_*` |
| 3.2 escalation 到達 → admin UI 表示 | `VaultAdminSettings.tsx` + activity events | ➕ | 状態フィールド + UI セクション |
| 3.3 異常終了 running → resume 実施 | `vault-bootstrapper.ts:113-124` 二重起動 guard | 🔧 | running 検出時に「writer instance ID」/「heartbeat timestamp」で異常終了を判別。`watcherInstanceId` パターン (vault-sync-state.ts:76) が参考になる |
| 3.4 done → 再試行しない | initializeVaultFeature の分岐 | ✓ | 既に no-op |
| 3.5 過渡状態 + getStatus に retry 情報 | `BootstrapStatus` 型 (`vault-bootstrapper.ts:30-38`) | 🔧 | フィールド追加 |
| 3.6 自動再試行抑止（env + admin UI abort）| config-definition + admin route | ➕ | env: `VAULT_BOOTSTRAP_RETRY_DISABLED`、admin route: `POST /vault/retry/abort` |
| 3.7 失敗を audit log 記録 + backoff 待機 | activity.ts | ➕ | `ACTION_VAULT_RESILIENCE_RETRY_ATTEMPT` / `_RETRY_FAILED` / `_RETRY_ESCALATED` |

### 要件 4: 自動 drift 検出と補修

| 受け入れ基準 | 対応資産 | ステータス | 備考 |
|---|---|---|---|
| 4.1 done 中の周期検出 (no O(N) scan) | `VaultMaintenanceScheduler`（5 分 tick、2 トラック構造）| ➕ on existing pattern | scheduler に 3 番目のトラックを追加。具体的検出手法は **Research Needed**（候補 4 つから選定）|
| 4.2 既存 bulk-upsert / remove 経路を再利用 | `vault-dispatcher.ts:162-193`（bulk-upsert）, `:324-341`（remove）| ✓ | dispatcher の public 関数を呼ぶか、`VaultInstruction.create({...})` 直接書き込みか design 判断 |
| 4.3 vault-manager の冪等性 / at-least-once 維持 | content-addressing + 純関数 path mapper | ✓ | 既存 op を使う限り自動成立 |
| 4.4 周期 / 範囲を env で設定可能 | scheduler の既存 env var パターン | ➕ | `VAULT_DRIFT_DETECTION_INTERVAL_MS` 等 |
| 4.5 admin UI surface | `VaultAdminSettings.tsx` | ➕ | セクション追加 |
| 4.6 event-driven sync との重複は冪等性で吸収 | vault-manager の冪等性 | ✓ | 前提が既に成立 |
| 4.7 失敗時の WARN log + 次回再試行 | scheduler 既存パターン | 🔧 | 追加 try/catch |
| 4.8 done 以外では検出しない | scheduler の guard | ➕ | `bootstrapState !== 'done'` で早期 return |

### 要件 5: Admin UI への信頼性指標 surface

| 受け入れ基準 | 対応資産 | ステータス | 備考 |
|---|---|---|---|
| 5.1 completion 信頼性指標セクション | `VaultAdminSettings.tsx:185-272` (Status) を拡張 | 🔧 | 既存 status セクションに追記 |
| 5.2 自動再試行状態セクション | 同上 | ➕ | 新規セクション |
| 5.3 drift 検出活動セクション | 同上 | ➕ | 新規セクション |
| 5.4 トリガー源表示 (`admin-ui` / `env-true` / `env-force`) | `vault_sync_state` に新規フィールド or `getStatus()` 拡張 | ➕ | 既存 `triggerSource` パラメータ（start opts）は永続化されていないため追加要 |
| 5.5 escalation 視覚的強調 | 既存 alert/warning パターン | 🔧 | reactstrap Alert で実装可 |
| 5.6 force 完了 + env=force のまま → 強警告 banner | `app:vaultBootstrapOnStart` の現値 + `lastTriggerSource` | ➕ | admin UI で両者を比較し banner 表示 |
| 5.7 `vault.resilience.*` audit log 拡張 | `activity.ts:137-139` パターン | ➕ | 複数の `ACTION_VAULT_RESILIENCE_*` 定数追加 |
| 5.8 新規 admin UI 画面を作らない | 既存 `VaultAdminSettings` への拡張のみ | ✓ | パターン維持 |

### 要件 6: 既存契約と冪等性原則の維持

| 受け入れ基準 | 対応資産 | ステータス | 備考 |
|---|---|---|---|
| 6.1 vault-manager 冪等性維持 | content-addressing | ✓ | 新 op も冪等であることを設計時に確認 |
| 6.2 at-least-once 配送 | change stream + processedAt | ✓ | dispatcher 経路を再利用すれば自動成立 |
| 6.3 VaultDispatcher 挙動不変 | vault-dispatcher.ts | ✓ | 本 spec は dispatcher を読むのみ |
| 6.4 既存 op (5 種) の挙動不変 | applyUpsert / applyBulkUpsert / applyRemove / applyRenamePrefix / applyGrantChangePrefix | ✓ | `reset-all` のみ対象 |
| 6.5 single-replica 前提 | （明示宣言）| ✓ | 設計で明記 |
| 6.6 既存 sub-spec の reference 維持 | gateway / manager spec.json `phase: implementation-complete` | ✓ | 編集禁止運用 |

---

## 3. Implementation Approach Options

### Option A: 既存ファイルへの局所改修中心（最小拡張）

**概要**: 既存 `vault-bootstrapper.ts` / `vault-namespace-builder.ts` / `VaultAdminSettings.tsx` を直接拡張。新規ファイルは drift 検出器のみ。

- **対象改修**:
  - `vault-bootstrapper.ts` に retry loop / force 判定 / completeness check を直接追加
  - `applyResetAll` の意味論を「明示的全 wipe」に限定するよう改修
  - admin UI コンポーネントに section を 3 つ追記
- **新規追加**:
  - `vault-drift-detector.ts`（要件 4 のみ。`VaultMaintenanceScheduler` に track 追加）
  - `activity.ts` への `vault.resilience.*` 定数

**Trade-offs**:
- ✅ ファイル数最小、PR diff の集中
- ✅ 既存パターンを完全踏襲
- ❌ `vault-bootstrapper.ts` が肥大化（現在 329 行 → 600 行超予想、coding-style.md の 800 行制限に接近）
- ❌ 単一ファイルに retry / force / completeness の 3 関心が同居して責務不明瞭

### Option B: 責務別の新規モジュール分離（推奨）

**概要**: bootstrapper を facade として残し、内部を 4 つのサブモジュールに分割。drift 検出も独立サービス。

- **新規モジュール構成**:
  ```
  apps/app/src/features/growi-vault/server/services/resilience/
  ├── index.ts                          ← barrel（外部公開は createVaultResilienceLayer のみ）
  ├── bootstrap-state-machine.ts        ← 要件 1.6/1.11 状態遷移
  ├── bootstrap-trigger-resolver.ts     ← 要件 1.3-1.8 env semantics + 二重起動
  ├── bootstrap-completeness-verifier.ts ← 要件 1.1 検証
  ├── bootstrap-retry-runner.ts         ← 要件 3 再試行ループ + escalation
  └── drift-detector.ts                 ← 要件 4 検出 + 補修発行
  ```
- **改修**: `vault-bootstrapper.ts` は薄い orchestrator として残し、上記モジュールに delegate
- **vault-manager 側**: `applyResetAll` の意味論変更 or 新 op handler 追加（要件 2.5 の設計次第）

**Trade-offs**:
- ✅ coding-style.md の「一責任 = 一ファイル」「200-400 行典型」に整合
- ✅ 各サブモジュールの単体テストが容易（DI で既存 spec パターンに乗る）
- ✅ 将来の拡張（マルチレプリカ対応など）でも責務境界が明確
- ❌ ファイル数増加、初期コードレビューの認知負荷増
- ❌ サブモジュール間の interface 設計に時間が必要

### Option C: ハイブリッド（段階的移行）

**概要**: 要件をフェーズに分割し、Phase 1 で minimum viable changes、Phase 2 で構造改善。

- **Phase 1（必須機能）**:
  - `vault-bootstrapper.ts` に局所改修（force semantics、completeness check、retry loop）
  - `drift-detector.ts` のみ新規（独立性が高い）
  - admin UI セクション追加
- **Phase 2（構造リファクタ）**:
  - `vault-bootstrapper.ts` 内部を Option B 構造に分解
  - 既存 spec へのリダイレクト追記
- **段階分割**:
  - Phase 1 PR で機能を出荷
  - Phase 2 PR で構造改善（feature flag 不要、純粋リファクタ）

**Trade-offs**:
- ✅ 早期出荷可能、リスク分散
- ✅ 構造改善は機能完成後に冷静に判断
- ❌ Phase 1 で `vault-bootstrapper.ts` が一時的に肥大化
- ❌ 2 段 PR は merge 順序の調整が必要

---

## 4. Effort & Risk Assessment

| 要件 | Effort | Risk | 根拠 |
|---|---|---|---|
| **要件 1**（state machine + env 3 値）| M | Medium | 既存 state machine の挙動変更 + config 型変更（boolean → string enum）+ admin UI 確認ダイアログ。retry の異常終了 running 判定（要件 3.3）と密結合 |
| **要件 2**（resume 意味論）| S–M | Medium | 局所改修だが op 設計（既存再定義 vs 新 op）の選択が必要。@growi/core への変更は consumer 影響が小さい（gateway / manager のみ） |
| **要件 3**（自動再試行）| M | Medium | 新規 retry loop + 異常終了 running 検出（heartbeat / watcherInstanceId 風）が肝。escalation UI も新規 |
| **要件 4**（drift 検出 + 補修）| L | **High** | green-field。検出手法 4 候補（completion-only / watermark / hash-based / heuristic）の選定と benchmark が design phase の中心議題。誤検出のリスク管理も必要 |
| **要件 5**（admin UI）| S–M | Low | 既存パターン踏襲、新規 API route 数本 + UI section 追加のみ |
| **要件 6**（契約維持）| S | Low | 既存契約を破らない確認のみ。新 op が冪等であるかの test を充実させればよい |

**総合**: M～L、Risk Medium。drift 検出（要件 4）が単独で High だが、要件 1-3 と独立に進行可能。

---

## 5. Research Needed (design phase で深掘り)

1. **drift 検出手法の選定**（要件 4）— brief.md 候補 4 つの比較評価:
   - **completion verification only**: bootstrap 完了直後の 1 回限り検証。drift 経時発生には無力
   - **watermark-based incremental sweep**: 最新の `updatedAt` 以降を周期スキャン。O(変更頻度) で軽量だが「sync ロストで watermark を超えて drift」を取りこぼす
   - **hash-based namespace integrity**: namespace ごとの tree hash を MongoDB 側で集計し vault-manager の commit OID と比較。検出率高いが集計コストが namespace 数依存
   - **heuristic surveillance**: ランダムサンプリング検証 + 異常パターン検知。実装軽量だが誤検出 / 取りこぼしのバランス調整が難しい
   - 評価軸: 検出率 / 周期 overhead / 実装複雑度 / 誤検出時の影響 / 補修 instruction 量

2. **「明示的全 wipe」op の設計**（要件 2.5）— 3 案:
   - (a) 既存 `reset-all` op の意味を「明示的全 wipe」に再定義し、resume 系は op を発行しない
   - (b) 新規 op `reset-all-explicit` を追加、既存 `reset-all` を廃止（後方互換: in-flight instructions の扱い）
   - (c) 既存 `reset-all` の payload に `{ mode: 'wipe' | 'noop' }` を追加（型は最小拡張、意味分岐は payload）

3. **異常終了 `running` 検知の仕組み**（要件 3.3）— 候補:
   - **heartbeat / writer instance ID**: vault-manager の `watcherInstanceId` パターン（vault-sync-state.ts:76）を bootstrapper にも適用。起動時に instance ID 不一致なら異常終了とみなす
   - **lease + TTL**: `bootstrapState: 'running'` に `leaseExpiresAt` を持たせ、TTL 超過なら異常終了
   - **シンプル時刻判定**: `bootstrapStartedAt` から N 時間経過 + プロセス起動なら自動 resume

4. **過渡状態の状態モデル粒度**（要件 1.11）— 現状 4 値 (`pending` / `running` / `done` / `failed`)。新規追加候補:
   - `'verifying'`: completeness check 中（done と running の中間）
   - `'retrying'`: 自動再試行中（failed と running の中間）
   - `'escalated'`: 再試行上限到達（failed の進化）
   - vs. 既存 4 値を維持しサブステータスを別フィールドで管理（型変更影響を最小化）

5. **config-definition.ts の型変更影響**（要件 1.13）— `boolean → 'true' | 'false' | 'force'` への変更が他の consumer や migration に与える影響範囲（grep の限り `app:vaultBootstrapOnStart` の consumer は `index.ts:396` の 1 箇所のみ → 影響軽微）

6. **drift 補修 instruction 経路の選択**（要件 4.2）— dispatcher の public 関数を呼ぶか、直接 `VaultInstruction.create({...})` するか。dispatcher は coalesce 等の副作用を持つため、補修用に bypass 経路が必要かは design 判断

---

## 6. Recommendations for Design Phase

### Preferred Approach: **Option B（責務別新規モジュール分離）**

**根拠**:
- 本 spec は 5 つの直交する関心（state machine / resume / retry / drift / surface）を扱い、Option A では `vault-bootstrapper.ts` が肥大化（coding-style.md の cohesion 原則に反する）
- 各サブモジュールが独立テスト可能で、既存 `.spec.ts` パターンに乗る
- drift 検出は green-field のため、独立サービスとして切り出すのが最も自然
- 将来のマルチレプリカ対応 spec（roadmap.md "Future"）で state machine と retry を共通基盤として再利用しやすい

ただし、**着手順序は Option C のフェーズ感覚を取り入れる**:
- Phase 1: bootstrap-trigger-resolver + completeness-verifier + admin UI（要件 1 / 5 の core）
- Phase 2: bootstrap-retry-runner（要件 3）
- Phase 3: drift-detector（要件 4）— 最も独立度が高く、benchmark 必要
- 各 phase は内部的に PR を分割しても良いが、cleanup 済み既存 spec への redirect 追記は最終 phase で 1 回のみ

### Key Decisions to Make in Design Phase

1. drift 検出手法の選定（4 候補から）
2. `reset-all` op の意味論再定義 vs 新規 op 追加
3. 異常終了 `running` 検知の仕組み（heartbeat vs TTL vs 時刻判定）
4. 過渡状態の状態モデル粒度（型追加 vs サブステータス別フィールド）
5. drift 補修 instruction 発行経路（dispatcher 経由 vs 直接書き込み）

### Research Items to Carry Forward

- 上記 "Research Needed" の 6 項目を design phase で深掘り
- とくに drift 検出は POC 的に 2-3 候補を mock 実装で比較できると design 判断が固まりやすい
- vault-manager 側の applyResetAll 改修コストは小さい（17 行関数）が、test 整備（namespace-builder.spec.ts）は新 op 増加に応じて拡充必要

---

## Appendix: 主要既存ファイル一覧

| 改修 / 拡張対象 | path | 規模 |
|---|---|---|
| Bootstrap orchestrator | [apps/app/src/features/growi-vault/server/services/vault-bootstrapper.ts](../../../apps/app/src/features/growi-vault/server/services/vault-bootstrapper.ts) | 329 行 |
| Sync state model | [apps/app/src/features/growi-vault/server/models/vault-sync-state.ts](../../../apps/app/src/features/growi-vault/server/models/vault-sync-state.ts) | 130 行 |
| Dispatcher (再利用元) | [apps/app/src/features/growi-vault/server/services/vault-dispatcher.ts](../../../apps/app/src/features/growi-vault/server/services/vault-dispatcher.ts) | 450 行 |
| Feature bootstrap init | [apps/app/src/features/growi-vault/server/index.ts](../../../apps/app/src/features/growi-vault/server/index.ts) | env 判定箇所 L396-404 |
| Config definition | [apps/app/src/server/service/config-manager/config-definition.ts](../../../apps/app/src/server/service/config-manager/config-definition.ts) | L555-559 (boolean) |
| VaultInstructionOp 型 | [packages/core/src/interfaces/vault/vault-instruction.ts](../../../packages/core/src/interfaces/vault/vault-instruction.ts) | L2-8 |
| applyResetAll | [apps/growi-vault-manager/src/services/vault-namespace-builder.ts](../../../apps/growi-vault-manager/src/services/vault-namespace-builder.ts) | L632-648 (17 行) |
| MaintenanceScheduler (拡張パターン) | [apps/growi-vault-manager/src/services/vault-maintenance-scheduler.ts](../../../apps/growi-vault-manager/src/services/vault-maintenance-scheduler.ts) | 5 分 tick、2 トラック |
| Admin UI | [apps/app/src/features/growi-vault/client/admin/VaultAdminSettings.tsx](../../../apps/app/src/features/growi-vault/client/admin/VaultAdminSettings.tsx) | 5 セクション |
| Activity actions | [apps/app/src/interfaces/activity.ts](../../../apps/app/src/interfaces/activity.ts) | `ACTION_VAULT_*` パターン |

---

# Design Synthesis（2026-05-20 design phase 追記）

## 1. Generalization

5 つの要件領域（state machine / resume / retry / drift / surface）は **「lifecycle 内の system-triggered correctness 保証」** という共通抽象を持つ。具体化:

- **状態機械（Bootstrap 系）と周期検証器（Drift 系）の二項構造** に落とし込むと、要件 1-3 が前者、要件 4 が後者、要件 5 が両者の surface に綺麗に分かれる。
- Retry も「state machine の遷移イベントの 1 つ」として表現できる（`failed → retrying → running` の遷移）。独立 retry loop モジュールは保持するが、retry 状態自体は state machine の一部。
- Force / 暗黙トリガーは「state machine の `start` イベントの triggerSource バリアント」として 1 つのイベント型に統合できる。

## 2. Build vs Adopt

| 対象 | 決定 | 根拠 |
|------|------|------|
| State machine library（XState 等）| **Build (純関数)** | 7 状態 + ~10 イベントで XState はオーバースペック。discriminated union + pure `transition()` で testability 十分 |
| Exponential backoff library | **Build (純関数)** | `min(maxMs, baseMs * 2 ** attempt) + jitter` を inline 実装。依存追加コストの方が大きい |
| Heartbeat / lease pattern | **Adopt (既存 watcherInstanceId パターン)** | vault-manager `vault-sync-state.ts:76` の pattern を bootstrapper にも対称適用 |
| Periodic scheduler | **Adopt (setInterval パターン)** | vault-manager の `VaultMaintenanceScheduler` 5 分 tick と同じパターンを apps/app 側で独立実装。共通基盤を作るのは早計 |
| Audit log | **Adopt (既存 ACTION_VAULT_* パターン)** | `interfaces/activity.ts` に `ACTION_VAULT_RESILIENCE_*` を並べる |
| Drift detection algorithm | **Build (watermark-based)** | 4 候補（completion-only / watermark / hash-based / heuristic）から選定。詳細は §3 |

## 3. Key Decisions (research.md §5 の Research Needed への回答)

### 3.1 Drift 検出手法 — Watermark-based incremental sweep を採用

| 候補 | 評価 | 採否 |
|------|------|------|
| completion verification only | bootstrap 完了直後の 1 回限り。経時 drift に無力 | ✗（要件 4.1 を満たさない）|
| **watermark-based incremental sweep** | `pages.updatedAt > driftLastWatermark` で増分 sweep。O(変更頻度) で軽量 | **✓ 採用** |
| hash-based namespace integrity | MongoDB と vault-manager 両側で hash 集計。検出率高いが namespace 数依存の重さ | ✗（複雑度過剰、benchmark 困難）|
| heuristic surveillance | ランダムサンプリング + 異常パターン。実装軽量だが誤検出 / 取りこぼしのバランス調整が困難 | ✗（決定論性不足）|

採用理由: GROWI の `pages.updatedAt` という既存フィールドを直接 watermark にできる。実装が単純で、O(変更頻度) のため大規模インスタンスでも overhead が予測可能。冪等性により重複は無害（要件 4.6）。

### 3.2 `reset-all` op の意味論 — **既存 op を再利用、emit タイミングのみ変更**

3 案（既存再定義 / 新 op 追加 / payload フラグ）から **既存 op の再利用** を選択:

- `applyResetAll` の動作（全 namespace ref + state doc 削除）は意味的に「明示的全 wipe」そのもの → 改変不要
- apps/app 側で `reset-all` を発行するタイミングを「初回 bootstrap + force のみ」に限定 → resume では発行しない
- `VaultInstructionOp` 型を変えない → `@growi/core` の breaking change なし、vault-manager の冪等性契約も完全維持
- 要件 2.5 が許容する「op 再定義」ルートに該当

却下案:
- (b) 新 op `reset-all-explicit`: in-flight instruction の扱いが煩雑、@growi/core 改変必要
- (c) payload `{ mode: 'wipe' | 'noop' }`: `noop` モードを vault-manager が受信する意味が薄い

### 3.3 異常終了 `running` 検知 — **Heartbeat + instanceId**

3 候補（heartbeat / lease+TTL / 時刻判定）から **heartbeat + instanceId** を選択:

- vault-manager の `watcherInstanceId` パターン（既存）を bootstrapper にも対称適用 → 学習コスト最小
- `bootstrapInstanceId` (UUID) + `bootstrapHeartbeatAt` (Date) の 2 フィールド追加で実現
- 起動時に `instanceId` が変わっていれば前回 crash 確定、`heartbeatAt` が `staleMs` 以上古ければ stale running 確定
- TTL 単独より単純（lease の renewal タイミング不要）、時刻判定単独より誤検知が少ない

### 3.4 状態モデル粒度 — **`BootstrapState` を 4 → 7 値に拡張**

`pending / running / verifying / done / failed / retrying / escalated` の 7 値。

- 独立フィールドで sub-status を持たせる案より、単一 union の方が discriminated union として TypeScript の型推論が効く
- `verifying` を独立させることで「processed === estimated 未確認の中間状態」を構造的に表現（要件 1.11）
- `retrying` / `escalated` を独立させることで admin UI の表示が単純化（要件 3.5、5.2）
- Schema enum 拡張は既存 doc の default 値補完で自然に migration（明示 script 不要）

### 3.5 Drift 補修 instruction 発行経路 — **直接 `VaultInstruction.create` (dispatcher bypass)**

2 候補（dispatcher 経由 / 直接書き込み）から **直接書き込み** を選択:

- `VaultDispatcher` は PageService event の coalesce が責務 → ad-hoc な repair を流すと coalesce 統計が汚染される
- DriftDetector は既存 op (`bulk-upsert` / `remove`) を直接 `VaultInstruction.create({...})` で発行 → vault-manager 側は change stream で受け取り、既存処理経路で冪等に適用
- dispatcher の挙動は要件 6.3 で不変保証 → bypass が責務境界として正しい

## 4. Simplification

検討段階で考えた構造から以下を削減:

| 削減対象 | 理由 |
|----------|------|
| `bootstrap-completeness-verifier.ts` 独立モジュール | check は「processed vs estimated」の 1 比較のみ。`BootstrapRunner` 内に inline する方が cohesive |
| `resilience/activity-actions.ts` | 既存 `interfaces/activity.ts` の `ACTION_VAULT_*` パターンに揃える方が一貫性高い |
| 共通 `PeriodicScheduler` 抽象 | vault-manager の `VaultMaintenanceScheduler` と apps/app の `DriftDetector` は独立で十分。共通基盤化は早計（YAGNI）|
| State machine の sub-status field（status + retryCount を 2 フィールドに分ける案）| union 拡張で 1 フィールドに収めた方が型整合 |
| 新規 `VaultInstructionOp` 追加 | 既存 `reset-all` の emit タイミング変更だけで要件 2 を満たす |

## 5. Boundary Decisions

- 本 spec は **apps/app 内のみで完結**。vault-manager / @growi/core への変更なし。
- 既存 sub-spec（gateway / manager）は cleanup 済み reference として編集禁止 → 本 spec が置き換え設計を提示。実装完了時に gateway Req 5 / manager Req 2.6 へ 1 行の redirect 追記のみ。
- 公開 interface `VaultBootstrapper` および factory `createVaultBootstrapper(...)` は維持 → 既存 consumer（admin route、index.ts）は変更不要。

## 6. Open Questions Carried to Implementation

- Heartbeat 周期（10s）と stale 閾値（60s）が GROWI Cloud の運用負荷で妥当か → Prometheus 統合後に再評価
- `VAULT_DRIFT_MAX_PAGES_PER_TICK` のデフォルト 10,000 が大規模インスタンス（50,000+ ページ）で適切か → 運用フィードバック待ち
- デプロイ初回起動で既存 `running` doc に対する stale 検知が偽陽性となるリスク → `bootstrapInstanceId === null` の場合は migration として skip する初期化分岐を runner に持たせる（design §Open Questions / Risks に明記済み）

