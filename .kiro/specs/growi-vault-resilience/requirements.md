# 要件定義書: growi-vault-resilience

## はじめに

GROWI Vault の現行 bootstrap 機構は「完了状態の信頼性」を保証しておらず、運用者が「Vault は本当に最新か」を信頼できない状態を生んでいる。`bootstrapState: 'done'` でも `bootstrapCursor` が前回最終ページ ID のまま残り、`VAULT_BOOTSTRAP_ON_START=true` を維持して再起動すると `reset-all` で既存 vault データを全消去するリスクがある。二重起動ガードは `running` 状態しか防がず、resume は無条件で `reset-all` を発行し、失敗は fire-and-forget で握り潰され、completeness は未検証で、drift（MongoDB の `pages` と vault tree の乖離）を検出する仕組みも存在しない。

本 spec は **system-triggered correctness 保証** を責務として、上記欠陥を解消する。具体的には (1) Bootstrap state machine の再設計、(2) `reset-all` op の意味論再定義、(3) 起動時自動再試行、(4) 完了の completeness 軽量検証、(5) 自動 drift 検出と補修 を扱う。既存 sub-spec（`growi-vault-gateway` Req 5、`growi-vault-manager` Req 2.6）は `/kiro-spec-cleanup` 済み reference として残し、本 spec が置き換え設計を提示する。実装本体は [apps/app/src/features/growi-vault/server/services/vault-bootstrapper.ts](../../../apps/app/src/features/growi-vault/server/services/vault-bootstrapper.ts) および [apps/growi-vault-manager/src/services/vault-namespace-builder.ts](../../../apps/growi-vault-manager/src/services/vault-namespace-builder.ts) の `applyResetAll` と新規 reconciliation 関連サービスを修正する。

詳細な背景・desired outcome・upstream/downstream・既存 spec touchpoints は [brief.md](./brief.md) を参照。

---

## 境界コンテキスト

**スコープ内（本 spec が責務を持つ）**:
- Bootstrap state machine の再設計（過渡状態の明示、完了時 cursor reset、二重起動ガード強化、resume 意味論）
- `reset-all` op の意味論再定義および partial reset / no-op resume 系 op の新設（必要に応じて）
- 起動時自動再試行（有界 exponential backoff、escalation 経路、admin による abort）
- Bootstrap 完了の completeness 軽量検証（processed vs estimated 等の O(N) 全件 scan を伴わない検証）
- 自動 drift 検出と補修機構（具体的検出手法は design 段階で 4 候補から選定）
- `vault_sync_state` schema 拡張（必要に応じて）
- `@growi/core/interfaces/vault` への新規 op / 拡張型の追加（必要に応じて）
- 既存 admin UI（`/admin/vault` の `VaultAdminSettings`）への completion 信頼性指標および自動補修活動の surface
- 既存 audit log への `vault.resilience.*` イベント記録

**スコープ外（本 spec は扱わない）**:
- User-triggered な手動 targeted reconcile（PageTree / GrowiContextualSubNavigation / admin UI からの手動再同期）→ `growi-vault-gateway` 既存 spec の拡張
- マルチレプリカ対応（leader election、writer 単一化の物理保証）
- Squash / GC 戦略の変更（`growi-vault-manager` Req 6）
- 既存 change stream watcher（`growi-vault-manager` Req 1）/ `VaultDispatcher`（`growi-vault-gateway` Req 4）の挙動変更
- PAT 認証 / ACL 評価ロジックの変更
- 既存 op（upsert / bulk-upsert / remove / rename-prefix / grant-change-prefix）の挙動変更（`reset-all` のみが再定義対象）
- 新規 admin UI 画面の独立構築（既存 `/admin/vault` を拡張する形を採る）

**隣接する期待**:
- `growi-vault-manager` の冪等性原則（content-addressing + 純関数 path mapper）は維持される
- `growi-vault-manager` の at-least-once 配送保証は維持される
- 既存の event-driven incremental sync（`VaultDispatcher`）は本 spec の前提として動作し続ける
- 既存 admin UI 基盤（`VaultAdminSettings`、`/admin/vault`）に表示要素を追加する形で surface する
- single-replica 運用が前提（マルチレプリカ対応は別 spec で扱う）
- 既存 sub-spec（gateway / manager）は cleanup 済み reference として再編集せず、本 spec が置き換え設計を提示する
- 「データ乖離 → 再 bootstrap したい」というニーズへの応答は乖離の程度で経路を分ける:
  - 軽度乖離: 本 spec の自動 drift 検出 + 補修（要件 4）が周期的に吸収する
  - 部分的乖離: `growi-vault-gateway` 拡張の user-triggered targeted reconcile（roadmap.md 参照）で sub-tree 単位に補修する
  - 全 wipe を伴う再構築: 本 spec の `VAULT_BOOTSTRAP_ON_START=force` または admin UI の明示トリガーで実行する（要件 1）

---

## 要件

### 要件 1: Bootstrap 完了状態の信頼性と起動トリガー semantics

**目的**: GROWI 管理者として、`bootstrapState: 'done'` が「state machine 完了」かつ「実体（vault tree）の完全性が確認済み」を意味し、`VAULT_BOOTSTRAP_ON_START` の値によって「暗黙トリガー（つけっぱなし安全）」と「明示トリガー（強制再 bootstrap）」を明確に区別したい。これにより、運用者が「Vault は本当に最新か」を信頼でき、env をつけっぱなしで再起動しても既存データが破壊されず、データ乖離による再 bootstrap が必要な場合にも明示的経路で対応できる。

#### 受け入れ基準

1. When VaultBootstrapper が bootstrap の最終段階に到達した場合, the GROWI Vault Resilience Layer shall completeness check（processed vs estimated の一致など、O(N) 全件 scan を伴わない軽量検証）を実行し、check 不成立の場合は `done` ではなく `failed` に遷移し `bootstrapLastError` に検証失敗の理由を記録する
2. When VaultBootstrapper が `done` に遷移する場合, the GROWI Vault Resilience Layer shall `bootstrapCursor` を null にリセットし、次回 `start()` が resume として誤動作しないようにする
3. When apps/app が `VAULT_BOOTSTRAP_ON_START=true` で起動し bootstrapState が `done` の場合, the GROWI Vault Resilience Layer shall 新規 bootstrap 実行および `reset-all` 系 instruction の発行を行わず、既存 vault データを破壊しない（暗黙トリガー: つけっぱなし安全）
4. When apps/app が `VAULT_BOOTSTRAP_ON_START=true` で起動し bootstrapState が `pending` / `failed` / 異常終了 `running` の場合, the GROWI Vault Resilience Layer shall 自動的に bootstrap を開始または resume する（要件 3 の自動再試行と整合）
5. When apps/app が `VAULT_BOOTSTRAP_ON_START=false` で起動した場合, the GROWI Vault Resilience Layer shall 起動時の自動 bootstrap を行わず、admin UI からの明示トリガーのみで開始する
6. When apps/app が `VAULT_BOOTSTRAP_ON_START=force` で起動した場合, the GROWI Vault Resilience Layer shall 現在の bootstrapState に関わらず明示的全 wipe を伴う新規 bootstrap を実行する（明示トリガー: データ乖離による再構築用）
7. When `VAULT_BOOTSTRAP_ON_START=force` を検出した起動時, the GROWI Vault Resilience Layer shall startup log および audit log に「force による全 wipe bootstrap を実行する」旨を記録する
8. When `VAULT_BOOTSTRAP_ON_START=force` による bootstrap が完了した場合, the GROWI Vault Resilience Layer shall admin UI / startup log / audit log に「次回 `force` のまま再起動すると再度全 wipe が走るため、env を `true` または `false` に戻すこと」を強警告として明示し、運用者が env を戻す責任を負うことを明確にする
9. When `start()` が呼び出され bootstrapState が `running` の場合, the GROWI Vault Resilience Layer shall 新たな bootstrap を開始せず（二重起動防止）警告ログを記録する（異常終了 `running` 検知は要件 3.3 で扱う）
10. When `start()` が admin UI から明示トリガーされ bootstrapState が既に `done` の場合, the GROWI Vault Resilience Layer shall 「完了済みの再 bootstrap は明示的全 wipe を伴う」ことを admin が UI 上で確認する手順を経た上でのみ新規 bootstrap として実行する
11. The GROWI Vault Resilience Layer shall `pending` / `running` / `done` / `failed` を含む各状態から `start()` が呼ばれた場合の遷移を一意に定義し、completeness 検証中である過渡状態を `done` および `running` と区別できる状態モデルを提供する
12. The GROWI Vault Resilience Layer shall bootstrap 状態の遷移を `getStatus()` 経由で外部（admin UI / 自動再試行ロジック）から観測可能にする
13. The GROWI Vault Resilience Layer shall `VAULT_BOOTSTRAP_ON_START` の値が 3 値（`true` / `false` / `force`）以外の場合、起動を中断するか `false` 同等の挙動にフォールバックし、不明値で誤動作しない

---

### 要件 2: Resume 意味論の再定義（`reset-all` op の分離）

**目的**: 運用担当者として、bootstrap が中断後に resume する場合、`reset-all` で既存データを wipe せずに「中断点からの本当の続行」として動作してほしい。これにより、resume cursor 以前のページが永久に欠落するリスクが解消される。

#### 受け入れ基準

1. When VaultBootstrapper が resume（既存 `bootstrapCursor` が non-null の状態で `start()`）を実行する場合, the GROWI Vault Resilience Layer shall `reset-all` を意味する instruction を発行せず、cursor 以降のページのみを bulk-upsert として処理する
2. When VaultBootstrapper が初回 bootstrap（明示的全 wipe を伴う）を実行する場合, the GROWI Vault Resilience Layer shall vault-manager に全 namespace の wipe を意味する instruction を発行し、続いて全ページを bulk-upsert として処理する
3. When vault-manager が「明示的全 wipe」を意味する instruction を受信した場合, the GROWI Vault Resilience Layer shall 全 namespace ref と `vault_namespace_state` / `vault_user_views` の全 doc を削除する（object pool は削除しない）
4. When vault-manager が resume 由来の bulk-upsert instruction を受信した場合, the GROWI Vault Resilience Layer shall 既存 namespace ref および `vault_namespace_state` を破壊せず、後続の bulk-upsert を既存 namespace tree に追加する
5. The GROWI Vault Resilience Layer shall 既存 `reset-all` op を再定義または新規 op で置き換える場合、その op 名と payload を `@growi/core/interfaces/vault` の `VaultInstructionOp` に追加し、既存の他 op（upsert / bulk-upsert / remove / rename-prefix / grant-change-prefix）への副作用を避ける
6. The GROWI Vault Resilience Layer shall resume と初回 bootstrap の区別は apps/app 側で判定し、vault-manager は受信した instruction の op 種別に従って素朴に動作するという責務境界を維持する

---

### 要件 3: 起動時自動再試行と escalation

**目的**: 運用担当者として、bootstrap が `failed` 状態で停留している場合、apps/app の次回起動時に有界な exponential backoff で自動再試行が走り、限界に達したら admin に escalation してほしい。これにより、失敗が fire-and-forget で握り潰される問題が解消される。

#### 受け入れ基準

1. When apps/app が起動し bootstrapState が `failed` の場合, the GROWI Vault Resilience Layer shall 有界な exponential backoff（最大再試行回数 / backoff 上限が env var で設定可能）で resume を自動的に試行する
2. When 自動再試行が最大回数に到達しても完了に至らない場合, the GROWI Vault Resilience Layer shall それ以上の自動再試行を停止し、admin UI に escalation 状態として明示的に表示する
3. When apps/app が起動し bootstrapState が `running` の場合, the GROWI Vault Resilience Layer shall 前回プロセスの異常終了として扱い resume を実施する（`running` のまま停滞させない）
4. When apps/app が起動し bootstrapState が `done` の場合, the GROWI Vault Resilience Layer shall 自動再試行を行わない
5. While 自動再試行が進行中, the GROWI Vault Resilience Layer shall bootstrap 状態を「再試行中」と区別できる過渡状態として表現し、`getStatus()` の結果に再試行回数 / 次回再試行予定時刻 / 直近エラーを含める
6. The GROWI Vault Resilience Layer shall 自動再試行を抑止する操作（env var による無効化、admin UI 経由の手動 abort）を提供する
7. If 自動再試行中の resume が失敗した場合, the GROWI Vault Resilience Layer shall failure をログおよび audit log に記録し、次回 backoff まで待機する（fire-and-forget で握り潰さない）

---

### 要件 4: 軽量 drift 検出（observability 主、自動補修副）

**目的**: 運用担当者として、bootstrap 完了後も MongoDB の `pages` と vault tree の乖離（drift）が system が想定通り動いていることの **監視装置** として周期的に観測されてほしい。検出された drift は既存 instruction 経路で軽量に自動補修し、頻発する場合は根本原因（インフラ / event-driven sync / コード bug）の調査トリガーとなる。

**Note on scope**: 本要件は「event-driven sync の取りこぼしを永久に残さない」ことの **完全な保証** は目指さない。change stream の長時間取りこぼし耐性および hard delete drift の構造的回収は、vault-manager の HA 化（roadmap の `growi-vault-ha` future spec）で扱う責務とする。本要件で扱う drift は以下に限定する:
- soft state 変化（編集 / trash 移動 / trash からの restore）に伴う update drift — `pages.updatedAt` の watermark sweep で拾える範囲
- `pages` collection の hard delete（`deleteCompletely`）由来の drift は **本要件のスコープ外**（`growi-vault-ha` 適用後、event-driven sync が確実性を持つことで実用上解消する想定）

#### 受け入れ基準

1. While bootstrapState が `done`, the GROWI Vault Resilience Layer shall `pages.updatedAt` を watermark として活用する軽量 sweep で update / trash 遷移 / restore 由来の drift を周期的に検出する（O(N) 全件 scan を伴わない）
2. When drift が検出された場合, the GROWI Vault Resilience Layer shall 既存の bulk-upsert / remove instruction 経路を再利用して補修 instruction を `vault_instructions` に発行する（新規 dispatch 経路 / 新規 op を作らない）
3. When 補修 instruction が発行された場合, the GROWI Vault Resilience Layer shall vault-manager の冪等性原則および at-least-once 配送保証を破らない
4. The GROWI Vault Resilience Layer shall drift 検出の周期および対象範囲を env var で設定可能にし、デフォルト値で本番運用に耐える overhead に収める
5. The GROWI Vault Resilience Layer shall 検出した drift の件数、直近検出時刻、補修 instruction の発行件数を admin UI から観測できるよう surface する（**observability 主目的**: drift 頻度の異常が運用者に可視化されることを最優先とする）
6. When event-driven incremental sync（`VaultDispatcher`）が正常に動作している場合, the GROWI Vault Resilience Layer shall drift 検出による補修と event-driven sync が重複しても、vault-manager の冪等性により最終状態が一意に収束することを前提とする
7. If drift 検出または補修処理中に失敗が発生した場合, the GROWI Vault Resilience Layer shall failure を WARN ログおよび audit log に記録し、次回周期で再試行する
8. While bootstrapState が `done` 以外, the GROWI Vault Resilience Layer shall drift 検出を行わない（bootstrap 中は drift 概念自体が成立しないため）
9. The GROWI Vault Resilience Layer shall hard delete（`pages` doc の物理削除）に由来する drift の回収を本要件の責務に含めず、event-driven sync の信頼性（および将来の `growi-vault-ha` spec）に委ねる旨を設計に明記する

---

### 要件 5: Admin UI への信頼性指標 surface

**目的**: GROWI 管理者として、`/admin/vault` 画面で「完了状態の信頼性指標」と「自動補修の活動状況」を確認できるようにしたい。これにより、運用者が「Vault は本当に最新か」を UI から判断できる。

#### 受け入れ基準

1. The GROWI Vault Resilience Layer shall 既存 admin UI（`/admin/vault` の `VaultAdminSettings`）に completion 信頼性指標（最終 completeness check 時刻、check 結果、processed vs estimated）を表示するセクションを追加する
2. The GROWI Vault Resilience Layer shall 既存 admin UI に自動再試行の状態（再試行中 / escalation 状態 / 再試行回数 / 次回予定時刻 / 直近エラー）を表示する
3. The GROWI Vault Resilience Layer shall 既存 admin UI に自動 drift 検出の活動状況（直近検出時刻、検出件数、補修 instruction 発行件数）を表示する
4. The GROWI Vault Resilience Layer shall 既存 admin UI に直近 bootstrap のトリガー源（`admin-ui` / `env-true` / `env-force`）を表示し、運用者が「いつ・何が起点で bootstrap が走ったか」を判別できるようにする
5. When 自動再試行が escalation 状態に到達した場合, the GROWI Vault Resilience Layer shall admin UI で警告レベル（視覚的強調）で表示し、運用者が見落とさないようにする
6. When 直近 bootstrap のトリガー源が `env-force` で完了済みかつ env が現在も `force` のままである場合, the GROWI Vault Resilience Layer shall admin UI に「次回 `force` のまま再起動すると再度全 wipe が走ります。env を `true` または `false` に戻してください」という強警告を視覚的強調で表示する
7. The GROWI Vault Resilience Layer shall completeness check 失敗、escalation 到達、drift 検出、drift 補修発行、`force` bootstrap 開始 / 完了を `vault.resilience.*` イベントとして既存 audit log に記録する
8. The GROWI Vault Resilience Layer shall 新規 admin UI 画面を独立に作らず、既存の `/admin/vault` 画面の構造を拡張する形で surface する

---

### 要件 6: 既存契約と冪等性原則の維持

**目的**: 開発者として、本 spec の変更が `growi-vault-gateway` および `growi-vault-manager` の既存契約（冪等性 / 配送保証 / event-driven sync / 既存 op 種別）を破壊しないことを保証したい。

#### 受け入れ基準

1. The GROWI Vault Resilience Layer shall `growi-vault-manager` の冪等性原則（content-addressing + 純関数 path mapper）を破壊しない
2. The GROWI Vault Resilience Layer shall `growi-vault-manager` の at-least-once 配送保証を破壊しない（新規 op を追加する場合も同じ性質を満たす）
3. The GROWI Vault Resilience Layer shall `VaultDispatcher` の event-driven incremental sync の挙動を変更しない（前提として依存する）
4. The GROWI Vault Resilience Layer shall 既存 op（upsert / bulk-upsert / remove / rename-prefix / grant-change-prefix）の挙動を変更しない（`reset-all` のみが再定義対象）
5. The GROWI Vault Resilience Layer shall single-replica 運用を前提とする（マルチレプリカ対応は別 spec の責務）
6. The GROWI Vault Resilience Layer shall 既存 sub-spec（`growi-vault-gateway` / `growi-vault-manager`）の cleanup 済み reference を再編集せず、本 spec が置き換え設計を提示する形を採る
