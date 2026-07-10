# Implementation Plan

> 開発方針: 新規変更は TDD（テスト先行・red→green）で進める。テストを書く／レビューする際は `essential-test-design`（観察可能な契約を検証）と `essential-test-patterns`（Vitest / 型安全モック）に従う。型は `any` / `as any` / `as unknown as T` で迂回しない。

- [ ] 1. 基盤: snapshot の型・判別子・永続スキーマ
- [x] 1.1 snapshot 判別可能ユニオン型・type guard・`Attachment` target モデルの追加
  - `ISnapshot` を「catch-all（`{ username? }`）」と「添付削除 variant（`username?`/`originalName?`/`pagePath?`/`pageId?`/`fileSize?`）」のユニオンとして定義する（要件 1.4 に従い判別子は既存の `action` のみで、snapshot 内に判別キー専用フィールドを足さない）
  - `action` を判別子に narrowing する type guard を追加する（`any` を使わず、既存の必須フィールド `action` で判定）
  - target モデルの集合に `Attachment` を1つ追加する（既存の Page/User/PageBulkExportJob/AuditLogBulkExportJob は変更しない）
  - 先にユニットテストを書く: guard が添付削除 action で添付 variant に narrow し、それ以外の action では catch-all 扱いになること、既存の `snapshot.username` 読み取りが両 variant で型エラーなく通ること
  - 観察可能な完了条件: 追加した guard のユニットテストが green で、`snapshot.username` を読む既存箇所の型検査が通る
  - _Requirements: 1.1, 1.2, 1.3, 1.4_
- [x] 1.2 永続スキーマ（composite type）へ添付フィールド追加と username の optional 化
  - `ActivitiesSnapshot` composite type に添付フィールド（`originalName`/`pagePath`/`pageId`/`fileSize`）をすべて optional で追加し、`username` を必須から optional に変更する（既存データは追加フィールド無しでもそのまま有効＝破壊的移行なし）
  - `prisma generate` を実行して型を再生成する
  - `username` が `string | null` に変わることで型整合が必要になる既存消費者（監査ログ検索クエリ、snapshot username 集計、client store）を洗い出し、`any` を使わずに型を合わせる
  - 観察可能な完了条件: `prisma generate` が成功し、生成後の `ActivitiesSnapshot` に5つの optional フィールドが存在し、`username: string | null` を扱う消費者の型検査が通る
  - _Requirements: 4.2_

- [ ] 2. 保存口（activities 拡張）の改修 — 実 DB 読み直しで保存を検証
- [x] 2.1 カスケードの保存口（createByParameters）で添付フィールドを保存する
  - 渡された snapshot の添付フィールドを、実際に永続化する composite データへ反映する（現状は `{ id, username }` だけを手組みして添付フィールドを捨てているのを直す）
  - 書き込み口の入力型（create 側）を `ISnapshot`（union）へ広げ、`any` で型を迂回しない
  - 先に結合テストを書く（red→green）: 添付フィールド入りの snapshot で作成 → **実 DB（devcontainer の mongo, rs0）から当該レコードを読み直し**、4フィールドが保存されていることを assert する（ビルダーやサービスの返り値ではなく DB を見る）
  - 観察可能な完了条件: 実 DB から読み直したレコードに `originalName`/`pagePath`/`pageId`/`fileSize` が保存されている結合テストが green
  - _Requirements: 2.1, 3.3, 4.2_
  - _Boundary: ActivitiesSnapshot composite, activities 拡張（createByParameters）_
  - _Depends: 1.1, 1.2_
- [x] 2.2 直接削除の保存口（updateByParameters）で composite を envelope 形で更新する
  - Prisma composite の更新は素のオブジェクトを渡せないため、`{ update: { … } }`（既存 `_id`・`username` を保てる形を第一候補）または `{ set: { … + _id } }` の envelope 形に**関数内部で型付きに**変換する。呼び出し側は素の `ISnapshot` を渡すだけにする（envelope を意識させない）
  - update 側入力型を素の `ISnapshot` を受け取れるよう広げ、`any` を使わない（design「型安全性の担保」参照）
  - 更新前に、middleware が先に作る `ACTION_UNSETTLED` の activity が `snapshot._id`・`username` を既に持つことを実 DB で1度確認し、`{ update }` が成立する前提を固定する
  - 先に結合テストを書く（red→green）: 添付フィールド入り snapshot で更新 → **実 DB から読み直し**、4フィールドが保存され、かつ既存の `snapshot._id`・`username` が壊れていないことを assert する（この経路は失敗しても更新ハンドラが握りつぶすため、返り値でなく DB を見ることが必須）
  - 観察可能な完了条件: 実 DB 読み直しで4フィールド＋`_id`＋`username` の生存を確認する結合テストが green
  - _Requirements: 2.1, 2.2, 4.2_
  - _Boundary: activities 拡張（updateByParameters）_
  - _Depends: 2.1, 1.1, 1.2_

- [ ] 3. snapshot ビルダーとカスケード recorder（新規の純粋ロジック）
- [x] 3.1 (P) 添付削除 snapshot ビルダー（純粋関数）とユニットテスト
  - 添付・pagePath・操作者名から添付削除 snapshot を生成する純粋関数を追加する（フレームワーク非依存、入力を破壊せず新オブジェクトを返す）
  - 呼び出し側で Mongoose 添付の `page`（ObjectId）を Prisma 別名の `pageId` へ読み替えてから渡す契約を明示する（読み替え漏れは型で捕まらず `pageId`/`pagePath` が黙って欠落するため、テストでこの前提を固定する）
  - 先にユニットテストを書く: 4フィールド＋username を正しく詰める、pagePath 等の欠損入力では当該フィールドを省略する（要件 2.3）
  - 観察可能な完了条件: 正常系・欠損系のユニットテストが green
  - _Requirements: 2.1, 2.2, 2.3, 3.3_
  - _Boundary: Snapshot Builder（新規ファイル）_
  - _Depends: 1.1_
- [x] 3.2 カスケード recorder（添付ごとに activity を新規作成）とユニットテスト
  - 削除対象の添付配列・`pageId → path` マップ・操作者を引数で受け取り（データセットを自分で取得しない executor 原則）、添付ごとに target=添付の `_id`・targetModel=`Attachment`・snapshot 付きで activity 作成サービスを呼ぶ
  - 1件の作成失敗が残りの記録・削除本体を止めないようにする（失敗は文脈付きで error ログ）
  - 先にユニットテストを書く: 添付ごとに1件作成される、記録対象外設定では何も作られない、1件失敗が他を止めない、target が添付ごとに一意
  - 観察可能な完了条件: 上記のユニットテストが green
  - _Requirements: 3.1, 3.2, 3.4_
  - _Boundary: Cascade Recorder（3.1 と同一新規ファイル）_
  - _Depends: 3.1_

- [ ] 4. 統合: 添付ファイル直接削除の記録
- [x] 4.1 (P) 直接削除 API で snapshot 付き update を emit する
  - 添付の実削除**前**に、添付ドキュメントと所属ページのパスから snapshot を生成する（削除後は添付が消えるため順序が重要）。ページが引けない場合は pagePath を省略し警告ログを出す（要件 2.3）
  - 記録イベントに target=添付の `_id`・targetModel=`Attachment`・snapshot を追加する（現状は action のみ）
  - 添付の `page`（ObjectId）→ `pageId` 読み替えの上でビルダーへ渡す
  - 観察可能な完了条件: 直接削除後、対象 activity の snapshot に添付4フィールド＋username が乗り、target/targetModel が添付・`Attachment` になる（7.1 で実 DB 検証）
  - _Requirements: 2.1, 2.2, 2.3_
  - _Boundary: Direct Remove Integration（attachment 削除 API）_
  - _Depends: 2.2, 3.1_
- [ ] 5. 統合: カスケード削除の記録
- [x] 5.1 (P) 完全削除の共通処理に操作者を届け、実削除前に recorder を呼ぶ
  - 完全削除の共通処理へ操作者（user 必須、ip/endpoint 任意）を1つの Parameter Object として追加し、3つの直接呼び出し元＋複数ページ一括削除の継ぎ目で組んで貫通させる（stream 経由の再帰・ゴミ箱空・グループ削除は複数ページ一括削除に収束するため自動的にカバー、いずれも user のみ＝ip/endpoint 縮退を許容）
  - `removeAllAttachments`（実削除）**の前**に、`pageId → path` マップ（ObjectId は文字列化して突き合わせ）を作り recorder を呼ぶ
  - design の容認判断（カスケードは「削除の試行」を記録する。3.4 の要請上、実削除前にデータ凍結する）に沿って順序を固定する
  - 観察可能な完了条件: 完全削除・ゴミ箱空の実行で、添付ごとに `ATTACHMENT_REMOVE` activity が作られ4フィールドが保存される（7.2/7.3 で実 DB 検証、E11000 が出ないこと・`pageId`/`pagePath` が undefined に落ちないことを含む）
  - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - _Boundary: page 完全削除サービス（deleteCompletelyOperation と直接呼び出し元）_
  - _Depends: 3.2, 2.1_
- [ ] 6. 統合: 監査ログ API での snapshot 参照
- [x] 6.1 (P) 監査ログ API の OpenAPI に添付フィールドを追記し、応答に乗ることを担保
  - OpenAPI の snapshot に添付4フィールドを追記する（応答整形は既存の素通しのため変更不要）
  - テストで、添付削除 activity の応答に4フィールドが欠落なく乗り、username のみの既存 activity も後方互換に返ることを確認する
  - 観察可能な完了条件: API 応答に添付フィールドが含まれ、旧形式 activity も問題なく返るテストが green
  - _Requirements: 4.1, 4.2_
  - _Boundary: Audit Log API（apiv3 activity）_
  - _Depends: 1.2, 2.1, 2.2_

- [ ] 7. 検証: 実 DB に対する結合テスト（読み直し方式）
  - 全体前提: 記録可否ゲートを通すため `ACTION_ATTACHMENT_REMOVE` を記録対象にする設定（Medium 以上または additional actions）を明示的に注入する（process.env を書き換えず明示 API で注入）。結合試験は per-worker 分離で実行する
- [x] 7.1 (P) 直接削除の結合テスト
  - 直接削除 API 実行後、対象 activity を実 DB から読み直し、snapshot に添付4フィールド＋username、target=添付 `_id`、targetModel=`Attachment` を確認する
  - 観察可能な完了条件: 上記を assert する結合テストが green
  - _Requirements: 2.1, 2.2_
  - _Depends: 4.1_
- [x] 7.2 (P) 完全削除カスケードの結合テスト
  - 1ページに複数添付がある状態で完全削除し、添付ごとに activity が作られ（E11000 が発生しない＝target が添付ごとに一意）、各レコードを読み直して4フィールドが保存され、`pageId`/`pagePath` が undefined に落ちていない（page→pageId 読み替えの検証）ことを確認する
  - 観察可能な完了条件: 添付ごとの記録・4フィールド保存・衝突なしを assert する結合テストが green
  - _Requirements: 3.1, 3.3, 3.4_
  - _Depends: 5.1_
- [x] 7.3 (P) ゴミ箱空・グループ削除経由の結合テスト
  - ゴミ箱を空にする操作で添付ごとの activity が作られ4フィールドが保存されること、あわせてグループ削除に伴う私有ページ完全削除経由でも1ケース記録されること（操作者貫通が一括削除の継ぎ目で効いていること）を確認する
  - 観察可能な完了条件: ゴミ箱空・グループ削除の両経路で記録される結合テストが green
  - _Requirements: 3.2_
  - _Depends: 5.1_
- [x] 7.4 (P) 監査ログ API 応答の結合テスト
  - 監査ログ API の応答に snapshot 添付フィールドが乗ること、username のみの既存 activity も破綻なく返ることを実データで確認する
  - 観察可能な完了条件: 応答内容の後方互換を assert する結合テストが green
  - _Requirements: 4.1, 4.2_
  - _Depends: 6.1_

## Implementation Notes

- 7.1: ゲート注入の前例 = `configManager.updateConfigs({ 'app:auditLogEnabled': true, 'app:auditLogActionGroupSize': ActionGroupSize.Medium })`（DB 書き込みの明示 API・process.env 非改変）＋ afterAll で `removeIfUndefined: true` により撤去。7.2/7.3/7.4 も同じ口を使うこと。番兵 IP 使用済み: 10.0.0.55/.56/.57/.70/.71/.72/.73/.74/.75/.76/.88/.99, 127.0.0.1（新規テストは未使用の IP を選ぶ前に `grep -rn "10\.0\.0\." apps/app/src` で確認）。7.2 の前例: v5 分岐には `app:isV5Compatible: true` 注入＋root 直下・PUBLISHED・parent ありのページが必要（STATUS_DELETED だと v4 分岐で ip/endpoint が縮退）。removeAllAttachments は fileUploadService を要求（gridfs + setUpFileUpload(true)）。
- 6.1: 既存問題（境界外・未修正）: `components.schemas.ActivityResponse` が `apiv3/user-activities.ts` にも同名定義され生成 spec 内で衝突（activity.ts 側が採用される）。将来スキーマ名の分離（例: AuditLogActivityResponse）を推奨。
- 5.1: `deleteCompletelyOperation` の actor は `ActivityActor | null`（必須引数）。design の表に無い第4の直接呼び出し元 `deleteCompletelyUserHomeBySystem`（システムによるユーザーホーム強制削除・操作者不在）が typecheck で発見され、**システム経路は意図的に記録対象外・明示的な null が契約**（省略はコンパイルエラーのまま）。7.2/7.3 はこの前提で書くこと。
- 4.1: pino logger は context-first（`logger.warn({ ... }, 'msg')`）。message-first だと文脈オブジェクトが実行時に黙って捨てられる（レビューで実測・差し戻し済み）。7.1 では「page が引けないケースの warn に attachmentId/pageId が構造化フィールドで乗る」ことの assert を検討（レビュアー提案）。
- 3.2: recorder の依存型は `ActivityCreator`（`{ createActivity(parameters: IActivityParameters): Promise<IActivity | null> }`）。design スニペットの `IActivity` 引数は概略で、実サービスの転送先型に合わせた。`ActivityActor` は attachment-removal-snapshot.ts から export 済み（5.1 が import する）。
- 2.2: `updateByParameters` の入力契約は「素の `ISnapshot`」（envelope 禁止・`id` は渡さない）。内部の `buildSnapshotUpdateEnvelope` が `{ update }` へ変換し既存 `_id`・`username` を保持する。後続の emit('update') 呼び出し（4.1）はこの契約で snapshot を渡すこと。
- 2.1: `createByParameters` の `username: snapshot?.username ?? ''` は削除済み（username 欠落時は保存しない。空文字補填は移行期の回避策で、全消費者の null 安全を確認済み）。後続タスクは「username 無し snapshot → 読み出しは null」を前提にする。
- 結合テストの分離パターン: `test/setup/prisma.ts` 経由の per-worker DB（`growi_test_<workerId>`）＋テスト専用の番兵 IP で beforeEach/afterAll 掃除。既存 activities integ スイートと同じ流儀に従うこと。
- vitest は必ず `apps/app` ディレクトリから実行する（repo root からだと別パッケージのプロジェクトに誤マッチして `~/` alias 解決が壊れる）。

---

## 増分（2026-07-10）: 添付系 action（ADD/DOWNLOAD）への snapshot capture 拡張

> 開発方針は上記と同じ（新規変更は TDD・テストは essential-test-design / essential-test-patterns に従う・型は `any` / `as any` で迂回しない）。要件5〜8 に対応。REMOVE（要件1〜4・タスク1〜7）は完了済みで作り直さない。

- [ ] 8. 基盤: 添付 snapshot 型と action 別判別ガードの拡張
- [x] 8.1 添付 snapshot の正準型化と ADD/DOWNLOAD の type guard 追加
  - 添付 snapshot の正準型を1つに定め、REMOVE 用の既存型はその別名として残す（viewer の既存 import を壊さない）。ADD・DOWNLOAD それぞれの activity を、`action` を唯一の判別子として添付 snapshot に narrow する type guard を追加する（snapshot 内に判別専用フィールドを足さない）
  - snapshot は全フィールド optional のまま。3 action で形が同一なので判別ユニオンにフィールドは増やさない
  - 先にユニットテストを書く（red→green）: ADD/DOWNLOAD action で添付 variant に narrow、非添付 action は catch-all、username のみの旧形式も型エラーなく通る、既存の添付削除 guard と併存する
  - 観察可能な完了条件: 追加した guard のユニットテストが green で、既存の添付削除型を参照する箇所（viewer 含む）の型検査が通る
  - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - _Boundary: Types & Guards（interfaces/activity.ts）_

- [ ] 9. 共有 snapshot モジュール（新規の純粋ロジック）
- [x] 9.1 添付 snapshot ビルダーと pagePath 解決の共有化・一般化
  - action 非依存の純粋ビルダー（添付・pagePath・username から添付 snapshot を生成、入力を破壊しない）と、page 参照から所属パスを引き当てる解決関数（見つからなければ警告ログ＋undefined）を、単一の共有モジュールに置く
  - REMOVE の既存ビルダーおよびルート内の pagePath 解決を、この共有版へ委譲する（挙動を変えない refactor）。pagePath 解決の実装を複数箇所に重複させない（凝集: 解決は1関数に集約）
  - 先にユニットテストを書く: 4フィールド＋username を詰める／pagePath・pageId 欠損時に当該省略／解決関数は page ヒット時にパス・不在時に undefined＋警告（pino は context-first）
  - 観察可能な完了条件: 共有ビルダー・解決関数のユニットテストが green、かつ委譲差し替え後も既存 REMOVE のユニット・結合テストが green のまま
  - _Requirements: 6.4, 7.3_
  - _Boundary: Attachment Snapshot Builder & Page-Path Resolver（attachment-snapshot.ts）。委譲差し替えのため REMOVE 側 attachment-removal-snapshot.ts（任意で attachment/api.js の pagePath 解決）も触るが挙動不変・記録単位/target は変えない_
  - _Depends: 8.1_
- [x] 9.2 DOWNLOAD 用の「解決＋組み立て」薄いラッパ
  - ダウンロード記録用に、添付と操作者から pagePath 解決を内部で行い添付 snapshot を返す async ラッパを共有モジュールに追加する（ルートを薄く保つための委譲先）
  - 操作者が認証済みなら username を含め、guest（操作者なし）なら username を省略する
  - 先にユニットテストを書く: authed→username あり／guest→username 省略／page 引き当て成功で pagePath／失敗で pagePath 省略
  - 観察可能な完了条件: 上記ユニットテストが green
  - _Requirements: 7.1, 7.2, 7.3_
  - _Boundary: Attachment Snapshot Builder（attachment-snapshot.ts）_
  - _Depends: 9.1_

- [ ] 10. 統合: 添付追加（ADD）の記録
- [x] 10.1 (P) 添付追加 API の記録に snapshot を載せる
  - 添付追加の記録イベント（既存の更新経路）に、対象＝添付・対象モデル＝Attachment・snapshot を追加する（現状は action のみ）
  - 記録時点で既に読み込み済みの所属ページから pagePath を無コストで渡し、添付の page 参照は文字列化して pageId として渡す（読み替え漏れで pageId/pagePath が黙って欠落するのを防ぐ）。追加のページ引き当ては行わない
  - 観察可能な完了条件: 添付追加後、対象 activity の snapshot に4フィールド＋username が乗り、target/targetModel が添付・Attachment になる（実 DB 検証は 13.1）
  - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - _Boundary: ADD Capture Integration（apiv3/attachment）_
  - _Depends: 9.1, 8.1_

- [ ] 11. 統合: 添付ダウンロード（DOWNLOAD）の記録
- [x] 11.1 (P) ダウンロード記録に非ブロッキングで snapshot を載せる
  - ダウンロード記録に、対象＝添付・対象モデル＝Attachment・snapshot を追加する。snapshot 構築（pagePath の引き当てを含む）は、ファイル応答を返した後の「結果を待たない記録処理」の内側で行い、応答前に await しない（ダウンロード応答のレイテンシを増やさない）
  - 記録・pagePath 解決の失敗はダウンロード応答を壊さない（best-effort、握りつぶす）。guest 時は username 省略
  - 記録に渡す parameters は型付きで構築し、`any` を新たに増やさない
  - 観察可能な完了条件: ダウンロード後の記録の snapshot に取得可フィールド＋pagePath が乗り、guest 時 username 省略、記録失敗を注入してもダウンロード応答（status・本体）が壊れない（実 DB 検証は 13.2）
  - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - _Boundary: DOWNLOAD Capture Integration（attachment/download）_
  - _Depends: 9.2, 8.1_

- [ ] 12. 統合: 監査ログ API での ADD/DOWNLOAD snapshot 露出
- [x] 12.1 OpenAPI 追記と応答露出の担保
  - 監査ログ API の OpenAPI に、添付4フィールドが ADD/DOWNLOAD でも現れる旨を追記する（応答整形は既存の素通しのため変更不要）
  - テストで、ADD/DOWNLOAD activity の応答に snapshot フィールドが欠落なく乗り、`action` で ADD と REMOVE を区別でき、username のみの旧 activity も後方互換に返ることを確認する
  - あわせて ADD の応答が snapshot 4フィールドに加え target（添付 _id）＋targetModel（Attachment）を含むこと（下流 viewer の DL リンク生成に必要）を確認する
  - 観察可能な完了条件: API 応答に ADD/DOWNLOAD の snapshot と ADD の target/targetModel が含まれ、後方互換テストが green（実 DB 検証は 13.3）
  - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - _Boundary: Audit Log API（apiv3 activity）_
  - _Depends: 10.1, 11.1_

- [ ] 13. 検証: 実 DB に対する結合テスト（読み直し方式）
  - 全体前提: 記録ゲートを通すため ADD/DOWNLOAD を記録対象にする設定（Medium 以上）を明示 API で注入する（process.env 非改変）。結合試験は per-worker 分離で実行し、未使用の番兵 IP を使う
- [ ] 13.1 (P) 添付追加の結合テスト
  - 添付追加 API 実行後、対象 activity を実 DB から読み直し、snapshot に4フィールド＋username、target=添付の _id、targetModel=Attachment、pagePath が埋まる（ページ既ロード）ことを確認する
  - 観察可能な完了条件: 上記を assert する結合テストが green
  - _Requirements: 6.1, 6.2, 6.3_
  - _Depends: 10.1_
- [ ] 13.2 (P) ダウンロードの結合テスト
  - ダウンロード実行後、記録を実 DB から読み直し、snapshot に originalName/pageId/fileSize＋pagePath（引き当て成功）、target/targetModel を確認する。認証時は username あり・guest 時は username 省略の両ケース。記録失敗を注入してもダウンロード応答が壊れないことを確認する
  - 観察可能な完了条件: 両ケース＋best-effort を assert する結合テストが green
  - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - _Depends: 11.1_
- [ ] 13.3 (P) 監査ログ API 応答の結合テスト
  - 監査ログ API 応答に ADD/DOWNLOAD の snapshot フィールドが乗ること、ADD には target（添付 _id）＋targetModel（Attachment）が乗ること（要件8.2）、`action` で区別できること、username のみの旧 activity も後方互換に返ることを実データで確認する
  - 観察可能な完了条件: 応答内容（snapshot＋ADD の target/targetModel＋後方互換）を assert する結合テストが green
  - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - _Depends: 12.1_

## Implementation Notes（増分）
- ゲート注入の前例（REMOVE 7.x と同じ口）: `configManager.updateConfigs({ 'app:auditLogEnabled': true, 'app:auditLogActionGroupSize': ActionGroupSize.Medium })`＋afterAll で `removeIfUndefined: true` により撤去。ADD/DOWNLOAD はいずれも MediumActionGroup（既定 Small では記録されない）。
- 番兵 IP: 新規テストは未使用 IP を選ぶ前に `grep -rn "10\.0\.0\." apps/app/src` で使用済みを確認する（REMOVE 7.x の使用済み一覧参照）。
- 10.1: ADD の記録は既存の「middleware が UNSETTLED を先に作り emit('update') で更新」経路。1 リクエスト1更新で unique index 衝突なし。`attachment.page`(ObjectId)→`pageId`(string) の読み替えは型で捕まらない（REMOVE で踏んだ罠）。
- 11.1: DOWNLOAD は createActivity 直接呼びの fire-and-forget。snapshot 構築の `await` を応答前に置かない（design 増分「実行順序（重要）」）。pino は context-first（`logger.warn({ attachmentId, pageId }, 'msg')`）。unique index は target=添付 _id で従来より衝突しにくいが、同一ユーザー・同一添付・同一 ms の二重 DL 衝突は best-effort で握りつぶす。
- 9.1: REMOVE ビルダー／pagePath 解決の共有化は挙動不変の refactor。記録単位・target 設計は変えない。既存 REMOVE のユニット・結合テストが green のままであることを完了条件に含める。
- 12.1 の学び: 監査ログ API の `searchFilter.actions` は `getAvailableActions()`（記録ゲート設定）と intersect するため、ゲート未注入のテストで actions フィルタを使うと ADD/DOWNLOAD（Medium 群）は 0 件になる。12.1 のテストは意図的に actions フィルタ不使用（username フィルタ／一意 originalName マーカーで特定）。13.3 でゲート注入込みの経路を検証する。
- 11.1 完了時の実装形: 記録は download.ts の module-level `recordDownloadActivity(crowi, attachment, actor)`（全体 try/catch・await なし呼び出し・304 でも従来どおり発火）。13.2 の失敗注入はこの関数経由の経路（`buildAttachmentDownloadSnapshot` や `createActivity` の失敗）を対象にできる。DOWNLOAD の warn logger 名前空間は download.ts 側。
- 9.2 完了時の実装形: DOWNLOAD の操作者型は `DownloadActor`（`Omit<ActivityActor,'user'> & { user?: IUserHasId }`・attachment-snapshot.ts から export）。カスケード用 `ActivityActor` の user 必須契約は不変。11.1 はルートから `buildAttachmentDownloadSnapshot(attachment, actor)` を呼ぶだけでよい（pagePath 解決・警告はラッパ内部）。
- 9.1 完了時の実装形: `AttachmentLike`/`ActivityActor` の正準定義は attachment-snapshot.ts へ移動（attachment-removal-snapshot.ts は再エクスポートで旧 import path 維持）。`resolveAttachmentPagePath(pageRef, context?)` は optional 第2引数 `{ attachmentId }` を持つ（warn の構造化フィールド用・design の1引数呼びと互換）。page 参照なし（プロフィール画像）は警告なしで undefined。resolver の warn logger 名前空間は `growi:service:activity:attachment-snapshot`（api-remove-activity.integ.ts が spy で pin 済み — 移設時は追随が要る）。
