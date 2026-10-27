# Implementation Plan

- [ ] 1. 前提の整備
- [x] 1.1 PR #12151 のマージ後の master から実装ブランチを作り直す
  - 本 spec のブランチ（spec ファイルのみ）を、PR #12151（URL 属性への反映）を含む master の最新に付け替える
  - 実装はこの付け替えの後に始める。`build-url-attributes` を本 spec で作り直さない
  - 完了時: 実装ブランチに `build-url-attributes` とそのテストがあり、匿名化まわりの既存テストがすべて通る
  - _Requirements: 1.3, 1.4_

- [x] 1.2 登録済みのルートを列挙する処理を、ツールとテストで共有できる形に切り出す
  - `tools/snapshot-route-middleware.ts` にあるルートの列挙処理（スタックの走査とマウント先の取り出し）をテスト用ユーティリティに移し、ツールはそれを使う形に変える
  - 共有する処理は、`/_api/v3` に限らず**すべてのルート**について、完全なルートの型・HTTP メソッド・ミドルウェア名を返す。`/_api/v3` への絞り込みと無名ミドルウェアの検査はツール側に残す
  - 小さな Express アプリ（入れ子のルーターとパラメータ付きのルートを含む）で、完全なルートの型と HTTP メソッドが列挙されることを単体テストで確かめる
  - 完了時: 単体テストが通り、ツールの型チェックが通る。ツールの出力形式は変わらない
  - _Requirements: 3.3_

- [x] 1.3 テスト環境で GROWI のルートを列挙できる起動方法を確かめる
  - まずアプリ全体を起動する手順（ツールと同じ手順）を integration テストの中で試し、だめなら apiv3 ルーターだけを組み立てる方法に切り替える（`app:installed` を真にする必要がある）
  - どちらを採用したか、なぜかを research.md に追記する
  - 完了時: integration テストの中で登録済みのルートを列挙でき、既知のルート（`GET /_api/v3/page/exist`、`GET /_api/search`、`GET /share/:linkId`）が含まれることを確かめるテストが通る。apiv1 やページ表示のルートを列挙できない方法を採った場合は、その範囲を research.md に書く
  - _Requirements: 3.3_

- [ ] 2. 匿名化に使う部品
- [x] 2.1 (P) ページパスのデコード・判定・ハッシュ化を独立した部品にする
  - 既存の page access の handler にあるデコード、ページとして扱えるかの判定、ハッシュ化を、動作を変えずに移す
  - ページとして扱えるかの判定から、`.` を含むパスの除外をやめる（静的ファイルの除外はパスの規則で行う）
  - 変更前の handler のテストにあったハッシュ値を、回帰の固定値として新しいテストに移す
  - 完了時: ASCII のページパス・ユーザーページ・非 ASCII（大文字・小文字のエンコード）・壊れたエンコード・`.` を含むページ名のテストが通り、変更前の固定値と一致する
  - _Requirements: 5.3, 6.1, 9.1, 9.2_
  - _Boundary: HashPagePath_

- [x] 2.2 (P) `:name` 形式のルートの型と URL パスを照合し、指定した区切りを置き換える部品を作る
  - `:name` は空でない 1 区切りに一致し、区切りの数が違えば一致しない
  - 完了時: 一致・不一致・指定した区切りだけが `[ANONYMIZED]` になること・指定しない区切り（例: ユーザーグループの ID）が残ることのテストが通る
  - _Requirements: 5.2, 7.1, 7.2_
  - _Boundary: PathPattern_

- [x] 2.3 (P) 指定した名前のクエリパラメータの値だけを置き換える部品を作り直す
  - クエリを `&` で区切り、名前（デコード後、末尾の `[]` を除く）が対象の区切りの値だけを置き換え、ほかの区切りは元の文字列のまま残す
  - 値が JSON 配列なら従来どおり `["[ANONYMIZED]"]` にする。同じ名前の繰り返し（`path=a&path=b`）はそれぞれ置き換える
  - 既存の handler が使っている間は既存の関数を壊さない。新しい関数は別名で追加し、handler を消すタスク（4.1）で古い関数を消して新しい関数をその名前にする
  - 完了時: 対象の名前・`name[]`・JSON 配列・繰り返し・ほかの区切りが変わらないこと・対象が無ければ入力と同じ文字列を返すことのテストが通る
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 6.4, 7.1, 9.1_
  - _Boundary: AnonymizeQueryParams_

- [ ] 3. 規則と実行関数
- [ ] 3.1 規則を受け取って URL を匿名化する実行関数を作る
  - URL をパスとクエリに分け、パスには最初に当てはまった規則を 1 つだけ、クエリには共通パラメータ名の置換を適用し、最後につなぐ
  - 画面内遷移用データ URL の規則では、中のパスを同じ規則の一覧に通して外側を付け直す
  - 何も変わらなければ「変化なし」を返す。想定外の例外では固定の `/[ANONYMIZATION_FAILED]` を返して警告を記録する
  - 規則の宣言は import せず、引数で受け取る
  - 規則・パス・規則の一覧の型（design.md の `RequestPath`、`PathRule`、`PathAction`、`AnonymizationRules`）をここで定義する
  - 秘密の値と API の区切りの規則はデコード前のパスを区切ってから照合し、どの規則もパスを変えなかった場合は元のパスの文字列をそのまま出力する
  - 完了時: テスト用の小さな規則で、規則の順序・パスとクエリの独立（片方の変換がもう片方を打ち消さない）・変化なし・データ URL の中への再適用・例外時の固定値のテストが通る
  - _Requirements: 1.5, 2.4, 2.5, 8.1, 8.2_
  - _Depends: 2.1, 2.2, 2.3_

- [ ] 3.2 パスの規則と共通パラメータ名を宣言する
  - design.md の表のとおり、8 つのパスの規則（データ URL・静的ファイル・秘密の値の区切り・API の区切り・残すページ・`.md`・ゴミ箱・ページ表示）をこの順で宣言する
  - データ URL の locale は `AllLang` で判定する
  - 共通で匿名化するパラメータ名（`q`、`nq`、`path`、`paths`、`fromPath`、`toPath`、`searchText`、`searchWord`、`username`、`shareLinkId`、`searchFilter`）を宣言する
  - `/static/`・`/images/` は最後の区切りが静的ファイルの拡張子（design.md の一覧）で終わるときだけ静的ファイルとして残す。データ URL の中のパスはデコード前の外側のパスから切り出す。`.md` の規則はユーザーページも対象にする
  - 完了時: 規則と共通パラメータ名を 1 つにまとめた宣言が公開され、実行関数に渡して代表的な URL（ページ表示・データ URL・共有リンク・API のページパス・拡張子の無い `/images/<ページ>`）が期待どおりに匿名化される
  - _Requirements: 2.4, 2.5, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 7.2, 7.3_

- [ ] 3.3 一覧表の各行に対応する例を宣言する
  - requirements.md「匿名化対象一覧」の全行（Q01、P01〜P13、N01〜N07、S01〜S04、U01〜U07、A01〜A09、K01〜K05、F01〜F02）について、同じ ID の例を 1 つ以上宣言する。各例は、URL・当てはまる規則・期待する `http.target`（変化なしを含む）を持つ
  - 例の型（design.md の `CoverageExample`）をここで定義する
  - API とページ表示のルートを持つ例には、Express のルートの型（例: `/_api/v3/page/exist`、`/share/:linkId`）と、GET 以外ならその HTTP メソッドを持たせる。正規表現付きで登録されたルートは、登録どおりの文字列にする（例: `/_api/v3/revisions/:id([0-9a-fA-F]{24})`）
  - 変更前のハッシュ値（`22ca1a8b9f281349`、`7aa6a8f4468baa96`、`2f4a824f8eacbc70`、`96d9632f363564cc` など）は、該当する行の期待値として固定する
  - 完了時: 一覧表の全行 ID に対応する例があり、各例の期待値が一覧表の「置換後の形」と食い違わない
  - _Requirements: 2.1, 2.2, 2.3, 9.2_

- [ ] 4. 組み込みと網羅テスト
- [ ] 4.1 hook を新しい実行関数に切り替え、既存の handler を廃止する
  - hook はリクエストの URL を実行関数と規則の宣言に渡し、結果があれば `http.target` と、URL 属性の組み立て（#12151）の結果を返す
  - 4 つの handler、その spec、module のインターフェース、古いクエリパラメータの置換関数を削除する
  - hook のテストを、handler 前提の部分を除いて新しい構成に合わせる
  - 完了時: 匿名化まわりのテストがすべて通り、handler を参照するコードが残っていない
  - _Requirements: 1.1, 1.3, 1.4, 1.5_
  - _Depends: 1.1_

- [ ] 4.2 一覧表とコード・挙動の網羅テストを作る
  - 全ての例を hook に通し、`http.target` と `http.url` が期待どおりであることを確かめる
  - requirements.md の一覧表の行 ID の集合と、例の ID の集合が一致することを確かめる（spec ファイルの場所は 1 つの定数にまとめる）
  - すべてのパスの規則と共通パラメータ名が、少なくとも 1 つの例から参照されていることを確かめる
  - 例を 1 つ消す・期待値を 1 つ変える・一覧表に行を 1 つ足すと、それぞれテストが失敗することを確かめてから元に戻す
  - 完了時: 網羅テストが通り、上記 3 通りの変更でそれぞれ失敗することを確認済み
  - _Requirements: 2.1, 2.4, 2.5, 3.1, 3.2, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 7.2, 7.3, 8.1, 8.2, 9.1, 9.2_

- [ ] 4.3 (P) 例に書いたルートが実在するかを確かめる integration テストを作る
  - 1.3 で確かめた起動方法で登録済みのルートを列挙し、ルートの型を持つすべての例について、HTTP メソッドとルートの型の組が列挙結果に等しさで含まれることを確かめる（末尾の `/` は取り除いて比べる）
  - 架空のルート（例: `/_api/v3/page/check-page-existence`）を持つ例を一時的に加えて失敗すること、失敗メッセージにそのルートが出ることを確かめてから元に戻す
  - 完了時: integration テストが通り、架空のルートで失敗することを確認済み
  - _Requirements: 3.3_
  - _Boundary: CoverageRoutesSpec_
  - _Depends: 1.3, 3.3_

- [ ] 5. 回帰の確認
- [ ] 5.1 変更前との比較と、計測部品を通した確認を行う
  - 変更前の handler と新しい実装に、同じ URL の集合（70 件以上。一覧表の全行と、変更前のテストの URL を含む）を流し、「変更前に匿名化されていて変更後に平文」が 0 件であること、ASCII のページパスのハッシュ値が同じであることを確かめる（比較用のコードはコミットしない）
  - hook の出力を HTTP の計測部品自身の属性生成に渡し、旧形式・新形式・両方の 3 通りで、どの URL 属性にも元の値が残らないことを確かめる
  - 匿名化が無効のときに hook が渡されないこと（`opentelemetry` spec 側の既存の振る舞い）を、既存のテストで確認する
  - 比較の URL の集合には、拡張子の無い `/images/<ページ>`・`/static/<ページ>`、`.` を含む `/images/v1.2`、`/download/<id>`、`/user/<名前>.md` を含める
  - 受信側への影響（新たに匿名化される URL、API のクエリが再エンコードされなくなること）を PR の説明用にまとめる
  - 完了時: 上記の結果（件数と、平文が 0 件であること）と受信側への影響を、PR の説明に書ける形で記録してある
  - _Requirements: 1.2, 1.3, 1.4, 8.1, 8.2, 9.1, 9.2_

- [ ] 5.2 apps/app 全体の lint・テスト・build を通す
  - `turbo run lint test build --filter @growi/app` 相当を実行する（routes 配下は触らないが、`tools/` と `test-utils` を変えるため lint 全体を回す）
  - 完了時: すべて成功する
  - _Requirements: 3.3_

- [ ] 6. `opentelemetry` spec から匿名化の部分を移し終える
  - `opentelemetry` spec の requirements.md から要件 6 を削除し、Boundary の範囲外に「HTTP の匿名化は `opentelemetry-anonymization` を参照」を加える。要件 10.2 を本 spec への参照に置き換える（要件番号は振り直さない）
  - design.md の Layer 4、Extension Templates「新規 Anonymization Handler の追加」、Revalidation Triggers の該当行、File Structure の `anonymization/` 部分、Requirements Traceability の 6.x 行を、本 spec への参照に置き換える
  - research.md の「Anonymization Handler の登録順とパターン」「Decision: Anonymization は best-effort, module-based, opt-in」を本 spec の research.md への参照に置き換える（誤っていた「複数 module が同一 URL を匿名化することは現状無い」は持ち込まない）
  - brief.md の Layer 4 の記述を本 spec への参照に置き換え、spec.json の `updated_at` を更新する（`phase` / `approvals` は変えない）
  - 完了時: `opentelemetry` spec の中で匿名化の契約を記述している箇所が、本 spec への参照だけになっている
  - _Requirements: 2.1_

## Implementation Notes

- 1.1: PR #12151 が未マージ（2026-10-27 時点）のため、実装ブランチは #12151 のコミット（`fix/otel-anonymize-http-url`）の上に載せた。#12151 のマージ後は `git rebase origin/master` でそのコミットが外れる。
- 検証コマンド: worktree の `node_modules` は本体チェックアウトへの symlink で、`pnpm vitest` / `pnpm run` は `pnpm install` を誘発して失敗する。`apps/app` で `node_modules/.bin/vitest run <パターン>` を直接使う。
- コミット: pre-commit hook は `pnpm biome` を呼び同じ問題で固まる。`node_modules/.bin/biome check` を手で通してから `git commit --no-verify` を使う。
- 1.3: ルート列挙の起動ヘルパーは `apps/app/test/setup/growi-routes.ts`（`listGrowiRoutes()`）。4.3 はこれを import して使う。`src/` に置くとサーバーの build に入るため `test/setup/` に置いた。integration テストは `cd apps/app && env -u MONGO_URI ../../node_modules/.bin/vitest run --project=app-integration <パターン>` で回す。
- 2.2: `matchPathPattern` / `redactPathParams` は素の `:name` だけを扱う（`:id([0-9a-f]{24})` のような正規表現付きは非対応）。3.2 のパス規則のパターンは素の `:name` で宣言する。末尾 `/` 1 つは許容して照合する（`/share/abc/` も匿名化される）。
- 2.3: 新しい関数は `anonymizeSearchParams(search, paramNames)`（`?` なしのクエリを受け取る）。4.1 で古い `anonymizeQueryParams` を消し、この関数を `anonymizeQueryParams` に改名する。
