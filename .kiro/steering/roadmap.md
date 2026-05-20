# Roadmap

## Overview

GROWI Vault の bootstrap / 同期機構を「真にレジリエント」にする改修ロードマップ。現状の `VaultBootstrapper` は完了状態の信頼性が低く（cursor リセット欠如、reset-all 毎回発行、fire-and-forget な失敗処理、二重起動ガードの不備）、また drift（MongoDB の `pages` と vault tree の乖離）を検出する仕組みが存在しない。これらを解消するため、システム側の自動 correctness 保証（新 spec `growi-vault-resilience`）と、admin および一般ユーザーが任意のサブツリーを再同期できる手動 reconcile（既存 `growi-vault-gateway` spec の拡張）を組み合わせる。

`/kiro-spec-cleanup` 実施済みの両 sub-spec（gateway / manager）は historical record として保ち、新 spec が置き換え設計を提示する形を採る。

## Approach Decision

- **Chosen**: 「誰がトリガーするか」を境界として、system-triggered correctness（resilient bootstrap state machine + auto drift 検出と補修）を新 spec、user-triggered reconcile（admin UI + PageTree + GrowiContextualSubNavigation からの reconcile）を gateway 既存 spec の拡張とする。
- **Why**: 機能の重さで切るより、トリガー源で切る方が責務の所在が明確で、既存 gateway spec のオーナーシップ（PAT 認証 + ACL 評価 + dispatch）と整合する。auth と ACL を持たない新 spec が user-facing UI を持つのは責務越境。
- **Rejected alternatives**:
  - 既存 gateway spec に全要件を追記する案: cleanup したばかりの reference 性を損なう。
  - resilient bootstrap と reconciliation を 2 spec に分解する案: 同じ MongoDB collection（`vault_sync_state`、`vault_instructions`）を扱う設計を分けると owner 境界が複雑になる。
  - 自動 drift 検出を out of scope にする案: 完了状態の信頼性は resilience の本質なので新 spec の責務として含めるべき（具体設計は design 段階で軽量化）。
  - 機能の重さで境界を切る案: gateway 拡張と新 spec の境界が「実装規模」で曖昧になる。

## Scope

- **In**:
  - Resilient bootstrap state machine（restart-safe、completion idempotent、自動再開）
  - 自動 drift 検出と補修（具体的設計は新 spec の design 段階で決定。候補: completion verification only / watermark-based incremental sweep / hash-based namespace integrity / heuristic surveillance）
  - User-triggered targeted reconcile（admin + 一般ユーザー、ACL-scoped、PageTree / GrowiContextualSubNavigation / admin UI 統合）

- **Out**:
  - マルチレプリカ対応（leader election、writer 単一化の物理保証）
  - Squash / GC 戦略の変更
  - 既存の change stream watcher / dispatcher の挙動変更（前提として依存）
  - PAT 認証 / ACL 評価ロジックの変更

## Constraints

- **既存 sub-spec の reference 性維持**: `growi-vault-gateway` と `growi-vault-manager` は cleanup 済みのため historical record として残し、新 spec が置き換え設計を提示する。実装完了時に既存 spec へリダイレクト記述を 1 行追記する程度に留める。
- **冪等性原則の維持**: vault-manager の冪等性（git object の content-addressing + `VaultPathMapper` の純関数性）は崩さない。新規 op を導入する場合も同じ性質を満たす必要がある。
- **Incremental sync 互換**: 既存の PageService event-driven sync（`VaultDispatcher`）は前提として維持。新 spec はその上に correctness 保証を重ねる。
- **VAULT_BOOTSTRAP_ON_START の安全化**: env をつけっぱなしで再起動しても vault データが破壊されないこと。
- **自動 drift 検出の overhead 最小化**: O(N) 全件 scan は避ける。design 段階で軽量な候補を評価する。

## Boundary Strategy

- **Why this split**:
  - System-triggered（自動）と user-triggered（手動）は trigger 源と auth 要件が異なる。
  - 自動補修は bootstrap state machine と密接に絡む（completion 時の check と統合した方が漏れがない）。
  - 手動補修は admin / 一般ユーザーの auth と GROWI ACL を経由するので gateway の既存責務に乗る。
  - 既存 gateway spec が既に user-facing API と admin UI のオーナーであり、UI 拡張は自然な拡張。

- **Shared seams to watch**:
  - 新 spec の reset-all 意味論変更 ↔ vault-manager 既存 Req 2.6 の実装
  - 新 spec の bootstrap state ↔ gateway 既存 admin UI の表示要件
  - gateway 拡張の reconcile 操作 ↔ 新 spec の自動 drift 補修処理（同じ instruction 経路を共有する可能性が高い）
  - 新 spec の自動補修がトリガーした reconcile と user-triggered reconcile の処理順序 / 競合

## Specs (dependency order)

- [ ] growi-vault-resilience -- resilient bootstrap state machine + 軽量 drift 検出（system-triggered correctness）。Dependencies: none（cleanup 済みの両 sub-spec を前提として依存）
- [ ] growi-vault-ha -- vault-manager の冗長化（HA）と change stream 取りこぼし防止。Dependencies: growi-vault-resilience（heartbeat / lease primitive を共有）

## Existing Spec Updates

- [ ] growi-vault-gateway -- user-triggered targeted reconcile（admin + 一般ユーザー、ACL-scoped、PageTree / GrowiContextualSubNavigation / admin UI 統合）。新規 Req を追加。Dependencies: growi-vault-resilience（state machine と reconcile instruction 経路を整合させるため、新 spec の design 確定後に着手するのが安全）

---

## Future Spec Details

### growi-vault-ha

**目的**: vault-manager の単一インスタンス前提を解消し、長時間停止 / change stream resume token 失効による instruction 取りこぼしを構造的に排除する。これにより `growi-vault-resilience` の drift detection は「軽量 observability + 最小自動補修」に縮小可能となる。

**Design direction**: Competing Consumers pattern
- 同一 image / config の vault-manager を N container 並列起動（role 分離なし）
- `vault_instructions` への atomic claim（`claimedBy` + `claimedAt` + TTL）で instruction 単位の処理権を分配
- 新規 `namespace_leases` collection で同一 namespace への書き込みを serialize（`.git/index.lock` 物理制約への対応）
- failover は per-instruction TTL 経過（秒オーダー）、`replicas` を増やすだけで scale + HA

**Scope**:
- `vault_instructions` schema 拡張（`claimedBy`, `claimedAt`）
- 新規 `namespace_leases` collection
- vault-manager の apply loop 改修（claim → namespace lease → apply → release）
- oplog window 運用要件の明文化（典型 failover 時間より十分長い設定値の指針）
- `growi-vault-resilience` の heartbeat / instanceId primitive を共通基盤に refactor 検討

**Out of scope**:
- 異なる git repo backend（現状 filesystem 前提を踏襲）
- `reset-all` の並列実行制御（bootstrap 時のみ発生する稀ケース、admin が一時 `replicas=1` に絞る運用で十分かは要設計）
- apps/app 側 dispatcher の HA（既に既存挙動として multi-replica で動作する想定、要再確認）

**Boundary との関係**:
- `growi-vault-resilience` の drift detection は本 spec 適用後さらに simplification 可能（observability 主、補修副）
- `growi-vault-gateway` の user-triggered reconcile は変更不要（同じ instruction 経路を使う）
