# Implementation Plan

> 作業ディレクトリは `services/attachment-text-extractor/`。既存の受け口 (FastAPI アプリ、設定、Bearer 認証、API の型、ルーター、OpenAPI の書き出し、Dockerfile、compose) とそのテストは流用する。markitdown に頼る旧実装は、最初のタスク (1.1) で、旧実装だけを確かめていたテストと一緒に削除し、新しい構成で一から作る。1.1 から 7.1 までの間は抽出が動かない。
>
> 削除するテストと、その観点を新しく確かめるタスクの対応:
>
> | 削除するテスト | 確かめていた観点 | 新しく確かめるタスク |
> |---|---|---|
> | `test_extract_simple.py` | 単純形式を 1 要素で返す | 3.1, 4.4, 5.1 |
> | `test_extraction_service.py` | MIME と拡張子からの形式判定、サポート対象外 | 2.3, 5.1 |
> | `test_limits.py` の時間切れの包み関数のテスト | 時間切れ | 6.3, 6.4 |
> | `test_security.py` の lxml の確認 | lxml の安全な設定 | なし (lxml は依存から外れる) |
> | `test_e2e_extract.py` | HTTP 経由の抽出 | 9.1 |
> | `test_extract_router.py` のうち変換の結果を前提にするもの | 成功・サポート対象外・時間切れの応答 | 7.1 |

- [ ] 1. 土台: 依存・設定・エラーコード・テスト用ファイル
- [x] 1.1 markitdown に頼る旧実装と、それだけを確かめていたテストを削除する
  - 旧い変換の処理 (単純形式の変換、振り分け表、抽出サービス)、markitdown の PDF 対応を調べる起動処理、health の `pdf_strategy`、XXE 対策の起動処理の lxml の確認、リソース制限の時間切れの包み関数を削除する
  - 上の表のテストを削除する。受け口のテスト (認証、設定、API の型、同時実行の枠とサイズ検査、OpenAPI の書き出しなど) は残す
  - 抽出のルーターは変換の呼び出しを外し、7.1 で実行管理につなぐまでの間、枠とサイズの検査の後に「サービス停止中」の 503 を返すようにする
  - markitdown と pdfminer.six を依存から外し、lockfile を更新する
  - 完了の状態: リポジトリに markitdown と pdfminer の import が残らず、アプリが起動し、残した受け口のテストがすべて通る
  - _Requirements: 1.7_

- [x] 1.2 新しい変換ライブラリとテスト専用の依存を追加する
  - 本番の依存に anydoc (版を固定)、pypdfium2、charset-normalizer を加える
  - テスト専用の依存に openpyxl、python-pptx、python-docx、pypdf、msoffcrypto-tool、xlwt、PyYAML を加え、本番の image には入らないようにする
  - lockfile を更新し、本番とテスト専用の全依存のライセンスが MIT / Apache-2.0 / BSD / PSF の範囲であることを確かめる
  - 完了の状態: `uv sync --locked` が通り、既存のテストがすべて成功し、新しいライブラリを読み込める
  - _Requirements: 1.7_

- [x] 1.3 設定項目・エラーコード・変換の共通の型を定める
  - 設定に `MAX_CHILD_RSS_MB` (320)、`MAX_XLSX_CELLS` (70000)、`MAX_RESULT_BYTES` (16MiB)、`MAX_PDF_PAGES` (5000)、`MAX_ARCHIVE_ENTRIES` (10000)、`MAX_ARCHIVE_UNCOMPRESSED_MB` (512) を加え、既定値を `MAX_CONCURRENCY` 3、`TIMEOUT_S` 55 に変える。使われていなかった `MAX_EXTRACTED_BYTES` を外し、`MAX_CONCURRENCY` の説明を「全体の上限はワーカー数 × この値」に直す
  - API のエラーコードに暗号化 (`file_encrypted`) と上限超過 (`resource_limit_exceeded`) を加える
  - 変換の失敗の種類、変換の上限の値、形式と経路の型など、変換層と実行管理の両方が使う型を用意する。ipynb の出力 1 つあたりの文字数の上限は、設定項目にせず固定値 10000 として変換の上限の値に含める
  - 完了の状態: 設定の既定値と新しいエラーコードを確かめる単体テストが通る
  - _Requirements: 1.10, 2.1, 2.2, 2.3, 2.6_

- [x] 1.4 テストで使うファイルを用意する仕組みを作る
  - 実在の文書はリポジトリに入れず、原則としてテストの中で生成する: 複数シート・1 シート・非表示シート・空シート・グラフシートを含む XLSX、7 万セルを超える XLSX、時間切れを起こせる大きな XLSX (5 シート × 1 万 4 千行)、複数スライドの PPTX、画像入りの 40MB の DOCX / PPTX、暗号化した DOCX / XLSX / PPTX、ユーザーパスワード付きとオーナーパスワードだけの PDF、画像だけの PDF、壊れた PDF、展開すると巨大になる DOCX、XML を深く入れ子にした DOCX、Shift_JIS / EUC-JP / BOM 付き UTF-8 のテキスト
  - ODT / ODS / ODP、RTF、EPUB は zipfile や文字列で組み立て、XLS は xlwt で生成する
  - 旧形式の DOC と PPT は Python だけでは作れないので、設計の例外 (design.md の Allowed Dependencies に記載) として Apache POI のテスト用ファイル (Apache-2.0) から小さなものを選んでリポジトリに置き、出典とライセンスを記録する
  - 大きなファイル (40MB、大きな XLSX) は生成に時間がかかるので、セッション単位で 1 回だけ生成する
  - 完了の状態: 上記の各ファイルを pytest の fixture として取得でき、取得だけを確かめるテストが通る
  - _Requirements: 1.2, 1.3, 1.8, 1.10, 1.12, 2.6_

- [ ] 2. 変換層の小さな部品 (純粋な処理)
- [x] 2.1 (P) 改行の統一と、日本語の間の空白・改行の詰めを実装する
  - 改行の統一は CRLF / CR を LF にする。日本語の詰めは、日本語の文字に挟まれた 1 文字分の半角空白と 1 つだけの改行を取り除き、全角空白・段落の区切り・英単語の間の空白は残す
  - 完了の状態: 「情報シス\nテム」が「情報システム」になり、「障害対応メモ\n\n本番環境」や全角空白が残ることを単体テストで確かめられる
  - _Requirements: 1.9_
  - _Boundary: TextNormalizer_

- [x] 2.2 (P) 文字コードの判定とデコードを実装する
  - BOM → 宣言された文字コード (HTML の meta) → 厳密な UTF-8 → 候補を日本語系と cp1252 に絞った charset-normalizer → cp932 → latin-1 の順に試す
  - 完了の状態: UTF-8 (BOM あり / なし)、Shift_JIS、EUC-JP、ISO-2022-JP、cp1252 の試料が正しくデコードされ、短い Shift_JIS が誤判定されないことを単体テストで確かめられる
  - _Requirements: 1.5_
  - _Boundary: CharsetDecoder_

- [x] 2.3 (P) 形式と経路を決める対応表を実装する
  - MIME の手がかりを優先し、なければ拡張子から形式を決め、経路 (pdf / pptx / xlsx / office / text) と anydoc に渡す形式名を返す
  - 旧形式 DOC / PPT / XLS と OpenDocument を office の経路に入れ、XLS は anydoc の形式名 `xlsx` で渡す。Outlook MSG と対応表にない形式はサポート対象外にする
  - 完了の状態: 設計の対応表の全行と、MSG がサポート対象外になることを単体テストで確かめられる
  - _Requirements: 1.5, 1.6, 1.8_
  - _Boundary: FormatResolver_

- [x] 2.4 (P) ZIP の事前検査を実装する
  - ZIP かどうかと、経路に必要な部品があるかを確かめ、なければ「書き換えずに anydoc にそのまま渡す」ことを示す結果を返す
  - エントリ数と、申告された展開後サイズの合計が上限を超えたら上限超過にする。部品を読むときは 1 部品あたりの上限も設ける
  - 完了の状態: 上限を超える ZIP が上限超過になり、ZIP でない入力 (暗号化された OOXML など) が「そのまま渡す」になることを単体テストで確かめられる
  - _Requirements: 2.6_
  - _Boundary: ArchiveGuard_

- [ ] 3. 形式ごとの変換 (ライブラリの呼び出し)
- [x] 3.1 (P) anydoc で Office 系を変換する処理を実装する
  - 形式を必ず明示して呼び、OCR の引数は渡さない (外部送信をしない)
  - anydoc の例外を、暗号化・壊れたファイル・上限超過・サポート対象外・想定外 (Rust の panic を含む) の失敗の種類に分ける。panic は `BaseException` 系なので取りこぼさない
  - 完了の状態: DOCX / RTF / EPUB / CSV / 旧形式 DOC・PPT・XLS / OpenDocument が 1 つのテキストになり、暗号化した DOCX が暗号化、壊れた DOCX が壊れたファイル、展開すると巨大になる DOCX と深い入れ子の DOCX が上限超過になることをテストで確かめられる
  - _Requirements: 1.5, 1.7, 1.8, 1.10, 1.11, 2.6_
  - _Boundary: OfficeConverter_

- [x] 3.2 (P) pypdfium2 で PDF をページごとに取り出す処理を実装する
  - ページ番号 (1 始まり) と、番号だけの文字列のラベルを付けて返す。改行を LF に揃えてから日本語の詰めをかける
  - 開くのにパスワードが要る PDF は暗号化、オーナーパスワードだけの PDF は抽出、開けない PDF は壊れたファイル、ページ数が上限を超えたら上限超過にする
  - 完了の状態: 生成した PDF でページ数どおりの要素が返り、パスワード付き PDF が暗号化、オーナーパスワードだけの PDF が抽出、画像だけの PDF が例外なく空の要素になることをテストで確かめられる
  - _Requirements: 1.4, 1.9, 1.10, 1.11, 1.12, 2.6_
  - _Boundary: PdfConverter_
  - _Depends: 2.1_

- [ ] 4. ZIP を書き換える変換とテキスト系の処理
- [x] 4.1 (P) PPTX をスライドごとに分けて anydoc に渡す処理を実装する
  - ZIP の事前検査を通ったものだけを対象にし、スライド一覧と関係ファイルを defusedxml で解析して、1 枚のスライドとそれが参照する XML 部品だけのパッケージを作る。画像などは入れない
  - 通らないもの (暗号化された PPTX、旧形式) は、Office 系の変換にそのまま渡す
  - PowerPoint の自動生成の代替テキストと、行末の改行の印を取り除く。ラベルはスライド番号の文字列にする
  - 完了の状態: anydoc の版に固定した契約テストで、分けて変換した結果をつなぐと丸ごと変換した結果と一致し、スライド数どおりの要素が返ることを確かめられる
  - _Requirements: 1.2, 2.6_
  - _Boundary: PptxSlideSplitter_
  - _Depends: 2.4, 3.1_

- [x] 4.2 (P) XLSX のセル数の事前検査を実装する
  - 全シートの XML を、XML として解析せず一定の大きさずつ読み、セルの印の数を数える。合計が上限を超えたら、anydoc を呼ばずに上限超過にする
  - 完了の状態: 7 万セルを超える XLSX が上限超過になり、上限以下の XLSX は通ること、同じプロセスの中で検査の前後のメモリの最大使用量がほとんど増えないことをテストで確かめられる
  - _Requirements: 2.6_
  - _Boundary: XlsxSheetSplitter_
  - _Depends: 2.4_

- [x] 4.3 XLSX をシートごとに分ける処理を実装する
  - workbook.xml の中でシート名を一意な目印に置き換え、非表示のシートを表示状態にしてから anydoc を 1 回呼び、目印で切って元のシート名に戻す
  - シートが 1 枚のときは全体を 1 要素 (番号 1、シート名) にする。空のシートとグラフシートは返さない。未知の目印・順番の食い違い・最初の目印の前のテキストがあるときだけ、全体を 1 要素で返してログに残す
  - 完了の状態: anydoc の版に固定した契約テストで、1 シート・空シートを含む複数シート・グラフシート・非表示シート・名前に `<` や `#` を含むシートのそれぞれでシート名と順番が対応することを確かめられる
  - _Requirements: 1.3_
  - _Depends: 3.1, 4.2_

- [x] 4.4 (P) テキスト系・HTML・XML・ipynb・CSV / TSV の処理を実装する
  - HTML は標準の html.parser で script / style / template / noscript / svg の中身を捨て、ブロック要素で改行を入れる
  - XML は DOCTYPE を取り除いてからタグを除く (解析しない)。ipynb はセルの source とテキストの出力を取り出し、画像の base64 を捨て、出力ごとの文字数に上限を設ける。TXT / MD / LOG / JSON / YAML はデコードしたテキストをそのまま返す
  - CSV / TSV はデコードして UTF-8 にしてから、anydoc に形式 `csv` で渡す
  - 完了の状態: 各形式の試料で期待どおりのテキストが返り、実体参照を何重にも重ねた XML (billion laughs) が膨らまず、Shift_JIS の CSV が文字化けしないことをテストで確かめられる
  - _Requirements: 1.5_
  - _Boundary: TextConverter_
  - _Depends: 2.2, 3.1_

- [ ] 5. 変換層の取りまとめ
- [x] 5.1 形式の判定から結果の組み立てまでを 1 つの入口にまとめる
  - 形式を決めて経路ごとの変換を呼び、全要素の改行を揃え、中身が空の要素を除き、全部空なら空の 1 要素を返す
  - 結果の合計が上限を超えたら上限超過にする。失敗はすべて失敗の種類に分けて返す
  - 完了の状態: 対応する全形式の生成ファイルを入口に渡すと、設計どおりの単位・番号・ラベルの要素が返り、画像だけの PDF が空の 1 要素になり、MSG がサポート対象外になることをテストで確かめられる
  - 完了の状態: TXT の「障害対応メモ\n本番環境で発生」と DOCX の段落の区切りが、変換後もそのまま残る (PDF 以外では日本語の詰めをかけない) ことをテストで確かめられる
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 1.9, 1.11, 2.6_

- [ ] 6. 子プロセスでの実行
- [x] 6.1 子プロセスの入口と、親子間の受け渡しを実装する
  - 親から「長さ + 本体」の形でファイルを受け取り、結果は JSON で 1 回だけ送る (pickle を使わない)
  - 起動直後に、仮想メモリの上限 (RSS の上限 + 512MB)、CPU 時間の上限 (`TIMEOUT_S` + 5 秒)、OS のメモリ不足のときに先に止められる優先度 (`oom_score_adj` = 1000) を設定する。これらは Linux 以外では何もしない
  - 依頼元のワーカーだけが書き込み側を持つパイプを見張り、閉じたら自分で終わる
  - 変換の入口を呼び、`BaseException` まで捕まえて失敗の種類として送る (`SystemExit` と `KeyboardInterrupt` は投げ直す)
  - 完了の状態: 子の入口を単独で起動し、正常なファイルで成功の JSON、壊れたファイルで失敗の JSON が返り、Linux では上限と優先度が設定されていることをテストで確かめられる
  - _Requirements: 2.5, 2.6, 2.7_

- [x] 6.2 forkserver の起動と準備の確認を実装する
  - アプリの起動時に forkserver を立ち上げ、変換の依存を forkserver の中で先に読み込ませる
  - forkserver が動いていて依存を読み込めているかどうかを返す
  - 完了の状態: 起動後に準備の確認が真になり、forkserver を止めると偽になることをテストで確かめられる
  - _Requirements: 2.5, 3.2_

- [x] 6.3 1 件の変換を子プロセスで実行し、監視して、結果を分類する
  - リクエストごとに子を 1 つ作り、ファイルをイベントループを止めずに送る
  - 50ms ごとに子の RSS と期限を確かめ、期限切れなら時間切れ、RSS の上限超えならメモリ超過として子を止める。結果が上限より大きければ読み捨てて結果超過にする。結果を受け取った場合も最後に必ず子を止め、2 秒を上限に回収する
  - 結果を送らずに子が終わったときは、SIGXCPU なら時間切れ、それ以外は異常終了に分ける
  - 監視中に子の RSS の最大値を記録し、結果と一緒に返す
  - 完了の状態: 正常な変換で成功と子の最大 RSS が返り、戻った時点で子が回収済みで残っていないことをテストで確かめられる
  - _Requirements: 2.2, 2.5, 2.6, 2.7_

- [x] 6.4 子プロセスの止め方と隔離をテストで確かめる
  - 大きな XLSX を短い期限で変換すると時間切れになり、子が回収済みで、親の RSS が元に戻り、直後の変換が成功する
  - RSS の上限を小さくするとメモリ超過になる。CPU 時間の上限を超えた子は時間切れに分類される
  - 子の中で abort と segfault を起こすと異常終了になり、同時に動いていた別の変換は成功する。子の中の想定外の例外 (Rust の panic に当たるもの) は想定外に分類される
  - 結果が `MAX_RESULT_BYTES` を超えると結果超過になる
  - 依頼元のワーカーを強制終了すると、子が 2 秒以内に終わる
  - 既定の上限 (RSS 320MB、仮想メモリと CPU 時間の上限) のもとで、画像入りの 40MB の DOCX / PPTX と 7 万セルの XLSX が誤って止められない。7 万セルを超える XLSX はセル数の検査で止まり、子の RSS が上限に近づかない
  - 完了の状態: 上記のテストが Linux の CI で通る
  - _Requirements: 2.2, 2.5, 2.6, 2.7, 4.2_

- [ ] 7. HTTP の受け口との接続と OpenAPI の書き出し
- [x] 7.1 抽出のルーターを実行管理につなぎ、エラー表どおりの応答にする
  - 同時実行の枠とサイズ検査はそのまま使い、時間切れの処理をリソース制限の部品から外す
  - ルーターは変換ライブラリを呼ばず、実行管理の結果を設計のエラー表どおりの `ErrorCode` と HTTP ステータスに変える (暗号化・上限超過・壊れたファイルは 422、想定外と異常終了は 500)
  - 1 件ごとに、形式・大きさ・所要時間・結果・子の最大 RSS を 1 行のログに出す。ファイルの中身と Authorization ヘッダは出さない
  - 1.1 で入れた一時的な 503 を外す。残したルーターのテストを新しい構成に合わせて直す
  - 完了の状態: ルーターのテストで、成功・サポート対象外・サイズ超過・暗号化・上限超過・時間切れ・異常終了・枠の不足のそれぞれが期待どおりのコードとステータスになり、時間切れや異常終了の後でも次のリクエストが枠を取れ、ログにファイルの中身とトークンが出ないことを確かめられる。既存のテストがすべて通る
  - _Requirements: 1.1, 1.6, 1.10, 1.11, 2.1, 2.2, 2.3, 2.6, 2.7, 4.2_
  - _Depends: 5.1, 6.3_

- [x] 7.2 アプリの起動処理と health / readiness を新しい構成に合わせる
  - 起動時に forkserver を立ち上げる
  - readiness は forkserver が動いていて変換の依存を読み込めるときだけ ready を返す
  - 残した health とアプリの組み立てのテストを新しい構成に合わせて直す
  - 完了の状態: アプリが起動し、`/healthz` が ok、`/readyz` が ready を返し、応答に `pdf_strategy` が含まれないことをテストで確かめられる。既存のテストがすべて通る
  - _Requirements: 3.2, 3.4_
  - _Depends: 6.2_

- [x] 7.3 OpenAPI を書き出し直す
  - OpenAPI を書き出し直して `packages/attachment-text-extractor-client/openapi.json` を更新し、生成されたクライアントも再生成して差分を揃える (Node 側の CI の差分検知を通すため)
  - 完了の状態: OpenAPI に新しいエラーコードが現れ、`pdf_strategy` が消え、Node 側の CI の差分検知 (orval で再生成して差分がない) が通る
  - _Requirements: 1.6, 1.10, 2.6_

- [ ] 8. 配布物と CI
- [ ] 8.1 Dockerfile と docker-compose を新しい構成に合わせる
  - uv のイメージの版を固定し、ワーカー数の既定を 1 にし、`RAYON_NUM_THREADS=1` と `TMPDIR=/tmp` を設定する
  - compose に同時実行数とメモリ上限の推奨値を入れ、read-only rootfs・uid 10001・tmpfs `/tmp` を保つ
  - 完了の状態: image をビルドして read-only rootfs・uid 10001・`--network none` で起動すると、`/readyz` が ready を返し、PDF と DOCX の `POST /extract` が成功する。image の大きさが 400MB 以下
  - _Requirements: 1.7, 2.4, 3.1, 3.3, 3.4_

- [x] 8.2 (P) k8s の manifest の例を作る
  - Deployment (securityContext、tmpfs `/tmp`、requests 512Mi / limits 2Gi、probe)、Service、HPA、外向き通信を遮断する NetworkPolicy を用意する
  - 完了の状態: pytest で YAML を読み、securityContext (非 root、read-only rootfs、capabilities をすべて外す、権限昇格なし、seccomp RuntimeDefault)、`/tmp` の tmpfs、リソースの値、egress を遮断する NetworkPolicy が入っていることを確かめるテストが通る
  - _Requirements: 2.4, 3.2, 3.3, 3.4, 4.1_
  - _Boundary: deploy/k8s_

- [ ] 8.3 このサービス専用の CI を作る
  - `uv sync --locked` → ruff の検査と整形の確認 → pytest → image のビルド → image の大きさ (400MB 以下) の確認 → read-only rootfs・uid 10001・`--network none` で起動し、`/readyz` と、PDF・DOCX の `POST /extract` の成功を確かめる → OpenAPI の書き出しと差分の確認、の順に実行する
  - workflow の `if: |` の中にはコメントを書かない
  - 完了の状態: trigger の `branches` / `paths` に合うブランチで workflow を実行し、`gh api repos/<org>/<repo>/actions/runs/<id>/jobs` で全ジョブが実行されて成功したことを確かめる (0 ジョブの実行は成功とみなさない)
  - _Requirements: 1.7, 2.4, 3.3_
  - _Depends: 8.1_

- [ ] 9. 全体の検証
- [x] 9.1 HTTP 経由で全形式とエラー表を通しで確かめる
  - 形式ごとに `POST /extract` で期待どおりの単位・番号・ラベルが返る (PDF / PPTX / XLSX / DOCX / HTML / CSV / TSV / ipynb / Shift_JIS のテキスト / 旧形式 / OpenDocument)
  - エラー表の各行が期待どおりのコードとステータスになり、枠を使い切ると 503 がすぐ返る
  - 外向き通信を遮断した環境での動作は、8.1 と 8.3 のコンテナでの確認で担保する
  - 完了の状態: 上記の結合テストがすべて通る
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 1.9, 1.10, 1.11, 1.12, 2.1, 2.2, 2.3, 2.5, 2.6, 2.7_

- [ ] 9.2 全体のテスト・lint・image の確認をまとめて通す
  - Python のテスト・lint・整形、image のビルドと大きさ、`--network none` での抽出、OpenAPI の差分確認をすべて実行する
  - 完了の状態: すべて成功し、要件の全 ID に対応するテストがあることを確かめられる
  - _Requirements: 1.1, 1.7, 2.4, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2_

## Implementation Notes

- 1.4: 時間切れ用の大きな XLSX (5 シート × 1 万 4 千行) は anydoc で約 0.2 秒で変換でき、`TIMEOUT_S` (整数) の最小値 1 秒では時間切れにならない。6.3 / 6.4 の実行管理は期限を `Settings.TIMEOUT_S` とは別の float 引数で受け取り、テストは 1 秒未満の期限を直接渡すこと。
- 1.4: 変換の実測では、非表示シート・空シート・グラフシートは anydoc の出力に現れず、表示シートが 1 枚だけの XLSX は `##` 見出しが付かない。4.3 のシート分割はこの出力を前提に組む。
- 3.1: `convert_office` は anydoc の例外を `from None` で包み直すが、元の例外 (anydoc が入力の先頭バイトを引用することがある) は `__context__` に残る。子プロセスの入口 (6.1) は `kind` / `detail` だけを親に送り、例外オブジェクトや traceback を送らないこと。
- 3.1: RLIMIT_AS 超過で起きる `MemoryError` は `convert_office` では internal (500) になる。メモリ超過 (resource_limit_exceeded) として扱うかどうかは 6.1 / 6.3 で決める。
- 2.4: ZIP の部品を読むときに漏れる例外は BadZipFile だけではない (zlib.error / EOFError / OSError / lzma.LZMAError / NotImplementedError / ValueError / UnicodeDecodeError)。Python 3.12 では未対応の圧縮方式 (method 9) が RuntimeError で出るので、ZIP の暗号化フラグ (bit 0) で encrypted と malformed を分けている。4.1 / 4.3 は `read_part` だけで部品を読むこと。
- 3.2: `convert_pdf` は PdfiumError 以外を捕まえない (子プロセスの入口が `BaseException` まで受けて internal にする設計)。1 ページが 400 万文字の PDF は最大 RSS が約 540MB になる。ページ内の文字数は 3.2 では抑えられないので、6.3 / 6.4 の RSS 上限と仮想メモリの上限で止まることをテストで確かめる。
- 3.2: `tests/conversion/test_pdf.py` は `tests/fixture_files.py` の非公開ヘルパー (`_build_pdf`、`_pdf_stream`) を import している。fixture_files.py に手を入れる次の機会に、公開名にするか日本語 PDF の生成処理ごと移す。
- 4.1: PowerPoint の自動代替テキストは、anydoc の出力では「説明 + 半角空白 2 つ + 決まり文」の 1 行になる。除去はこの形に限る。作者が `X  決まり文` (半角空白ちょうど 2 つ) と打った行は見分けられず消える。4.3 でも XML 宣言の文字コードが不正なとき、パーサーは LookupError / ValueError を投げるので、`ParseError` だけでなくこれらも malformed にすること。
- 4.1: 分割変換は共有部品 (マスター・レイアウト・テーマ) をスライドごとのパッケージにコピーするため、処理量は「スライド数 × 共有部品の大きさ」に比例する (2000 枚・マスター 200KB で約 6 秒)。上限は TIMEOUT_S と RSS 上限が受け持つ。
- 4.2: セル数の検査 (`enforce_cell_limit`) は `.rels` 以外のすべての部品を数える。anydoc が `workbook.xml.rels` のリンク先でシートを探すため、パスや拡張子の名前で絞ると、サブディレクトリ・`..` を含むリンク・大文字拡張子・パッケージ直下に置いたシートで検査をすり抜けられる。BOM 付き UTF-16 の部品は malformed として止める。4.3 は `inspect_archive(data, "xl/workbook.xml", limits)` で開いた archive をこの関数に渡し、呼び出し側で close すること。空の `<row` を大量に並べる入力 (50 万行で約 268MB) はセル数の指標の対象外で、RSS 上限が受け持つ。
- 4.3: ZIP を書き換えて anydoc に渡す経路は、部品を丸ごと読まず `archive_guard.copy_part` で 64KiB ずつコピーする (ピボットキャッシュなど、セル数の検査が数えない大きな部品があるため。丸ごと読むと 15MB の XLSX が 403MB になり RSS 上限を超えた)。workbook.xml のように XML として解析する部品だけ `read_part` を使う。5.1 / 6.4 の RSS テストは images48 相当 (48MB・画像 12 枚: 全体変換 130MB / 分割 179MB) とピボット付きのブックでも確かめること。
- 4.3: `pptx_split.py` と `xlsx_split.py` の OOXML の XML 処理は `ooxml_xml.py` (`parse`、`register_prefixes`、`local_name`) にまとめた (9.2)。
- 4.4: 標準の `html.parser` は、`<a/////…>` や `</a x x …>` 4MB、属性だらけの 1 つのタグ 4MB で 450〜700MB を使う (`convert_text` では防げない)。anydoc の CSV 変換は入力の約 36 倍のメモリを使い、20MB の CSV で 721MB になった。6.3 / 6.4 の RSS テストで確かめ、CSV には変換前のサイズ上限 (または行数・セル数の事前検査) が要るかどうかを 5.1 / 9.2 で決める。
- 4.4: `convert_text` の HTML / XML は半角空白・タブだけをまとめ、全角空白 (U+3000) と `&nbsp;` は残す。HTML / XML / ipynb / plain / csv のどの経路も、対になっていない surrogate を結果に含めない (含むと JSON の応答が UnicodeEncodeError で 500 になる)。
- 5.1: `convert(data, filename, mime_hint, limits) -> ConversionSuccess` は失敗のとき `ConversionError` を投げる (`ConversionOutcome` を返すのは runner 側)。6.1 の子プロセスの入口がこれを `ConversionFailure` に変え、`BaseException` まで受けて `SystemExit` / `KeyboardInterrupt` だけ投げ直す。core は想定外の `Exception` (MemoryError 含む) を `internal` にまとめるので、MemoryError をメモリ超過として扱うと 6.1 / 6.3 で決めるなら core 側も直す。design.md のファイル構成欄 (183 行目付近) の `convert(data, filename, mime_hint)` は limits が抜けた書き間違いで、正式な契約は limits 付き。
- 5.1: 拡張子を `.xls` にした入力は旧形式の経路に入り、セル数の検査を通らない (設計どおり。RSS 上限が受け持つ)。40MB の DOCX / PPTX を CSV / HTML として渡すとテストプロセスの最大メモリが約 0.9GB になる (4.4 の既知の問題)。6.4 でこの組み合わせも子プロセスの上限で止まることを確かめる。
- 6.1: 子プロセスは `RLIMIT_CORE` を 0 にする (design.md の ChildEntry に追記済み)。6.4 は abort / segfault / SIGXCPU を起こすので、コアダンプが出ないことを前提にする。テストでは `WCOREDUMP` を判定に使わず、`/proc/<pid>/limits` の値で確かめる。
- 6.1: 監視スレッド (`os._exit`) は GIL を取れる間だけ働く。メインスレッドが時間のかかる Python の正規表現などで GIL を持ち続けると、パイプを閉じても子が終わるまで 25 秒かかった (anydoc の変換中と普通の Python のループ中は 0.01〜0.02 秒)。そのとき止めるのは `RLIMIT_CPU` と親の SIGKILL。`text.py` の `_META_CHARSET` (`[^>]*?`) と `pptx_split.py` の `_LINE_BREAK_MARKER` は入力次第で 2 乗の時間になりうるので、6.4 の「2 秒以内に終わる」テストは変換中の現実に近い負荷でも確かめる。
- 6.1: 子から親への結果にも「長さ (4 バイト) + 本体」を付けた。上限は `2 × MAX_RESULT_BYTES + 1MiB`。6.3 は読む前に `wire.decode_frame_header(header, wire.max_result_frame_bytes(limits.max_result_bytes))` で確かめ、超えたら読み捨てて `result_too_large` にする。`write_frame` は non-blocking の fd を受け付けないので、6.3 は読み取りを自前で書く。start() の後、親は自分の手元にある「入力の読み取り側・結果の書き込み側・監視用パイプの読み取り側」の写しを閉じること (閉じないと EOF が届かない)。子の終了コード: 3 = 依頼元がいなくなった、4 = 入力の形が壊れていた。どちらも結果は送らない。
- 6.1: `RLIMIT_AS` に当たると、XLSX は Rust 側の abort (exitcode -6、結果なし) になり、6.3 では「異常終了」(500) に分類される。メモリの主な守りは親の RSS 監視 (320MB、`memory_exceeded`) で、これは `RLIMIT_AS` (832MB) より先に効く。`MemoryError` は core が `internal` にまとめたままでよい。
- 6.1: forkserver の準備 (6.2) では `RAYON_NUM_THREADS=1` を forkserver の起動前に設定する (今回のテストではこれが無くても、40MB の DOCX / PPTX と 7 万セルの XLSX は VmPeak 約 370MB 以下で通った)。CPU 時間の hard 上限が環境側で低いと soft と hard が同じ値になり、SIGXCPU より先に SIGKILL が届いて「時間切れ」が「異常終了」に分類される (珍しい配備だけ)。
- 6.2: `ConversionRunner` の準備確認の使い方 (7.2 が守る): `/readyz` は `readiness()` が準備できていない (`stale` を含む) なら `await asyncio.to_thread(runner.verify)` で確かめ直し、その結果を返す。`readiness()` は新しいプロセスを作らず待たない。`verify()` は正常なら約 5ms、固まっていても `probe_timeout_s` + 約 0.5 秒 + 回収で戻る。k8s の readinessProbe の `timeoutSeconds` (8.2) はこれより長くするか、7.2 で `probe_timeout_s` を短く渡す。forkserver が死んだ直後に標準の処理がまだその死を見ていない間の最初の `Process.start()` は `EOFError` になるので、6.3 の `run()` はこれを「異常終了」として扱い、次のリクエストは立て直された forkserver を使う。
- 6.2: Python 3.12 では forkserver に `__main__` を先読みさせる指定が効かず、子 1 つを作るたびに起動スクリプト (uvicorn) を読み直して約 29ms かかる (何も読み込まないスクリプトなら約 7ms)。8.1 で、forkserver にだけ読み込ませて `/readyz` には出さない別の一覧 (例 `uvicorn.main`) を足すか、起動を小さなスクリプト経由にするか決める。`stop()` は変換中の子が残っていると終わるまで止まる (3 秒動く子で 3.03 秒)。7.2 は 6.3 が子を回収した後にスレッドから呼ぶ。`/readyz` の dependencies に内部モジュール名 (`app.runner.child_entry`) が出るので、認証なしで呼べる `/readyz` に出してよいかを 7.2 で決める。`os.environ.setdefault` で RAYON_NUM_THREADS を書くのは、stdlib が forkserver に環境変数を渡す口を持たないため。TMPDIR は 8.1 の Dockerfile で設定する。
- 6.3: `ConversionRunner.run(ConversionRequest(data, filename, mime_hint)) -> ConversionOutcome` と `ConversionRunner.from_settings(settings, **options)` が 7.1 / 7.2 の入口。子の最大 RSS は `ConversionSuccess` / `ConversionFailure` の省略可能な項目 `child_peak_rss_mb` で返す (親だけが入れ、親子間の JSON には載らない)。この項目は design.md の Contracts に未記載なので、9.2 の前に追記する。`app/runner/__init__.py` は design のファイル構成では ConversionRunner を公開するはずだが未公開 (6.2 から持ち越し)。7.1 / 7.2 で公開する。
- 6.3: 分類の優先順位は、(1) 受け取りきった結果 (同じ見回りで期限が来ても結果を優先)、(2) 親が決めた timeout / memory_exceeded / result_too_large、(3) 結果なしで終わった子 (-SIGXCPU → timeout、その他は crashed)。結果超過は長さ欄だけで決め、本体は読まずに子を止める。最悪の場合の所要時間は期限 55 秒 + 回収待ち約 4 秒 = 約 59 秒で、apps/app 側の 60 秒に余裕が少ない (7.1 / 8.1 / 9.2 で TIMEOUT_S の既定を見直すか、apps/app 側の上限との関係を確認する)。`run()` は `start()` を前提にしない (先に呼ぶと forkserver が依存の先読みも RAYON_NUM_THREADS も無しで立つ)。7.2 は起動順を守る。親が wire → app.conversion.errors → app/conversion/__init__ → core の連鎖で anydoc / pypdfium2 を読み込み、RSS が約 9MB 増える (設計の 1 ワーカー約 120MB の範囲内)。8.1 の init (tini など) は、forkserver が落ちた後に残った子の回収に PID 1 が必要になるかどうかの材料。
- 6.3 の改善案 (どれも必須ではない): pidfd が使えず forkserver を落とした珍しい組み合わせで、動いている子が exitcode 255 と読まれて SIGKILL を送らず、戻った時点で子が短い間残る。2 回の見回りの間に終わる変換は最大 RSS が小さく報告される (結果を受け取った後に VmHWM を読み直していない)。子が結果のパイプを先に閉じて動き続けると、期限と RSS を見ずに最大 2 秒待つ。`_read_exact` が bytearray から bytes に写すので結果 1 件あたり一時的に約 2 倍のメモリを使う。
- 6.4: 実測で、1 シート 10 万行 × 1 列の XLSX は子の RSS が 328〜357MB になり、RSS 上限 320MB で止まった (設計の見積もり「10 万セルで 214MB」は合わなかった)。ユーザー判断で `MAX_XLSX_CELLS` の既定を 70,000 に下げた (design.md / research.md 更新済み)。実測 (既定の上限のもと): 1 シート 7 万行 × 1 列 = 最大 RSS 285MB (89%)・VmPeak 419MB、1 シート 7 千行 × 10 列 = 231MB、5 シート × 1 万 4 千行 = 146MB、44MB の DOCX = 266MB (83%)、48MB の DOCX (画像 12 枚) = 281MB (88%)。余裕が薄いので、環境差でテストが不安定になった場合はまず `tests/runner/test_child_isolation.py` の `0.95 × 上限` の許容を見る。5 シート × 1 万 4 千行は約 0.47 秒で変換できるので、時間切れのテストの期限 0.2 秒は余裕が約 2.3 倍。
- 6.4: ワーカーを SIGKILL したとき、そのワーカーの forkserver の UNIX ソケットの一時フォルダ (`/tmp/pymp-*`) が残る。テストは `TMPDIR` をテスト用の場所にして防いでいる。本番では k8s が `/tmp` (tmpfs) を Pod ごと捨てるので問題ないが、compose では残りうる (8.1 で `/tmp` を tmpfs にする)。申し送り: タスク 7.1 は「時間切れ・異常終了の後でも次のリクエストが同時実行の枠を取れる」ことを確かめる (枠の返却は router の責務)。
- 7.1: `POST /extract` は枠 → 本文の読み取り → サイズ検査 (413) → `runner.run` → `extract_errors.FAILURE_RESPONSES` の順。runner は `request.app.state.runner` から取る (`get_runner`、代わりの値なし)。7.2 は lifespan で `app.state.runner` を作り、`test_main.py` / `test_integration_auth.py` が使っている偽の runner の差し込みを、本物の起動に置き換える。改善案 (必須ではない): `extract.py` の `_json_safe` は `wire._require_str` が既にペアになっていない surrogate を拒否しているため、まず通らない上に置き換え文字が `?` で (core は U+FFFD)、毎回全ページを UTF-8 に変換し直す。消すか U+FFFD に揃える。ログの `format=` が成功時は MIME、失敗時は拡張子で揃っていない。503 の行に size / duration_ms / child_peak_rss_mb が無い。成功応答は `model_copy` + `response_model` の再検証 + `jsonable_encoder` で複製が多い (設計の 16MiB × 3 の範囲内)。`TestSlotRelease::test_slot_is_released_when_the_request_is_cancelled` は `Limits` だけを見ていてルーターを通っていない。時間の上限の申し送り (最悪 約 59 秒 vs apps/app 側 60 秒) は 8.1 / 9.2 で必ず扱う。
- 7.2: アプリの起動処理 (`create_app(**runner_options)` の lifespan) が `ConversionRunner.from_settings(settings)` を `app.state.runner` に置いて `await runner.start()` し、終了時は `await asyncio.to_thread(runner.stop)` する。forkserver や依存が壊れていても起動は失敗させず、`/readyz` が 503 `not_ready` を返す (`/healthz` は 200 のまま。k8s は再起動の無限ループにならない)。`/readyz` は `readiness()` が準備できていなければ `to_thread(runner.verify)` で確かめ直す。応答の `dependencies` は `anydoc` / `pypdfium2` / `charset-normalizer` と、内部モジュールをまとめた `converter` だけ。残る弱点 (必須ではない): forkserver が生きたまま固まった (SIGSTOP) 場合、`/readyz` は前回の「準備完了」を返し続け、`/extract` は 10 秒 (子の起動の時間切れ) 後に 500 `crashed` になる。その後は forkserver を止めて立て直すので、次の `/readyz` で回復する。直すなら `/readyz` で毎回 `verify()` を呼ぶ (約 5ms、認証なしの `/readyz` が毎回子を 1 つ作る) か、短い TTL で結果を持つ。準備完了でない間に `/readyz` が大量に来ると `verify` の待ちでデフォルトのスレッドを最大 20 本ほど塞ぐ (子の起動と同じプール。実測の遅れは約 0.5 秒)。9.2 で扱うか、CLAUDE.md にこの弱点を書く。8.2 の readinessProbe の `timeoutSeconds` は `probe_timeout_s` (10 秒) + 約 0.5 秒 + 回収より長くする。
- 7.3: `openapi.json` と生成クライアント (`packages/attachment-text-extractor-client/src/generated/index.ts`、Git 管理下) を書き出し直した。再生成は 2 回目も同じ結果で、Node 側の差分検知 (`pnpm run gen` → `git diff --exit-code`) は通る見込み。書き出した `openapi.json` は `pnpm biome check --write openapi.json` で整形してから `gen` を回す (コミット済みのファイルが biome 整形済みのため)。`POST /extract` に `responses=` (400 / 408 / 413 / 422 / 500 / 503 を `ErrorResponse`) を足した。副作用: 422 を `ErrorResponse` にしたので、`file` 欠落の検証エラー (実行時は `HTTPValidationError`) は OpenAPI 上は文書化されなくなった。`/readyz` の 200 の応答は `response_model` が無く空のスキーマ (クライアントでは `unknown`)。説明を付けるなら Pydantic のモデルが要る (必須ではない)。`apps/app/src/features/search-attachments/server/services/attachment-text-extractor.ts` は `file_encrypted` / `resource_limit_exceeded` を `default` に落として `null` を返す。`attachment-search-indexing` の設計 (572 行目付近) はこの 2 つを `encrypted` / `resourceLimit` に対応づけるので、消費側の対応はそちらの spec で行う。`apps/app` の型検査は未実施 (`node_modules` 未導入。消費側は `ErrorCode.*` の既存メンバーだけを使っており、readyz の型には触れない)。
- 8.1 (MANUAL_VERIFY_REQUIRED): この devcontainer には docker が無いので、次の「完了の状態」は未確認。(1) image が build できる、(2) image の大きさが 400MB 以下、(3) 読み取り専用 rootfs・uid 10001・`--network none` で起動する、(4) `/readyz` が ready を返す、(5) PDF と DOCX の `POST /extract` が成功する。確認コマンドは `services/attachment-text-extractor/CLAUDE.md` の「Container Deployment」に書いてあり、8.3 の CI でも使う。Dockerfile と compose は静的に確かめた (`tests/test_deploy_config.py` の 13 件): uv image は `ghcr.io/astral-sh/uv:0.12.24`、base は `python:3.12.15-slim-bookworm` (どちらも registry に存在を確認。digest は未固定)、`WORKERS` の既定 1、`RAYON_NUM_THREADS=1`、`TMPDIR=/tmp`、`USER 10001`、バイトコードを build 時にコンパイル。compose は `mem_limit: 2g`・`init: true`・`cap_drop: ALL`・`no-new-privileges`・tmpfs `/tmp` 64m・ヘルスチェックを `/readyz` (timeout 15 秒) に変更。tini は image に入れていない (slim に無く apt はネットワークと大きさが増える)。8.2 の k8s の Pod は init を使うか、`/tmp` が Pod ごと捨てられることに頼る。compose の `ports: 8000:8000` は `internal: true` のネットワークでは host に公開されない可能性がある (変更前から。未対応)。`TIMEOUT_S` の既定は 55 のまま (最悪 約 59 秒 vs apps/app 側 60 秒。9.2 で必ず扱う)。`uvicorn.main` の preload は CLAUDE.md の follow-up に記載。
- 8.2: k8s の manifest (`deploy/k8s/`) は kubectl / kubeconform が無いため、YAML を読んで中身を確かめただけで、クラスタには適用していない (`tests/test_k8s_manifests.py` の 26 件)。オペレーターが直す項目は `# EDIT:` で示してある (namespace・image・Secret 名・NetworkPolicy の ingress の相手)。k8s には init の設定が無く image に tini も無いので、forkserver が落ちて孤児になった子は、Pod の `/tmp` (メモリ上の emptyDir) が Pod ごと捨てられることに頼る (`shareProcessNamespace` は設定していない)。決めた数値: `terminationGracePeriodSeconds` 75 (`TIMEOUT_S` 55 + 余裕)、readiness は `timeoutSeconds` 15 / `periodSeconds` 20、liveness は `/healthz` で忙しい Pod を殺さないよう `failureThreshold` 6、HPA は CPU 70%・2〜10 レプリカ (CPU は 3 枠 + 満杯なら 503 の代理指標)、`/tmp` の `sizeLimit` 64Mi。PodDisruptionBudget は設計に無いので入れていない。
- 8.3 (MANUAL_VERIFY_REQUIRED): `.github/workflows/attachment-text-extractor.yml` を作った。ただし GitHub 上で一度も実行していない (push は未承認の外部への操作)。人が確認する項目: (1) ワークフローの `paths` に合うブランチ (例: このワークフロー自身を変更したブランチ) に push して実行し、`gh api repos/<org>/<repo>/actions/runs/<id>/jobs` でジョブ数が 0 より多く全ステップが成功したこと (0 ジョブの実行は成功ではない)。(2) Docker の各ステップ (build、400MB 以下、読み取り専用・uid 10001・`--network none` での起動、`/readyz`、PDF と DOCX の抽出) は docker が無く未実行。コンテナ内の client は host の uvicorn に対してだけ確かめた。(3) `astral-sh/setup-uv@v6` のタグが GitHub 上で解決できること。静的な確認は `tests/test_ci_workflow.py` (17 件) と `tests/test_smoke_extract.py` (7 件): ステップの順番、400000000 バイト、docker の起動フラグ、`if: |` のブロックにコメントが無いこと、トークンの直書きが無いこと。`actionlint` / `yamllint` は無く未実行。OpenAPI の差分検知は `scripts/check_openapi_drift.py` で JSON として比べる (コミット済みのファイルは biome 整形済みで、書き出した生の JSON と文字列では一致しないため。`poe export-openapi` は生の JSON でコミット済みのファイルを書き換えるので、ローカルでは出力先を一時ファイルにする)。トリガーは `ci-vault.yml` と同じ `push` + `workflow_dispatch` で、`pull_request` / `merge_group` は無く、`.github/mergify.yml` の必須チェックにも入っていない (未変更。マージの条件にするかは別判断)。
- 9.1: `tests/test_e2e_http.py` (86 件) が実際の app・lifespan・runner を通して、28 形式の単位・番号・ラベル・MIME、エラー表の全行 (400 / 401 / 408 / 413 / 422 ×3 種 / 500 / 503)、枠が満杯のときの 503 (2 秒未満)、時間切れ・異常終了の後の次のリクエストを確かめる。拡張するときの決まり: forkserver はプロセス全体で 1 つなので、複数の app を同時に動かさない (クラス単位の fixture)。`app.routers.extract.limits` は初回に作られて使い回されるので、テストは app ごとに None に戻す。主な挙動: 空の `.txt` は 200 で空の 1 要素、空の `.pdf` / `.docx` / `.xlsx` は 422 `extraction_failed`、拡張子が不明な空ファイルは 400、画像だけの PDF は 200 で `pageNumber` が null の空の 1 要素。時間切れは 0.2 秒の期限で 5 シート × 1 万 4 千行の XLSX (約 0.47 秒) を使うので、遅い CI では余裕が約 2.3 倍。
- 9.2 (一部 MANUAL_VERIFY_REQUIRED): docker が使えない範囲はすべて確かめた: lint・整形・全テスト (1115 件を 2 回連続)、OpenAPI の差分検知、lock の同期、本番依存 26 件のライセンス (すべて MIT / BSD / Apache-2.0 / PSF)、残骸の grep、要件 ID (1.1〜4.2) ごとのテスト対応。image の build・大きさ 400MB 以下・`--network none` での抽出・GitHub 上でのワークフローの実行は 8.1 / 8.3 の人の確認が残る。要件 4.1 (テナントの分離) は単体のサービスとして配備することを静的に確かめるだけで、振る舞いのテストは無い。`/tmp/pymp-*` は古い 8 件が残っている (今回のテストは作らない)。`post_extract` (54 行) と `create_app` (51 行) が「関数は 50 行未満」の目安を数行超える。
