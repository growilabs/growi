# 要件定義書: growi-vault-reconcile

## はじめに

GROWI Vault の運用者（admin）および一般ユーザーは、MongoDB の `pages` と vault tree（per-ACL namespace の git repo）の局所的な乖離（drift）を発見した際に、その特定の sub-tree やページのみを手動で再同期する経路を持たない。現状の選択肢は (1) `growi-vault-resilience` の自動 drift detection（`pages.updatedAt` watermark sweep が拾える範囲のみで、path change drift / grant drop drift / hard delete drift は構造的に検出不能）、または (2) `VAULT_BOOTSTRAP_ON_START=force` / admin UI 明示トリガーによる全 wipe 再 bootstrap（局所救済として overkill、可用性低下）の二択に限られ、運用者は drift 放置か全削除かの極端な選択を強いられる。

本 spec は user-triggered targeted reconcile を導入することでこのギャップを埋める。`growi-vault-gateway` (cleanup 済み reference) の PAT 認証 + ACL 評価 interface を **依存** として再利用し、`growi-vault-resilience` が確立した `vault_instructions` outbox 経路 + 既存 `bulk-upsert` op を共有することで、新規 instruction op を導入せず vault-manager の冪等性契約を維持する。admin は `/admin/vault` の拡張から任意範囲、一般ユーザーは PageTree / GrowiContextualSubNavigation から自分が write 権を持つ sub-tree のみを ACL-scoped に reconcile できる。resilience の自動補修と user-triggered reconcile の重複は冪等性に委ね、両方が走っても最終状態が一意に収束する設計とする。

詳細な背景・desired outcome・upstream/downstream・隣接 spec touchpoints は [brief.md](./brief.md) を参照。

---

## 境界コンテキスト

**スコープ内（本 spec が責務を持つ）**:
- admin / 一般ユーザー向けの user-triggered reconcile API endpoint（GROWI 既存 web セッション認証配下）
- reconcile request の ACL 評価とスコープ解決（既存 GROWI Page ACL の評価結果を使用）
- reconcile orchestrator: 対象ページの走査と `vault_instructions` への `bulk-upsert` 発行
- reconcile state / history の永続化（実行時刻 / target / 結果 / 件数）
- `/admin/vault` の reconcile section 拡張（trigger UI + history）
- PageTree / GrowiContextualSubNavigation の reconcile 起動 entry point（最小: メニュー or ボタン）
- `vault.reconcile.*` audit event の記録
- per-user / per-target rate limit と target scope 上限制御

**スコープ外（本 spec は扱わない）**:
- 新規 `vault_instructions` op の追加（既存 `bulk-upsert` を再利用）
- `growi-vault-manager` 側の op handler / dispatcher 挙動変更
- `growi-vault-resilience` の state machine / 自動 drift detection ロジック変更
- `growi-vault-gateway` の PAT 認証 / ACL 評価ロジック本体の変更（既存実装を依存として使用するのみ）
- 双方向同期 / git → MongoDB push（vault は read-only 公開面のまま）
- マルチレプリカ writer の serialize（`growi-vault-ha` の責務）
- 新規 admin UI 画面の独立構築（既存 `/admin/vault` を拡張）

**隣接する期待**:
- `growi-vault-gateway` の PAT 認証 / ACL 評価 / namespace 計算 interface は本 spec の前提として動作し続ける
- `growi-vault-resilience` が確立した `vault_instructions` outbox + 既存 instruction op の冪等性契約は不変
- `growi-vault-manager` の冪等性 / at-least-once 配送保証は不変
- 既存 GROWI Page ACL（page-grant 評価）は ACL の真実源として再利用する
- single-replica 運用が前提（マルチレプリカ対応は `growi-vault-ha` で扱う）
- cleanup 済み sub-spec（gateway / manager）は historical record として残し、本 spec は新規 spec として置き換え設計を提示する

---

## 要件

### 要件 1: User-triggered reconcile の起動経路と target scope

**目的**: GROWI 管理者および一般ユーザーとして、UI から特定の範囲（単一ページまたは sub-tree）の vault 再同期をトリガーし、その範囲だけを局所的に修復したい。これにより、全 wipe 再 bootstrap を伴わずに drift を解消できる。

#### 受け入れ基準

1. When 管理者が `/admin/vault` の reconcile UI から target（page path prefix）を指定して reconcile を起動した場合, the GROWI Vault Reconcile Service shall その target 配下の全ページを対象とする reconcile request を生成し受け付ける
2. When 一般ユーザーが PageTree または GrowiContextualSubNavigation の reconcile 起動 entry point から自身が閲覧中のページに対して reconcile を起動した場合, the GROWI Vault Reconcile Service shall そのページおよびその descendants を対象とする reconcile request を生成し受け付ける
3. When reconcile request が受け付けられた場合, the GROWI Vault Reconcile Service shall request 単位の一意な reconcile ID を発行し、ユーザーへ即時に応答する（同期完了を待たない）
4. The GROWI Vault Reconcile Service shall reconcile の target scope を「単一ページ」または「sub-tree（path prefix）」の 2 種類に限定し、namespace 単位 / grant 単位の起動は受け付けない
5. If reconcile target として無効な path（空文字 / 不正な path 形式）が指定された場合, the GROWI Vault Reconcile Service shall HTTP 400 相当のエラーを返し、reconcile request を作成しない

---

### 要件 2: ACL ベース認可（admin / 一般ユーザー）

**目的**: GROWI 管理者として、一般ユーザーが reconcile 起動によって自分の権限範囲外のページを操作できないことを保証したい。これにより、reconcile が GROWI ACL の boundary を破壊しないことを担保する。

#### 受け入れ基準

1. The GROWI Vault Reconcile Service shall reconcile API への認証として GROWI 既存の web セッション認証を要求し、未認証リクエストを受け付けない
2. When 管理者ロールを持つユーザーが reconcile を起動した場合, the GROWI Vault Reconcile Service shall target scope の制約なしに全ページを対象として reconcile を実行する
3. When 一般ユーザーが reconcile を起動した場合, the GROWI Vault Reconcile Service shall 既存 GROWI Page ACL を評価し、user が編集権（write 相当）を持つページのみを reconcile 対象に含める
4. If 一般ユーザーの reconcile target に user が編集権を持たないページが含まれている場合, the GROWI Vault Reconcile Service shall そのページを reconcile 対象から除外し、残りのページのみを処理する（リクエスト全体を失敗させない）
5. The GROWI Vault Reconcile Service shall ACL 評価の結果をリクエスト時点で確定し、reconcile 実行中の ACL 変更は次回 reconcile request で反映する
6. If reconcile 対象から ACL 評価により全ページが除外された場合, the GROWI Vault Reconcile Service shall reconcile を no-op として完了し、その旨をユーザーへ通知する（HTTP 200 + `processedCount: 0`）

---

### 要件 3: 既存 instruction 経路への相乗り（新規 op 導入なし）

**目的**: 開発者として、reconcile が `growi-vault-manager` の冪等性契約および `growi-vault-resilience` が確立した `vault_instructions` 経路を破壊しないことを保証したい。

#### 受け入れ基準

1. When reconcile request が受け付けられた場合, the GROWI Vault Reconcile Service shall 対象ページを MongoDB の `pages` collection から読み出し、ACL 評価結果に基づいて namespace を解決する
2. When reconcile が namespace 解決を完了した場合, the GROWI Vault Reconcile Service shall 既存 `bulk-upsert` op を使用して `vault_instructions` に instruction を発行する
3. The GROWI Vault Reconcile Service shall 新規の `vault_instructions` op（`reconcile-*` 等）を追加しない
4. The GROWI Vault Reconcile Service shall `growi-vault-manager` の op handler（`applyBulkUpsert` / `applyResetAll` / `applyRemove` 等）の挙動を変更しない
5. The GROWI Vault Reconcile Service shall `growi-vault-manager` の冪等性原則（content-addressing + 純関数 path mapper）および at-least-once 配送保証を破壊しない
6. When trash 配下のページが reconcile target に含まれている場合, the GROWI Vault Reconcile Service shall apps/app 層で trash 状態を判定せず、vault-manager 側の `isExcludedFromVault` filter による exclusion semantics に委ねる（`growi-vault-resilience` で確立した layering 原則を維持）

---

### 要件 4: `growi-vault-resilience` 自動補修との競合許容

**目的**: 開発者として、user-triggered reconcile と `growi-vault-resilience` の自動 drift 補修が同一 namespace に対して重複しても、vault tree の最終状態が一意に収束することを保証したい。

#### 受け入れ基準

1. When user-triggered reconcile と自動 drift 補修が同一 namespace の同一ページに対して並行に instruction を発行した場合, the GROWI Vault Reconcile Service shall vault-manager の冪等性により最終状態が一意に収束することを前提とし、専用の serialize ロジックを導入しない
2. The GROWI Vault Reconcile Service shall 進行中の reconcile を `growi-vault-resilience` の自動補修トリガーで強制 abort しない
3. The GROWI Vault Reconcile Service shall `growi-vault-resilience` の `bootstrapState` 遷移ロジックに介入せず、`bootstrapState !== 'done'` の間に reconcile が受け付けられた場合の挙動を明示する
4. While `bootstrapState !== 'done'`, the GROWI Vault Reconcile Service shall reconcile request を受け付けるか拒否するかの方針を一意に定め（拒否を default とする）、拒否時はその旨をユーザーへ通知する
5. The GROWI Vault Reconcile Service shall 自動 drift 補修と user-triggered reconcile の双方が同一 page を対象に instruction を発行した結果、`vault_instructions` outbox および git tree が重複処理に起因する破壊を起こさないことを担保する

---

### 要件 5: 進捗 / 結果の observability 表示

**目的**: GROWI 管理者および一般ユーザーとして、reconcile を起動した後に「いつ・誰が・どの範囲を・何件処理して・成否は」を UI 上で確認したい。これにより、reconcile を発火しっぱなしにせず、実際の効果を観測できる。

#### 受け入れ基準

1. The GROWI Vault Reconcile Service shall reconcile request 単位の履歴（reconcile ID / 起動時刻 / 起動ユーザー / target scope / processed count / 結果 / 完了時刻 / 直近エラー）を永続化する
2. The GROWI Vault Reconcile Service shall 既存 `/admin/vault` 画面に reconcile history セクションを追加し、管理者が直近 N 件の reconcile 履歴を閲覧できるようにする（既存 UI 構造を拡張する形を採り、新規画面を独立に作らない）
3. The GROWI Vault Reconcile Service shall 既存 `/admin/vault` 画面に reconcile trigger UI（target 指定 + 起動ボタン）を追加する
4. When reconcile が起動 / 完了 / 失敗した場合, the GROWI Vault Reconcile Service shall `vault.reconcile.started` / `vault.reconcile.completed` / `vault.reconcile.failed` の audit event を既存 audit log に記録する（event 名は実装段階で確定するが、`vault.reconcile.*` の prefix を使用する）
5. If reconcile orchestrator が page 走査 / namespace 解決 / instruction 発行のいずれかで失敗した場合, the GROWI Vault Reconcile Service shall 失敗内容を reconcile history の `lastError` に記録し、WARN ログおよび audit log に出力する
6. The GROWI Vault Reconcile Service shall reconcile history を一般ユーザーには表示せず、admin のみが `/admin/vault` から閲覧できるようにする

---

### 要件 6: Overhead 制御（target 上限・同時実行数・誘導メッセージ）

**目的**: 運用担当者として、一般ユーザーが大量・大規模な reconcile を投げることで vault-manager / MongoDB のリソースが食い潰されないよう、reconcile の target 上限と同時実行数を強制したい。さらに、上限を超えたリクエストには明示的な誘導（範囲を絞る / 管理者に依頼する）を返して、ユーザーが次の行動を取れるようにしたい。

#### 受け入れ基準

1. The GROWI Vault Reconcile Service shall 1 回の reconcile request が処理する最大ページ数を role 別の上限として強制する: 一般ユーザー向け上限と管理者向け上限を env var で個別に設定可能とし、一般ユーザー向け上限を管理者向け上限以下に保つ（default は 一般ユーザー / 管理者 ともに 1000 ページ。手動 reconcile は局所補修用途に閉じ、大規模 sweep は `VAULT_BOOTSTRAP_ON_START=force` を含む resilience 経路に委ねる）
2. The GROWI Vault Reconcile Service shall 受付ゲートでの target ページ数判定を `pages.descendantCount` フィールドの読み出しによって行い、ACL filter 前の `1 + descendantCount`（`targetType: 'page'` は 1、`targetType: 'sub-tree'` は `1 + descendantCount`）を上限と比較する。受付ゲートで `countDocuments` 等の全 scan 系 query を発行しない
3. When 一般ユーザーが起動した reconcile の target 配下の page 数（`1 + descendantCount`）が一般ユーザー向け上限を超過した場合, the GROWI Vault Reconcile Service shall request を実行せずに拒否し、ユーザーに「target の範囲を絞って再試行する」または「管理者に reconcile 実行を依頼する」の 2 つの選択肢を明示したエラーメッセージを返す
4. When 管理者が起動した reconcile の target 配下の page 数が管理者向け上限を超過した場合, the GROWI Vault Reconcile Service shall request を実行せずに拒否し、管理者に「target の範囲を絞って再試行する」または「`VAULT_BOOTSTRAP_ON_START=force` を伴う全 wipe 再 bootstrap を検討する」旨のメッセージを返す
5. The GROWI Vault Reconcile Service shall reconcile target の page 数が上限を超過した場合に request を自動分割して複数 reconcile を発行する挙動を取らない（自動分割は導入しない）
6. The GROWI Vault Reconcile Service shall 一般ユーザー単位の同時 reconcile 実行数を env var で設定可能な上限値（default は 1）に制限し、上限超過時の新規 request を拒否する
7. The GROWI Vault Reconcile Service shall システム全体での同時 reconcile 実行数の上限を env var で設定可能とし、default 上限は 3 とする（一般ユーザーと管理者の合計を制限する）
8. If 一般ユーザーの同時 reconcile 上限またはシステム全体の同時実行上限を超過した場合, the GROWI Vault Reconcile Service shall ユーザーに「現在進行中の reconcile 完了後に再試行する」旨のメッセージを返す
9. The GROWI Vault Reconcile Service shall target 上限 / 同時実行上限の超過による拒否を `vault.reconcile.rejected` 相当の audit event として記録する（event 名は実装段階で確定するが、`vault.reconcile.*` の prefix を使用する）
10. The GROWI Vault Reconcile Service shall 受付ゲートの p99 latency を 200ms 以内に保ち、1 reconcile の orchestrator 実行時間を最大 120 秒（default 上限値ぎりぎりの page 数で完了する保守的目安）以内に収める。orchestrator が発行する `vault_instructions` の insert 件数は `ceil((1 + descendantCount) / chunkSize)` 以内に有界とする
11. The GROWI Vault Reconcile Service shall orchestrator の cursor stream に対して上限値 +1 件のハードキャップを付与し、`pages.descendantCount` の stale 等で受付ゲートが見積もり違いをした場合でも、実際の処理 page 数が上限値を超えないようにする。ハードキャップ到達時は当該 reconcile を `status: 'failed', lastError: 'limit-exceeded'` で停止する

---

### 要件 7: 既存契約と冪等性原則の維持

**目的**: 開発者として、本 spec の変更が `growi-vault-gateway` / `growi-vault-manager` / `growi-vault-resilience` の既存契約を破壊しないことを保証したい。

#### 受け入れ基準

1. The GROWI Vault Reconcile Service shall `growi-vault-manager` の冪等性原則（content-addressing + 純関数 path mapper）を破壊しない
2. The GROWI Vault Reconcile Service shall `growi-vault-manager` の at-least-once 配送保証を破壊しない
3. The GROWI Vault Reconcile Service shall `growi-vault-resilience` の state machine（7-state）および自動 drift detection ロジックを変更しない
4. The GROWI Vault Reconcile Service shall `growi-vault-gateway` の PAT 認証 / ACL 評価 / namespace 計算ロジック本体を変更せず、既存実装を依存として使用するのみとする
5. The GROWI Vault Reconcile Service shall 既存 `vault_instructions` op（upsert / bulk-upsert / remove / rename-prefix / grant-change-prefix / reset-all）の挙動を変更しない
6. The GROWI Vault Reconcile Service shall single-replica 運用を前提とする（マルチレプリカ対応は `growi-vault-ha` の責務）
7. The GROWI Vault Reconcile Service shall cleanup 済み sub-spec（`growi-vault-gateway` / `growi-vault-manager`）の reference 性を維持し、これらの spec ファイルを本 spec の実装過程で再編集しない（新規 spec として置き換え設計を提示する形を採る）
8. The GROWI Vault Reconcile Service shall vault は read-only 公開面であるという既存の前提を維持し、git 側 → MongoDB 側への push（双方向同期）を導入しない
