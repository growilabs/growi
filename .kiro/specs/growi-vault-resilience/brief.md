# Brief: growi-vault-resilience

## Problem

GROWI Vault の現行 bootstrap 機構は「完了状態の信頼性」を保証しておらず、運用者が「Vault は本当に最新か」を信頼できない状態を生んでいる。

- `bootstrapState: 'done'` でも `bootstrapCursor` が前回最終ページ ID のまま残るため、`VAULT_BOOTSTRAP_ON_START=true` をつけっぱなしで再起動すると reset-all で既存データを全消去するリスク（→ vault が空になる事故）
- 二重起動ガードが `running` 状態しかブロックしないため、`done` / `failed` / `pending` での再 `start()` が全て新規実行扱いになる
- Resume 動作で `reset-all` instruction を無条件発行するため、resume cursor 以前のページが永久に欠落する可能性
- 失敗は `fire-and-forget` で握り潰され、起動時に自動再試行する仕組みが無い
- `bootstrapState: 'done'` の意味は「cursor 走査が終わった」だけで、実体（vault tree）の完全性は保証されない
- drift（MongoDB の `pages` と vault tree の乖離）が発生しても検出する仕組みが無く、event-driven sync の取りこぼしや dead-letter 化した instruction は永久に同期されない
- `VaultMaintenanceScheduler` は squash と git gc のみで、reconciliation を担わない

これらは「初回 bootstrap が一度成功すれば後は永続的に正しい」という暗黙の前提に依存しており、実運用での障害耐性が低い。

## Current State

- gateway spec の Req 5 が現行 bootstrap を、manager spec の Req 2.6 が `reset-all` op の現行挙動を定義
- 実装本体: [vault-bootstrapper.ts](../../../apps/app/src/features/growi-vault/server/services/vault-bootstrapper.ts) と [vault-namespace-builder.ts](../../../apps/growi-vault-manager/src/services/vault-namespace-builder.ts) の `applyResetAll`
- 5 つの構造的欠陥が両 sub-spec の Implementation Notes に記録済み（refactor 動機の出典）
- 補修機構は皆無（dead-letter ログは出るが instruction は queue に残ったまま）
- 両 sub-spec は `/kiro-spec-cleanup` 済みで `phase: implementation-complete` として固定化されている

## Desired Outcome

- `bootstrapState: 'done'` が「state machine 完了」かつ「実体としての完全性が確認済み」を意味する
- 失敗時に明示的な `failed` 状態で停留せず、有界な自動再試行 / 自動補修が走る
- `VAULT_BOOTSTRAP_ON_START=true` を env につけっぱなしにしても安全（再起動で既存データを破壊しない）
- Resume が「中断点からの本当の続行」として機能する（reset-all を無条件発行しない）
- drift が発生した場合に system が検出して自動補修する（具体設計は design 段階で決定、ただし overhead 最小の設計を採る）
- Admin UI に「完了状態の信頼性指標」「自動補修の活動状況」が surface される

## Approach

「誰がトリガーするか」を境界として、**system-triggered correctness 保証**を本 spec の責務とする。具体的には:

1. **Bootstrap state machine の再設計** — apps/app 側の `VaultBootstrapper` を中心に、過渡状態を明示した state 遷移、完了時の不変条件、resume 意味論を作り直す
2. **`reset-all` op の意味論再定義** — vault-manager 側の `applyResetAll` を「明示的に全 wipe する初回 bootstrap」と「resume での 何も wipe しない続行」に分離。必要なら新規 op を追加
3. **起動時自動再試行** — `failed` 状態で起動した apps/app が有界な exponential backoff で resume を試み、明示的限界に達したら admin UI に escalate
4. **完了の completeness 軽量検証** — `processed === estimatedDocumentCount` 程度のチェックを完了遷移時に必須化
5. **自動 drift 検出と補修** — 設計詳細は design 段階で決定。候補は 4 つ（completion verification only / watermark-based incremental sweep / hash-based namespace integrity / heuristic surveillance）。いずれも O(N) 全件 scan を避け、補修トリガは既存 instruction 経路（bulk-upsert）を再利用する方針

User-triggered な手動 targeted reconcile（PageTree / GrowiContextualSubNavigation / admin UI からの「このパス配下を再同期」操作）は **gateway 既存 spec の拡張**として別途扱う（roadmap.md 参照）。本 spec は trigger しない。

実装は両 sub-spec のファイル（`vault-bootstrapper.ts`、`vault-namespace-builder.ts`、新規 reconciliation 関連サービス）を修正するが、設計の所有は本 spec が持つ。実装完了時に既存 spec へリダイレクト記述を 1 行追記する形で閉じる。

## Scope

- **In**:
  - Bootstrap state machine の再設計（完了時 cursor reset、ガード強化、resume 意味論、過渡状態の明示）
  - `reset-all` op の意味論再定義 or partial reset 系 op の新設
  - 起動時の自動再試行（有界 exponential backoff、escalation 経路）
  - Bootstrap 完了の completeness check（軽量検証 + admin への surface）
  - 自動 drift 検出と補修機構（具体設計は design 段階。候補 4 つから選定）
  - `vault_sync_state` schema 拡張（必要なら）
  - System-triggered な correctness 保証のための新規 instruction op（必要なら）
  - Admin UI への「completion 信頼性指標」「自動補修活動」surface

- **Out**:
  - User-triggered な手動 targeted reconcile（gateway 既存 spec 拡張）
  - PageTree / GrowiContextualSubNavigation からの reconcile UI（同上）
  - マルチレプリカ対応（leader election、writer 単一化の物理保証）
  - Squash / GC 戦略の変更
  - 既存 change stream watcher / dispatcher の挙動変更（前提として維持）
  - PAT 認証 / ACL 評価のロジック変更

## Boundary Candidates

- **Bootstrap state machine 境界**（apps/app 側）: 状態列の定義と遷移、不変条件、永続化（`vault_sync_state`）
- **`reset-all` / partial reset op の意味論境界**（vault-manager 側）: 既存 op を再定義するか、新 op を追加するか
- **起動時自動再試行境界**（apps/app 側）: retry 戦略、limit、escalation
- **Completion verification 境界**（apps/app 側）: 「真の done」を定義する軽量 check
- **自動 drift 検出機構の境界**（apps/app or vault-manager、設計次第）: 何をどの周期でどう検出するか
- **自動補修 dispatch 境界**: drift から補修 instruction への変換（既存 dispatcher の経路を再利用するか）
- **Admin UI surface 境界**: state model と activity の可視化

## Out of Boundary

- User-triggered な reconcile（PageTree / SubNavigation / admin の手動操作）→ gateway 既存 spec
- イベント駆動 incremental sync（`VaultDispatcher`）→ gateway 既存 spec
- Change stream watcher の resume token 管理 → vault-manager 既存 spec
- vault-manager の view compose / git protocol / squash / gc → vault-manager 既存 spec
- マルチレプリカ runtime model

## Upstream / Downstream

- **Upstream**（前提として依存）:
  - `growi-vault-gateway`: Req 4（`VaultDispatcher`）、Req 5（`VaultBootstrapper` 現行）、Req 7（settings）、Req 8（admin UI 基盤）
  - `growi-vault-manager`: Req 1（`VaultInstructionWatcher`）、Req 2.1-2.7（各 op 処理）、Req 6（`MaintenanceScheduler`）、Req 9（`VaultRepoStorage`）
  - 両 sub-spec の Implementation Notes（refactor 動機の出典）
  - `@growi/core` の Vault DTO 型（`VaultInstructionOp` 等、新規 op 追加時に拡張対象となる可能性）

- **Downstream**（本 spec 完了後に依存する想定）:
  - `growi-vault-gateway` 拡張（user-triggered reconcile）: 本 spec の bootstrap state model と整合させる必要
  - 将来のマルチレプリカ spec: 本 spec の state machine が前提

## Existing Spec Touchpoints

- **Extends（再設計対象、historical record として既存を残す）**:
  - `growi-vault-gateway`: Req 5 全体（bootstrap state machine、cursor 管理、resume 意味論、failure handling）
  - `growi-vault-manager`: Req 2.6（`reset-all` op の挙動）

- **Adjacent（変更しない、前提として依存）**:
  - `growi-vault-gateway`: Req 1（git smart HTTP）、Req 2（PAT 認証）、Req 3（namespace 計算）、Req 4（dispatcher）、Req 6（compose-view RPC）、Req 7（settings）、Req 8（admin UI 基盤）、Req 9（DTO 型）、Req 10（エラー / セキュリティ）
  - `growi-vault-manager`: Req 1（watcher）、Req 2.1-2.5 と Req 2.7-2.8（reset-all 以外の各 op）、Req 3（path mapper）、Req 4（view composer）、Req 5（upload-pack）、Req 6（squash/gc）、Req 7（shared secret）、Req 8（health）、Req 9（repo storage）、Req 10（skeleton）、Req 11（storage stats）

- **Adjacent（並行開発）**:
  - `growi-vault-gateway` の user-triggered reconcile 拡張（roadmap.md の "Existing Spec Updates" 参照）

## Constraints

- **既存 sub-spec の reference 性維持**: `growi-vault-gateway` / `growi-vault-manager` は cleanup 済みのため再編集を避ける。新 spec が置き換え設計を提示し、実装完了時にリダイレクト記述を 1 行追記する程度に留める。
- **冪等性原則の維持**: vault-manager の冪等性（content-addressing + 純関数 path mapper）は崩さない。新規 op を導入する場合も同じ性質を満たすこと。
- **Incremental sync 互換**: 既存の PageService event-driven sync を破壊しない。本 spec の自動補修は incremental sync の上に重なる safety net として機能すること。
- **VAULT_BOOTSTRAP_ON_START の安全化**: env をつけっぱなしで再起動しても vault データが破壊されないこと（done 状態で再起動しても reset-all が走らないこと）。
- **自動 drift 検出の overhead 最小化**: O(N) 全件 scan は避ける。design 段階で軽量な候補（completion verification only / watermark-based incremental sweep / hash-based namespace integrity / heuristic surveillance）を比較評価し選定する。
- **At-least-once 配送**: vault-manager 側の at-least-once 配送保証を破らない。新規 op も冪等であること。
- **MVP では single-replica 前提**: 本 spec の解決対象は single-replica 運用下での resilience。マルチレプリカ対応は別 spec で扱う。
- **既存 admin UI 基盤の流用**: 新規 surface は admin UI（`/admin/vault`）に追加する形を採り、新規 UI を独立に作らない。
