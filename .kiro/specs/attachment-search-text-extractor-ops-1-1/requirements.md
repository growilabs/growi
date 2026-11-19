# Requirements Document

## Project Description (Input)

### 問題

GROWI.cloud の運用者は、1 つの抽出サービス (`apps/attachment-text-extractor`) を複数の顧客の GROWI (app) で共有して動かす。いまの抽出サービスは、どの app からの要求かをログに出さず、処理中の件数や応答の数を監視システムが集める形で出していない。そのため、顧客ごとの負荷が抽出サービスの側から見えず、自動スケールの指標も CPU しかない。あわせて、レビューで見つけて先送りにした抽出サービスの不具合と文書の不足 (`.kiro/specs/attachment-search/roadmap.md` の (f) の抽出サービス側) が残っている。

### 現状

- 抽出サービスは版 1.0.0 として公開済みである。ログの `/extract` の行は `extract format=… size=… duration_ms=… result=… child_peak_rss_mb=…` で、呼び出し元を見分ける情報が無い。
- `GET /metrics` は無い。
- `/readyz` は呼ぶたびに確認用の子を起動し、結果を覚えない。トークンなしで呼び続けられると最大で約 1 コアを使う。
- PPTX / XLSX のファイルの形を少し崩すと、ZIP のエントリ数・展開後の大きさ・XLSX のセル数の上限を通らずに変換される。
- PDF と PPTX の結果の大きさは、全ページを読んだ後にだけ確かめている。
- 変換の子が親の環境変数を読めることが、文書に書かれていない。
- コードのコメントが、削除した作業用の spec の要件番号を引いている。

### 達成したい姿

抽出サービスの版 1.1.0 で、ログから呼び出し元の app が分かり、運用者が `/metrics` から負荷を集められ、上の不具合と文書の不足が片づいている。

詳細は [brief.md](./brief.md) を参照。

## Introduction

本 spec は、完了済みの spec `attachment-search-text-extractor` と、その呼び出し側である `attachment-search-indexing` の契約を変える **amend spec** である (`.claude/rules/spec-lifecycle.md`)。変わる契約の一覧は [brief.md](./brief.md) の「Amend target」にある。

**番号の読み方**: この文書の「1.1」のような番号は、この spec の要件の番号である。対象 spec の要件を指すときは「対象 spec の AC 2.6」のように書く。取り込みのときの番号の対応は brief.md の「Port-back の前提」にある。

**`X-Growi-App-Id` の値について**: この値は app が自分で名乗るもので、認証されていない。負荷の内訳を見るためだけに使い、認可・上限・処理の分岐のどれにも使わない (ユーザーの決定)。Req 1 の AC は、この値で要求の扱いが変わらないことを求めている。

## Boundary Context

- **In scope**:
  - 抽出サービス: `X-Growi-App-Id` の受け取りとログへの出力、`GET /metrics`、`/readyz` の結果の使い回し、ZIP の上限を回避する経路の閉鎖、PDF / PPTX のページごとの結果の大きさの確かめ、子と親の環境変数についての文書、古い要件番号のコメントの削除
  - OpenAPI の文書 (`packages/attachment-text-extractor-client/openapi.json`) と生成クライアントの作り直し
  - apps/app: `POST /extract` を送るときに `X-Growi-App-Id` を付けること
  - 版 1.1.0 の changeset、`docker/README.md` の公開タグの一覧とログの説明
- **Out of scope**:
  - apps/app 側で抽出の件数と所要時間を公開すること (`attachment-search-indexing` の Req 8.2、task 3.4)
  - app ごとの同時実行の上限、トークンの入れ替え、宛先の固定 (roadmap の (h))
  - 子が親の環境変数やほかの要求のファイルを読めることへの対策 (roadmap の (h))
  - Python 版に由来する仕様の是正 (roadmap の (g))
  - コメントが引く `research.md` の節の番号と `D1`〜`D5`
- **Adjacent expectations**:
  - GROWI.cloud の app には `GROWI_APP_ID_FOR_GROWI_CLOUD` が設定されている。OSS の app には設定されていない
  - `/metrics` と `/readyz` に届く要求は、ネットワークの設定 (内向きの通信の制限) で、監視システムと GROWI の app からだけに絞られている
  - 運用の手引き (GROWI の外で管理する文書) は、tasks.md の最後の確認の一覧を受けて別に直す

## Requirements

### Requirement 1: 呼び出し元の app をログに出す

**Objective:** GROWI.cloud の運用者として、抽出サービスのログの行から、要求を送った app を見分けたい。なぜなら、共有している抽出サービスの負荷が、どの顧客から来ているかを抽出サービスの側で知りたいから。

#### Acceptance Criteria

1. When `POST /extract` の要求が認証を通る, the 抽出サービス shall その要求の `/extract` のログの行の最後に ` app=<値>` を付けて出す
2. When 要求の `X-Growi-App-Id` ヘッダーの値が `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` に合う, the 抽出サービス shall その値をそのまま `app=` の値にする
3. If 要求に `X-Growi-App-Id` ヘッダーが無い, the 抽出サービス shall `app=-` と出す
4. If `X-Growi-App-Id` ヘッダーの値が 1.2 の形に合わない (空、65 文字以上、使えない文字を含む、同じヘッダーが 2 つ以上ある), the 抽出サービス shall `app=(invalid)` と出し、受け取った値はログに写さない
5. The 抽出サービス shall `X-Growi-App-Id` の値の有無と形によって、応答のステータス、応答の本文、枠の取り方、変換の上限を変えない
6. When 本文を受け取る前か変換の前に要求を断る (`service_busy`、`file_too_large`、`upload_timeout`、`invalid_upload`、`client_disconnected`), the 抽出サービス shall その行にも 1.1〜1.4 のとおり `app=` を付ける
7. The 抽出サービス shall OpenAPI の文書で、`POST /extract` に任意のヘッダー `X-Growi-App-Id` (1.2 の形の文字列) を受け付けることを示す

### Requirement 2: apps/app が app の ID を送る

**Objective:** GROWI.cloud の運用者として、各 app が自分の ID を抽出サービスに伝えてほしい。なぜなら、Req 1 のログの値は app が送らなければ埋まらないから。

#### Acceptance Criteria

1. When apps/app が `POST /extract` を送り、設定 `app:growiAppIdForCloud` に値がある, the apps/app shall その値を文字列にして (前後の空白を取り除かずに) `X-Growi-App-Id` ヘッダーに入れて送る。ただし 2.2 と 2.3 に当たるときは送らない
2. Where 設定 `app:growiAppIdForCloud` に値が無いか空の文字列である, the apps/app shall `X-Growi-App-Id` ヘッダーを付けずに送る
3. If 設定の値を文字列にしたものが、表示できる ASCII 文字 (0x21〜0x7E) だけでできていない (空白、改行、非 ASCII の文字を含む), the apps/app shall ヘッダーを付けずに抽出を続け、抽出の要求そのものを失敗させない
4. The apps/app shall 設定の値を、送るたびに読み直す (抽出サービスの URI とトークンと同じ読み方)

### Requirement 3: 稼働状況の指標 (`GET /metrics`)

**Objective:** GROWI.cloud の運用者として、抽出サービスの処理中の件数、応答の数、所要時間、プロセスの状態を監視システムで集めたい。なぜなら、負荷を見て、埋まっている枠の数で自動スケールしたいから。

#### Acceptance Criteria

1. When `GET /metrics` が呼ばれる, the 抽出サービス shall Prometheus のテキスト形式で、この 3.2〜3.6 の値を返す
2. The 抽出サービス shall いま変換のために取られている枠の数と、枠の上限 (`MAX_CONCURRENCY`) を、それぞれ gauge として出す
3. The 抽出サービス shall 応答の数を、エンドポイントと HTTP ステータスごとに数えたカウンタとして出す。エンドポイントの値は、文書に載っている経路 (`/extract`、`/healthz`、`/readyz`、`/openapi.json`、`/metrics`) と、それ以外すべてをまとめた `other` だけにする
4. The 抽出サービス shall 3.3 のカウンタに、401 と 404 の応答も含める
5. The 抽出サービス shall `/extract` の 1 件ごとの結果 (ログの `result=` と同じ値) ごとに、件数のカウンタと所要時間のヒストグラムを出す
6. The 抽出サービス shall HTTP を受けるプロセスの CPU 時間、メモリ、イベントループの遅れを出す
7. The 抽出サービス shall どのメトリクスのラベルにも `X-Growi-App-Id` の値を使わない
8. When `GET /metrics` がトークンなしで呼ばれる, the 抽出サービス shall トークンを求めずに答える。ただし、認証を外すかどうかは、`/healthz` などと同じく、送られた要求の文字列そのもの (`?` より前) が `/metrics` と完全に一致するかで決める
9. The 抽出サービス shall `GET /metrics` の呼び出しでログの行を出さず、変換の子を起動しない

### Requirement 4: `/readyz` の結果を使い回す

**Objective:** 抽出サービスの運用者として、トークンなしで `/readyz` を呼び続けられても CPU を使い続けないでほしい。ただし、固まった部品と、準備未完了からの回復には、決まった時間のうちに気づきたい。

#### Acceptance Criteria

1. When `/readyz` の確認が終わる, the 抽出サービス shall その結果 (準備完了と準備未完了のどちらも) を、確認を終えた時点から 10 秒間、続く `/readyz` の呼び出しに返す
2. When 覚えた結果が 10 秒より古くなった後に `/readyz` が呼ばれる, the 抽出サービス shall 確認用の子を起動して確かめ直す
3. While 確認が実行中である, the 抽出サービス shall 同時に届いた `/readyz` の呼び出しに、その 1 回の確認の結果を共有する (いまの振る舞いを保つ)
4. The 抽出サービス shall トークンなしで `/readyz` を休みなく呼ばれても、確認用の子を、前の確認が終わってから 10 秒に 1 回より多くは起動しない

### Requirement 5: ZIP の上限を回避する経路を塞ぐ

**Objective:** 抽出サービスの運用者として、PPTX / XLSX の ZIP の形を崩したファイルで、エントリ数・展開後の大きさ・セル数の上限を通り抜けられないようにしたい。なぜなら、この上限は細工したファイルから子を守るためのものだから。

#### Acceptance Criteria

1. If PPTX または XLSX として渡されたファイルが ZIP ではない (ZIP の終わりの記録が見つからない。暗号化された OOXML と旧形式の PPT / XLS はこれに当たる), the 抽出サービス shall いまと同じくファイル全体を anydoc に渡す
2. If PPTX または XLSX として渡されたファイルが ZIP であるのに、エントリの一覧を最後まで読めない (読めない名前、扱えない版の印を持つエントリ、ZIP の読み手が開けない), the 抽出サービス shall 変換を行わず、`extraction_failed` (422) を返す
3. If PPTX または XLSX として渡された ZIP に、必要な部品 (`ppt/presentation.xml` または `xl/workbook.xml`) が無いか、同じ名前で 2 つ以上ある, the 抽出サービス shall 変換を行わず、`extraction_failed` (422) を返す
4. The 抽出サービス shall 5.2 と 5.3 の変更で、`ErrorCode` の値、HTTP ステータスとの対応、OpenAPI の文書を変えない

### Requirement 6: PDF と PPTX のページごとに結果の大きさを確かめる

**Objective:** 抽出サービスの運用者として、結果の大きさの上限を超えた変換は、その時点で止まってほしい。なぜなら、上限を大きく超える結果を最後まで読むと、時間とメモリを無駄に使うから。

#### Acceptance Criteria

1. When PDF のページ、または PPTX のスライドを 1 つ読み終える, the 抽出サービス shall それまでに読んだ `content` の UTF-8 のバイト数の合計 (改行を LF に揃えた後の値。`label` は数えない) が `MAX_RESULT_BYTES` を超えたら、残りを読まずに `result_too_large` で止める
2. The 抽出サービス shall 6.1 の合計を、全経路の最後に行う結果の大きさの確かめと同じ数え方で数える
3. The 抽出サービス shall 全経路の最後に行う結果の大きさの確かめを残す

### Requirement 7: 子プロセスと親の環境変数についての文書

**Objective:** 抽出サービスの運用者として、変換の子プロセスが親の環境変数 (トークンを含む) を読めることを知っておきたい。なぜなら、共有の抽出サービスを置くかどうか、どう置くかを決める材料になるから。

#### Acceptance Criteria

1. The 運用者向けの文書 (`apps/attachment-text-extractor/docker/README.md`) shall 変換の子が親と同じ uid で動くこと、トークンは子に渡さないが、子は親の環境変数をトークンを含めて `/proc` から読めることを書く
2. The 運用者向けの文書 shall 1 の記述の根拠 (確かめた環境と、確かめていない環境。GROWI.cloud のノードでは試していないこと) を、確かめた範囲を超えない言い方で書く
3. The 運用者向けの文書 shall この事実への対策を決めていないこと (`attachment-search` の roadmap の (h) で決めること) を書く

### Requirement 8: 古い要件番号を引くコメントを取り除く

**Objective:** 抽出サービスを次に変える開発者として、コメントが存在しない要件や別の要件を指していないでほしい。なぜなら、番号が合わないコメントは、読み手を間違った要件に導くから。

#### Acceptance Criteria

1. The 抽出サービスのコード (`apps/attachment-text-extractor/` の `src`・`scripts`・`test`・`benchmark`) と `.github/workflows/ci-attachment-text-extractor.yml` shall コメントとテストの名前 (`describe` / `it` に渡す文字列) で要件の番号 (`Req N.M`、`Requirement N.M` の形) を引かない
2. When 番号を消したコメントが、コードから読み取れない理由を述べている, the 変更作業 shall その理由を番号なしの文として残す。理由を述べていないコメントは、行ごと消す
3. The 変更作業 shall コメントとテストの名前の変更だけを 1 つの commit にまとめ、コードとテストの振る舞いを変えない

### Requirement 9: 版 1.1.0 として公開する

**Objective:** GROWI.cloud の運用者として、この spec の変更を 1 つの版の image で受け取りたい。

#### Acceptance Criteria

1. The 変更作業 shall `@growi/attachment-text-extractor` の minor の changeset を 1 つ書き、版を 1.1.0 にする
2. The 変更作業 shall 同じ PR で、`docker/README.md` の公開タグの一覧に `1.1.0` と `1.1` を加え (`1.0.0` の行は残す)、ログの説明に `app=` と `/metrics` を加える
3. The 変更作業 shall OpenAPI の文書の `info.version` を `1.1.0` にする
4. Before 「Release Subpackages」の PR をマージする, the 人 shall `ci-attachment-text-extractor.yml` を手で起動した実行 (linux/amd64 と linux/arm64、メモリの計測を含む) が成功したことと、公開する内容を確かめる

### Requirement 10: 対象 spec への取り込みと、この spec の削除

**Objective:** spec の保守担当として、この spec の変更が対象の spec に取り込まれ、この spec が残らないでほしい。なぜなら、変更の記述が 2 か所に分かれると、どちらが正しいか分からなくなるから。

#### Acceptance Criteria

1. When 実装が終わる, the 変更作業 shall この spec の変更を、`attachment-search-text-extractor` と `attachment-search-indexing` の requirements.md・design.md・research.md に、最初からそうだったように書き込む (既存の要件番号は変えず、新しい番号は末尾に足す)
2. The 変更作業 shall 設計の理由と実験の記録を、対象 spec の research.md に移す
3. The 変更作業 shall `attachment-search` の roadmap.md の (f) から終わった抽出サービス側の項目を、(h) から「呼び出し元の app を抽出サービスのログに出す」を消し、(h) の子の環境変数の項目を「文書に書いた。対策は未決」に書き換える
4. The 変更作業 shall 対象 spec の `spec.json` の `updated_at` を更新し、この spec のディレクトリを削除する
5. The 変更作業 shall 運用の手引きに反映してほしい変更の一覧を、完了の報告に載せる
