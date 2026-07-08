# Implementation Plan

> **方式**: delete-at-settle（Option B）。事前作成（`add-activity` middleware / ページ復元フロー）は温存し、settle 時に「記録可否が確定して対象外の行（②）」だけを削除する。要件4（例外・中断・クラッシュを含む試行記録の保持）を満たすため事前作成は残す。
>
> **依存**: 削除の保存口 → settle 抽出 → リスナー組み替え → 結合検証、の一直線。並列（P）タスクはない（後段が前段の成果物を import・呼び出しするため）。
>
> **進め方**: TDD（RED→GREEN）。記録ゲートの中核（対象外の行が実際に消える／試行記録が実際に残る）は、モック単体でなく **実 DB（レプリカセット rs0）を読み直す結合試験**で合否を判定する。結合試験の設定（記録対象/対象外・`auditLogEnabled`）は明示注入し、`process.env` を直接書き換えない。テスト分離は per-worker。

- [ ] 1. 削除の保存口 `deleteById` を Prisma activities extension に新設
  - `activities` の1行を id 指定で削除する保存口を追加する。対象行が無くても例外を投げない冪等な挙動にする（二重 settle・emit が来ず未作成の id にも安全）。
  - snapshot spec の設計が予約していた「直接削除の保存口」を実体化する。スキーマ変更はしない（物理削除。論理削除フラグは導入しない）。
  - RED→GREEN: integ テストで「既存行を削除できる」「存在しない id では no-op で throw しない」を実 DB で確認する（後始末の `deleteMany` とは別物の、ドメイン保存口として）。
  - Observable: `deleteById` の integ テストがグリーンで、存在しない id を渡しても例外が出ない。
  - _Requirements: 1.1, 4.2_
  - _Boundary: ActivityExtension_

- [ ] 2. 記録ライフサイクルを確定する `settleActivityRecord` を抽出
  - 記録可否の判断結果 `shouldPersist`（真偽）を**引数で受け取り**、真なら更新の保存口・偽なら削除の保存口を呼ぶ薄い純関数にする。戻り値は activity（対象内かつ更新成功）または null（削除した／更新対象なし）。
  - 記録可否の判断を内部で行わない（単一情報源 `getAvailableActions`/`shoudUpdateActivity` を複製しない）。貢献度・通知・snapshot・ルート固有ペイロードに一切依存しない。
  - バレル `service/activity`（`index.ts`）に `settleActivityRecord` の re-export を追加し、親（update リスナー）がバレル経由で import できるようにする。
  - RED→GREEN: unit テストで「`shouldPersist=false` → 削除口を呼び null を返す・更新口を呼ばない」「`shouldPersist=true` → 更新口を渡した引数で呼び activity を返す・not-found は null を伝播」を確認する。更新口/削除口は型安全にモックする（型アサーションを避け `mock<T>()` を使う）。
  - Observable: `settleActivityRecord` の unit テストがグリーンで両分岐の呼び分けと戻り値が期待どおり。かつバレル経由で `settleActivityRecord` が import できる（`index.ts` の re-export 追加）。
  - _Requirements: 1.1, 1.2, 3.1, 3.2_
  - _Boundary: settleActivityRecord（service/activity/settle-activity-record.ts, service/activity/index.ts）_
  - _Depends: 1_

- [ ] 3. `update` リスナーを delete-at-settle に組み替え
  - 「`contributor` 分離 → 貢献度を先行処理（不変）→ `shouldPersist` を単一情報源で算出 → `settleActivityRecord` へ委譲 → 戻り値が非 null のときだけ従来どおり `updated` を emit（`generatePreNotify` 有無の分岐も保存）」の順に組む。
  - 対象外分岐を現行の no-op から「削除口の呼び出し」に変える。settle 呼び出しをエラー境界（try/catch＋`logger.error`）で囲み、記録の失敗がリクエスト本体を止めないようにする。
  - middleware 経路と復元フロー（第2作成源）は同じ `update` リスナーへ emit するため、両者を無改修のまま一律に扱う（action 固有の分岐を足さない）。
  - RED→GREEN: 既存 `activity.spec.ts` の「対象外 → 更新しない・`updated` を emit しない」契約を「**対象外 → 削除口を呼ぶ・`updated` を emit しない**」に改訂する。essential では更新＋`updated` emit、貢献度の先行処理が保存されることも確認する。
  - Observable: 改訂した `activity.spec.ts` がグリーン（対象外で削除口呼び出し＋`updated` 非 emit、essential で更新＋`updated` emit、貢献度先行が保存）。
  - _Requirements: 1.1, 1.2, 1.4, 2.1, 2.3, 2.4, 3.3_
  - _Boundary: ActivityService update listener_
  - _Depends: 2_

- [ ] 4. 記録ゲート挙動の結合検証（本 spec の受け入れ条件）
  - 実 DB を読み直す結合試験で記録ゲートの中核挙動と非回帰を確認する。設定は明示注入（`process.env` を直接書き換えない）、per-worker 分離。
  - 4.1–4.3 は共有セットアップ（per-worker DB・設定注入ヘルパ）のため**同一の integ ファイル**に置き、並列（P）にはしない。観察成果物は各子タスクが持つ。

- [ ] 4.1 対象外を消す／対象内・essential は残す、を実 DB で検証
  - 非 GET・対象外 action を settle → その id の行が `activities` に存在しないことを実 DB の読み直しで確認する（②の除去。R1.1 の権威ある証拠）。
  - 非 GET・対象内 action を settle → 実 action の行が永続化されることを確認する。
  - `auditLogEnabled=false` → essential のみ永続化、非 essential は settle 時に削除されることを確認する。
  - Observable: 対象外 id の行が DB から消え、対象内・essential の行が残ることを読み直しで確認できる。
  - _Requirements: 1.1, 1.2, 2.1, 2.2_
  - _Boundary: ActivityService 記録ゲート結合試験（同一 integ ファイル・並列不可）_
  - _Depends: 3_

- [ ] 4.2 fail-safe（試行記録）の保持と②との区別を実 DB で検証
  - 非 GET・emit 前に例外で終了（settle されない）→ 事前作成された `ACTION_UNSETTLED` 行が残ることを実 DB で確認する（middleware の事前作成が試行記録として機能。R4.1 の権威ある証拠）。
  - 残存行が `ACTION_UNSETTLED` を保持し、「確定して対象外だった②」（4.1 で消える）とは区別できることを確認する。
  - カテゴリ(b)の検証（残存 ≠ 失敗の cross-spec 契約）: 同一ユーザーの短時間再更新など `shouldGenerateUpdate=false` で `emit('update')` 自体が飛ばない経路でも、事前作成された `ACTION_UNSETTLED` 行が残ることを実 DB で確認する。これにより「残存 `ACTION_UNSETTLED` は失敗の証拠とは限らず、成功したが記録を抑制した更新（no-op）も含む」ことを固定する。この不変条件は `activity-log-snapshot-viewer` が依存するため本 spec でテストゲート化する。
  - Observable: 例外時（a）と `shouldGenerateUpdate=false`（b）のいずれでも `ACTION_UNSETTLED` 行が実 DB に残り、対象外だった②の行は残らない、という差が確認できる。
  - _Requirements: 4.1, 4.2, 4.3_
  - _Boundary: ActivityService 記録ゲート結合試験（同一 integ ファイル・並列不可）_
  - _Depends: 3_

- [ ] 4.3 既存挙動の非回帰を検証（貢献度・GET 経路・グループ構成）
  - 貢献度 action（例: `ACTION_PAGE_CREATE`）で、変更前後の貢献度集計が不変であることを確認する（別コレクション・行の存在に非依存）。
  - GET 経路の記録挙動（対象のみ作成）が変わっていないことを確認する（`createActivity` を無改修）。
  - action グループ／essential の構成が変わっていないことを確認する（`interfaces/activity.ts` を無改修）。
  - Observable: 貢献度・GET 経路・グループ構成の各テストがグリーンで、本変更による差分が出ない。
  - _Requirements: 1.3, 2.4, 2.5_
  - _Boundary: ActivityService 記録ゲート結合試験（同一 integ ファイル・並列不可）_
  - _Depends: 3_
