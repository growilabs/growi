# Brief: growi-vault-ha

## Problem

GROWI Vault は現状 vault-manager を **single-replica 前提** で運用しており、長時間停止や change stream resume token 失効による `vault_instructions` 取りこぼしが構造的に発生しうる。`growi-vault-resilience` の自動 drift detection が事後検出 + 補修を担ってはいるものの、これは「単一の writer が一時的に止まっても後で取り戻す」safety net であり、可用性 (availability) と書き込み連続性 (continuity) を保証するものではない。

具体的な脆弱性:

- **長時間停止 → resume token 失効**: vault-manager が oplog window より長く停止すると、change stream の resume token が無効化され instruction を取りこぼす。`growi-vault-resilience` の drift detector が拾えるのは `pages.updatedAt` watermark で検知可能な範囲のみで、その他の drift（path change / grant drop / hard delete）は構造的に検出不能。
- **failover に分単位の MTTR**: 単一インスタンスの crash / restart で、その間の incremental sync が全て停留する。
- **scaling の上限**: vault-manager の処理能力は単一プロセスの CPU/IO で頭打ち。instruction 急増 (mass import / bulk-rename 等) で queue が滞留する。
- **bootstrap や reconcile の重い処理が他の incremental sync を阻害する**: 長時間処理が走っている間、change stream watcher と instruction dispatcher が同一プロセス内で詰まる。

これらは「vault-manager は常に 1 つだけ」という暗黙の前提に依存しており、本番運用における HA 要件を満たさない。

## Current State

- `growi-vault-resilience` (完了, 2026-05-21): bootstrap state machine + watermark-based drift detector + heartbeat / instanceId / `failed: process-restarted` 正規化機構を所有。**heartbeat primitive は本 spec の lease 機構の前提となる。**
- `growi-vault-reconcile` (完了, 2026-05-22): user-triggered targeted reconcile を `vault_instructions` outbox に積む producer。**multi-replica 環境下で sub-tree reconcile を serialize するか / 並列で走らせて冪等性に委ねるかは本 spec の design 段階で決定。**
- `growi-vault-gateway` (cleanup 済 reference): PAT 認証 + ACL 評価 + read-only git smart HTTP。**read 経路は per-replica で独立に動作可能（state を持たない）。本 spec では変更不要。**
- `growi-vault-manager` (cleanup 済 reference): instruction → git materialization の冪等な consumer。`.git/index.lock` 物理制約 (同一 namespace 同時書き込み不能) を持つ。**本 spec が serialize 機構を提供しなければ multi-replica で破綻する。**

ギャップ:

- vault-manager の HA 化 (process-level replicate) 機構がない
- 同一 namespace への並行書き込みを serialize する lease / claim 機構がない
- multi-replica 環境下での failover (検知 + 引き継ぎ) 経路がない
- oplog window 運用要件 (resume token の最大空白時間) の明文化と監視がない

## Desired Outcome

- vault-manager を N container 並列起動して可用性と scaling を両立できる
- 単一インスタンス crash で他 replica が **秒オーダー** (per-instruction TTL) で処理を引き継ぐ
- 同一 namespace への書き込みは常に 1 replica に serialize され、`.git/index.lock` race を発生させない
- 長時間停止しても oplog window 内なら resume token は維持され、取りこぼしゼロを保証
- `growi-vault-resilience` の drift detection は「observability 主、最小補修副」に縮小可能 (HA で取りこぼしの構造的原因が解消されるため)
- `growi-vault-reconcile` の user-triggered 経路は変更不要 (同じ instruction 経路を使い、冪等性で結果が一意に収束)

## Approach

**Competing Consumers + Per-namespace Lease** pattern を採用する想定。具体は design 段階で確定するが、現状のディレクション:

1. **同一 image / config の vault-manager を N container 並列起動** (`replicas: N` で role 分離なし)
2. **`vault_instructions` への atomic claim** (`claimedBy: instanceId` + `claimedAt` + TTL) で instruction 単位の処理権を分配する
3. **新規 `namespace_leases` collection** で同一 namespace への書き込みを serialize (`.git/index.lock` 物理制約への対応)
4. **failover は per-instruction TTL 経過** (秒オーダー)。`replicas` を増やすだけで scale + HA が両立
5. **oplog window 運用要件の明文化**: 典型 failover 時間より十分長い oplog window の設定値指針を文書化
6. **`growi-vault-resilience` の heartbeat / instanceId primitive を共通基盤として refactor 検討** (重複の整理)

apps/app 側 dispatcher については、既存挙動として multi-replica で動作する想定だが要再確認 (本 spec の Out of Scope か In Scope かは design 段階で確定)。

## Scope

- **In**:
  - `vault_instructions` schema 拡張 (`claimedBy`, `claimedAt`, TTL index 等)
  - 新規 `namespace_leases` collection と lease 取得 / 更新 / 解放 API
  - vault-manager の apply loop 改修 (claim → namespace lease → apply → release のサイクル)
  - failover 動作 (lease 期限切れの再 claim、TTL の調整指針)
  - oplog window 運用要件の明文化と監視メトリクス
  - `growi-vault-resilience` の heartbeat / instanceId primitive の共通化検討 (refactor は本 spec 内で完結、resilience spec 本体は変更しない方針)
  - admin UI / observability: 現役 replica 数、claim 分布、lease 競合発生回数等の surface

- **Out**:
  - 異なる git repo backend (現状の filesystem 前提を踏襲)
  - `reset-all` の並列実行制御 (bootstrap 時のみ発生する稀ケース。admin が一時的に `replicas=1` に絞る運用で代替できるかは design 段階で評価)
  - apps/app 側 dispatcher の HA (既存挙動が前提として multi-replica 互換と想定、要再確認のみ)
  - Read 経路の HA (`growi-vault-gateway` の read API は per-replica で stateless、変更不要)
  - 双方向同期 / git → MongoDB push
  - Squash / GC 戦略の根本変更 (lease 機構と整合させる軽微な調整は許容)

## Boundary Candidates

- **Lease primitive の境界**: `namespace_leases` collection の schema / 取得・更新・解放 API / TTL 設定値の所有
- **`vault_instructions` claim 境界**: instruction-level claim と namespace lease の責務分離 (instruction claim は「私が処理する」、namespace lease は「私だけが書く」)
- **failover 検知境界**: 古い lease をどの replica が掃除するか (lazy expiry vs. active sweeper)
- **vault-manager apply loop の境界**: claim → lease → apply → release のサイクル設計と、各段階での失敗時の roll-forward / roll-back
- **`growi-vault-resilience` との共通基盤境界**: heartbeat / instanceId primitive を共通モジュールに抽出するか / resilience を変更せず本 spec 内で独立実装するか
- **`growi-vault-reconcile` との並行発火境界**: 同一 sub-tree への並行 reconcile が乗ったとき、namespace lease が serialize するか / instruction の冪等性に委ねるか
- **observability 境界**: claim 分布 / lease 競合 / failover カウントを admin UI に surface する範囲

## Out of Boundary

- `growi-vault-gateway` の read API / PAT 認証 / ACL 評価 (per-replica stateless で本 spec 適用後も無変更)
- `growi-vault-manager` の冪等性原則 (content-addressing + 純関数 path mapper) — 維持必須
- `growi-vault-resilience` の bootstrap state machine 本体 — primitive 共通化以外は変更しない
- `growi-vault-reconcile` の accept gate / orchestrator 本体 — instruction 発行経路は無変更
- apps/app 側 PageService / VaultDispatcher — 既存挙動を multi-replica 前提として再確認のみ
- 異なる git backend / 異なる instruction transport
- マルチリージョン (geographically distributed replica)

## Upstream / Downstream

- **Upstream** (前提として依存):
  - `growi-vault-resilience`: heartbeat / instanceId primitive、`vault_instructions` outbox の write owner 契約、`failed: process-restarted` 正規化
  - `growi-vault-reconcile`: instruction 経路の consumer 契約 (本 spec 適用後も発行 API は無変更で動く必要)
  - `growi-vault-manager`: 冪等性 (content-addressing) と `.git/index.lock` 物理制約
  - `growi-vault-gateway`: read API の stateless 性 (本 spec 適用後も per-replica で動作)
  - MongoDB の atomic update / TTL index / oplog window

- **Downstream** (本 spec 完了後に依存される想定):
  - `growi-vault-resilience` の drift detection は本 spec 適用後 simplification 可能 (observability 主に縮退)
  - 将来のマルチリージョン spec / 異なる backend storage spec

## Existing Spec Touchpoints

- **Extends** (本 spec が前提を変える):
  - `growi-vault-resilience`: heartbeat / instanceId primitive の共通化検討 (resilience spec 本体は変更しない、本 spec 内で抽出を完結させる方針)
  - `growi-vault-reconcile`: multi-replica 環境下での sub-tree reconcile の振る舞いを補足 (本 spec の Implementation Notes に明記する形で、reconcile spec 本体は変更しない方針)

- **Adjacent** (変更しない、前提として依存):
  - `growi-vault-gateway`: 全要件 (read 経路は per-replica で動作)
  - `growi-vault-manager`: 冪等性契約と `.git/index.lock` 制約

## Constraints

- **既存 sub-spec の reference 性維持**: gateway / manager / resilience / reconcile は cleanup 済み or 完了済みのため再編集を避ける。本 spec が「multi-replica 化に伴う前提変更」を提示し、関係する spec の Implementation Notes には事後追記 1 行で済ませる方針。
- **冪等性原則の維持**: vault-manager の冪等性は本 spec 適用後も維持。lease 機構は冪等性に **追加** の正しさを与えるもので、置き換えない。
- **At-least-once 配送の維持**: instruction の at-least-once 配送保証は崩さない。lease 失効時は別 replica が再 claim する。
- **oplog window 運用の明文化**: 典型 failover MTTR より十分長い oplog window の指針値を文書化し、運用ドキュメントに反映する。
- **MVP で N=2〜3 想定**: 巨大スケールではなく、本番運用での HA / scaling のベースラインを satisficing する。N>10 のスケーラビリティ最適化は本 spec の責務外。
- **resilience の primitive を尊重**: heartbeat / instanceId は既に resilience で確立済み。共通化検討は本 spec 内で完結させ、resilience spec 本体に bleed back しない。
