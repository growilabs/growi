# Requirements Document

## Introduction

ニュース一覧ページ `/_news` のニュース本文(body)を、プレーンテキスト描画から **Markdown 描画**へ変更する。これにより、運営(GROWI 配信元)は本文中の任意の位置に見出し・強調・リスト・リンク・**画像(GIF 含む)**を配置でき、テキストだけでは伝わりにくい内容(操作デモの GIF、書式付き告知など)を表現できる。

本文は配信フィード(GitHub Pages 上の feed.json)の body フィールドに **Markdown をインラインで**保持する。画像は従来どおりフィードと同一オリジンの `images/` ディレクトリ(feed.json と同ディレクトリ直下)に置き、本文の Markdown から相対パスで参照する。外部配信元のコンテンツを各インスタンスで描画するため、**専用の制限された描画(限定した要素のみ許可し生 HTML を通さない)**でセキュリティを担保することを中心的な制約とする。

設計判断の経緯・トレードオフ・アーキテクチャ特性は research.md に記録する。

## Boundary Context

- **In scope**: body の Markdown 描画(opt-in)、制限された描画許可範囲、本文中への画像(GIF 含む)埋め込みと同一オリジン検証、解決/描画失敗時のフォールバック、後方・前方互換
- **Out of scope(今回のリリースに含めない)**:
  - **動画(mp4 / `<video>`)** — GIF で短尺アニメーションを賄い、mp4 は将来の純追加とする
  - サイドバー通知パネルの表示(従来どおりタイトルのみ、Markdown 描画しない)
  - 配信側リポジトリ(growi-news-feed)のスキーマ・CI・入稿フロー(PrimaVista)整備 — 別作業。アプリ側はそこに「本文の Markdown 契約」「画像ディレクトリ規約」を提供する側
  - 画像ファイルサイズの制限 — アプリ側は上限を設けない。サイズ制約(GitHub Pages の帯域・閲覧者の通信量への配慮)は配信側の運用/CI で担保する
- **Adjacent expectations**(配信側への契約): 配信側は以下に従う。配信側・アプリ側のどちらが先にリリースされても他方を壊さない。
  - 本文を Markdown 文字列として body に格納する
  - 画像はフィードと同一オリジンの `images/` ディレクトリ(feed.json と同ディレクトリ直下)の**直下のみ**に置く(サブディレクトリは不可)。本文からは `images/foo.gif` の相対パスで参照する
  - アプリ側は検証(https・同一オリジン・`images/` 直下・許可拡張子)に失敗した画像参照を**警告なく本文から除去する**(Req 4.1)。配信前に参照先の実在・規約適合を検証するのは配信側の責務(別作業)

## Requirements

### Requirement 1: ニュース本文の Markdown 描画

**Objective:** As a GROWI 配信運営者, I want ニュース本文を Markdown で記述して任意位置に書式や画像を置きたい, so that テキストだけでは伝わらない内容を表現できる

#### Acceptance Criteria

1. When ニュースアイテムが Markdown 本文として指定されている場合, the /_news ページ shall body を Markdown として描画する
2. When ニュースアイテムが Markdown 指定でない、または本文が空の場合, the /_news ページ shall 従来どおりプレーンテキスト(改行・連続スペースを保持)で描画する
3. The /_news ページ shall Markdown 本文中の見出し・強調・箇条書き/番号リスト・リンク・引用・コード・段落・画像を描画する
4. The /_news ページ shall 本文中の任意の位置に配置された複数の画像を、記述順どおりに描画する

### Requirement 2: 描画の安全性(制限された許可範囲)

**Objective:** As a GROWI インスタンス管理者, I want 外部配信元由来の本文を描画しても自インスタンスの安全性が損なわれないこと, so that 不正・過剰なコンテンツが混入しても被害が波及しない

#### Acceptance Criteria

1. The /_news ページ shall あらかじめ定めた要素・属性のみを描画し、許可範囲外の要素・属性は取り除く
2. The /_news ページ shall 本文中の生 HTML(`script`・`iframe`・`style`・`video`・イベントハンドラ属性等)を実行・描画しない
3. If 本文中のリンク URL が http(s) / mailto 以外(`javascript:`・`data:` 等)の場合, then the /_news ページ shall そのリンクを無効化する
4. The /_news ページ shall 本文中の外部リンクを新しいタブで開き、`rel="noopener noreferrer"` を付与する
5. The /_news ページ shall GROWI Wiki 本体のレンダラ(その描画許可範囲)を流用せず、ニュース専用に定義した許可範囲で描画する。この許可範囲は Wiki 本体の許可範囲の変更から独立して維持される

### Requirement 3: 画像(GIF 含む)の埋め込みと同一オリジン検証

**Objective:** As a GROWI 配信運営者, I want 本文に画像や GIF を安全に埋め込みたい, so that 画像付き告知を全インスタンスに配信できる

#### Acceptance Criteria

1. When 本文の Markdown に相対パスの画像参照が含まれる場合, the /_news ページ shall 描画時にその相対パスを配信フィード基準の絶対 URL に解決する
2. The /_news ページ shall 解決後の URL が https であり、かつ配信フィードと同一オリジンの `images/` ディレクトリ直下(サブディレクトリを含まない)を指す場合のみ、その画像を表示する
3. The 画像参照 shall 拡張子 png / jpg / jpeg / webp / gif を対象とする(GIF はアニメーションを含め画像として扱う)
4. The /_news ページ shall 画像を遅延読み込みで表示し、画像取得リクエストに GROWI インスタンスの URL を送信せず、表示高さに上限を設ける

### Requirement 4: 解決・描画失敗時のフォールバック

**Objective:** As a GROWI ユーザー, I want 一部の画像が壊れていても本文は問題なく読めること, so that 配信不備やネットワーク制約で本文全体が損なわれない

#### Acceptance Criteria

1. If 画像参照の解決または同一オリジン検証に失敗した場合, then the /_news ページ shall 描画時にその画像を取り除き、本文の残りのテキスト・要素を保持する
2. If 描画時に画像の取得に失敗した場合, then the /_news ページ shall その画像のみを非表示にし、本文テキストの表示を維持する
3. The /_news ページ shall 描画パイプラインでの二段検証(URL 解決プラグインによる同一オリジン封じ込め + sanitize)を適用し、メディア URL が https でない、または同一オリジンの `images/` 直下でない場合、その画像を表示しない

### Requirement 5: 互換性とリリース独立性

**Objective:** As a GROWI 管理者, I want この変更が既存環境を壊さず追加作業も不要であること, so that バージョンアップだけで安全に受け取れる

#### Acceptance Criteria

1. When フィードに Markdown 本文が含まれない場合, the /_news ページ shall 従来どおりの表示・動作を維持する
2. The 本機能 shall 既存データのマイグレーション・追加の設定項目・新規外部依存なしで動作する
3. When 本機能を持たない旧バージョンの GROWI が Markdown 本文を含むフィードを取得した場合, the GROWI shall エラーなく動作し、本文を従来のプレーンテキストとして描画する(前方互換)
4. The サイドバー通知パネル shall 本変更後もタイトルのみの表示を維持し、本文の Markdown 描画を行わない
