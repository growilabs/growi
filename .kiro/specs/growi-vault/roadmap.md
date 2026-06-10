# growi-vault Sub-spec Roadmap

> 本ファイルは umbrella spec `growi-vault` 内の sub-spec 進行管理。リポジトリ全体の roadmap は `.kiro/steering/roadmap.md`（現在 stub）を参照すること。

## Overview

GROWI Vault の bootstrap / 同期機構を「真にレジリエント」にする改修ロードマップ。現状の `VaultBootstrapper` は完了状態の信頼性が低く（cursor リセット欠如、reset-all 毎回発行、fire-and-forget な失敗処理、二重起動ガードの不備）、また drift（MongoDB の `pages` と vault tree の乖離）を検出する仕組みが存在しない。これらを解消するため、システム側の自動 correctness 保証（`growi-vault-resilience`）と、admin および一般ユーザーが任意のサブツリーを再同期できる手動 reconcile（`growi-vault-reconcile`）を組み合わせ、さらに本番運用の HA / scaling 要件を満たすため vault-manager の多重化（`growi-vault-ha`）を後続で扱う。

cleanup 済みの両 sub-spec（gateway / manager）は historical record として保ち、新 spec が置き換え設計を提示する形を採る。`growi-vault-resilience`（完了 2026-05-21）と `growi-vault-reconcile`（完了 2026-05-22）で同 pattern の有効性が連続して確認されたため、残る `growi-vault-ha` も同 pattern（新 spec 切り出し + 既存は historical record + 関連 Implementation Notes への 1 行追記）で進める。

## Approach Decision

- **Chosen**: 「誰がトリガーするか」を境界として、system-triggered correctness（resilient bootstrap state machine + auto drift 検出と補修）と user-triggered reconcile（admin UI + PageTree + GrowiContextualSubNavigation からの reconcile）をそれぞれ独立 spec とする。両者は `vault_instructions` outbox 経路と vault-manager の冪等性契約を共有し、cleanup 済みの `growi-vault-gateway` の PAT 認証 + ACL 評価 interface を依存として再利用する。
- **Why**: 機能の重さで切るより、トリガー源で切る方が責務の所在が明確。cleanup 済み reference spec を再編集して HOW を混在させるより、新 spec で置き換え設計を提示する pattern のほうが reference 性を保てる（resilience で実証済み）。flat な命名（`growi-vault-{gateway,manager,resilience,reconcile}`）で responsibility map が並列に見え、各 spec が 8-15 tasks 程度の粒度に揃う。
- **Rejected alternatives**:
  - 既存 gateway spec に reconcile Req を追記する案: cleanup したばかりの reference 性を損なう（HOW trim 済み本文と新規 HOW が混在）。
  - resilient bootstrap と reconciliation を 2 spec に分解する案: 同じ MongoDB collection（`vault_sync_state`、`vault_instructions`）を扱う設計を分けると owner 境界が複雑になる → ただし resilience 完了で `vault_instructions` への write owner が確立したため、reconcile は「outbox 経路を相乗りする consumer」として境界を引き直せる。
  - 自動 drift 検出を out of scope にする案: 完了状態の信頼性は resilience の本質なので新 spec の責務として含めるべき（具体設計は design 段階で軽量化）。
  - 機能の重さで境界を切る案: 境界が「実装規模」で曖昧になる。

## Scope

- **In**:
  - Resilient bootstrap state machine（restart-safe、completion idempotent、自動再開）— `growi-vault-resilience` 完了
  - 自動 drift 検出と補修（watermark-based incremental sweep を採用）— `growi-vault-resilience` 完了
  - User-triggered targeted reconcile（admin + 一般ユーザー、ACL-scoped、PageTree / GrowiContextualSubNavigation / admin UI 統合）— `growi-vault-reconcile`
  - vault-manager の冗長化（HA）と change stream 取りこぼし防止 — `growi-vault-ha`（future）

- **Out**:
  - 双方向同期 / git → MongoDB push（vault は read-only 公開面のまま）
  - Squash / GC 戦略の変更
  - 既存の change stream watcher / dispatcher の挙動変更（前提として依存）
  - PAT 認証 / ACL 評価ロジック自体の変更（既存 GROWI Page ACL / `growi-vault-gateway` を使用）
  - 新規 instruction op の追加（既存 `bulk-upsert` / `remove` / `reset-all` 等を再利用）

## Constraints

- **既存 sub-spec の reference 性維持**: `growi-vault-gateway` と `growi-vault-manager` は cleanup 済みのため historical record として残し、新 spec が置き換え設計を提示する。実装完了時に既存 spec へリダイレクト記述を 1 行追記する程度に留める。
- **冪等性原則の維持**: vault-manager の冪等性（git object の content-addressing + `VaultPathMapper` の純関数性）は崩さない。新規 op を導入する場合も同じ性質を満たす必要がある。
- **Incremental sync 互換**: 既存の PageService event-driven sync（`VaultDispatcher`）は前提として維持。新 spec はその上に correctness 保証を重ねる。
- **VAULT_BOOTSTRAP_ON_START の安全化**: env をつけっぱなしで再起動しても vault データが破壊されないこと。
- **自動 drift 検出の overhead 最小化**: O(N) 全件 scan は避ける。design 段階で軽量な候補を評価する。

## Boundary Strategy

- **Why this split**:
  - System-triggered（自動）と user-triggered（手動）は trigger 源と auth 要件が異なるため、独立 spec として切り出す（responsibility map が clean）。
  - cleanup 済み reference spec（`growi-vault-gateway` / `growi-vault-manager`）は historical record として保全し、新 spec が置き換え設計を提示する pattern を採用（resilience で実証済み）。
  - flat 命名（`growi-vault-{gateway,manager,resilience,reconcile,ha}`）で各 spec の責務が並列に見え、navigation コストが低い。
  - 各 spec は `vault_instructions` outbox + 既存 instruction op を共有経路として、新規 op を増やさず冪等性契約を維持する。

- **Shared seams to watch**:
  - `growi-vault-reconcile` の user-triggered 経路 ↔ `growi-vault-resilience` の自動補修経路: 同じ `vault_instructions` outbox を共有するため、冪等性に委ねた競合許容方針を両 spec で明示する必要あり
  - `growi-vault-reconcile` の ACL 評価 ↔ `growi-vault-gateway` の既存 ACL 評価: gateway の interface を再利用する形を design 段階で明示
  - `growi-vault-ha` 適用後の reconcile 動作 ↔ multi-replica 環境での lease / claim: reconcile 操作の serialize 要件を ha spec の scope に含める

## Specs (dependency order)

- [x] growi-vault-resilience -- resilient bootstrap state machine + 軽量 drift 検出（system-triggered correctness）。Dependencies: none（cleanup 済みの両 sub-spec を前提として依存）。Status: 2026-05-21 `/kiro-validate-impl` GO（全 14 タスク完了、resilience-flow integ 含む 338 tests pass、要件 50/50 COVERED）
- [x] growi-vault-reconcile -- user-triggered targeted reconcile（admin + 一般ユーザー、ACL-scoped、PageTree / GrowiContextualSubNavigation / admin UI 統合）。既存 `growi-vault-gateway` の PAT/ACL interface を依存として再利用し、`vault_instructions` 経路に相乗りする独立 spec。Dependencies: growi-vault-resilience（instruction 経路 / 冪等性契約 / state machine の前提を共有）。Status: 2026-05-22 `/kiro-validate-impl` GO + `/kiro-spec-cleanup` 完了（全 22 leaf タスク完了、vitest 247 pass + Playwright E2E 4 pass on chromium、要件 7/7 COVERED、phase=implementation-complete）
- [ ] growi-vault-ha -- vault-manager の冗長化（Competing Consumers + per-namespace lease）と change stream 取りこぼしの構造的排除。Dependencies: growi-vault-resilience（heartbeat / instanceId primitive を共有）、growi-vault-reconcile（multi-replica 環境での reconcile lease / claim を ha scope に含めるか要検討）。Status: 2026-05-22 brief drafted（`.kiro/specs/growi-vault-ha/brief.md`）、requirements 以降は未着手

---

## Future Spec Details

詳細は各 spec の `brief.md` を一次情報源とする。本ロードマップでは方向性と境界の概観のみ保持し、設計の詳細は brief / requirements / design 側で進化させる。

### growi-vault-ha

- **目的**: vault-manager の単一インスタンス前提を解消し、長時間停止 / change stream resume token 失効による instruction 取りこぼしを構造的に排除する。これにより `growi-vault-resilience` の drift detection は「observability 主、最小補修副」に縮小可能となる。
- **Design direction**: Competing Consumers + per-namespace lease（同一 image / config の N replica + `vault_instructions` への atomic claim + `namespace_leases` collection で `.git/index.lock` race を回避、failover は per-instruction TTL の秒オーダー）。
- **Brief**: [.kiro/specs/growi-vault-ha/brief.md](../growi-vault-ha/brief.md) — Problem / Current State / Desired Outcome / Approach / Scope / Boundary Candidates / Out of Boundary / Upstream / Existing Spec Touchpoints / Constraints を保持。
- **Sibling spec への波及方針**: resilience の heartbeat / instanceId primitive は本 spec 内で共通基盤に抽出 (resilience spec 本体は無変更)。reconcile の sub-tree 並行発火は冪等性に委ねるか namespace lease で serialize するかを design 段階で確定 (reconcile spec 本体は無変更、Implementation Notes に 1 行追記の方針)。
