# Requirements Document

## Project Description (Input)

### 誰が困っているか

GROWI を self-host している運用者と、GROWI をチャットから使うチーム。

### 今どうなっているか

`apps/slackbot-proxy`（以下 Gen 1）は GROWI と Slack をつなぐ中継サーバで、次の 3 つを担っている。

- GROWI から Slack の channel への通知
- Slack のスラッシュコマンドからの検索・ページ作成
- **複数の GROWI 対 複数の Slack workspace を 1 台でさばくハブ機能**（Gen 2 でも核心）

行き詰まっているのは次の 3 点。

- **Slack にしか対応していない。** `@slack/oauth` / `@slack/web-api` / Block Kit がコードベース全域に
  散らばっており、Mattermost・Discord・Microsoft Teams・Chatwork を足す余地が無い。
  GROWI 本体側も `packages/slack` を通じて Slack Block Kit をそのまま組み立てているので、
  Slack 依存は proxy だけの問題ではない。
- **どのチャットサービスでも公式アプリになっていない。** 運用者が自分で Slack App を作る必要がある。
- **private channel への投稿に事前準備が要る。** bot を招待しておくことが前提になっている
  （`join-to-conversation` ミドルウェアが存在する理由）。

### 何を変えるか

Slack 専用の中継サーバを、**複数のチャットサービスに対応した中継サーバ**（以下 Gen 2）へ作り直す。
作るものは 3 つに分かれる。

1. **中継サーバ本体（`apps/chat-integration-proxy`）** — 各チャットサービスとのやり取り
   （OAuth、webhook の検証、ネイティブなメッセージ形式への変換、分散ロック）を
   Vercel Chat SDK（`chat` + adapters、MIT）に任せる形で作り直す。
   GROWI 独自の関係管理 — 1 workspace 対 N GROWI のルーティング、トークンのペア、チャンネル単位の権限 —
   は Chat SDK では代替できないので、Gen 2 でも自前で持ち続ける。
2. **チャットサービスに依存しないメッセージ形式（`@growi/chat`、名前は仮）** — Slack Block Kit を置き換える。
   `packages/slack` は Gen 1 用のレガシーとして凍結する。
3. **GROWI 本体側の置き換え** — 本体がその中立形式を出す側になる。
   `growi-uri-injector` の Delegator ツリーは役目を終え、GROWI URI の埋め込みは中立形式側のメタデータへ移す。
   **工数はここに最も集中する。**

### 前提

**Gen 2 は完全なスクラッチ開発とする。Gen 1 との後方互換は取らない。段階的な移行も考えない。**
既存のデータモデル・プロトコル・依存ライブラリのいずれにも縛られない。

**Gen 1 の実装には手を入れない。** Gen 1 と Gen 2 はしばらく併存し、既存の利用者は Gen 1 を使い続ける。

### discovery で確定済みの決定

根拠は同じディレクトリの `brief.md` にある。

| # | 決定 |
|---|---|
| 1 | **データベースは PostgreSQL。** Chat SDK が必須とする state adapter に公式の `pg` 実装があり、MySQL 実装が無いため。Gen 1 の MySQL + TypeORM 0.2.45 からは離れる |
| 2 | **Microsoft Teams はサポートする。** 運用者ごとに Azure Bot 登録が要る点は変えられないので、手順をどこまで用意するかだけが残る |
| 3 | **複数 GROWI にまたがる検索結果は、proxy が Reciprocal Rank Fusion（RRF）で 1 本のリストに統合する。** LLM は使わない。これにより検索結果は整形済みの表示物ではなく**構造化データ**で proxy へ返すことが確定した |
| 4 | **ページ作成は決まったコマンドのまま作り直す。** 自由な文章からの作成は初版を出したあとで別途判断する |
| 6 | **proxy と GROWI がお互いを本物だと確認する方法は RFC 9421 HTTP Message Signatures + Ed25519（非対称鍵）。** 公開鍵は最初の紐付けのときに相手へ登録する。Gen 1 の固定文字列トークン 2 本は使わない |
| 7 | **接続方向は proxy から GROWI へ**（Gen 1 と同じ）。GROWI 側から常時接続を張る案は採らない。閉域ネットワークは「proxy と GROWI をどちらも閉域に置き、外部からの通信を proxy だけに通す」構成で満たし、これを名前の付いた推奨デプロイ構成として設計・文書化する |
| 8 | **Gen 1 と Gen 2 は GROWI 本体で同時に有効にできる**（ブリーフの案 1）。利用者は好きなタイミングで乗り換えられる |

なお、対応するチャットサービス・作る機能の範囲・チャット利用者と GROWI ユーザーの対応づけは、
本書の Boundary Context と Requirement 1 / 7 で確定させた。

### まだ決めていないこと

| # | 未決の論点 |
|---|---|
| 5 | **各チャットサービスの公式アプリ審査を通すかどうか。** 技術ではなく審査・組織の問題（Slack App Directory、Discord verified bot、Teams AppSource）。Gen 2 の技術スコープから外して別トラックにするのが妥当か |
| 6-a | **決定 6 のうち、署名を何で実装するか。** RFC 9421 + Ed25519 という方式は確定しているが、`http-message-signatures`（総リリース 10 本）をそのまま使うか、RFC 8941 Structured Fields の正準化だけ薄く自前で書いて署名・鍵管理は `jose` に載せるかが未決。検証コードの範囲が変わるので要件フェーズで決める。**暗号そのものは自前で書かない** |
| 7-a | **決定 7 の「どのサービスが proxy への外部からの接続を必要とするか」の確定。** Discord のアダプタが、外部から届くエンドポイントを開けずにスラッシュコマンドとボタンを受けられるかが未確認。受けられないなら、閉域構成で外部から通す経路が Teams だけでなく Discord にも要る |
| M | **Mattermost のアダプタを引き取って保守するか。** `chat-adapter-mattermost` はメンテナ 1 名・4 リリースの有志作で、対応する 4 サービスのうちここだけが公式アダプタではない。実際に GROWI からの通知経路で動かして、fork 保守の現実味を測ってから決める |

### 要件フェーズで扱う必要があるリスク

`brief.md` の 2.4 に詳しい。

- Chat SDK のリリース頻度が高い（約 8 か月で 54 リリース）。バージョン完全固定と、薄い facade で包んで
  影響を 1 モジュールに閉じ込めることを設計判断として明記する
- Teams は「Webhook URL を貼るだけ」の導入方法が 2026-05 に廃止済みで、運用者ごとに Azure Bot 登録が要る


---

## Introduction

この文書は、Slack 専用の中継サーバ（Gen 1）を複数のチャットサービスに対応した中継サーバへ作り直すにあたって、
**利用者と運用者から見て何ができるようになるか**を定める。

前提・確定済みの決定・まだ決めていないことは上の Project Description に、その根拠は同じディレクトリの
`brief.md` にある。技術的な選択（どのデータベースを使うか、相手の確認にどの標準を使うか、
各チャットサービスとのやり取りをどのライブラリに任せるか）は既に確定しているが、それらは design で扱う。
ここでは確定した選択が**利用者と運用者に何をもたらすか**だけを書く。

以下、中継サーバを **chat-integration proxy**、GROWI 本体を **GROWI application** と呼ぶ。

## Boundary Context

### In scope

- **対応するチャットサービスは Slack・Mattermost・Discord・Microsoft Teams の 4 つ**
- Gen 1 の利用者向け機能の作り直し — 通知（管理者が設定するもの・編集した人が指定するもの）、
  複数 GROWI をまたぐ検索、ページ作成、チャットの会話の取り込み、GROWI の URL の展開、ヘルプ
- チャットの利用者と GROWI ユーザーの紐付け（1 人の GROWI ユーザーに複数サービスのアカウント）
- 1 つのチャット workspace に複数の GROWI が紐づくときの振る舞い
- chat-integration proxy と GROWI application が相手を本物だと確認する仕組み（最初の紐付けと、
  リクエストごとの確認、鍵の入れ替え）
- チャンネル単位のコマンド権限
- 閉域ネットワークでの運用構成と、その導入手順
- Gen 1 との同時有効化

### Out of scope

- **Chatwork と Google Chat への対応** — 今回の対応先に含めない。Chatwork は thread も対話的な入力部品も
  持たないため、代わりの手段の設計が他の 4 つと大きく異なる
- **各チャットサービスの公式アプリ審査**（決定 5）— 審査要件も期間もサービスごとに違い、実装ではなく
  申請の作業。別トラックで扱う
- **LLM を使った、自由な文章からのページ作成**（決定 4）— 決まったコマンドのまま作り直す。
  チャット側に LLM が居る場合は、GROWI の MCP サーバとスコープ付きアクセストークン
  （`access-token-parser` spec、実装済み）で直接ページを作れるため、chat-integration proxy を
  経由させる理由が無い
- **複数 GROWI の検索結果を LLM で関連度順に並べ替えること**（決定 3）— 交互に並べる形を既定とする
- **検索結果の要約** — 本文の取得が必要になり、ある GROWI が他の GROWI を読む手段が要る
- **Gen 1 の実装の変更** — Gen 1 には手を入れない
- **チャットサービス側の制約そのものの解消** — bot が参加していないチャンネルへ投稿できないこと、
  そのチャンネルの会話履歴を取得できないことは Gen 2 でも変わらない。本書が定めるのは、
  そうなったときに何が必要かを利用者に示すことである

### Adjacent expectations

- **GROWI application の権限判定** — ページの閲覧・作成の可否は GROWI application が判定する。
  chat-integration proxy は独自の権限判定を持たない
- **GROWI application の検索** — 各 GROWI の既存の検索をそのまま使う。本 spec は検索の仕組みに手を入れない
- **GROWI application の監査ログ** — チャット経由の操作も他の操作と同じように記録されることを期待する。
  本 spec は記録の仕組みを作らない
- **`packages/slack`** — Gen 1 用として凍結する。本 spec は変更しない

## Requirements

### Requirement 1: 複数のチャットサービスへの対応と、サービスごとの機能差

**Objective:** As a GROWI を self-host する運用者, I want 自分たちが使っているチャットサービスで GROWI 連携を使えること, so that GROWI に合わせてチャットサービスを選び直さずに済む

#### Acceptance Criteria

1. The chat-integration proxy shall Slack・Mattermost・Discord・Microsoft Teams のそれぞれに対して、本書の他の要件が定める機能を提供する
2. Where あるチャットサービスが、ある機能に必要な仕組み（対話的な入力部品、会話履歴の取得、投稿されたリンクの通知）を持たない, the chat-integration proxy shall その仕組みを使わない代わりの手段でその機能を提供するか、そのサービスではその機能を使えないことを利用者に示す
3. When 運用者があるチャットサービスとの連携を設定した, the chat-integration proxy shall そのサービスで使える機能と使えない機能を運用者に示す
4. If あるチャットサービス向けの処理が想定外に失敗した, then the chat-integration proxy shall 他のチャットサービスの処理を継続する
5. The 導入ドキュメント shall チャットサービスごとに、運用者が事前に用意しておく必要があるものを示す

### Requirement 2: GROWI からチャットへの通知

**Objective:** As a GROWI を使うチームのメンバー, I want ページの変更をふだん使っているチャットのチャンネルで受け取ること, so that GROWI を開かなくても更新に気づける

#### Acceptance Criteria

1. When 管理者が設定したパス条件に一致するページで、ページ作成・ページ編集・ページ削除・ページ移動・いいね・コメント のいずれかが起きた, the GROWI application shall 設定されたチャンネルへ、そのページへのリンクと、操作した人を含む通知を投稿する
2. When 編集した人がページの保存時に通知先のチャンネルを指定した, the GROWI application shall 指定されたチャンネルへ通知を投稿する
3. While 通知の対象が、誰でも閲覧できるわけではないページである, the GROWI application shall 通知にページ本文を含めない
4. If 通知先のチャンネルに bot が参加していないために投稿できなかった, then the chat-integration proxy shall 投稿できなかったこと・対象のチャンネル・投稿できるようにするために必要な操作 を運用者が後から確認できる形で記録する
5. If 通知先のチャットサービスが応答しなかった, then the GROWI application shall ページの作成・編集・削除・移動そのものは完了させる
6. When 1 つの GROWI に複数のチャットサービスが紐づいている, the GROWI application shall 設定された全ての宛先へ通知を投稿する

### Requirement 3: 複数の GROWI をまたぐ検索

**Objective:** As a 複数の GROWI を使っているチームのメンバー, I want チャットから 1 回検索するだけで全ての GROWI の結果を見られること, so that どの GROWI に書いたか思い出せなくても探せる

#### Acceptance Criteria

1. When 利用者が検索コマンドを実行した, the chat-integration proxy shall そのチャンネルに紐づく全ての GROWI へ同じ検索語を送る
2. When 紐づく全ての GROWI から結果が返った, the chat-integration proxy shall 各 GROWI の上位から順に交互に取り出して並べた 1 本のリストとして投稿する
3. The chat-integration proxy shall 結果の各行に、どの GROWI の結果かを示す
4. If 定められた待ち時間の内に応答しなかった GROWI があった, then the chat-integration proxy shall 間に合った GROWI の結果を投稿したうえで、応答しなかった GROWI を名前付きで示す
5. If 紐づく全ての GROWI が待ち時間の内に応答しなかった, then the chat-integration proxy shall 結果が得られなかったことと、応答しなかった GROWI を利用者に示す
6. The GROWI application shall 検索を実行した利用者に対応する GROWI ユーザーの閲覧権限を適用した結果だけを返す
7. If 検索を実行した利用者に対応する GROWI ユーザーが紐付いていない, then the GROWI application shall 誰でも閲覧できるページだけを結果に含める
8. Where 運用者が GROWI ごとの重みを設定した, the chat-integration proxy shall 重みの大きい GROWI の結果をより上位に配置する
9. The GROWI application shall 検索結果を、順位・パス・タイトル・URL・更新日時を個別に取り出せる形で返す

### Requirement 4: チャットからのページ作成

**Objective:** As a チャットで議論しているチームメンバー, I want 話の内容をその場で GROWI のページにできること, so that チャットに流れて消えるのを防げる

#### Acceptance Criteria

1. When 利用者がページ作成のコマンドを実行した, the chat-integration proxy shall ページのパスと本文を入力する手段を利用者に示す
2. When 利用者がパスと本文を確定した, the GROWI application shall そのパスにページを作成し、作成されたページへのリンクを利用者に返す
3. The 作成されたページ shall 作成者として、操作した利用者に紐付いた GROWI ユーザーを記録する
4. If 操作した利用者に対応する GROWI ユーザーが紐付いていない, then the GROWI application shall ページを作成せず、紐付けの手順を chat-integration proxy 経由で利用者に返す
5. If 紐付いた GROWI ユーザーがそのパスへページを作成する権限を持たない, then the GROWI application shall ページを作成せず、権限が足りないことを利用者に示す
6. If 指定されたパスに既にページが存在する, then the GROWI application shall 既存のページを上書きせず、既にページがあることを利用者に示す

### Requirement 5: チャットの会話の取り込み

**Objective:** As a チャットで議論したチームメンバー, I want その会話を原文のまま GROWI のページとして残せること, so that 後から議論の経緯を読み返せる

#### Acceptance Criteria

1. Where あるチャットサービスが会話履歴の取得に対応している, the chat-integration proxy shall 利用者が取り込む範囲を指定して会話をページにする手段を提供する
2. When 利用者が取り込む範囲を確定した, the GROWI application shall その範囲の発言を投稿された順に並べたページを作成する
3. The 作成されたページ shall 各発言について、投稿者に紐付いた GROWI ユーザーがいる場合はその GROWI ユーザーを、いない場合はチャット上の表示名を記す
4. If bot がそのチャンネルの会話履歴を取得できない, then the chat-integration proxy shall ページを作成せず、取得できない理由と、取得できるようにするために必要な操作を利用者に示す
5. If 指定された範囲に発言が 1 件も無い, then the chat-integration proxy shall ページを作成せず、その旨を利用者に示す
6. Where あるチャットサービスが会話履歴の取得に対応していない, the chat-integration proxy shall そのサービスではこの機能を使えないことを利用者に示す

### Requirement 6: GROWI の URL の展開

**Objective:** As a チャンネルで GROWI のリンクを共有する人, I want リンクを貼るだけで中身の概要が見えること, so that 相手が開かなくても何の話か分かる

#### Acceptance Criteria

1. When 利用者が、紐づく GROWI のページ URL をチャンネルに投稿した, the chat-integration proxy shall そのメッセージに、ページのパスを含む要約を添える
2. While 対象のページが誰でも閲覧できるページである, the chat-integration proxy shall 要約に本文の冒頭・更新日時・コメント数を含める
3. While 対象のページが誰でも閲覧できるわけではないページである, the chat-integration proxy shall 要約にパス以外の内容を含めない
4. If 対象の URL が、そのチャンネルに紐づくどの GROWI のものでもない, then the chat-integration proxy shall 何も添えない
5. Where あるチャットサービスが、投稿されたリンクを bot に通知する仕組みを持たない, the chat-integration proxy shall そのサービスではこの機能を使えないことを運用者に示す

### Requirement 7: チャットの利用者と GROWI ユーザーの紐付け

**Objective:** As a チャットから GROWI を操作する人, I want 自分の操作が自分の GROWI ユーザーとして記録されること, so that 誰が何をしたかがページの履歴と監査ログで追える

#### Acceptance Criteria

1. The GROWI application shall 1 人の GROWI ユーザーに対して、複数のチャットサービスのアカウントを紐付けられるようにする
2. The GROWI application shall 紐付けを自分の GROWI の中だけで成立させ、同じ workspace に紐づく他の GROWI での紐付けの有無に影響されないようにする
3. When 利用者がある GROWI に対する紐付けを始めた, the GROWI application shall そのチャットのアカウントが本人のものであることを確認できた場合にだけ紐付けを成立させる
4. If 紐付けようとしたチャットのアカウントが、同じ GROWI 内で既に別の GROWI ユーザーに紐付いている, then the GROWI application shall 紐付けを成立させず、その旨を利用者に示す
5. When 利用者が紐付けを解除した, the GROWI application shall 以降そのチャットアカウントからの書き込みを伴う操作を実行しない
6. If 紐付いていない利用者が書き込みを伴う操作を実行した, then the GROWI application shall その操作を実行せず、どの GROWI に対する紐付けが必要かが分かる形で手順を返す
7. The GROWI application shall 利用者が、自分に紐付いているチャットアカウントの一覧を確認して個別に解除できるようにする
8. The chat-integration proxy shall チャットのアカウントと GROWI ユーザーの対応表を保持しない

### Requirement 8: 1 つの workspace に複数の GROWI が紐づくときの振る舞い

**Objective:** As a 複数の GROWI を 1 つのチャット workspace から使うチーム, I want どの GROWI に対する操作かを取り違えずに済むこと, so that 意図しない GROWI にページを作ってしまわない

#### Acceptance Criteria

1. The chat-integration proxy shall 1 つのチャット workspace に対して複数の GROWI を紐付けられるようにする
2. When 対象が 1 つに定まる操作が、複数の GROWI が紐づくチャンネルで実行された, the chat-integration proxy shall どの GROWI に対して実行するかを利用者に選ばせる
3. When 対象が 1 つに定まる操作が、1 つの GROWI しか紐づかないチャンネルで実行された, the chat-integration proxy shall 選択を求めずにその GROWI に対して実行する
4. When 全ての GROWI を対象とする操作が実行された, the chat-integration proxy shall 選択を求めずに紐づく全ての GROWI に対して実行する
5. If 同じ GROWI を同じ workspace へ二重に紐付けようとした, then the chat-integration proxy shall 紐付けを成立させず、既に紐付いていることを示す
6. If 操作が実行されたチャンネルにどの GROWI も紐づいていない, then the chat-integration proxy shall 操作を実行せず、紐付けの手順を示す

### Requirement 9: chat-integration proxy と GROWI の紐付け

**Objective:** As a GROWI の管理者, I want proxy と自分の GROWI を安全に紐付けられること, so that 第三者が自分の GROWI を勝手に proxy へ登録できない

#### Acceptance Criteria

1. When 管理者がチャット側で登録操作を行った, the chat-integration proxy shall 一定時間で失効する登録コードを発行する
2. When 管理者が GROWI 側でその登録コードを入力した, the chat-integration proxy shall 申告された GROWI の URL に対して、その URL の持ち主だけが答えられる確認を行う
3. If URL の持ち主であることを確認できなかった, then the chat-integration proxy shall 紐付けを成立させず、確認に失敗したことを管理者に示す
4. If 登録コードが既に失効している, then the chat-integration proxy shall 紐付けを成立させず、やり直しの手順を管理者に示す
5. When 紐付けが成立した, the chat-integration proxy shall 以降お互いを確認するために必要な情報を双方に登録する
6. The chat-integration proxy shall 紐付けの過程で、相手になりすますために使える秘密を通信路に流さない
7. When 管理者が紐付けを解除した, the chat-integration proxy shall 以降その GROWI との間のリクエストを処理しない

### Requirement 10: リクエストごとの相手の確認と鍵の入れ替え

**Objective:** As a GROWI を閉域に置いている運用者, I want proxy から届くリクエストが本物であることを GROWI 側でも確認できること, so that proxy が侵害されても GROWI が無条件に従うことにならない

#### Acceptance Criteria

1. When chat-integration proxy が GROWI へリクエストを送った, the GROWI application shall そのリクエストの宛先・操作の種類・本文が送信時から変わっていないことを確認してから処理する
2. If 確認に失敗した, then the GROWI application shall そのリクエストを処理せず、失敗したことを運用者が後から確認できる形で記録する
3. If リクエストに付された有効期限を過ぎている, then the GROWI application shall そのリクエストを処理しない
4. If 一度処理したリクエストと同じものが再び届いた, then the GROWI application shall 二重に処理しない
5. While 運用者が鍵の入れ替えを行っている, the GROWI application shall 新旧どちらの鍵で送られたリクエストも処理する
6. The GROWI application shall 相手を確認するために保持している情報が漏れても、その相手になりすませない状態を保つ
7. The chat-integration proxy shall GROWI から届くリクエストに対しても、1 から 4 および 6 と同じ確認を行う

### Requirement 11: チャンネル単位のコマンド権限

**Objective:** As a GROWI の管理者, I want どのチャンネルからどのコマンドを使えるかを決められること, so that 想定していないチャンネルから書き込まれるのを防げる

#### Acceptance Criteria

1. The GROWI application shall コマンドごとに、実行を許すチャンネルを管理者が設定できるようにする
2. The GROWI application shall 全ての GROWI を対象とするコマンドと、1 つの GROWI を対象とするコマンドを、別々に設定できるようにする
3. If 許可されていないチャンネルからコマンドが実行された, then the chat-integration proxy shall そのコマンドを実行せず、そのチャンネルでは許可されていないことを利用者に示す
4. When 管理者が権限設定を変更した, the chat-integration proxy shall 次に実行されるコマンドから変更後の設定を適用する
5. If コマンドの実行後に表示された部品（ボタン・フォームなど）が操作された, then the chat-integration proxy shall そのコマンドと同じ権限設定を適用する

### Requirement 12: Gen 1 との併存

**Objective:** As a Gen 1 を使っている運用者, I want 好きなタイミングで Gen 2 へ移れること, so that GROWI のバージョンアップに移行作業を巻き込まれない

#### Acceptance Criteria

1. The GROWI application shall Gen 1 の連携と Gen 2 の連携を同時に有効にできるようにする
2. When 運用者が Gen 2 の連携を設定した, the GROWI application shall Gen 1 の設定を変更しない
3. While 両方の連携が有効である, the GROWI application shall それぞれの連携先へ独立に通知を投稿する
4. If 同じチャンネルが Gen 1 と Gen 2 の両方の通知先になっている, then the GROWI application shall 設定の時点でその旨を運用者に示す
5. The GROWI application shall 設定画面で、どちらの連携がどのチャットサービスに繋がっているかを区別して示す

### Requirement 13: 閉域ネットワークでの運用

**Objective:** As a GROWI をインターネットに公開できない組織の運用者, I want GROWI を公開せずにチャット連携を使えること, so that セキュリティ方針を変えずに導入できる

#### Acceptance Criteria

1. The chat-integration proxy shall GROWI がインターネットから到達できない構成で動作する
2. Where 対応するチャットサービスが chat-integration proxy への外部からの接続を必要としない, the chat-integration proxy shall 外部から proxy へ届く経路を開けずに動作する
3. Where 対応するチャットサービスが chat-integration proxy への外部からの接続を必要とする, the chat-integration proxy shall 接続元を限定するために必要な情報を運用者に示す
4. The 導入ドキュメント shall 閉域で運用する場合の構成図・必要な通信・chat-integration proxy と GROWI application の役割分担 を含む
5. The 導入ドキュメント shall chat-integration proxy が侵害された場合に閉域内の GROWI が受ける影響と、Requirement 10 がそれをどう抑えるかを示す

### Requirement 14: ヘルプ

**Objective:** As a チャットから GROWI を使う人, I want そのチャンネルで何ができるかをその場で確認できること, so that 使い方を調べるために GROWI やドキュメントを開かなくて済む

#### Acceptance Criteria

1. When 利用者がヘルプのコマンドを実行した, the chat-integration proxy shall そのチャンネルで実行できるコマンドとその使い方を利用者に示す
2. The GROWI application shall ヘルプの内容として、その GROWI が実際に提供しているコマンドとその使い方を返す
3. When 複数の GROWI が紐づくチャンネルでヘルプが実行された, the chat-integration proxy shall どの GROWI のヘルプかが分かる形で、GROWI ごとに区別して示す
4. The chat-integration proxy shall そのチャンネルで許可されていないコマンドを、ヘルプに含めないか、許可されていないことが分かる形で示す
5. If ある GROWI がヘルプの内容を返さなかった, then the chat-integration proxy shall その GROWI についてヘルプを表示できなかったことを示す
