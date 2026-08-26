# Gap Analysis: inline-comment

## Requirement-to-Asset Map

| 要件 | 再利用可能な既存資産 | ギャップ |
|---|---|---|
| **R1 範囲選択による作成**（文字単位・原文保持・認可） | 既存 `Comment` モデル（page/creator/revision/comment フィールド）、apiv3 の `accessTokenParser → loginRequired → express-validator → apiV3FormValidator → res.apiv3()` という認可・検証チェーン（`revision-diff-api` で確立済み） | **Missing**: アンカー用の構造化フィールド（quote/prefix/suffix/offset/アンカー起点リビジョンID）。**Missing**: 本文レンダリング結果に対して `window.getSelection()` を取得するクライアント側の選択キャプチャ層（2023年試作の `TextSelectionTools` 一式は現行のコンポーネント構成では失効しており参考にしかならない）。**Constraint**: 新規フィールドは Mongoose スキーマ・Prisma スキーマの両方に同期させる必要がある（`.claude/rules/model.md`）。 |
| **R2 表示**（完全一致→あいまい一致→ハイライトなし） | `diff`（v5、`apps/app/package.json` に直接依存として既存）はサーバー側の行単位diff用途で使われているが文字レベルのあいまい一致には使っていない | **Missing**: あいまい一致（fuzzy re-anchor）マッチャー自体。**Missing**: `Intl.Segmenter` の使用例（現行コードにゼロ件、初導入になる）。**Missing**: レンダリング済み本文中の一致範囲を `<mark>`/`<span>` 等で囲むハイライト表示の前例（`revision-diff-api` は差分のHTML化をクライアント責務として明示的にスコープ外にしており、参考にできる実装は見つからなかった）。**Missing**: `RevisionRenderer.tsx` は `ReactMarkdown` を素で包むのみで、外部にrefを渡さないため、選択キャプチャ・ハイライト描画のためのコンテナref自体が現状ない。 |
| **R3 既存メンション機構の再利用** | `crowi.commentService.prepareMentionNotifications`（`apps/app/src/server/service/comment.ts`）は `comment_id + actionUserId + activityId + page` のみを要求する汎用的な作りで、そのまま呼び出し可能。メンションのハイライト表示は本文テキストに対するremarkプラグインなのでストレージ方式に依存しない | **Constraint**: `getMentionedUsers` 内部は `prisma.comments.findUnique(...)` を直書きしており、インラインコメントを別モデルに保存する場合はこの呼び出しの一般化が必要になる（同一 `comments` モデルに保存する場合は変更不要）。**Constraint**: `prepareMentionNotifications` は `activityId`（`res.locals.activity._id`）を要求するため、インラインコメント作成経路も既存の通常コメント作成時と同様に `Activity` レコード（新しい `SupportedAction` 定数を伴う）を発行する必要がある。「そのまま呼び出せる」は入力の型の話であり、呼び出し元がActivity発行という前提を満たす必要がある点は設計フェーズで明記すること。 |
| **R4 解決/未解決の管理** | なし | **Missing**: `resolvedBy`/`resolvedAt` 相当のフィールドはコードベース全体に存在せず、完全新規。操作可能な利用者の範囲（作成者限定か、ページへのコメント権限を持つ全員か）も要件では汎用的にしか定義されていない。 |
| **R5 ベストエフォート再アンカリング** | 既存の `revisionId`（`ref Revision`）フィールドの実装パターンは、新設する不変フィールド「アンカー起点リビジョンID」の型・リレーション定義の参考になる | **Missing**: 不変な起点リビジョンIDフィールドと、それとは別に保持する「解決済みオフセットのキャッシュ」フィールド。**Missing**: 再アンカーアルゴリズム自体（R2と同じギャップ）。 |
| **R6 共有リンク閲覧者へのデータ非公開** | `apps/app/src/server/routes/comment.js` の `api.get` に既存の `req.isSharedPage` 分岐がある（ただし現状はこの分岐が通常コメントの全フィールドをそのまま返しており、インラインコメント用フィールドを同じ経路に載せた場合、そのままでは**漏洩する側の前例**になる点に注意） | **Missing**: レスポンスシリアライズ時にインラインコメント固有フィールド（quote/prefix/suffix/offset/アンカー起点リビジョンID）を `isSharedPage` 時に除外するロジック。既存の `isSharedPage` 分岐が `revision_id` を無視して `page_id` のみでスコープを絞っている点は、除外ロジックの設計における狭いスコープ確定の前例として参考になる。 |

## 実装アプローチの選択肢

### Option A: 既存 `Comment` モデル／既存ルートを拡張

既存の `comments` Prisma/Mongoose モデルにアンカー系フィールド（quote, prefix, suffix, offset, anchorOriginRevisionId, resolvedOffsetキャッシュ, resolvedBy, resolvedAt 等）を直接追加し、既存の `/_api/comments.add`・`/comments.get` を拡張してインラインコメントも同じモデル・同じルートで扱う。

- ✅ メンション通知・認可ロジックが変更なしでそのまま使える（同一コレクションのため `getMentionedUsers` の一般化も不要）
- ✅ 1ページ分の「全コメント」を単一クエリで取得できる
- ❌ `resolvedBy`/`resolvedAt` は通常のスレッドコメントの行では常にnullの列になる（意味を持たないカラムが増える）
- ❌ 既存の `comment.js`（作成・更新・削除・返信をすべて扱う）にさらに責務が積み増しされ、単一責任の観点で肥大化する
- ❌ 既存の `api.get` の `isSharedPage` 分岐が既に「全フィールドをそのまま返す」実装のため、除外漏れのリスクが最も高い選択肢

### Option B: 新規モデル・新規 `apiv3` フィーチャーモジュールとして分離

`apps/app/src/features/inline-comment/`（`revision-diff-api`/`page-markdown-endpoint` が確立した「サービス層＋apiv3ルート＋feature配下の`interfaces`/`server`」という構成規約に追従）として、別の Prisma モデル（例: `inline_comments`）と専用の apiv3 ルートを新設する。

- ✅ 既存コーディング規約（apiv3が現行の標準、レガシー dot-style は拡張しない）に最も素直に沿う
- ✅ 通常コメントに `resolvedBy`/`resolvedAt` のような無意味な列が増えない
- ✅ 共有リンク経由の除外は「新設ルート自体が `isSharedPage` を一切扱わない」設計にすれば構造的に単純になる
- ❌ `getMentionedUsers` の `prisma.comments.findUnique` 直書きを一般化またはインラインコメント用に複製する必要がある
- ❌ 「本文コメント」と「インラインコメント」という2つの概念が別モデルに分かれ、将来UIで両者を統合表示する際の結合コストが増える

### Option C: ハイブリッド（同一モデル＋新規ルート）

インラインコメントは既存の `comments` モデルの行として保存し（メンション通知・認可・返信チェーンの再利用を維持）つつ、作成（アンカー付き）・解決トグルなどインラインコメント固有の操作は新設の apiv3 ルートモジュールに切り出す。アンカー系フィールド（例: 構造化された `anchor` フィールド）の有無で通常コメントとインラインコメントを判別する。既存の `/_api/comments.get` は、共有リンク時にアンカー系フィールドを除外するようその読み取りシリアライズ部分だけ小さく変更する。

- ✅ メンション通知・認可・返信ロジックを無変更で再利用
- ✅ 新規の作成・解決ロジックは新しいファイルに切り出され、レガシー `comment.js` への変更は読み取り時の除外処理という最小限に抑えられる
- ✅ 「アンカーフィールドの有無」というデータ駆動の判別は、`.claude/rules/coding-style.md` が推奨する「モード名によるハードコード分岐を避ける」方針と整合する
- ❌ レガシー dot-style ルート（`comment.js`）と新設 apiv3 ルートが同一テーブルに対して混在することになり、将来の保守者が「`comments` コレクションは1つのルータが扱っている」と誤解しないよう明記が必要
- ❌ インラインコメントに `replyTo`（返信）を許すかどうかが要件で定義されておらず、同一テーブル共有ゆえに設計判断を先送りできない

brief.md の Boundary Candidates が「既存の通常コメントAPIとどこまで共有し、どこから分けるかが設計判断のしどころ」と明記している通り、この3択自体が brief の時点で認識されていた論点である。Option C は R3（メンション再利用）と R6（共有リンク除外）の両方の要件が既に踏まえている既存コードの形（`getMentionedUsers`・`isSharedPage` 分岐）に最も自然に接続するが、最終判断は設計フェーズに委ねる。

**R6が行単位の除外である点への影響**（brief.md L73「インラインコメント行が…返らないように」、requirements.md R6 AC1）: R6は特定フィールドのマスキングではなく、インラインコメントの行そのものを共有リンク経由のレスポンスから除外することを求めている。Option A/Cのように通常コメントとインラインコメントを同一 `comments` テーブルに同居させる場合、`/comments.get` の `isSharedPage` 分岐は「アンカーフィールドを持つ行を丸ごと除外する」行フィルタを実装する必要があり、単純なフィールド単位のシリアライズ変更では済まない（Option Cの節で述べた「レガシー `comment.js` への変更は最小限」という利点は、行フィルタが必要になる分だけ縮小する）。Option Bはインラインコメントを別モデルに分離するため、共有リンク到達可能なルートにそもそも読み取り経路を追加しないという設計で構造的にこの要件を満たしやすい。この点を踏まえてもなお、R3の再利用性やAPI構成の一貫性を優先してOption Cを選ぶか、R6の実装単純さを優先してOption Bへ倒すかは、設計フェーズで明示的に比較検討すること。

## Research Needed（設計フェーズへの持ち越し事項）

1. あいまい一致マッチャーの実装方式: `diff-match-patch` を新規直接依存として追加する（brief が名指ししている `Match_MaxBits=32` 制約は「採用する場合」の前提）か、NFC正規化＋書記素クラスタ境界を自前で扱う軽量な部分文字列マッチャーを実装するか。現状どちらも未着手（`diff-match-patch` はロックファイル上 `jsondiffpatch` 経由の間接依存としてのみ存在し、apps/app からは未import）。
2. インラインコメントの永続化先: 既存 `comments` モデルに同居させる（Option A/C）か、新規モデルに分離する（Option B）か。`getMentionedUsers` の一般化要否に直結する。
3. インラインコメントに返信（`replyTo`）を許すか: 要件では明示されていない。同一モデル共有案（Option A/C）を取る場合は設計フェーズで明示的に決定する必要がある。
4. 選択キャプチャ用のrefをどこに追加するか: `RevisionRenderer.tsx` は現状 `ReactMarkdown` をrefなしでラップしているため、どの選択肢を取ってもこの小さな変更（コンテナへのref転送）は共通して必要になる。
5. 共有リンク除外の実装箇所: 既存の `/_api/comments.get` の `isSharedPage` 分岐に除外処理を追加する（Option A/C）か、インラインコメント用の読み取り経路自体を共有リンクから到達不可能な設計にする（Option B）か。

## Effort & Risk

- **Effort: L（1〜2週間）** — 新規アンカーフィールドの二重スキーマ同期、初導入となるあいまい一致アルゴリズム（`Intl.Segmenter` 含む）、クライアント側の選択キャプチャ・ハイライト描画UI、解決/未解決トグルUI、共有リンク除外、と複数の独立したワークフローにまたがる。apiv3モジュール構成・dual-schema同期の型自体は `revision-diff-api`/`mongoose-to-prisma` skill として確立済みパターンがあるため XL までは見込まない。
- **Risk: Medium-High（あいまい一致サブシステムに集中）** — brief 自身が「最も技術的不確実性が高い部分」と明記している通り、正規化後オフセット→原文オフセットの逆変換や書記素クラスタスナップは実装ミスがハイライトのズレとして静かに現れやすく、テストで検出しづらい。永続化・APIレイヤーは確立パターンに乗るため Medium、UIレイヤーは2023年試作の `TextSelectionTools`/`useRenderedObserver` が参考にできるため Low-Medium。

## Recommendations for Design Phase

- 上記 Option A/B/C のいずれを採るか、上記 Research Needed の5項目を含めて設計フェーズで確定する。brief・要件の記述からは Option C（ハイブリッド）が最も抵抗が少ないが、最終決定は設計フェーズの判断に委ねる。
- あいまい一致マッチャーは、外部ライブラリ追加 vs 自前実装のトレードオフ（依存追加コスト vs 32文字制約・書記素境界スナップの自前実装コスト）を設計フェーズで具体的に比較検討すること。

---

## 【重要・上書き】アーキテクチャ選定はその後のユーザーレビューで再転換した

以下の「設計フェーズでの決定事項」セクションのうち、**「実装アプローチ: Option B（新規モデル・新規apiv3モジュール）に確定」の節は、この後のユーザーとの design.md レビューで覆り、現在は無効**。最終的な決定は「既存 `comments` モデルへの拡張＋新規ルート」（同一テーブルに同居させる形）であり、根拠は `design.md` の「アーキテクチャ選定：既存 `comments` モデルへの拡張＋新規ルート（設計レビューでの転換）」節を参照。

転換のきっかけはユーザー自身の指摘だった：
1. 「`/comments.get` を『共有リンクのときだけ』ではなく『常に』インラインコメントを除外するようにすれば、同居させても要件6は満たせるのではないか」という指摘（`isSharedPage` 依存の条件付きフィルタではなく無条件フィルタにする、という着想）
2. 「インラインコメントにも返信を持たせたい」という需要。同居させれば既存の `replyTo` 機構をそのまま使える

この転換により、Option Bを選んだ当初の理由（`getMentionedUsers` の一般化コストと引き換えに構造的な保証を得る）は妥当性を失った——返信を許可する以上、同一テーブルに同居させた方が既存資産の再利用（`replyTo`／`getMentionedUsers` 無改造）が大きく、共有リンク非公開も無条件フィルタ1本で（構造的にではないが）実用上十分な強さで満たせると判断したため。以下の節を読む際は、この上書きを踏まえること。

---

## 設計フェーズでの決定事項（`/kiro-spec-design` で確定、その後一部上書き）

advisor（Opusレビュー）を各節目で活用し、以下を確定した。詳細な根拠・比較は `design.md` を参照。

### 実装アプローチ: Option B（新規モデル・新規apiv3モジュール）に確定

上記A/B/Cの検討で最後まで残っていた論点は、要件6が「特定フィールドの除外」から「行そのものの除外」に修正されたことで解消した。同一 `comments` テーブルに同居させる案（A/C）は、`/comments.get` の共有リンク分岐（`findCommentsByPageId`。通常コメント呼び出し元とも共有される取得メソッド）に行フィルタを追加する必要があり、将来の新しい呼び出し元がフィルタを書き忘れるリスクを構造的に残す。新規モデル・新規ルートに分離すれば、共有リンク到達可能な経路自体を作らないため、要件6は設計として自明に満たされる。追加コストは `getMentionedUsers` の `prisma.comments.findUnique` 直書き（単一箇所）の一般化のみ。

### Build vs Adopt: あいまい一致は `approx-string-match` を採用、`diff-match-patch` は不採用

- `dom-anchor-text-quote`/`dom-anchor-text-position`（hypothes.is）は2017〜2020年で更新が止まっており、DOM Range結合（Node.jsサーバー側では使えない）のため不採用
- `diff-match-patch` は `Match_MaxBits = 32` を超えるパターンで `match_bitap_` が例外を送出することをソースコードで確認した（黙って諦めるのではない）。文中の1文選択でも32文字を超えるため、`match_main` を主経路にするには事前チャンク分割が必須になり、実装コストが高い
- `approx-string-match`（robertknight/approx-string-match-js, `^2.0.0`）は文字列のみを扱う（DOM非依存）、能動的にメンテされている（2026年8月時点で直近コミットあり）、TypeScriptネイティブ、hypothes.isの現行クライアント自体が同ライブラリに移行済み——という理由で採用した

### 解決済みオフセットの永続キャッシュは見送り（Simplification）

brief.mdの討論メモには「解決済みオフセットをキャッシュする」という記述があったが、`requirements.md` の要件5（5.1–5.5）にはキャッシュ永続化を求める受け入れ基準がない。持続的なキャッシュは (a) 新しい永続フィールド、(b) リビジョン一致判定によるキャッシュ無効化ロジック、(c) 本文編集直後の複数閲覧者による再計算競合という3つのコストを生む一方、得られるのは「クライアント側での文字列検索1回分の節約」という未計測の効果でしかないため、v1では持たない。マッチングをクライアント側に倒したことで、この決定はキャッシュの書き込み経路そのものを消す（サーバー側の状態変更なし）という副次的な単純化にもつながった。`anchorOriginRevisionId` はオフセット計算やキャッシュ無効化には使われず、provenance（来歴）情報としての役割のみを持つ。

### マッチングはクライアント側で実行（サーバー側SSR中の抽出は不採用）

`PageContentRenderer` は `{ ssr: true }` だが、本文中の `lsx`（子ページ一覧）ブロックは `packages/remark-lsx/src/client/` 配下のSWRフックによってクライアント側でのみ解決される。サーバーが構築するAST由来のプレーンテキストは閲覧者が実際に見るテキストと一致しないため、サーバー側でのアンカー計算は「アンカー作成時と別の文字列に対してマッチングする」ことになり不採用。この確認（`PageView.tsx` の `dynamic()` オプション、`packages/remark-lsx/src/client/` の存在）はadvisorの指摘を受けて実施した。

### 静定検知: 新規ヒューリスティックではなく既存の `GROWI_IS_CONTENT_RENDERING_ATTR` プロトコルを再利用

設計初期には「MutationObserverで一定フレーム変異が無ければ静定」という自前のヒューリスティックを想定していたが、コードベース調査で `GROWI_IS_CONTENT_RENDERING_ATTR`/`GROWI_IS_CONTENT_RENDERING_SELECTOR`（`@growi/core/dist/consts`）という既存の共通プロトコルが見つかった。drawio・mermaid・plantUML・lsxは既にこのプロトコルに参加しており（[auto-scroll](../auto-scroll/) スペックで確立・整理済み）、`apps/app/src/client/util/watch-rendering-and-rescroll.ts` が同じ監視パターンを実装済み。この発見により：
- `renderedTextOf` の「除外対象サブツリー一覧」を自作する必要がなくなった（`lsx`/`drawio`/`mermaid` は静定を待てば安全に本文として扱える）。除外対象は `.katex`（KaTeXの二重DOM構造）のみに縮小した
- ただし、添付ファイル埋め込み（Ref/Refs/RefImg/RefsImg/Gallery、RichAttachment）はauto-scrollスペックの時点でこのプロトコルへの参加が見送られており、これらを含むページでは静定が実際より早く発火しうる残存リスクとして `design.md` の Revalidation Triggers に記録した

### アーキテクチャ再転換: 既存 `comments` モデルへの同居に戻す（上記Option Bからの上書き）

ユーザーとの design.md レビューで、上記「実装アプローチ: Option B」の決定を覆した。詳細な根拠は `design.md` の「アーキテクチャ選定：既存 `comments` モデルへの拡張＋新規ルート」節に記載しているため、ここでは要点のみ記す：

- **転換のきっかけはユーザーの指摘**：(1) `/comments.get` の除外フィルタを `isSharedPage` 依存にせず常に適用すれば、同居させても要件6は満たせる、(2) インラインコメントにも返信を持たせたい、という2点
- **保証の性質は正直に書き分けた**：新規モデル分離案の「共有リンクに返らない」は物理的にコレクションが存在しないことによる構造的な保証だったが、同居＋無条件フィルタ案は「`findCommentsByPageId`／`findCommentsByRevisionId`／`countCommentByPageId` という3つのメソッドの中にある `WHERE` 条件」に依存するルールベースの保証であり、両者は性質が異なる。この違いを踏まえた上で、返信の再利用とメンション通知の無改造という利益がその差を上回ると判断した
- **`getMentionedUsers` の一般化は不要になった**（Option Bで見込んでいたコストが消えた）。同一テーブル・同一 `comment_id` 空間のため無改造で動く
- **Prismaの名前付きリレーション制約への対応が必要になった**：`resolvedBy`（`comments`→`users`）を追加すると、既存の無名だった `creator` リレーションも明示的に名前を付けねばならない（advisorレビューで発覚。`prisma validate` が通らないまま見落とすところだった）
- **`countCommentByPageId`（ページ末尾コメントの件数バッジに使用）にも同じ除外フィルタが必要**（advisorレビューで発覚。見落とすとインラインコメントの件数が通常コメントのバッジに混入するユーザー可視の不具合になる）
