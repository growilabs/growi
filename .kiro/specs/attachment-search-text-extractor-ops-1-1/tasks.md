# Implementation Plan

この spec は amend spec である。最後のタスク (9) が、変更を対象の spec に取り込み、この spec のディレクトリを削除する。実装が終わっても、9 が済むまでは完了ではない。

進め方の約束:

- 振る舞いを変えるタスクは、テストを先に書いて落ちることを確かめ (RED)、それから実装して通す (GREEN)。落ちたときの出力をタスクの記録に残す
- `pnpm install` は、ほかの pnpm・vitest・build の実行と同時に動かさない (`.claude/rules/devcontainer.md`)。抽出サービスの vitest は 1 つずつ動かす (`apps/attachment-text-extractor/AGENTS.md`)
- `git stash` を名前なしで使わない

- [x] 1. 古い要件番号を引くコメントを取り除く
  - `apps/attachment-text-extractor/` の `src`・`scripts`・`test`・`benchmark` から、`Req N.M` と `Requirement N.M` の形の参照 (2026-11-19 の時点で 68 ファイル、108 か所。うち約 30 か所はテストの名前 (`describe` / `it` の文字列) の中にある) を消す。テストの名前は番号を外した名前に変える (テストの中身は変えない)。`.github/workflows/ci-attachment-text-extractor.yml` の 122 行目のコメントの「Req 3.14 and 11.2」も消す (`if:` の中ではない、ジョブのステップの上の YAML のコメントである)
  - コードから読み取れない理由を述べているコメントは、番号なしの文として残す。何をしているかを言い直しているだけのコメントは、行ごと消す (`.claude/rules/coding-style.md`)。`research.md N.M` の形の節の番号、`(16.3)` のような番号、`D1`〜`D5` は、このタスクでは触らない
  - コメントとテストの名前以外を変えない。変更は 1 つの commit にまとめる
  - 終わった状態: 上の範囲で `grep -rnE "Req(uirement)?s? ?[0-9]+\.[0-9]+"` が 0 件。lint と抽出サービスの全テストが、変更の前と同じ件数で通る (名前だけが変わる)
  - 後のタスクが同じファイル (`bearer-auth.ts`、`request-log.ts`、`create-app.ts`、`child-env.ts` など) を変えるので、最初に行い、ほかと並べない
  - _Requirements: 8.1, 8.2, 8.3_

- [ ] 2. HTTP の層の下ごしらえ
- [x] 2.1 枠の使用中の数と上限を読めるようにし、枠をアプリの組み立てで作る
  - 先に、枠の単体テストで「取ると使用中の数が増え、返すと減る」「上限は設定した値 (0 や負の値もそのまま)」を書き、落ちることを確かめる
  - 枠を `/extract` の route の登録の中ではなく、アプリの組み立て (`createApp`) で 1 つ作り、route に渡す
  - 終わった状態: 枠の単体テストが通り、`/extract` の既存のテスト (503 `service_busy`、枠が返ること) が変わらず通る
  - _Requirements: 3.2_
- [x] 2.2 文書に載っている経路とトークンの要らないパスを 1 か所にまとめる
  - 経路のパスの一覧、トークンの要らないパスの一覧、送られた要求の文字列 (`?` より前) から経路のラベル (一致しなければ `other`) を決める関数を置く。`bearerAuth` の判定はこれを使う
  - このタスクでは `/metrics` をまだ加えない (振る舞いを変えない)
  - 終わった状態: ラベルを決める関数の単体テスト (`/./healthz`、`/%68ealthz`、`//healthz`、`http://test/healthz`、`?` の付いた要求が、`open-path-targets.integ.ts` と同じ結論になる) と、既存の `open-path-targets.integ.ts`・`bearer-auth.integ.ts` が通る
  - _Requirements: 3.3, 3.8_

- [ ] 3. 抽出サービスの個別の変更
- [x] 3.1 呼び出し元の app をログの行に出す
  - 先に次のテストを書き、落ちることを確かめる: ヘッダーが無い → 行の最後が `app=-`、形に合う値 → `app=<値>`、空・65 文字・形に合わない文字・同じヘッダー 2 つ → `app=(invalid)` で値は行に出ない。本文を読む前に断る 5 つの理由 (`service_busy`、`file_too_large`、`upload_timeout`、`invalid_upload`、`client_disconnected`) の行にも付く。値を変えても、ステータスと本文が同じ
  - 行の形を `$` で固定しているテスト (`request-log.integ.ts`、`diagnostic-log.integ.ts`、`extract-limits.integ.ts`) を、`app=` まで含む形に直す。メモリの計測の道具の見本の行 (`report.spec.ts`) に `app=` の付いた行を足し、読めることを確かめる
  - 形の正規表現は 1 か所に置く (3.2 が OpenAPI の文書で同じものを使う)。ヘッダーは route の最初、宣言された長さの確かめと枠より前に読む
  - 終わった状態: 上のテストがすべて通り、ログの行が `extract format=… size=… duration_ms=… result=… child_peak_rss_mb=… app=…` になる
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_
- [x] 3.2 OpenAPI の文書にヘッダーを載せ、版を 1.1.0 にして、生成クライアントを作り直す
  - `POST /extract` の `describeRoute` に、任意のヘッダー `X-Growi-App-Id` (3.1 の正規表現を `pattern` にした文字列) を足す。文書の `info.version` を `1.1.0` にする
  - 書き出しの手順で `packages/attachment-text-extractor-client/openapi.json` を書き出し直して biome で整え、orval で生成クライアントを作り直す (`apps/attachment-text-extractor/AGENTS.md` の手順)
  - 終わった状態: 書き出した文書に `parameters` が 1 つ加わり、`info.version` が `1.1.0` になっている。`export-openapi.integ.ts` が通る。生成クライアントの差分が先頭のコメントの版の行だけである (関数と型が変わっていない)
  - _Depends: 3.1_
  - _Requirements: 1.7, 9.3_
- [x] 3.3 (P) `/readyz` の結果を 10 秒覚える
  - 先に、時計を差し替えたテストを書き、落ちることを確かめる: 確認が終わってから 10 秒以内の呼び出しは確認用の子を起動せず同じ結果を返す、10 秒を過ぎたら確かめ直す、準備未完了の結果も覚える、確認の実行中に届いた呼び出しは 1 回の確認を共有する
  - 覚える期間は確認が終わった時点から数え、期間はコードの定数にする (環境変数にしない)。`health-routes.ts` と `readiness.ts` の「覚えない」と書いたコメントを直す
  - 終わった状態: 上のテストと、既存の readiness のテスト (準備未完了から戻ること、ログの行が溢れないこと) が通る
  - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - _Boundary: Readiness_
- [x] 3.4 (P) ZIP の検査を通せない PPTX / XLSX を断る
  - 先に、research.md §3.1 の形でテストを書き、落ちることを確かめる: 10 万セルの XLSX に `xl/workbook.xml` をもう 1 つ足したもの、扱えない版の印のエントリを 1 つ足したもの、UTF-8 の印と合わない名前のエントリを足したもの、12,000 エントリに扱えない版の印のエントリを足したものが、変換されずに `malformed` になる。PPTX でも、必要な部品が 2 つのもの、無いものが `malformed` になる
  - `archive-guard.spec.ts` の「passes … through」のテストのうち、ZIP である形 (必要な部品が無い、2 つある、空の ZIP、扱えない版の印、UTF-8 の印と合わない名前) を「`malformed` で断る」に書き換える。ZIP でない形 (空、テキスト、途中で切れた ZIP、中央の一覧が無い、暗号化された OOXML) は「通す」のまま残す。zip64 の部品を受け付けるテストも残す
  - `inspectArchive` の `null` を「ZIP でない」だけの意味にし、ほかの場合は `malformed` の例外にする。`ErrorCode`・ステータス・OpenAPI の文書は変えない
  - 終わった状態: 上のテストが通り、暗号化された PPTX / XLSX が `file_encrypted`、旧形式の PPT / XLS が今と同じ結果になる (既存のテスト)。research.md §3.3 の記録 (以前の動き・いまの動き・合わせない理由) が、テストのコメントではなく spec にあることを確かめる
  - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - _Boundary: ArchiveGuard_
- [ ] 3.5 (P) PDF と PPTX のページごとに結果の大きさを確かめる
  - 先に次のテストを書き、落ちることを確かめる: 上限を超えるスライドの後に anydoc が `malformed` を返すスライドを置いた PPTX が、`result_too_large` になる (途中で止まったことを結果の違いで確かめる)。1 ページで上限を超える PDF が `result_too_large` になる。CRLF を含むスライドで、LF に揃えた後の大きさが上限ちょうどなら通る
  - 数え方 (改行を LF に揃えた `content` の UTF-8 のバイト数。`label` は数えない) を 1 か所に置き、PDF の繰り返し、PPTX の繰り返し、`assemblePages` がそれを使う。`assemblePages` の最後の確かめは残す
  - 終わった状態: 上のテストと、既存の結果の大きさのテスト (`label` が巨大な XLSX が通る、など) が通る
  - _Requirements: 6.1, 6.2, 6.3_
  - _Boundary: ResultBudget_

- [ ] 4. `/metrics`
- [ ] 4.1 `@prometheus-io/client` を本番の依存に加える
  - 先に、本番の依存の一覧のテスト (`production-dependencies.spec.ts`) に `@prometheus-io/client` を足し (11 → 12 個。テスト名とコメントも直す)、層の規則 (`layer-rules.ts` の `PACKAGE_RULES`) で `@prometheus-io/client` を HTTP の層だけに許す。層のテストに、HTTP の層の外で import すると落ちる合成の例を足す
  - `pnpm install` で `apps/attachment-text-extractor/package.json` と `pnpm-lock.yaml` に加える (ほかの pnpm の実行と同時に動かさない)
  - `@prometheus-io/client` とその依存のすべてのライセンス (research.md §1 では Apache-2.0 と MIT)、install のときのスクリプトの有無、この spec が使う API の名前を、`pnpm-lock.yaml` に入った実際の内容で確かめ、research.md §1 に記録する。許容的でないライセンスや、使う API が無いことが分かれば、先に進まず人に諮る
  - 終わった状態: 依存の一覧のテストと層のテストが通り、ライセンスの記録が research.md にある
  - _Requirements: 3.1_
- [ ] 4.2 指標を集め、`GET /metrics` で答える
  - 先に次のテストを書き、落ちることを確かめる: トークンなしの `GET /metrics` が 200 で Prometheus のテキスト形式を返す。`/./metrics`・`/%6Detrics` などはトークンなしで 401 (`open-path-targets.integ.ts` に足す)。401・404・`/extract` の成功と失敗の後に、`attachment_extractor_http_responses_total` が経路とステータスごとに増える (存在しないパスは `other`)。偽の runner で変換を止めている間、`attachment_extractor_slots_in_use` が増え、終わると戻る。`attachment_extractor_slots_max` が `MAX_CONCURRENCY` と同じ。`/extract` の結果ごとの件数とヒストグラムが増え、まだ起きていない結果も 0 で出ている。`LOG_LEVEL=ERROR` でも結果の件数が増える。`X-Growi-App-Id` の値がどのラベルにも出ない。`/metrics` の呼び出しでログの行が増えない。プロセスの既定の指標 (CPU、メモリ、イベントループの遅れ) が出ている
  - 応答を数える middleware を `bearerAuth` より前に置く。結果と所要時間は、ログの行を書く関数から渡す。registry はアプリごとに 1 つ作る
  - `/metrics` には `describeRoute` を付けない (OpenAPI の文書に載せない)
  - 終わった状態: 上のテストが通り、`export-openapi.integ.ts` が 3.2 の後と同じ文書で通る
  - _Depends: 2.1, 2.2, 3.1, 4.1_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

- [ ] 5. (P) apps/app が app の ID を送る
  - 先に次のテストを書き、落ちることを確かめる: 設定 `app:growiAppIdForCloud` に `'4242'` があると、`postExtract` に渡す axios の `headers` に `X-Growi-App-Id: 4242` と `Authorization` が両方入る。設定が無い・空・空白を含む・改行を含む・非 ASCII を含むときは `X-Growi-App-Id` が入らず、抽出は続く。値は呼ぶたびに読み直される
  - ヘッダーに入れるかどうかの判定は純関数にする (文字列が空でなく、0x21〜0x7E の文字だけでできている)。値は `String(value)` で扱い、数であることを前提にしない (research.md §2.3)
  - このファイルはすでにサーバの処理の中で `configManager.getConfig` を呼んでいるので、同じ読み方に合わせる
  - 終わった状態: 上のテストと `attachment-text-extractor` の既存のテスト (apps/app 側) が通り、`turbo run lint --filter @growi/app` が通る
  - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - _Boundary: AttachmentTextExtractorService (apps/app)_

- [ ] 6. 運用者向けの文書と、サービスの説明書を直す
  - `docker/README.md`: 公開タグの一覧に `1.1.0`、`1.1` を加え (`1`、`latest` も 1.1.0 を指す。Dockerfile の link のタグは `attachment-text-extractor/v1.1.0`)、`1.0.0`、`1.0` の行を残す。ログの節に `app=` (値の意味と、自己申告で判断に使わないこと) と、`/metrics` (指標の名前、トークンなしで開いていて内向きの通信の制限で守ること、親のプロセスの値で子を含まないこと、自動スケールに `slots_in_use / slots_max` を使えること、数えない答え) を書く。「a request refused with 401 leaves no line」は残し、`/metrics` で数えることを足す。Health checks の節に、`/readyz` の結果を 10 秒覚えることと、確認の間隔を 10 秒以下にしないことを書き、「neither path needs the token」をトークンの要らない 4 つのパスの記述にする
  - `docker/README.md` の「Non-root, read-only, no privileges.」の段落の後に、子と親の環境変数の段落を置く。書く強さは research.md §5.4 の範囲を超えない (確かめた環境、確かめていない環境 (image の中、GROWI.cloud のノード)、親のメモリはノードの ptrace の設定によること、対策は未決であること)
  - `apps/attachment-text-extractor/AGENTS.md`: API の一覧に `GET /metrics`、Invariants のトークンの項 (子には渡さないが、同じ uid の子は親の環境変数を読めること)、トークンの要らないパスの項 (4 つ)、ログの行の項目 (`app=`) を直す
  - コードのコメントのうち、トークンの要らないパスを 3 つと書いたもの (`bearer-auth.ts`、`create-app.ts`) を、2.2 と 4.2 の後の形に合わせる
  - 終わった状態: 上の記述が直っていて、`/healthz`・`/readyz`・`/openapi.json` の 3 つだけが開いていると書いた箇所が、抽出サービスのディレクトリに残っていない (`grep` で確かめる)
  - _Depends: 4.2_
  - _Requirements: 7.1, 7.2, 7.3, 9.2_

- [ ] 7. 版 1.1.0 の changeset を書き、全体を確かめる
  - `.changeset/` に `'@growi/attachment-text-extractor': minor` の changeset を 1 つ書く。生成クライアントの package には書かない (research.md §8.2)
  - 確かめること: `turbo run lint test --filter @growi/attachment-text-extractor`、生成クライアントの package の lint と build、`turbo run lint test build --filter @growi/app` (apps/app の CI と同じく、生成クライアントを作り直して commit 済みと同じであること)
  - 終わった状態: 上がすべて通り、changeset が 1 つだけある
  - _Requirements: 9.1_

- [ ] 8. 公開の前の、人の確認
- [ ] 8.1 メモリの計測を含む CI を手で起動して確かめる
  - push は外に向けた操作なので、ユーザーの承認を得てから行う。PR のブランチで `gh workflow run ci-attachment-text-extractor.yml --ref <branch>` を起動する
  - `gh api repos/<org>/<repo>/actions/runs/<id>/jobs` で、ジョブの数が 0 より多く、linux/amd64 と linux/arm64 の両方の image の確認とメモリの計測のステップが成功していることを確かめる (0 ジョブの実行は成功とみなさない)。メモリの計測が `app=` の付いた行から子の最大 RSS を読めていること (計測の失敗の条件「子の最大 RSS がログに無い」に当たらないこと)、image の大きさが 400MB 以下であることを確かめる
  - 終わった状態: 実行の id、ジョブの数、image の大きさ、計測の値が、PR の説明か research.md に記録されている
  - _Requirements: 9.4_
- [ ] 8.2 「Release Subpackages」の PR をマージする前に、人が確かめる
  - この spec の PR が master にマージされると、changesets が「Release Subpackages」の PR を作る。それをマージすると、`release-attachment-text-extractor.yml` が Docker Hub に `1.1.0` を公開する
  - マージの前に人が確かめること: 8.1 の結果、PR の中の `apps/attachment-text-extractor/package.json` の版が `1.1.0` であること、CHANGELOG の中身、同じ PR に入るほかの package の版の変化
  - 終わった状態: 人がマージを判断した記録 (PR の承認かコメント) がある。公開の後、Docker Hub に `1.1.0` があり、git のタグ `attachment-text-extractor/v1.1.0` が打たれている
  - _Requirements: 9.4_

- [ ] 9. 対象 spec に取り込み、この spec を消す
- [ ] 9.1 `attachment-search-text-extractor` の requirements.md・brief.md・design.md を書き直す
  - design.md の「取り込みの計画」の一覧のとおりに直す。この spec の変更が最初からあったように書き、「以前は覚えなかった」などの経緯を本文に残さない
  - requirements.md は既存の番号を変えず、末尾に Req 8 (この spec の Req 1)、Req 9 (Req 3) を足し、Req 2 の末尾に AC 2.10〜2.13 (Req 5)・AC 2.14〜2.16 (Req 6)、Req 3 の末尾に AC 3.5〜3.8 (Req 4)・AC 3.9〜3.11 (Req 7) を足す (番号の対応は brief.md の「Port-back の前提」)。AC 7.1 の文書に載せるものに、任意のヘッダーを足す (番号は変えない)
  - design.md の Revalidation Triggers に、この spec の design.md の Revalidation Triggers の 4 つを足す
  - 終わった状態: 2 つの文書に「結果は覚えない」「認証の要らない 3 つのパス」「トークンは子に渡らない」だけを書いた箇所が残っていない (`grep` で確かめる)
  - _Requirements: 10.1_
- [ ] 9.2 設計の理由と実験の記録を、対象 spec の research.md に移す
  - この spec の research.md の §1〜§8 を、`attachment-search-text-extractor` の research.md の新しい節として移す (§2.3・§2.4 は `attachment-search-indexing` の research.md へ)。§1.4 に `@prometheus-io/client` とその依存のライセンスを足す。§5.6 に orval がヘッダーから何も作らないことを足す。§5.7 と §5.9 (884 行) を直す
  - 対象 spec の research.md §8 の前書きを直し、§8.2 の表を消す (コメントが要件番号を引かなくなったため)
  - 終わった状態: この spec のディレクトリを消しても失われる根拠が無い
  - _Requirements: 10.2_
- [ ] 9.3 `attachment-search-indexing` に取り込む
  - requirements.md の Req 1 の末尾に AC 1.5〜1.8 (この spec の Req 2) を足す。design.md の AttachmentTextExtractorService (Bearer auth の項の並び) と Testing Strategy に、ヘッダーの付け方を足す
  - 終わった状態: 2 つの文書がヘッダーを送ることを、最初からそうだったように書いている
  - _Requirements: 10.1_
- [ ] 9.4 `attachment-search` の roadmap.md を直す
  - (f) の抽出サービス側の 5 項目を消す。(h) の「呼び出し元の app を抽出サービスのログに出す」の項を消す。(h) の「同時に処理中の、ほかの顧客のファイルを守る」の最後の項目を「子が親の環境変数を読めることは `docker/README.md` に書いた (手元の実験で確かめた。GROWI.cloud のノードでは未確認)。対策は未決」に書き換える。(h) の自動スケールの指標の項目を、`/metrics` の枠の指標を使える形に書き換える。(h) のほかの項目は残す
  - spec の一覧からこの spec の行を消す
  - 終わった状態: roadmap.md に、終わった項目とこの spec への参照が残っていない
  - _Requirements: 10.3_
- [ ] 9.5 対象 spec の spec.json を更新し、この spec を削除する
  - 消す前に、steering (`.kiro/steering/`) とほかの spec から、この spec のファイルを名前で参照している箇所を `grep` で探す。あれば、中身を対象 spec の research.md に移して参照を書き換える
  - `attachment-search-text-extractor` と `attachment-search-indexing` の `spec.json` の `updated_at` だけを更新する (`phase` と `approvals` は変えない)
  - `.kiro/specs/attachment-search-text-extractor-ops-1-1/` を削除し、参照が残っていないことを `grep` で確かめる
  - _Requirements: 10.4_
- [ ] 9.6 運用の手引きに反映してほしい変更の一覧を、完了の報告に載せる
  - 運用の手引き (GROWI の外で管理している文書) が拾うべき変更を一覧にして、完了の報告に書く: ログの行の最後の `app=` (値の意味と、自己申告であること)、`/metrics` (指標の名前、トークンなしで開いていること、内向きの通信の制限で守ること、自動スケールの指標)、`/readyz` の結果を 10 秒覚えること (確認の間隔を 10 秒以下にしない)、子が親の環境変数を読めることの注記、新しい image のタグ `1.1.0`
  - 終わった状態: 完了の報告に上の 5 項目がある
  - _Requirements: 10.5_

## Implementation Notes

- (zip-extent.ts と archive-guard.ts の「research.md §3」「§3.2」も同様。)
- コードのコメントが「research.md §N」「research §N.M」でこの spec の research.md の節を指している箇所 (3.1 の `src/http/app-label.ts`: §2.1・§2.5、3.3 の `src/runner/conversion-runner.ts`・`src/runner/readiness.ts`・`src/http/health-routes.ts`・`src/runner/runner-diagnostics.integ.ts`: §4。以降のタスクで増えうる) は、タスク 9.2 で research.md を対象 spec の新しい節として移すときに、移した先の節番号へ書き換える。この spec のディレクトリは 9.5 で消えるので、そのままにすると参照先が消える (`grep -rn "research" apps/attachment-text-extractor/src` で探す)。
- この worktree では lefthook の pre-commit が完走しないので、biome・テスト・tsgo を手で通したうえで `git commit --no-verify` を使う。
