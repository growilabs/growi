# Requirements Document

## Project Description (Input)

### 問題

添付ファイル抽出サービス `services/attachment-text-extractor/` は、GROWI の monorepo でただ 1 つの Python のコードである。monorepo のほかの部分は Node / TypeScript で書かれているため、このサービスだけ別の言語・別の道具・別の CI で保守し続けることになる。

### 現状

- 対象 spec `attachment-search-text-extractor` は実装と cleanup が済み、Python 3.12 + FastAPI のサービスとして動いている (src 約 3,700 行、tests 約 11,300 行、テスト 1,222 件)。
- Office 系の変換に使う anydoc は npm (`@firecrawl/anydoc@0.2.4`) にもあり、Python 版と同じ Rust の核を使う。
- PDF、テキスト系、子プロセスの管理は Python のライブラリと OS の機能 (`setrlimit`、forkserver) に頼っており、Node ではそのまま使えないものがある。

### 達成したい姿

抽出サービスを Node.js + Hono + `@firecrawl/anydoc` で書き直し、外から見える振る舞いを変えずに、monorepo と同じ言語で保守できるようにする。目的は保守のしやすさであり、性能や抽出の質の向上ではない。

詳細は [brief.md](./brief.md) を参照。

## Introduction

本 spec は、完了済みの spec `attachment-search-text-extractor` (以下「対象 spec」) の実行基盤を書き換える **amend spec** である (`.claude/rules/spec-lifecycle.md`)。変わる契約と変わらない契約の一覧は [brief.md](./brief.md) の「Amend target」節にある。

**番号の読み方**: この文書で「1.1」のように書いた番号は、この spec の要件の番号である。対象 spec の Acceptance Criteria を指すときは、必ず「対象 spec の AC 1.1」と書く。

**技術名を要件に書いている理由**: 通常の requirements では、言語やフレームワークの名前は design に回す。この spec は実行基盤を Node.js + Hono + `@firecrawl/anydoc` に替えること自体が目的なので、これらの名前を要件 (主に Req 4) にそのまま書く。後のレビューでこれらを「実装の詳細」として取り除かないこと。一方、まだ決まっていない選択 (PDF のライブラリ、子プロセスの作り方、OpenAPI の作り方、配置) は要件では決めず、「何を測って、誰が決めるか」だけを Req 11 に書く。

**契約の維持は「既定の方針」である**: Req 1 と Req 7 が求める契約の維持 (API・エラー・設定・OpenAPI・生成クライアントを変えないこと) は、書き換えの作業を単純にするために置いた既定の方針である。守ろうとすると apps/app や書き換えた後の抽出サービスが複雑になる場合は、Req 1.9〜1.13 の手続きに従って崩してよい。判断の基準は「シンプルさ (保守性) が上がるか」である。ただし Req 1.13 に挙げた不変条件 (セキュリティ上の性質、メモリの予算 2Gi、対応形式と位置情報つきの抽出) は崩さない。

**検索の品質はベンチマークで守る**: Req 2 は、Python 版と一字一句同じ出力を求めない。代わりに、検索で見つかるべき語句と位置の正解を付けた評価用の文書の集まり (ベンチマーク) で、Node 版が Python 版を下回らないことを求める。

**この spec の要件の性質**: Req 1〜3 は「Python 版と同じであること」を確かめる要件で、比べる相手の Python 版が消えた後は意味を持たない。Req 6、10、11、12 は書き換えの作業の間だけ意味を持つ。書き換えの後も成り立ち続けるのは Req 4、5、7〜9 で、取り込みの扱いは brief.md の「Port-back の前提」に従う。

## Boundary Context

- **In scope**:
  - `services/attachment-text-extractor/` の中身を Node 版に置き換えること (src、tests、Dockerfile、`deploy/k8s/`、CLAUDE.md、scripts)
  - OpenAPI の書き出し手順の置き換えと、書き出した文書がいまと同じであることの検査
  - CI workflow と docker-compose のエントリの追従
  - 配置の決定に伴う workspace と turbo の設定の変更 (workspace に入れると決めた場合だけ)
  - Python の資産の撤去
  - 未決事項を試作と計測で決めること
- **Out of scope**:
  - 機能の追加 (新しい形式、新しい設定項目、新しいエンドポイント)
  - HTTP の契約の変更 (ただし既定の方針として。守ると複雑になる場合は Req 1.9〜1.13 の手続きで崩してよい)
  - Python 版と Node 版の並行運用
  - Bun / Deno / Rust での実装
  - 下流 spec (`attachment-search-indexing`、`attachment-search-ui`) と apps/app の変更 (ただし既定の方針として。Req 1.9 で契約を崩した場合は、その結果として要る下流の変更を Req 1.11 の範囲で同じ作業に含める)
  - 抽出サービスを apps/app のプロセスの中で動かすこと
  - 性能や抽出の質を上げるための変更 (検索の品質を Python 版より下げないことは Req 2 で求める)
- **Adjacent expectations**:
  - 下流の apps/app は、`openapi.json` から orval で作った生成クライアントで `POST /extract` を呼ぶ。既定では、この spec は生成クライアントの型・関数・引数が変わらないことを保証する。契約を崩した場合は、生成クライアントと apps/app の呼び出し側を同じ作業で直す (Req 1.11)
  - `@firecrawl/anydoc@0.2.4` が linux x64 / arm64 向けのビルド済みのネイティブ部品として npm から取れることを前提にする
  - Docker / Kubernetes の実行環境 (cgroup、seccomp、NetworkPolicy に対応した CNI) は対象 spec と同じものを前提にする

## Requirements

### Requirement 1: 外から見える契約の維持

**Objective:** 抽出サービスの利用者 (apps/app) と運用者として、実行基盤が替わっても API とエラーの扱いが、既定では同じであってほしい。なぜなら、下流のコードと運用の手順を変えずに済ませれば書き換えの作業が単純になるから。ただし、守ることでかえって apps/app や抽出サービスが複雑になるなら崩してよい。シンプルさは保守性を上げるから。

1.1〜1.8 は既定の方針である。崩してよい条件と手続きは 1.9〜1.12、崩せない不変条件は 1.13 に書く。

#### Acceptance Criteria

1. The 抽出サービス (Node 版) shall 対象 spec の requirements.md の AC 1.1〜4.2 をすべて、番号と文言を変えずに満たす
2. The 抽出サービス (Node 版) shall `POST /extract` (multipart の `file` と任意の `mimeType`)、`GET /healthz`、`GET /readyz`、`GET /openapi.json` を提供し、それぞれの成功時の応答の形を Python 版と同じにする (FastAPI が既定で出している `/docs` と `/redoc` の画面を残すかどうかは Req 11.9 で決める)
3. When 対象 spec の design.md §Error Handling の表のいずれかの行の条件が起きる, the 抽出サービス (Node 版) shall その行と同じ `ErrorCode` と同じ HTTP ステータスを返す (たとえば、呼び出し側の切断は 422 `extraction_failed`、結果を送る前に子プロセスが終わった場合は 500 `extraction_failed`)
4. The 抽出サービス (Node 版) shall 対象 spec の design.md §Configuration の表にある環境変数を、同じ名前・同じ既定値・同じ意味で受け付ける (`WORKERS` の扱いは Req 11.9 の決定に従い、`MAX_CHILD_RSS_MB` と `MAX_XLSX_CELLS` の既定値は Req 11.11 に従って下げた場合だけその値にする)
5. If `ATTACHMENT_EXTRACTOR_SERVICE_TOKEN` が設定されていない、または空白だけである, the 抽出サービス (Node 版) shall 起動せずに終了する
6. The 抽出サービス (Node 版) shall 認証なしで呼べるパスを `/healthz`、`/readyz`、`/openapi.json` の 3 つだけにし、それ以外のパス (存在しないパスを含む) へのトークンのない要求には 401 `unauthorized` を返す
7. When 1 件の `POST /extract` が終わる, the 抽出サービス (Node 版) shall 形式・大きさ・所要時間・結果・子プロセスの最大 RSS を 1 行のログに出し、ファイル名・ファイルの中身・Authorization ヘッダはログに出さない
8. The 抽出サービス (Node 版) shall エラー応答の `message` にファイルの中身と内部の例外の文字列を含めない
9. Where 1.1〜1.8 または Req 7.1〜7.4 の既定の方針を守ることで、apps/app または書き換えた後の抽出サービスが複雑になる, the 書き換え作業 shall その方針を崩してよい。崩すかどうかはこの spec の作業者が「シンプルさ (保守性) が上がるか」を基準に判断し、判断は 1.10 のとおり記録する
10. When 既定の方針を崩すと判断する, the 書き換え作業 shall 崩す前に、(a) 何を崩すか、(b) それを守ると何がどう複雑になるか、(c) 崩した結果として要る下流の変更の範囲、を research.md に記録する
11. When 既定の方針を崩す, the 書き換え作業 shall 崩した結果として要る下流の変更 (apps/app の抽出サービスのクライアントの呼び出し側、`packages/attachment-text-extractor-client` の `openapi.json` と生成クライアント、`attachment-search-indexing` などの下流 spec の記述) を同じ作業に含め、下流 spec を変える場合はその spec をこの spec の Amend target に加える
12. When 既定の方針を崩す, the 書き換え作業 shall 崩した内容を design.md の Revalidation Triggers に書き、取り込み (Req 12) で対象 spec の AC と design.md を更新し (AC は番号を振り直さず文言を更新する。以前の文言や経緯は本文に残さない)、完了の報告でユーザーに明示する
13. The 書き換え作業 shall 次のものを 1.9 の例外の対象にせず、崩さない: 認証 (1.5、1.6)、サービスのトークンを子プロセスに渡さないこと (Req 3.8)、子プロセスでの隔離 (Req 3.4、3.5、3.9〜3.12)、ファイルの中身や入力を返さないエラー応答とログ (1.7 のうち出さない項目、1.8)、メモリの予算 2Gi (Req 3.14)、対象 spec の対応形式 (対象 spec の AC 1.1〜1.8)、位置情報つきの抽出 (対象 spec の AC 1.2〜1.4)

### Requirement 2: 変換結果の同等性

**Objective:** 全文検索の利用者として、書き換えの後も、添付ファイルが書き換えの前と同じかそれ以上に検索で見つかってほしい。なぜなら、書き換えによって検索の品質が落ちてはならないから。出力が Python 版と一字一句同じである必要はない (anydoc を使った結果として自然な出力ならよい)。

#### Acceptance Criteria

1. When anydoc を使う形式 (DOCX / XLSX / PPTX / RTF / EPUB / CSV・TSV / 旧形式 DOC・XLS・PPT / OpenDocument) のファイルが渡される, the 書き換え作業 shall Python 版と文字単位で同じであることは求めず、比較用のファイルの集まりについて Node 版と Python 版の `pages[]` の違いを記録する
2. When PDF、HTML、XML、ipynb、またはその他のテキスト系のファイルが渡される, the 書き換え作業 shall 比較用のファイルの集まりについて Node 版と Python 版の `pages[]` を比べ、違いを記録する (合否は 2.12 のベンチマークで決め、この記録は原因を調べるための材料とする)
3. If 2.1 または 2.2 で違いが見つかっても 2.12 のベンチマークで退行していない, the 書き換え作業 shall 違いを記録するだけにし、ユーザーに判断を求めない (退行した場合の扱いは 2.14)
4. The 比較用のファイルの集まり shall 日本語の PDF (横書き・縦書き・語の途中で改行が入るものを含む)、Shift_JIS / EUC-JP / ISO-2022-JP / BOM 付き UTF-8 / UTF-16 のテキスト、`<meta charset>` を持つ HTML、script / style を含む HTML を含む
5. The 抽出サービス (Node 版) shall 改行コードの統一をすべての経路にかけ、日本語の間の 1 文字分の空白・改行の詰めを PDF の経路だけにかける (対象 spec の AC 1.9 と同じ範囲)
6. The 抽出サービス (Node 版) shall 対象 spec の残存ギャップに書かれた既知の制約 (PowerPoint の自動代替テキストと同じ形の行が消える、`.csv` に `application/vnd.ms-excel` が付くと XLS として扱われる、BOM のない UTF-16 は判定できない、`label` は番号だけの文字列) を、既定では Python 版と同じ振る舞いのまま保ち、変わった場合は research.md に記録する
7. The 書き換え作業 shall 検索の品質を測る評価用の文書の集まり (以下「ベンチマーク」) を作る。ベンチマークは、形式ごと (少なくとも PDF / DOCX / XLSX / PPTX / XLS / CSV / HTML / TXT) に日本語を含む文書を持ち、日本語の PDF を必ず含み、2.4 のファイルを含む。文書は既存のテスト用のファイルと、テスト用のファイルを作る仕組みを使って作ってよい
8. The ベンチマーク shall 各文書に、検索で必ず見つかるべき語句・フレーズと、それが現れるべき位置 (PDF はページ、PPTX はスライド、XLSX はシートの番号と名前) を正解として付ける
9. The ベンチマーク shall 形式ごとに次の指標を測る: (a) 正解の語句が抽出したテキストに現れる割合 (再現率)、(b) 位置の正しさ (`pages[]` の要素の数と、各要素の `pageNumber` と `label` が正解と合っているか、正解の語句が正しい位置の要素に現れるか)、(c) 日本語の文字化けと、語の途中に空白や改行が入る分断が無いこと
10. Where ベンチマークを動かす環境で実際の Elasticsearch (kuromoji の解析器を使う設定) が使える, the ベンチマーク shall 抽出したテキストを投入し、正解の語句で検索したときにその文書 (と位置) が見つかる割合も測る
11. The 書き換え作業 shall Node 版を測る前に、同じベンチマークで Python 版を測り、その結果を基準 (ベースライン) として research.md に記録する
12. The 抽出サービス (Node 版) shall ベンチマークのすべての形式とすべての指標で、Python 版のベースラインを下回らない
13. When ベースラインを測り終える, the 書き換え作業 shall ベースラインに加えて絶対値の合格の基準 (下限) を置くかどうかと、その値を、ユーザーの判断を受けて research.md に記録する
14. If ある形式のある指標で Node 版がベースラインを下回る, the 書き換え作業 shall 原因 (部品の違い。たとえば PDF の部品が pypdfium2 から WASM の PDFium に替わったこと) を調べて research.md に記録し、直すか受け入れるかをユーザーに諮り、ユーザーの判断なしに受け入れない
15. The 抽出サービス (Node 版) shall 位置情報 (PDF のページ、PPTX のスライド、XLSX のシート) を、検索の品質の一部として 2.9 (b) の指標でベースラインを下回らずに保つ

### Requirement 3: リソースの保護と隔離の同等性

**Objective:** SRE / 抽出サービスの運用者として、悪意あるファイルや重いファイルへの守りが書き換えで弱くならないでほしい。なぜなら、共有の Deployment で 1 件の異常が他のテナントの抽出を止めてはならないから。

#### Acceptance Criteria

1. When 宣言された `Content-Length` が上限を超える, the 抽出サービス (Node 版) shall 同時実行の枠を取らず、本文を読まずに 413 `file_too_large` を返す
2. While 同時実行の枠に空きがない, the 抽出サービス (Node 版) shall 本文を受け取らずに、待たずに 503 `service_busy` を返す
3. When 枠を取った後に本文を受け取る, the 抽出サービス (Node 版) shall 本文をメモリにだけ置き (一時ファイルを作らない)、実際に届いたバイト数で大きさの上限を判定し、`UPLOAD_TIMEOUT_S` (既定 15 秒) を過ぎたら 408 `extraction_timeout` を返す
4. When 変換が `TIMEOUT_S` (既定 55 秒) を超える、または変換中の子プロセスの RSS が `MAX_CHILD_RSS_MB` を超える, the 抽出サービス (Node 版) shall 変換を行っている子プロセスそのものを止めて回収し、枠を返してから応答する
5. When 呼び出し側が変換の途中で接続を切る, the 抽出サービス (Node 版) shall 変換を行っている子プロセスを止めて回収し、枠を返す
6. When CSV / TSV が `MAX_CSV_BYTES` を、HTML が `MAX_HTML_BYTES` を超える, the 抽出サービス (Node 版) shall 子プロセスを作らずに 422 `resource_limit_exceeded` を返す
7. If XLSX の全シートのセル数の合計が `MAX_XLSX_CELLS` (既定 70,000) を超える、または PPTX / XLSX の ZIP のエントリ数・申告された展開後の大きさの合計が上限を超える, the 抽出サービス (Node 版) shall anydoc を呼ばずに 422 `resource_limit_exceeded` を返す
8. The 抽出サービス (Node 版) shall サービスのトークンを子プロセスの環境変数に渡さない
9. The 抽出サービス (Node 版) shall 子プロセスから親プロセスへの結果を、長さを先に付けた JSON として 1 回だけ受け取り、親の側で子が送ったデータをコードとして解釈しない
10. If 1 件の変換で子プロセスが異常終了する (Rust の panic による abort、segfault、OS による強制終了を含む), the 抽出サービス (Node 版) shall そのリクエストに 500 `extraction_failed` を返し、受け付け中の他のリクエストの処理を続ける
11. If 親プロセス (HTTP を受けるプロセス) が子プロセスより先に終わる, the 子プロセス shall 自分で終了し、変換を続けない
12. The 抽出サービス (Node 版) shall 子プロセスのコアダンプを出さない
13. The 抽出サービス (Node 版) shall 最悪の合計時間 (本文の受信 `UPLOAD_TIMEOUT_S` + 変換 `TIMEOUT_S` + 子プロセスの停止と回収) を、apps/app の既定 `timeoutMs` (90,000ms) より短く保ち、その合計の内訳を計測で示す
14. While 既定の設定 (枠 3、`MAX_CHILD_RSS_MB` は 320 または Req 11.11 で下げた値) で 3 件の変換が同時に動いている, the 抽出サービス (Node 版) shall コンテナ全体の実メモリを k8s の例の limits (2Gi) 以内に収める (計測の方法は Req 11.2 に従う)

### Requirement 4: 実行基盤の制約

**Objective:** 抽出サービスの保守担当として、サービスが monorepo のほかの部分と同じ言語と道具で書かれていてほしい。なぜなら、言語を統一して保守しやすくすることがこの書き換えの目的だから。

#### Acceptance Criteria

1. The 抽出サービス shall Node.js 上で動き、HTTP の受け口に Hono (`@hono/node-server`) を使う
2. The 抽出サービス shall Office 系の変換に npm の `@firecrawl/anydoc` を版 0.2.4 に固定して使い、版を上げるときは版を固定した契約テスト (PPTX の分割、XLSX の目印、XLS の形式名、例外の分類) が通ることを条件にする
3. The 抽出サービス shall apps/app のプロセスの中では動かず、独立したコンテナとして動く
4. The 抽出サービス shall 依存を MIT / Apache-2.0 / BSD / ISC などの許容的なライセンスのものだけにし、GPL / AGPL / LGPL のものを含めない
5. The 抽出サービス shall anydoc の OCR を使わず (文書を外部に送る `hosted` を指定しない)、外向き通信なしで動く
6. The 抽出サービス shall Python のコードと Python の実行環境を含まない
7. The 抽出サービス shall Bun / Deno では動かすことを前提にしない (Node.js だけを対応する実行環境とする)
8. The 抽出サービス shall 子プロセスに上限を掛けるために、util-linux の標準コマンド `prlimit` を使ってよい。それ以外の外部コマンドは使わない (対象 spec の AC 1.7 の解釈。brief.md の「Amend target」を参照)

### Requirement 5: コードの構成

**Objective:** 抽出サービスを次に変える開発者として、各ファイルの役割が 1 つで、どこに何があるかがすぐ分かってほしい。なぜなら、言語を統一する目的は保守しやすくすることであり、構成が悪ければその目的が果たせないから。

#### Acceptance Criteria

1. The 抽出サービスのソースコード shall 1 つのファイルに 1 つの責務だけを持たせ、`.claude/rules/coding-style.md` の上限 (1 ファイル 800 行、1 関数 50 行の目安) に収める
2. The 抽出サービスのソースコード shall 変換と正規化の処理を、HTTP と子プロセスの仕組みを知らない純関数として切り出し、子プロセスを使わずに単体テストできるようにする
3. The 抽出サービスのソースコード shall 層の依存を一方向にする (変換の層は、子プロセスを管理する層と HTTP の層を import しない。子プロセスを管理する層は HTTP の層を import しない)
4. The 抽出サービスのソースコード shall 各ディレクトリの `index.ts` から、外の呼び出し元が使うものだけを export する
5. The 抽出サービスのソースコード shall 失敗の種類から `ErrorCode` と HTTP ステータスへの対応を 1 か所の表にまとめ、失敗の種類の追加漏れを型の検査で見つけられるようにする
6. The 抽出サービスのソースコード shall named export を使い、ログには `console.log` ではなくロガーを使う

### Requirement 6: 進め方 (TDD の順序とレビューの関門)

**Objective:** ユーザーとして、書き換えをテストを先に置く順序で進め、各段階で独立したレビューを通してほしい。なぜなら、振る舞いを変えないことをテストで固定してから実装を替えることが、書き換えで壊さないための唯一の確かな方法だから。

#### Acceptance Criteria

1. The 書き換え作業 shall 次の順で進め、前の段階が終わる前に次の段階に入らない: (1) テストを Node (vitest) に書き換える → (2) テストのレビューを通す → (3) 実装を書き換える → (4) 実装のレビューを通す
2. The 書き換え作業 shall Python のテストファイル 1 つごとに、対応する Node のテストファイル、または対応させない理由 (forkserver・pickle・`BaseException` のように Python に固有の仕組みを確かめるテストなど) を書いた対応表を作る
3. When テストの書き換えが終わる, the 書き換え作業 shall HTTP を通して確かめる Node のテストを、まだ動いている Python 版のサービスに向けて実行し、すべて通ることを確かめてから実装の書き換えに入る (テストがいまの振る舞いを正しく写していることの確認)
4. When テストの書き換えが終わる, the 書き換え作業 shall 実装の書き換えの前に、Node 版の実装に向けたテストが失敗すること (RED) の出力を記録する
5. The テストのレビュー shall テストを書いた担当とは別の担当が行い、`essential-test-design` と `essential-test-patterns` の 2 つの skill を使う
6. The 実装のレビュー shall 実装した担当とは別の、新しく立てた担当が、Opus の model で、欠陥を探す立場 (敵対的) で行う
7. If いずれかのレビューで修正が必要な指摘が出る, the 書き換え作業 shall 指摘を直して同じレビューを通し直すまで次の段階に入らない
8. The 書き換え作業 shall ベンチマークの作成と Python 版でのベースラインの計測 (Req 2.7〜2.11) を、6.1 の最初の段階 (テストの書き換え) より前か、それと同時に行い、実装の書き換え (6.1 の 3 番目の段階) に入る前に終える (Python 版が残っているうちに測る必要があるため)

### Requirement 7: OpenAPI と生成クライアントの維持

**Objective:** 下流の apps/app の開発者として、既定では、抽出サービスが書き換わっても生成クライアントの型・関数・引数が変わらないでほしい。なぜなら、下流を変えずに済ませれば書き換えの作業が単純になるから。ただし、守ることでかえって複雑になるなら崩してよい (7.6)。

#### Acceptance Criteria

1. The 抽出サービス (Node 版) shall `GET /openapi.json` と書き出しの手順で、いまの `packages/attachment-text-extractor-client/openapi.json` と同じ型・同じ名前・同じ操作を持つ文書を出力する (`operationId` の `post_extract_extract_post`、スキーマ名の `Body_post_extract_extract_post`、`title` の `Pagenumber` のように、FastAPI が自動で付けた名前も含めて同じにする)。説明文 (`description`) だけは、Python 版に固有の言葉 (`/readyz` の説明の「forkserver」「fork」、`PageInfo` の説明の「None」など) を取り除いて Node 版に合う文に直す
2. When 書き換えの後に orval で生成クライアントを作り直す, the 生成クライアント shall `packages/attachment-text-extractor-client/src/generated/` の型・関数・引数に差分を出さない (7.1 で直した説明文から作られるコメントの差分だけは認める)
3. The CI shall 抽出サービスが出力する OpenAPI の文書と、commit 済みの `openapi.json` が JSON として食い違ったら失敗する (いまの drift 検知と同じ働きを保つ)
4. The 書き換え作業 shall 下流 spec (`attachment-search-indexing`、`attachment-search-ui`) と apps/app のファイルを変更しない。`packages/attachment-text-extractor-client/` の中で変えてよいのは、7.1 の説明文の修正を反映した `openapi.json` と、作り直した生成クライアントのコメントだけとする
5. When 説明文を直す, the 書き換え作業 shall 直した説明文ごとに直す前と直した後の文を research.md に記録する
6. Where 7.1、7.2、7.4 の既定の方針 (たとえば FastAPI が自動で付けた名前を Hono で同じに作ること) を守ることで、apps/app または抽出サービスが複雑になる, the 書き換え作業 shall Req 1.9〜1.12 と同じ手続きでその方針を崩してよい。崩した場合も 7.3 の drift 検知は保つ

### Requirement 8: 配備物

**Objective:** GROWI の配布者 (OSS / GROWI.cloud) として、Node 版の image が Python 版と同じ安全設定と同じ大きさの範囲で動いてほしい。なぜなら、配布と運用の手順を変えずに置き換えたいから。

#### Acceptance Criteria

1. The 抽出サービスの Docker image shall Node の slim image を元にし、大きさを 400MB 以下にする
2. When image を read-only rootfs・uid 10001・ネットワークなし (`--network none`) で起動する, the 抽出サービス shall `/readyz` で準備完了 (200) を返し、PDF と DOCX の `POST /extract` に 200 を返す
3. The 抽出サービスの Docker image shall 本番に不要なもの (テスト用の依存、ビルドの道具、テストのファイル) を含めない
4. The docker-compose のエントリ shall Node 版の image を使い、ほかの設定 (環境変数、tmpfs、安全設定) を Python 版と同じにする
5. The `deploy/k8s/` の例 shall Node 版の image を使い、対象 spec の AC 3.3 の推奨設定 (read-only rootfs、非 root、capabilities の削除、外向き通信の遮断、tmpfs の一時領域) を保ち、メモリの requests / limits を Req 3.14 の計測に合わせて見直す
6. The 抽出サービス shall 共有メモリ (`/dev/shm`) を使わない
7. When Docker image をビルドする, the Dockerfile shall 最終の段 (実行用の段) で `prlimit` を実行して版を表示させ、`prlimit` が無いか動かなければビルドを失敗させる
8. If 起動時に `prlimit` が見つからない、または実行できない, the 抽出サービス shall `/readyz` で 503 `not_ready` を返し、`/healthz` は 200 のままにする (k8s がコンテナの再起動を繰り返さないようにするため)

### Requirement 9: CI の置き換え

**Objective:** 抽出サービスの保守担当として、Node 版の lint・テスト・image の確認が CI で自動に回ってほしい。なぜなら、Python 版と同じだけの確認を Node 版でも続けたいから。

#### Acceptance Criteria

1. The `.github/workflows/attachment-text-extractor.yml` shall Node 版の lint、型の検査、vitest のテスト、image のビルド、image の大きさの検査、read-only rootfs・uid 10001・ネットワークなしでの起動の確認、OpenAPI の drift 検知を行う
2. The CI の workflow shall Python の道具 (uv、ruff、pytest) を使わない
3. When CI の変更を確かめる, the 書き換え作業 shall trigger の条件 (`paths` など) に合うブランチで workflow を動かし、`gh api repos/<org>/<repo>/actions/runs/<id>/jobs` でジョブの数が 0 より多く、すべてのステップが成功したことを確かめる (ジョブが 0 件の実行は成功とみなさない)
4. Where 抽出サービスを pnpm workspace に入れると決めた場合, the 既存の Node 用の CI shall 抽出サービスのテストが他の package のテストと競合せずに動くことを確かめる
5. When CI が image を確認する, the CI の workflow shall ビルドした image の中で、本番と同じ条件 (uid 10001、read-only rootfs、ネットワークなし) で `prlimit` を実行できることを確かめ、できなければ失敗する

### Requirement 10: Python 資産の撤去

**Objective:** 保守担当として、Node 版に置き換えた後に Python の資産がリポジトリに残っていないでほしい。なぜなら、使われないファイルが残ると、どちらが正なのかが分からなくなるから。

#### Acceptance Criteria

1. When Node 版が Req 1〜9 を満たす, the 書き換え作業 shall `services/attachment-text-extractor/` から `pyproject.toml`、`uv.lock`、`.python-version`、Python のソースとテスト、`scripts/*.py`、ruff と pytest の設定を削除する
2. The 書き換え作業 shall Python 版と Node 版を並べて動かす期間、配備物、設定を作らない
3. When 撤去が終わる, the リポジトリ shall `services/attachment-text-extractor/` の下と、抽出サービス用の CI workflow に、`.py` のファイルと Python の道具 (uv、ruff、pytest、poe) を使う記述を含まない
4. The 書き換え作業 shall 撤去の前に、Python 版でしか確かめられない作業 (Req 2.11 のベースラインの計測、Req 2.1 / 2.2 の比較、Req 6.3) をすべて終え、Req 2.14 でユーザーに諮った項目の判断を受けている

### Requirement 11: 未決事項の決め方

**Objective:** ユーザーとして、まだ決まっていない技術的な選択を、推測ではなく試作と計測で決めてほしい。なぜなら、Node で使える部品の挙動は Python 版と違い、調べずに決めると守りや品質が黙って落ちるから。

#### Acceptance Criteria

1. The 書き換え作業 shall 11.2〜11.8 の各項目について、design の承認より前に試作して計測し、結果と選んだ案と理由を research.md に「実測」「未検証」を区別して記録する
2. The 計測 shall 子プロセスの最大 RSS を、対象 spec の基準値 (7 万セル 1 シートの XLSX で 285MB、画像 12 枚の 48MB の DOCX で 281MB、上限 320MB の 0.95 倍まで許す) を取ったのと同じファイルと同じ方法で、Node 版について取り直す
3. The PDF のライブラリの選定 shall 候補 (`@hyzyla/pdfium`、pdfjs-dist、pdfium-native など) ごとに、日本語の PDF のテキスト (Req 2.4 のファイル)、パスワード付き PDF と所有者パスワードだけの PDF の区別 (対象 spec の AC 1.10 / 1.12)、壊れた PDF の扱い、ページ数の上限の掛け方、子プロセスの最大 RSS と仮想メモリ、ライセンスを比べた結果に基づく
4. The 子プロセスの作り方の選定 (Node の `fork` か、`prlimit` で包んだ `spawn` か、その他) shall 子の起動にかかる時間、仮想メモリ上限・CPU 時間上限・コアダンプの禁止・`oom_score_adj` を掛けられるか、親が先に終わったときに子が残らないか、を比べた結果に基づく
5. The 仮想メモリの上限 (`RLIMIT_AS`) の扱い shall Node と使うライブラリが必要とする仮想メモリの実測 (何もしない状態で 1,200MB、anydoc の XLSX で 2,000MB、PDFium WASM で 3,000MB 以上という調べ) を確かめ直し、上限を緩める値と、緩めた分を補う守り (RSS の監視など) を決めた結果に基づく
6. The 本文の受け取りと切断の検知の方法 shall Hono と `@hono/node-server` で、枠を取る前の `Content-Length` の検査、メモリだけでの受け取り、実際に届いたバイト数での上限、切断による変換の停止が、Req 3.1〜3.5 のとおりに働くことを試作で確かめた結果に基づく
7. The OpenAPI の作り方の選定 shall Req 7.1〜7.3 を満たせるかどうかと、満たすためにどれだけ複雑になるか (Req 7.6 で崩すかどうかの判断材料。コードから作る方法と、commit 済みの文書を正とする方法の両方を含む) を確かめた結果に基づく
8. The 配置の選定 (`services/attachment-text-extractor/` を pnpm workspace に入れるか、外に置くか) shall turbo の build / test / lint への影響、CI の時間、`pnpm install` と lockfile への影響、Docker のビルドのしやすさを比べた結果に基づく (対象 spec が workspace の外に置いた理由は Python に固有のものだったので、そのままでは根拠にしない)
9. When design フェーズで次の未決の項目を扱う, the 書き換え作業 shall 選択肢ごとの利点と欠点 (計測できるものは計測の結果) を design.md に示し、ユーザーの判断を受けてから design の承認を求める: `WORKERS` の Node での意味 (無視する、Node の cluster の数にする、廃止する)、`/readyz` の `dependencies` に出す名前、FastAPI が既定で出している `/docs` と `/redoc` (どちらも認証が要る) を残すかどうか、11.8 の比較に基づく配置の選択
10. If 計測の結果、Req 1.13 の不変条件、または Req 1.9 で崩すと判断していない対象 spec の AC を Node 版で満たせないことが分かる, the 書き換え作業 shall 書き換えを先に進めず、満たせない AC と理由をユーザーに示して判断を受ける
11. If 計測の結果、`MAX_CHILD_RSS_MB` 320 または `MAX_XLSX_CELLS` 70,000 が Node 版では成り立たない (基準のファイルの子プロセスの最大 RSS が上限の 0.95 倍を超える、または Req 3.14 のメモリの予算 2Gi を超える) ことが分かる, the 書き換え作業 shall その既定値を下げてよい。ただし、下げた値、根拠にした計測 (ファイル・方法・結果)、検索の対象になる XLSX の範囲がどう変わるかを research.md に記録し、対象 spec の Revalidation Triggers に当たることを design.md に書き、取り込み (Req 12) で対象 spec の design.md と requirements.md に反映し、完了の報告でユーザーに明示する。既定値を上げることと、Req 3.14 のメモリの予算 (2Gi) を超えることは認めない
12. When Req 2.14 でベンチマークの退行が見つかる, the 書き換え作業 shall その形式と指標、原因をユーザーに示し、直すか受け入れるかの判断を受けてから Python 資産の撤去 (Req 10) に入る

### Requirement 12: 対象 spec への取り込みと自己削除

**Objective:** spec の保守担当として、書き換えが終わったら変更が対象 spec に取り込まれ、この spec が消えてほしい。なぜなら、正となる記述が 2 か所に分かれると、どちらかが黙って古くなるから。

#### Acceptance Criteria

1. When Req 1〜11 が満たされる, the 書き換え作業 shall 対象 spec の requirements.md / design.md / research.md を、Node 版が最初からそうだったように書き直す (以前の Python 版の経緯を本文に残さない)
2. The 取り込み shall 対象 spec の既存の要件の番号 (Req 1〜4、AC 1.1〜4.2) を変えず、新しい要件は対象 spec の末尾に新しい番号で追加する
3. The 取り込み shall Req 11 の計測の結果と決定の理由を、この spec のディレクトリを消す前に対象 spec の research.md に移す
4. The 取り込み shall 対象 spec の spec.json の `updated_at` だけを更新し、`phase` と `approvals` は変えない
5. When 取り込みが終わる, the 書き換え作業 shall `.kiro/specs/attachment-search-text-extractor-node-rewrite/` を削除し、steering や他の spec からこの spec への参照が残っていないことを確かめる
6. The 取り込み shall brief.md の「Follow-ups」に挙げたファイルのうち、ユーザーが直すと決めたものだけを直す (どれを直すかは、取り込みのタスクを始める前に一覧をユーザーに示して決めてもらう)
