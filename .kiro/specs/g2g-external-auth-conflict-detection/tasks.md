# Implementation Plan

> このspecは`.claude/rules/spec-lifecycle.md`が定義するamend specである。タスク10がport-back+自己削除の最終タスク。
>
> **設計の要点**: `detect-unique-conflicts.ts`の型・アルゴリズムを単一フィールド一致から「フィールドの組(1つ以上)一致」へ一般化し、`externalaccounts`(`providerType`+`accountId`)・`externalusergroups`(`externalId`、`name`+`provider`)を検知対象に加える。複合キーの合成値は`JSON.stringify(fields.map(...))`(文字列連結は使わない)。既存候補の取得は複合キーについてタプル単位のバッチ`$or`(単一フィールドの`$in`のまま流用しない)。コレクションごとの宣言は`declareDetector<T>`ヘルパーでTを閉じ込め、型アサーションを使わない。
>
> **進め方**: TDD(RED→GREEN)。検知は実DB(レプリカセット rs0)を読み直す結合試験で合否を判定する既存方針を踏襲する。

- [ ] 1. 一意キーの型と複合キー判定を一般化する(基盤)
- [x] 1.1 UniqueKeySpec型を導入し、collectConflictsを複合キー対応にする
  - `UniqueKeySpec<T> = {label, fields}`型を定義し、`collectConflicts`の第4引数を`readonly UniqueField[]`から`readonly UniqueKeySpec<T>[]`へ変更する。
  - 複合キーの合成値は`JSON.stringify(fields.map(...))`で作る。`fields`のいずれかが空値のドキュメントは照合しない。
  - `UniqueFieldConflict.collection`を4コレクションの合併型へ、`field`の型を`UniqueField`(閉じた合併型)から`string`へ拡張する。
  - 既存の`collectConflicts`呼び出し(unit test、約8箇所)を新しい引数形式に書き直す。
  - RED→GREEN(unit): 値一致かつ`_id`相違→衝突/値一致かつ`_id`同一→非衝突/複合キーの片方だけ一致→非衝突/区切り文字を含む値同士で誤判定しないこと、を固定する。
  - Observable: `collectConflicts`のunitがグリーンで、複合キーの部分一致が衝突と判定されないことが確認できる。
  - _Requirements: 1.1, 1.2, 1.4, 1.5_
  - _Boundary: detect-unique-conflicts collectConflicts_

- [x] 1.2 UniqueConflictReportをコレクション名→衝突配列の汎用形にする
  - `UniqueConflictReport`を`{conflictsByCollection: ReadonlyMap<CollectionName, readonly UniqueFieldConflict[]>}`へ変更する。
  - `hasConflicts`をMapの全値走査に書き換える。
  - Observable: 型変更後も`hasConflicts`のunitがグリーンで、空のMap/衝突を含むMapの両方を正しく判定する。
  - _Requirements: 3.2_
  - _Depends: 1.1_

- [ ] 2. externalaccounts/externalusergroupsの抽出と既存候補取得を追加する
- [x] 2.1 複合キー向けの既存候補取得(タプル単位のバッチ$or)を追加する
  - `findExistingCandidates`に、フィールドの組(タプル)ごとの完全一致条件をバッチにまとめた`$or`で既存候補を取得する経路を追加する。単一フィールドキーは既存の`$in`方式のまま。
  - Observable: `providerType`のように値の種類が少ないフィールドを含む複合キーで、既存候補の取得件数がタプルの実使用数に比例し、コレクション全件を取得しないことをunitで確認する。
  - _Requirements: 1.1_
  - _Boundary: detect-unique-conflicts findExistingCandidates_
  - _Depends: 1.1_

- [x] 2.2 externalaccountsの一意キー宣言と抽出を追加する
  - `ExternalAccountUniqueFields`型とpick関数、`EXTERNAL_ACCOUNT_UNIQUE_KEYS`(`{providerType, accountId}`の複合キー)を追加する。
  - `mongoose.model('ExternalAccount')`はモデルファイルが一度もimportされていないプロセスでは`MissingSchemaError`を投げるため、unit testでは`~/server/models/external-account`を明示的にimportしてから呼ぶ。
  - Observable: `providerType`+`accountId`の組で衝突を検知するunit testがグリーン。
  - _Requirements: 1.1_
  - _Boundary: detect-unique-conflicts externalaccounts declaration_
  - _Depends: 2.1_

- [x] 2.3 externalusergroupsの一意キー宣言と抽出を追加する
  - `ExternalUserGroupUniqueFields`型とpick関数、`EXTERNAL_USER_GROUP_UNIQUE_KEYS`(`externalId`単体、`name`+`provider`の複合キーの2エントリ)を追加する。
  - **`detect-unique-conflicts.ts`への追記が2.2と競合しないよう、2.2の完了後に着手する**(同一ファイルへの並行編集を避ける)。
  - Observable: `externalId`衝突、`name`+`provider`衝突それぞれを検知するunit testがグリーン。
  - _Requirements: 1.3, 1.4_
  - _Boundary: detect-unique-conflicts externalusergroups declaration_
  - _Depends: 2.2_

- [ ] 3. 宣言駆動のorchestratorへ一般化する(統合)
- [x] 3.1 declareDetectorヘルパーとCOLLECTION_DETECTORSを実装する
  - `declareDetector<T>(collection, keys, pick)`ヘルパーで、コレクションごとに`T`を閉じ込めた`CollectionDetector`を作る。型アサーションを使わない。
  - `users`/`usergroups`/`externalaccounts`/`externalusergroups`の4エントリを`COLLECTION_DETECTORS`として宣言する。
  - Observable: 4エントリの配列が型アサーションなしでコンパイルできる(`tsgo`で確認)。
  - _Requirements: 5.1_
  - _Depends: 1.1, 2.2, 2.3_

- [x] 3.2 detectUniqueConflictsをCollectionInput[]駆動へ書き換える
  - 入力を`{collections: readonly CollectionInput[]; replaceTargetCollections?}`へ変更する。`CollectionInput = {collection, jsonPath, lookup: ExistingDocumentLookup}`。
  - `jsonPath`が`null`、または`replaceTargetCollections`に含まれるコレクションはスキップする(要件1.6)。スキップ以外は`COLLECTION_DETECTORS`から対応するdetectorを呼ぶ。
  - `toLookup`をモジュールの公開契約として使えるようにする(呼び出し側がModelから`ExistingDocumentLookup`を作れるようにする)。
  - 既存の`detectUniqueConflicts`呼び出し(integ test、約20箇所)を新しい引数形式に書き直す。
  - RED→GREEN(integ・実DB): 4コレクションそれぞれについて、対象コレクションが転送に含まれない場合に検知がスキップされ例外が出ないこと。
  - Observable: 既存のintegがグリーンで、`CollectionInput`の配列を渡す新しい呼び出し形式で従来と同じ検知結果が得られる。
  - _Requirements: 1.6, 2.3_
  - _Depends: 3.1_

- [ ] 4. (P) 通知生成を汎用化する
  - `summarizeUniqueConflicts`を`conflictsByCollection`の走査に書き換え、種別・件数・代表例(先頭数件)を含む文言を生成する。既存のusers/usergroups向けの出力形式は変えない。
  - 既存のunit(`summarize-unique-conflicts.spec.ts`)を新しい形へ書き換える。
  - Observable: externalaccounts/externalusergroupsの衝突を含むレポートでも、種別・件数・代表例を含む通知文が生成される。
  - _Requirements: 3.1, 3.2_
  - _Boundary: summarize-unique-conflicts_
  - _Depends: 1.2_

- [ ] 5. (P) 受信サービスに4コレクションの解決を組み込む
  - `detectImportConflicts`(`g2g-transfer.ts`)が、`innerFileStats`からexternalaccounts/externalusergroupsのJSONパスも解決し、`mongoose.model('ExternalAccount')`・`ExternalUserGroup`(デフォルトエクスポート)を取得して`CollectionInput[]`を組み立てる。
  - 解決できないファイルは例外、対象外は`null`という既存の方針をexternalaccounts/externalusergroupsにも適用する(要件1.6)。
  - Observable: 4コレクションすべてを含む転送設定を渡すと、4件分の`CollectionInput`が組み立てられる。
  - _Requirements: 1.6_
  - _Boundary: g2g-transfer.ts ReceiverService_
  - _Depends: 3.2_

- [ ] 6. (P) 受信ルートのログ出力を汎用化する
  - 衝突時のログ出力(`routes/apiv3/g2g-transfer.ts`)を、`conflictsByCollection`から件数をコレクションごとに汎用的に集計する形に書き換える。
  - Observable: externalaccounts/externalusergroupsの衝突を含むログに、コレクションごとの件数が出る。
  - _Requirements: 2.2_
  - _Boundary: routes/apiv3/g2g-transfer.ts_
  - _Depends: 3.2_

- [ ] 7. 既存の周辺テストを新しい形へ追随させ、受信フロー全体の非回帰を確認する
- [ ] 7.1 (P) rescue-admins.spec.tsのUSER_UNIQUE_FIELDS参照を書き換える
  - `USER_UNIQUE_FIELDS`を直接importして文字列配列として使っている箇所(187-201行目)を、`USER_UNIQUE_KEYS.flatMap(key => key.fields)`による変換を経由する形に書き換える。
  - Observable: `rescue-admins.spec.ts`がコンパイル・実行できる。
  - _Requirements: 1.1_
  - _Boundary: rescue-admins.spec.ts_
  - _Depends: 3.1_

- [ ] 7.2 g2g-transfer.integ.tsのアサーションを新しいレポート形式へ書き換え、externalaccountsの衝突で受信フローが中断することを確認する
  - `report.userConflicts`/`report.groupConflicts`を直接読んでいる箇所(約10箇所)を、`conflictsByCollection`経由の読み方へ書き換える。
  - externalaccountsの一意制約衝突を仕込んだ受信フローの結合試験を新規に追加し、取り込みが開始されず(要件2.1)、成功として完了せず(要件2.2)、既存データが無変更のまま(要件2.3)であることを確認する。
  - Observable: 既存の`g2g-transfer.integ.ts`がグリーンで、externalaccountsの衝突を仕込んだ新規ケースが中断を確認する。
  - _Requirements: 2.1, 2.2, 2.3, 3.2_
  - _Boundary: g2g-transfer.integ.ts_
  - _Depends: 3.2, 4, 5_

- [ ] 8. externalaccounts/externalusergroupsの検知とアクセス維持を実DBで検証する
- [ ] 8.1 衝突の検知を実DBで検証する
  - 転送先に既存の`externalaccounts`(同じ`providerType`+`accountId`・別`_id`)/`externalusergroups`(同じ`externalId`、または同じ`name`+`provider`・別`_id`)を持つ実データベース上で、それぞれ衝突が検知されることを確認する。`mongoose.model('ExternalAccount')`を使うため、テストでは`~/server/models/external-account`を明示的にimportする(`MissingSchemaError`回避)。
  - 複合キーの片方だけが一致するケース(`providerType`のみ一致/`accountId`のみ一致)では非衝突になることを確認する。
  - 同一`_id`の再取り込みでは非衝突になることを確認する。
  - Observable: `detect-unique-conflicts.integ.ts`に追加したケースがグリーンで、期待した検知/非検知の分岐が実DB上で確認できる。
  - _Requirements: 6.1, 6.2_
  - _Boundary: detect-unique-conflicts.integ.ts_
  - _Depends: 3.2_

- [ ] 8.2 衝突が無いときのSSO/LDAPログインとグループアクセスの維持を実DBで検証する
  - 衝突なしでexternalaccounts/externalusergroupsを含む取り込みを行った後、`providerType`+`accountId`や`externalId`/`name`+`provider`から転送元と同じユーザー・グループへ解決できることを実DBで確認する。**既存の`describe('group access after a conflict-free import', ...)`ブロック(715行目以降、実際の`ImportService`を動かして検証する既存の前例)と同じ形で、externalaccounts/externalusergroups向けの`describe`を追加する**。取り込みの実行自体は`ImportService`が担い(design.mdのOut of Boundary参照)、このタスクは検知が正しく非衝突と判定した後の実際の解決結果を確認する。
  - **8.1と同じファイル(`detect-unique-conflicts.integ.ts`)に追記するため、8.1の完了後に着手する**(同一ファイルへの並行編集を避ける)。
  - Observable: 取り込み後、対象の外部識別子から期待するユーザー・グループが解決される。
  - _Requirements: 4.1, 4.2, 4.3_
  - _Boundary: detect-unique-conflicts.integ.ts_
  - _Depends: 8.1_

- [ ] 9. 一意キー宣言と実際のデータモデルのドリフトを検出する試験を作る
  - `COLLECTION_DETECTORS`の宣言と、`users`/`usergroups`/`externalaccounts`/`externalusergroups`それぞれの`Model.schema.indexes()`(`unique: true`のもの)を突き合わせ、両者がずれたら失敗する試験を作る。
  - **`CollectionDetector`型は`collection`と`detect`のみを持ち、キー宣言(`fields`)を公開しない(3.1のレビューで確認済み・意図的)。ドリフト試験は`COLLECTION_DETECTORS`からコレクション名の一覧だけを読み、キー宣言自体は4つの`*_UNIQUE_KEYS`定数(`USER_UNIQUE_KEYS`/`GROUP_UNIQUE_KEYS`/`EXTERNAL_ACCOUNT_UNIQUE_KEYS`/`EXTERNAL_USER_GROUP_UNIQUE_KEYS`)を直接importして読むこと。** `CollectionDetector`に`fields`相当のプロパティを追加しない(`T`を消してしまい、3.1が避けた型アサーション問題を再導入するため)。4定数のうち`GROUP_UNIQUE_KEYS`のみ未exportなので、このタスクでexportに変更する(1行、`detect-unique-conflicts.ts`)。
  - `externalaccounts`については、この試験がMongooseスキーマ(Prisma移行完了までの暫定コード)を一意制約の正として読んでいることをコメントで明記する。
  - Observable: 宣言から1エントリ削ると試験が失敗し、不一致のコレクション名・フィールドが分かる形でメッセージに出る。
  - _Requirements: 5.1, 5.2_
  - _Boundary: detect-unique-conflicts.drift.spec.ts, detect-unique-conflicts.ts(GROUP_UNIQUE_KEYSのexport追加のみ)_
  - _Depends: 3.1_

- [ ] 10. 変更をg2g-import-conflict-detectionへport-backし、本spec自身を削除する
  - [ ] 10.1 g2g-import-conflict-detectionのrequirements.md/design.mdを書き換える
    - requirements.mdのOut of scope(`users`/`usergroups`以外・ExternalUserGroup系を除外している記述)を、externalaccounts/externalusergroupsを対象に含める記述へ書き換える。要件番号は末尾に追記し、既存の番号は変更しない。
    - design.mdのBoundary Commitments(This Spec Owns/Out of Boundary)とRevalidation Triggers(宣言リストとのドリフト、Prisma移行時の切り替えを追加)を書き換える。
  - [ ] 10.2 設計の理由をg2g-import-conflict-detectionのresearch.mdへ移す
    - 複合キーの合成方法・既存候補取得方式・`COLLECTION_DETECTORS`の型付け方式・ドリフト試験の前提についての判断理由を移設する。
  - [ ] 10.3 g2g-import-conflict-detectionのspec.jsonを更新する
    - `updated_at`を更新する(`phase`/`approvals`はそのまま)。
  - [ ] 10.4 roadmap.mdからの本spec参照を除く
    - 本specは`roadmap.md`に掲載されていないため対応不要であることを確認する。
  - [ ] 10.5 本specディレクトリを削除する
    - `.kiro/specs/g2g-external-auth-conflict-detection/`を削除する。
  - Observable: g2g-import-conflict-detectionのdesign.md/requirements.mdがexternalaccounts/externalusergroupsの検知を対象として記述しており、`g2g-external-auth-conflict-detection`ディレクトリが存在しない。

## Implementation Notes

- 1.1完了時のレビューで判明: 7.1の`_Depends:_`を`1.1`から`3.1`へ修正した。7.1は`USER_UNIQUE_KEYS`(1.1ではなく3.1で導入)を参照するため、1.1完了時点ではまだ着手できない。
- 1.1: 複合キーの`UniqueFieldConflict.value`は`JSON.stringify(values)`形式(例: `["saml","x"]`)。単一フィールドキーは従来どおり素の値を報告する(`toReportedValue`が`toMatchKey`から独立)。タスク4(通知汎用化)はこの形式を前提に文言を組み立てること。
- 2.1: `findExistingCandidates`をテストのためexportした(design.mdのService Interfaceには無い露出)。タスク3.2で`detectUniqueConflicts`が宣言駆動になれば複合キーの`$or`形状が公開エントリ経由で検証可能になるため、その時点でexportを外せる。
- 2.1: `EXISTING_LOOKUP_BATCH_SIZE`(1000)を`$or`のタプル件数上限にも流用した。`$in`の1000要素と`$or`の1000分岐はクエリの重さが同じではないため、タスク6.x(実DB検証)で1000分岐境界のクエリプラン(`explain()`で`{providerType,accountId}`の複合索引が使われ、コレクションスキャンにならないこと)を確認すること。
- 3.2: `conflictsByCollection`はスキップしたコレクションのキーを持たない(空配列ではなく不在)。`hasConflicts`(1.2)は値を走査するだけなので不在でも問題ないが、タスク4/6/7.2でMapを直接読む側は`.get(name) ?? []`を使うこと(全4キーが必ず存在する前提を置かない)。
- 3.1: `USER_UNIQUE_FIELDS`/`GROUP_UNIQUE_FIELDS`を`USER_UNIQUE_KEYS`/`GROUP_UNIQUE_KEYS`(`UniqueKeySpec[]`)へ改名した。この変更で`rescue-admins.spec.ts`が壊れる(想定済み、タスク7.1が対応)。`CollectionDetector`型は`collection`/`detect`のみを持ち、キー宣言を公開しない設計(design.md通り)なので、タスク9のドリフト試験は4つの`*_UNIQUE_KEYS`定数を直接importして読むこと(タスク9の本文に追記済み)。`GroupUniqueField`/`UniqueField`型は`satisfies`ガード撤去に伴い未参照になったが、公開型の削除はこのタスクの境界外のため残置(タスク3.2かport-back時のクリーンアップ候補)。
