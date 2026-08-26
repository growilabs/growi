# Implementation Plan

> **方式**: Option A（事前衝突検知＋中断）。G2G 受信フローの「unzip・meta 検証済み」〜「`importCollections` 呼び出し」の間に衝突検知ゲートを 1 段挟む。衝突があれば取り込みを一切開始せず（DB 無変更）、衝突サマリ付きエラーを push 側へ返し、push 側が転送元管理者へ WebSocket 通知する。衝突が無ければ従来どおり取り込む（挙動不変）。`ImportService` の取り込み挙動・ページ閲覧判定・一意インデックス定義は変更しない。
>
> **設計の要**: 検知の中核は I/O を持たない純関数（`collectConflicts`）＝「一意フィールド値が一致し、かつ `_id` が異なる」ものだけを衝突とする（同一 `_id` の再取り込みと sparse フィールドの空値は非衝突）。その外周に、アーカイブ JSON から一意フィールドのみ stream 抽出するアダプタと、既存データを `$in` バッチ照会するアダプタを置き、orchestrator が両者を突き合わせる。純関数は比較対象を引数で受け取り、データセットを import しない。
>
> **進め方**: TDD（RED→GREEN）。検知の中核（衝突あり/なし/同一 `_id`/sparse 空値）と、衝突なし時の関係解決（＝グループ公開ページが当該ユーザーから到達可能）は、モック単体でなく **実 DB（レプリカセット rs0・`^/test/setup/crowi` の `getInstance`）を読み直す結合試験**で合否を判定する。テストは essential-test-design（観察可能な契約を検証）／essential-test-patterns（Vitest・型安全モック `mock<T>()`・型アサーション回避）に従う。結合試験のテスト分離は per-worker。
>
> **依存**: 型＋純関数（基盤）→ 検知 I/O オーケストレーション → 受信サービスの検知メソッド → 受信ルートのゲート → 通知の届け方（push＋client）→ アクセス維持の非回帰検証、の順。後段が前段の成果物を import・呼び出しする。

- [x] 1. 衝突判定の型と純関数（基盤）
- [x] 1.1 一意制約衝突の判定結果型と純関数を TDD で実装する
  - 衝突レコード（衝突コレクション種別・一意フィールド名・衝突値・アーカイブ側 `_id`・既存側 `_id`）と、ユーザー/グループ別の衝突一覧を持つレポート型を定義する。
  - アーカイブ側と既存側の 2 配列を引数で受け取り、「一意フィールド値が一致し、かつ `_id` が異なる」ものだけを衝突として列挙する純関数を実装する（データセットを import しない）。
  - sparse な一意フィールド（メール・Slack メンバー ID）の空値（null / undefined / 空文字）は照合対象から除外する（不在同士は一意違反にならないため）。
  - レポートに 1 件でも衝突があるかを返す判定関数を用意する。
  - RED→GREEN（unit）: 値一致かつ `_id` 相違 → 衝突になる／値一致かつ `_id` 同一 → 非衝突になる／sparse 空値同士 → 非衝突になる／同一ドキュメントが複数フィールドで衝突 → フィールドごとに列挙される。
  - Observable: 純関数の unit テストがグリーンで、上記 4 分岐の列挙結果が期待どおり。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - _Boundary: detect-unique-conflicts_

- [x] 2. 検知の I/O オーケストレーション（コア）
- [x] 2.1 アーカイブ読み取り・既存照会・検知駆動を実装し実 DB で検証する
  - 取り込み対象アーカイブの JSON から、ユーザーは username / email / slackMemberId と `_id`、グループは name と `_id` のみを stream 抽出する（本文・パスワード等は読まない）。
  - 抽出値を使って転送先の既存データを一意フィールドごとに `$in` でバッチ照会し（read-only）、純関数に渡して衝突レポートを得る orchestrator を実装する。
  - 対象にユーザー（またはグループ）の JSON が含まれない場合は、そのコレクションの検知をスキップし例外を出さない。
  - RED→GREEN（integ・実 DB）: 転送先に管理者（同一メール・別 `_id`）を seed → メール衝突が検知される／転送先にグループ（同名・別 `_id`）を seed → 名前衝突が検知される／同一 `_id` の再取り込み → 非衝突／ユーザー JSON 無し → スキップして例外なし。検知の前後で転送先の既存データが変化しないことを確認する。
  - Observable: integ が実 DB 上でグリーンで、衝突あり/なし/同一 `_id`/対象欠如の各ケースの検知結果が期待どおり、かつ既存データが無変更。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.4, 5.1_
  - _Boundary: detect-unique-conflicts_
  - _Depends: 1.1_

- [x] 3. 受信サービスに検知メソッドを追加（統合）
- [x] 3.1 innerFileStats からファイルを解決して検知を駆動する受信メソッドを実装する
  - 受信サービスに、unzip 済みアーカイブのファイル一覧（コレクション名とファイル名）からユーザー/グループの JSON パスを解決し、無ければ null を渡して検知を駆動するメソッドを追加する（受信インターフェースにも追加）。
  - 取り込みは行わず、衝突レポートを呼び出し元へ返す（DB 無変更）。
  - RED→GREEN（integ・実 DB）: 受信サービス経由で、ユーザー/グループの JSON がある場合に検知が動き、片方が無い場合はその種別だけスキップされる。
  - Observable: 受信メソッドの integ がグリーンで、ファイル解決とスキップ挙動が期待どおり、衝突レポートが返る。
  - _Requirements: 1.6, 2.1, 2.4_
  - _Boundary: g2g-transfer.ts ReceiverService_
  - _Depends: 2.1_

- [x] 4. 受信ルートに衝突検知ゲートを差し込む（統合）
- [x] 4.1 取り込み開始前に検知し、衝突時は中断してエラーを返す
  - 受信ルートの、取り込み設定生成の後・コレクション取り込み呼び出しの前に、検知メソッドを呼ぶゲートを追加する。
  - 衝突が 1 件以上ある場合はコレクション取り込みを呼ばず、衝突サマリ（種別・件数・代表的な衝突フィールドと値の先頭数件）を含む専用コード（データ衝突）のエラー応答を 409 で返す。値の大量露出は避け、代表例＋件数に留める。
  - 衝突が無い場合は従来どおりコレクション取り込みを呼ぶ（挙動不変）。
  - 型付きエラーで扱うためのデータ衝突コードを G2G 転送エラーの識別子に追加する。
  - RED→GREEN（integ・実 DB）: 衝突を作った状態で受信フローを呼ぶ → 取り込みが実行されず（DB 無変更）409 のデータ衝突エラーが返る／衝突が無い状態 → 取り込みが呼ばれ従来どおり成功する。
  - Observable: ルートの integ がグリーンで、衝突時は取り込み未実行かつ 409、非衝突時は取り込み実行という分岐が確認できる。
  - _Requirements: 2.1, 2.2, 2.3, 4.3_
  - _Boundary: routes/apiv3/g2g-transfer.ts, g2g-transfer-error.ts_
  - _Depends: 3.1_

- [x] 5. 衝突通知を転送元管理者へ届ける（統合）
- [x] 5.1 push 側で衝突応答を判別し具体的なエラーを WebSocket 送出する
  - push 側のアーカイブ送信の失敗処理で、受信側応答本文のデータ衝突コードを判別し、専用の見出しキーと衝突サマリ本文を含む管理者向け WebSocket エラーを送出する。それ以外の失敗は従来の汎用エラーのまま。
  - RED→GREEN（unit）: 受信側がデータ衝突エラー応答を返したとき、専用キー＋衝突サマリ本文の管理者向けエラーが送出される（応答本文の形は実装時に確認し、テストで固定する）。型安全モック（`mock<T>()`）を用いる。
  - Observable: push 側の unit がグリーンで、衝突応答時に専用キーとサマリ本文が送出される。
  - _Requirements: 2.2, 3.1, 3.2_
  - _Boundary: g2g-transfer.ts PusherService_
  - _Depends: 4.1_

- [x] 5.2 クライアントで衝突詳細を表示し英語の通知文言を追加する
  - 管理者向け WebSocket エラー受信時に、翻訳した見出しに加えて衝突サマリ本文を表示するようトースト処理を更新する。
  - データ衝突の見出しキー（種別・件数の要約と、解消のための指針＝衝突アカウント/グループを事前に解消する、初期セットアップ前の空の GROWI へ転送する 等）を英語で追加する。他言語翻訳は後続タスク（本機能のゲートにしない）。
  - RED→GREEN（unit）: 衝突エラーを受け取ったとき、見出し（翻訳キー）と詳細本文の双方が表示される。
  - Observable: クライアントの unit がグリーンで、衝突通知の見出しと詳細が表示され、英語文言が解決できる。
  - _Requirements: 3.1, 3.2, 3.3_
  - _Boundary: G2GDataTransfer.tsx, admin locales_
  - _Depends: 5.1_

- [x] 6. 衝突なし時のグループアクセス維持を非回帰検証（検証）
- [x] 6.1 (P) 衝突が無い取り込みでユーザー・グループ・関係が整合し閲覧が維持されることを実 DB で確認する
  - 衝突が無い状態で、ユーザー・ユーザーグループ・グループ関係を取り込んだ後、あるユーザーに紐づくグループ ID 集合が期待どおり解決されること（＝グループ公開ページが当該ユーザーから到達可能であること）を実 DB で確認する。
  - これは既存の取り込み挙動（変更しない）が正常系で正しく機能することの非回帰確認であり、ゲートが誤って正常転送を中断しないことの裏付けでもある。
  - RED→GREEN（integ・実 DB）: 衝突なしで 3 者を取り込み → 対象ユーザーの関連グループ ID 集合が転送元と同じ対応になる（グループ公開ページが閲覧可能な条件が成立）。
  - Observable: integ がグリーンで、衝突なし取り込み後にユーザーに紐づくグループ ID が期待どおり解決される。
  - _Requirements: 4.1, 4.2, 5.2_
  - _Boundary: detect-unique-conflicts.integ_
  - _Depends: 2.1_

## Implementation Notes

- **モデルの型**: design.md の `Model<UserDocument>` / `Model<UserGroupDocument>` のうち `UserDocument` は実在しない（`models/user/index.js` は JS の factory）。orchestrator は `Model<IUser>` / `Model<IUserGroup>` を受け取る。`mongoose.model<IUser>('User')` と `~/server/models/user-group` の default export がそのまま代入可能。**入れ違いを型で防げるのは片方向だけ**（`UserGroupModel` が `[x: string]: any` の索引シグネチャを持つため、`UserGroup` は `Model<IUser>` にも構造的に代入できてしまう）。実際の守りは `g2g-transfer.integ.ts` が users / usergroups の衝突を別々に assert していること。
- **検知処理の失敗は例外で伝播する**（空レポートで素通りさせない）。アーカイブ JSON が途中で切れている / 0 バイト / 配列でない場合は `detectUniqueConflicts` が throw する。受信ルート（4.1）はこれを 500 系に変換する責務を持つ（design.md Error Handling / Error Strategy）。衝突検知の 409 と混同しないこと。
- **integ の前提**: この worktree では `packages/*` の `dist` が未生成だと結合試験が `@growi/logger` の解決失敗で起動しない。`npx turbo run build --filter '@growi/app^...'` で解消する（cache hit で速い）。
- **integ のテスト分離**: per-worker DB を他ファイルと共有しうるので `deleteMany({})` は使わず、固有プレフィックス付き fixture を `$in` で消す。一時アーカイブは `os.tmpdir()` 配下に作り `afterAll` で削除する。
- **`mock<Model<IUser>>({ find: ... })` は書けない**（`find` の overload により `DeepPartial` で表現できず TS2740/TS2322）。`mock<Model<IUser>>()` で自動スタブしてから `model.find.mockImplementation(...)` で振る舞いを差し込む。
- **`detectImportConflicts` の 2 種類の結末を混同しないこと**（3.1 で確定）: 「転送対象に users/usergroups が無い」＝ `null` を渡して検知スキップ（要件 1.6、例外なし）。「宣言されたファイルが解決できない・読めない」＝ **例外**（`getFile` が `fs.accessSync` で不在を例外化する）。ルート（4.1）は検知呼び出しを try/catch で包み、例外は 500 系へ、衝突ありは 409 へと**別経路**に振り分ける。
- **4.1 で `collections` との突き合わせを足さないこと**（3.1 レビューの記録）: `collections` に `users` が無いのにアーカイブに `users.json` がある組み合わせでは、取り込まれないコレクションで 409 になり得る。ただし push 側の `exportService.export(collections)` は選択分のみ書き出すので実運用では到達不能で、かつ安全側に倒れる挙動。design.md は `innerFileStats` からの解決を明示しているので現状が仕様準拠。
- **409 応答本文の実際の形**（4.1 で確定。5.1 はこれに依存する）: `{ "errors": [ { "message": "<衝突サマリ>", "code": "growi_data_conflict" } ] }`。`ErrorV3` の `info` / `stack` / `args` は `undefined` なので JSON から落ちる。push 側は `rawAxios.post` の catch で `err.response?.data?.errors?.[0]?.code` と `.message` を読む。検知失敗は同じ封筒で `code: 'conflict_detection_failed'` / HTTP 500 なので、ステータスとコードの両方で区別できる。コード文字列は `G2G_DATA_CONFLICT_ERROR_CODE`（`models/vo/g2g-transfer-error.ts`）を import して使う — 文字列リテラルを二重定義しないこと。
- **衝突サマリの生成は `service/import/summarize-unique-conflicts.ts`**（4.1 で追加。design.md の File Structure Plan には未記載）。値の露出は 1 コレクションあたり先頭 `CONFLICT_SAMPLE_LIMIT = 3` 件＋残件数まで。要件 3.3（解消のための指針）はこのサマリではなく 5.2 の i18n 文言の担当。
- **5.2 が追加する i18n キーの正確な位置**（5.1 で確定）: push 側が emit するキーは `admin:g2g:error_data_conflict`（`service/g2g-transfer.ts` の素のリテラル。同ファイルの既存 3 キーと同じ慣習で、定数化は不要と判定済み）。i18next は最初の `:` で namespace `admin` を切り出して残りをキー区切りで繋ぐので、書く場所は `apps/app/public/static/locales/en_US/admin.json` の **`g2g` オブジェクト直下の `error_data_conflict`**。
- **詳細トーストの出し分けは payload の `key` で判断する**（5.2 で確定。**文言の一致で判断しないこと**）: `client/components/Admin/g2g-error-toast-contents.ts` の `KEYS_WITH_DETAIL_MESSAGE` に宣言されたキーだけ `message` を併記する。当初は「訳した見出しと `message` が異なるときだけ併記」にしていたが、`ja_JP` / `fr_FR` / `ko_KR` は既存キーを翻訳済みなので等価判定が必ず不成立になり、「日本語の見出し＋英語の生文字列」の 2 重トーストに退行した（5 言語 × 実 payload 4 種で実測）。en_US と zh_CN（未翻訳）だけ症状が出ないため英語で動かすと気づけない。
- **他言語では衝突見出しが英語にフォールバックする**（当初「生キーが出る」と書いたのは誤り。最終検証で訂正）: `config/i18next.config.mjs` が `fallbackLng: 'en_US'` を設定しているので、`error_data_conflict` が en_US にだけあれば ja/fr/ko/zh でも英語の見出し（＝要件 3.3 の解消指針を含む）に解決される。「生キー」という当初の読みは、locale JSON を直接読む probe が fallback を経由しなかったことによるもの。したがって `error_upload_attachment` が 5 言語すべてに無かった以前の状態こそが生キー表示の原因で、en_US へ追加した時点で全言語が英語表示に直っている。後続の翻訳タスクは「英語で読める」状態を各言語へ訳す作業であり、機能のゲートではない。**この fallback は設定とライブラリのコードから読み取ったもので、実行中のアプリでは未確認。**
- **既存のキー欠落が 1 件ある**（5.1 レビューで発見）: `admin:g2g:error_upload_attachment` は pusher が emit しているのに 5 言語すべての `admin.json` の `g2g` に存在せず（各ファイル `transfer_success` / `error_generate_growi_archive` / `error_send_growi_archive` の 3 キーのみ）、トーストに raw キーが出る。5.2 では「pusher が emit する全キーが en_US/admin.json で解決できる」ことを assert する spec を 1 本足すことを推奨（この既存欠落も直せる）。
- **`g2g-transfer.ts` は既に 800 行超**（変更前 801 行 → 858 行）。coding-style の上限超過は 3.1 以前からの既存債務で、`_Boundary:_` がこのファイルへの追加を指定しているため回避不能。将来 pusher / receiver で分割する価値あり。
## Follow-ups（本 spec の受け入れ対象外。最終検証で挙がったもの）

- **【解決済み】`externalaccounts` / `externalusergroups` 経由の #10151 同型症状**: 以前ここには「`externalaccounts`（`providerType`+`accountId` の複合一意制約）と `externalusergroups`（`externalId` 単体、`name`+`provider` の複合一意制約）も #10151 と同じ壊れ方をするのに検知対象外である」という指摘が記録されていた。本 spec は Requirement 1.7〜1.10・2.4・4.4〜4.5・5.3〜5.4 でこの 2 コレクションを検知対象に含め、`detect-unique-conflicts.ts` の `EXTERNAL_ACCOUNT_UNIQUE_KEYS` / `EXTERNAL_USER_GROUP_UNIQUE_KEYS` と `detect-unique-conflicts.integ.ts` / `g2g-transfer.integ.ts` の実 DB 試験で解消済み。
- **転送キーに関する画面文言が実装と食い違っている**: `commons.json` の `transfer_key_limit` は「1 hour」だが実 TTL は 30 分（`transferkeys` の `expireAfterSeconds: 1800`）、`once_transfer_key_used` は「一度使ったら再利用不可」だがコードのどこもキーを削除していない（実際は再利用可）。今回追加した `error_data_conflict` が初めて「解消して再試行せよ」と指示する文言なので、この 2 つの誤りが再試行手順の理解を直接妨げる。`error_data_conflict` に「30 分以内に再試行するか転送キーを再発行する」旨を足すと要件 3.3 がより実行可能になる。
- **`G2GDataTransfer.tsx` の submit catch に `setTransferring(false)` が無い**（1 行）。キー期限切れ等で再試行の POST が失敗すると進捗パネルが古い `mongo: ERROR` を表示し続ける。既存バグだが 409 が再試行を促す経路なので今回初めて日常的に踏まれる。
- **`usergroups` を `flushAndInsert` にすると誤検知でゲートに止められる**: `ImportCollectionItem.jsx` は `usergroups` に 3 モードすべてを出し、受信側の `getImportSettingMap` も拒否しない。flush されるので取り込み時に一意違反は起きないのに、ゲートは flush 前の転送先を見て 409 を返す。既定は `insert` なので通常経路は無影響で、倒れる向きは安全側（破壊せず拒否）。
- **検知対象外だが一意索引があり既定で転送されるコレクション**（実 DB の索引列挙で確認）: `tags{name}`（衝突しやすく、A のタグが落ちて `pagetagrelations` が孤児化）、`pagetagrelations`、`attachments{fileName}`、`pageredirects{fromPath}`、`bookmarks`、`useruisettings{user}`、`namedqueries{name}`。`configs` は `flushAndInsert` 強制なので衝突しない。`usergrouprelations` / `pages` には一意索引が**実在しない**ので design の Out of Scope 判断は正しい。
- **非 sparse 一意索引でのフィールド欠落は偽陰性**: `users.username` / `usergroups.name` は unique だが sparse ではないので、MongoDB はフィールド欠落を `null` 1 個として索引する（実測で `code=11000`）。検知側は空値をスキップするので「衝突なし」と報告する。到達には転送先に username 欠落ドキュメントが必要で、通常の書き込み経路は `required: true` が防ぐ。
- **検知と取り込みの間に DB レベルの TOCTOU がある**（ロック無し）。取り込み中に転送先で同名ユーザーが作られると #10151 が再現するが、移行先は通常空で確率は低い。同一転送先への同時転送は既存から壊れている（転送キーは削除されず複数併存可、`import()` に同時実行ガード無し、`importService.baseDir` に固定名で `users.json` を書くので相互上書き）。今回の新症状として 500 `conflict_detection_failed` が増えた。
- **409 というステータスコードを固定するテストが無い**: push 側は `code` だけを読み status を見ないので、409→200 に変えても pusher の unit は全緑。守っているのはルートの integ だけ。

- **【解決済み】一意インデックス定義の変更を検知する仕組みが無い**: 以前ここには「`USER_UNIQUE_KEYS` / `GROUP_UNIQUE_KEYS` はスキーマの手動転記であり、将来 unique 索引が増えても検知対象に自動で入らない」という指摘が記録されていた。Requirement 6.1/6.2 と `detect-unique-conflicts.drift.spec.ts` が、宣言リスト（`USER_UNIQUE_KEYS` / `GROUP_UNIQUE_KEYS` / `EXTERNAL_ACCOUNT_UNIQUE_KEYS` / `EXTERNAL_USER_GROUP_UNIQUE_KEYS`）と各モデルの実スキーマ定義を突き合わせる試験として解消済み。
- **`findExistingCandidates` がテスト専用にエクスポートされたまま**: `detect-unique-conflicts.ts` の `findExistingCandidates` は本来の呼び出し元（`detectUniqueConflicts` の内部）以外では、`detect-unique-conflicts.spec.ts` のユニットテストからしか参照されていない。エクスポートを外して file-local にできないか、次に触るときに確認する価値がある。
- **`UniqueField` / `GroupUniqueField` 型が未参照**: `detect-unique-conflicts.ts` が公開する型のうち `UniqueField`（`UserUniqueField | GroupUniqueField` の合併型）と `GroupUniqueField` は、定義側以外のどこからも参照されていない（`UserUniqueField` は `rescue-admins.ts` が使用しており、これは削除対象ではない）。未参照分は削除候補。
- **`externalusergroups` にはデータ非破壊を確認する専用テストが無い**: `g2g-transfer.integ.ts` は users/usergroups の非破壊テストに加え `externalaccounts` 用の非破壊テスト（衝突検知中に転送先の既存ドキュメントが変化しないことを確認するテスト）を持つが、`externalusergroups` には同種のテストが無い。検知ロジック自体は共通の `detectUniqueConflicts` を通るため実害は低いと見積もっているが、feature レベルのカバレッジの穴として記録しておく。
- **中断時に展開済みアーカイブが tmp に残る**: 409 / 500 で中断しても `<tmpDir>/imports` の JSON と zip は消えない（メールアドレス等を含む）。既存の全中断経路（`validation_failed` / `version_incompatible` / `import_settings_invalid`）と同一挙動で新規の退行ではないが、409 は通常運用で踏まれる新しい経路なので掃除を検討する価値がある。
- **要件 4.3 のうち添付転送と進捗完了通知はテストで固定されていない**: 差分は `startTransfer` の失敗 catch 1 行だけなので実挙動は不変だが、「添付転送が完走する」「`mongo`/`attachments` とも COMPLETED が飛び client が `transfer_success` を出す」を固定するテストは新旧どこにも無い（本 spec 以前からの空白）。
- **要件 3.3 の文言そのものは無検証**: locale-drift spec は「非空文字列に解決できる」しか見ないので、`error_data_conflict` から解消指針を削っても全テストが緑のまま通る。
- **`G2GTransferErrorCode.DATA_CONFLICT` に機能上の利用者がいない**: wire に乗るのは別定数 `G2G_DATA_CONFLICT_ERROR_CODE` で、追加した列挙値はルートの `logger.warn` のフィールドにしか現れない。design の「型付きエラーで扱う識別子」という意図は未実現。
- **`detect-unique-conflicts.integ.ts` が 1914 行**で coding-style の 800 行上限を超え、かつ `getImportSettingMap` 自体を検証するテスト 2 本を抱えている（import ドメインのテストから G2G 層への逆向き参照）。本番コードの依存方向は汚れていないが、この 2 本は `g2g-transfer.integ.ts` 側の方が収まりが良い。
- **design.md が実装の最終形に追随していない**: 追加ファイル 2 本（`summarize-unique-conflicts.ts` / `g2g-error-toast-contents.ts`）が File Structure Plan に無く、Event Contract の「`admin:g2gError` に `message` を追加」は不正確（`message` は変更前から全 emit 箇所に存在し、実際に変わったのは client が読むようになったこと）。`/kiro-spec-cleanup` で整える。

- **残存する理論的な穴（対応不要・記録のみ）**: 根の配列が閉じないまま末尾が `]` で終わるアーカイブ（例 `[[{doc}]`）は構造検査も JSONStream も通過し「衝突なし」を返す。`users` / `usergroups` スキーマに配列フィールドが無いためエクスポート経路から到達不能。完全に閉じるなら JSONStream の stream の `root` プロパティ（根の値が未完結なら値が残る）を見る手があるが、未文書の内部プロパティで型アサーションが必要。
