# Requirements Document

## Project Description (Input)

### 背景・痛点
GROWI の URL だけを AI（対話エージェント）や検索エンジンに渡しても、コンテンツを十分に活用できない。実測で判明した 3 つの壁:

1. 本文が設定閾値 `app:ssrMaxRevisionBodyLength` を超えると SSR から CSR に切り替わり、JavaScript を実行しない HTTP 取得では本文 Markdown が取れない。
2. 兄弟ページ・配下ページの辿り方が URL 単体からは分からない。
3. 「ホスト + ページパスでもアクセスできる」というヒントが URL から得られない。

結果として AI・検索エンジンの視点で情報活用が弱く、SEO / GEO (Generative Engine Optimization) に対しても弱い。

### スコープ（Phase 1 のみ）
- 最優先は「URL を渡された対話エージェント」。ここで詰まると人間の UX に直結するため。
- OSS core に入れる。公開ページ・社内イントラ（認証付き）の両対応。
- SEO / GEO 向けの sitemap.xml / JSON-LD / Open Graph / canonical メタ / llms.txt / robots.txt と、それらの管理画面トグル群は **Phase 2 として別スペックに分離**する（このスペックには含めない）。

## Introduction

本機能は、GROWI の各ページに対して **Markdown 表現を返す HTTP エンドポイント**を追加する。URL を渡された対話型 AI エージェント（および認証付きツール）が、JavaScript を実行しなくても 1 回の取得でページ本文と近傍ナビゲーション（親・子・兄弟・正規 URL）を得られるようにし、そこからリンクを辿ってナレッジベースを探索できるようにする。既存のページ閲覧と同一のアクセス制御に従うことで、非公開情報を新しい経路から漏らさない。あわせて、この Markdown 版 URL を人間（コピー操作）と機械（HTML からの自動発見）の双方が入手できる導線を用意する。

## Boundary Context

- **In scope**:
  - `/{pageId}.md`・`{pagePath}.md`・`Accept: text/markdown`（および `?format=md`）による Markdown 取得。
  - `.md` サフィックスと実在ページの衝突解決（後方互換の維持）。
  - 応答への近傍ナビゲーション footer の付加。
  - 本文を持たない空ページ（コンテナ）の扱い。
  - HTML への機械可読な発見情報（alternate link / `Link` ヘッダ）の付加。
  - 既存 CopyDropdown への「Markdown URL (.md)」項目追加。
- **Out of scope（Phase 2 / 別スペック）**:
  - sitemap.xml、JSON-LD、Open Graph、SEO 用 canonical メタ、llms.txt、robots.txt、およびこれら AI/検索エンジン向け公開機能の管理画面トグル。
  - 子ページ一覧専用の Markdown エンドポイント（`/{pageId}/children.md` 等）は作らない。子が多い場合は footer から既存のページ一覧取得手段（ページ一覧 API）へ案内する。
- **Adjacent expectations**:
  - アクセス制御・本文（最新リビジョン）取得・親子関係／子ページ数・子ページ一覧は、既存のページ関連の仕組みに依存する（本機能は独自の認可を持たない）。
  - 兄弟ページは既存に専用取得手段が無いため、対象ページの親を起点に導出する。
- **Known limitation（要件ではなく前提）**:
  - URL 貼り付け経由のクラウド AI はセッション情報を持たないため、実際に匿名で取得できるのは公開ページが中心となる。非公開のイントラページは PAT を持つ GROWI MCP が本来の解であり、本エンドポイントは認証付きツール経由でも等しく機能する。
- **i18n**: UI 文言は英語ファーストとし、翻訳は後続タスクとする。

## Requirements

### Requirement 1: ページ Markdown の取得（URL 形態）
**Objective:** As an AI エージェント（または認証付きツール）, I want ページの Markdown 表現を URL で取得したい, so that JavaScript を実行せずにページ本文を活用できる

#### Acceptance Criteria
1. When クライアントが `/{pageId}.md`（`pageId` は permalink 形式の有効なページ ID）を GET したとき, the Markdown エンドポイント shall 該当ページの本文 Markdown を `Content-Type: text/markdown; charset=utf-8` で返す。
2. When クライアントが `{pagePath}.md` を GET し、そのパスの解決先ページが存在するとき, the Markdown エンドポイント shall 該当ページの本文 Markdown を `text/markdown` で返す。
3. When クライアントが通常のページ URL を `Accept: text/markdown` ヘッダ付き、または `?format=md` 付きで GET したとき, the Markdown エンドポイント shall 要求されたページの本文 Markdown を `text/markdown` で返す。
4. The Markdown エンドポイント shall 返す本文として、そのページの最新リビジョン本文をそのまま（別形式へ変換せず）用いる。
5. If 解決先のページが存在しないとき, then the Markdown エンドポイント shall HTTP 404 を返す。

### Requirement 2: `.md` サフィックスの衝突解決（後方互換）
**Objective:** As a 既存 GROWI 利用者, I want パス末尾が `.md` の実在ページが従来どおり表示されること, so that 新機能によって既存ページの表示が壊れない

#### Acceptance Criteria
1. When リクエストパス R が `.md` で終わり、かつ R そのものに対応する実在ページがあるとき, the GROWI サーバー shall 従来どおりそのページの通常（HTML）表示を返し、`.md` をフォーマット指定として解釈しない。
2. When リクエストパス R が `.md` で終わり、R に対応する実在ページが無く、末尾 `.md` を除いた base に対応する実在ページがあるとき, the Markdown エンドポイント shall base ページの Markdown を返す。
3. If リクエストパス R が `.md` で終わり、R にも base にも対応するページが無いとき, then the GROWI サーバー shall HTTP 404 を返す。
4. When クライアントが `Accept: text/markdown` または `?format=md` を明示したとき, the Markdown エンドポイント shall 要求されたパスそのものに対応するページの解決を最優先し、該当ページが存在すればその Markdown を返す（存在するが閲覧権限が無い場合は 403 とし、base へのフォールバックは行わない）。
5. If 明示指定（`Accept: text/markdown` または `?format=md`）されたパスが `.md` で終わり、そのパスそのものに対応するページが無いとき, then the Markdown エンドポイント shall 末尾 `.md` を除いた形での解決にフォールバックする（除去後が permalink 形であれば該当ページ、そうでなければ base パスのページの Markdown を返す）。footer 等が配る permalink 形 `.md` URL に明示シグナルを重ねた取得はこの規則で成立する。

### Requirement 3: アクセス制御（既存のページ閲覧認可の踏襲）
**Objective:** As a GROWI 管理者, I want Markdown 取得が通常のページ閲覧と同じ権限で保護されること, so that 非公開情報が新しい経路から漏れない

#### Acceptance Criteria
1. The Markdown エンドポイント shall 通常のページ閲覧と同一のアクセス制御（ページの grant と閲覧者の権限）に従って取得可否を判定する。
2. If 閲覧者が対象ページを閲覧する権限を持たないとき, then the Markdown エンドポイント shall HTTP 403 を返す。
3. While インスタンスがゲスト読み取りを許可し、かつ対象ページが公開であるとき, the Markdown エンドポイント shall 未認証（匿名）クライアントに対して Markdown を返す。
4. While インスタンスがゲスト読み取りを許可していないとき, when 未認証クライアントが Markdown を要求したとき, the Markdown エンドポイント shall 通常のページ閲覧と同じ挙動（ログインへの誘導もしくは取得不可）に従う。
5. When エンドポイントが 403 または 404 を返すとき, the Markdown エンドポイント shall 応答本文に、認証付き取得または GROWI MCP の利用を促す短い案内を Markdown で含める。

### Requirement 4: 近傍ナビゲーション footer
**Objective:** As an AI エージェント, I want 1 回の取得で親・子・兄弟ページと正規のページ URL を得たい, so that リンクを辿ってナレッジベースを探索できる

#### Acceptance Criteria
1. When the Markdown エンドポイントがページの Markdown を返すとき, the Markdown エンドポイント shall 本文の末尾に、対象ページの正規のページ URL（ホスト + パス形式）と permalink を含むナビゲーション footer を付加する。
2. When 対象ページに親ページがあるとき, the Markdown エンドポイント shall footer に親ページへの `/{pageId}.md` 形式のリンクを含める。
3. When 対象ページに子ページがあるとき, the Markdown エンドポイント shall footer に子ページへの `/{pageId}.md` 形式のリンクと直下子ページ総数を含め、あわせて子孫合計（descendantCount）を直下子数とは別に併記する。
4. When 対象ページに兄弟ページがあるとき, the Markdown エンドポイント shall footer に兄弟ページへの `/{pageId}.md` 形式のリンクを含める。
5. The Markdown エンドポイント shall footer に対象ページの最終更新日時と更新者を含める。
6. The Markdown エンドポイント shall 子ページ数の多寡に関わらず、全件を取得できる既存のページ一覧取得手段（ページ一覧 API）への案内を footer に常に含める。
7. If footer に列挙する子ページまたは兄弟ページの件数が上限を超えるとき, then the Markdown エンドポイント shall 総数と省略された残数を明記する（黙って切り詰めない）。
8. Where 対象ページが階層のルートで親を持たない場合, the Markdown エンドポイント shall footer の親リンクを省略する。

### Requirement 5: 空ページ（コンテナページ）の扱い
**Objective:** As an AI エージェント, I want 本文を持たない中間ノードのページでもナビゲーションを得たい, so that 探索が中間ノードで止まらない

#### Acceptance Criteria
1. When 解決先が本文を持たない空ページ（コンテナ）であるとき, the Markdown エンドポイント shall エラーにせず、ページのパスと「本文が無い」旨、および近傍ナビゲーション footer を含む Markdown を返す。
2. When 解決先が本文の内容が空（空文字）である通常ページのとき, the Markdown エンドポイント shall 空の本文と近傍ナビゲーション footer を返す。
3. The Markdown エンドポイント shall 空ページに対しても Requirement 4 のナビゲーション footer の規則を適用する。

### Requirement 6: 機械向けの発見性（alternate link / Link ヘッダ）
**Objective:** As an AI エージェント／クローラ, I want 素のページ URL から Markdown 版の存在を知りたい, so that コピー操作を介さずとも機械可読版へ辿れる

#### Acceptance Criteria
1. When GROWI がページの HTML を返すとき, the GROWI サーバー shall `<head>` に、当該ページの Markdown 版を指す `<link rel="alternate" type="text/markdown" href="/{pageId}.md">` を含める。
2. When GROWI がページの HTML を返すとき, the GROWI サーバー shall 同等の情報を HTTP `Link` レスポンスヘッダとしても提供する。
3. While ページ本文が初期 HTML に含まれず後からクライアント側で取得される場合でも, the GROWI サーバー shall 上記の alternate 情報を初期 HTML（サーバー描画部分）に含める。

### Requirement 7: 人間向けの発見性（CopyDropdown）
**Objective:** As a GROWI 利用者, I want ページの「Markdown URL (.md)」を簡単にコピーしたい, so that AI エージェントにそのまま貼り付けられる

#### Acceptance Criteria
1. When 利用者が通常ページで CopyDropdown を開いたとき, the CopyDropdown shall 「Markdown URL (.md)」項目を表示する。
2. When 利用者が「Markdown URL (.md)」項目を選択したとき, the CopyDropdown shall 当該ページのパス URL に `.md` を付与した URL（クエリまたはハッシュがある場合はその前に `.md` を挿入）をクリップボードにコピーする。
3. When 対象ページのパス末尾が `.md` であるとき, the CopyDropdown shall 無条件に `.md` を付与し（例: `.../README.md.md`）、解決はサーバー側の規則（Requirement 2）に委ねる。
4. Where 共有リンク表示モードのとき, the CopyDropdown shall 「Markdown URL (.md)」項目を対象外とする（本 Phase では通常ページのみ）。
