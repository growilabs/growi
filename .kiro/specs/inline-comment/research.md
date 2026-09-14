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

### あいまい一致は `prefix`／`suffix` を使わず、クオートと `approxOffset` のみで行う（実装済み）

討論で確定した設計要求は「クオート＋前後文脈」で再検索することだったが、`quote-matcher.ts` の実装は前後文脈（`prefix`／`suffix`）を保存するのみで、あいまい一致（`matchApproximately`）ではクオート単体と `approxOffset` しか使わない（`quote-matcher.ts:108-109` に「意図的に未使用」と明記）。

理由は採用した `approx-string-match` のAPIが `search(text, pattern, maxErrors)` という単一パターンでの近似検索であり、`prefix + quote + suffix` を1つのパターンとして渡す場合、一致した範囲から「どこからどこまでがクオート本体か」を書記素境界を保ったまま逆算する必要が生じる（`prefix`/`suffix`それぞれの長さがあいまい一致の許容誤差の分だけ伸縮しうるため、単純な文字数オフセットでは戻せない）。ここに手を入れると、brief.md が既に指摘していた `Match_MaxBits=32`（`diff-match-patch`不採用の理由）と同種の、パターン長に起因する制約に新たに向き合う必要が生まれる。v1では、同じクオートがページ内に複数回出現する場合の絞り込みを `approxOffset`（作成時に記録したおおよその位置に最も近い候補を選ぶ）だけで代替し、前後文脈は「将来この絞り込みを強化する余地」として保存だけしておく形にとどめた。

この単純化が安全な範囲は「解決済みオフセットの永続キャッシュは見送り」の項が説明する `approxOffset` の役割（同上）と同じ——クオートがページ内で一意でない場合の絞り込み精度が下がるだけで、ハイライトが完全に外れることはない。requirements.md の要件2.1／5.1は、この実装済みの挙動（クオート＋おおよその位置での再検索）に合わせて記述している。

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

## 選択→作成フローのUX見直し（amend spec `inline-comment-selection-ux` より統合）

v1の実装後、ユーザー提供の実装UIモックアップ（テキスト選択時のポップアップ→展開フォーム→複数行→末尾コメント一覧への統合表示）をもとに、選択してから送信するまでの操作の流れを見直した。以下は、この見直しの過程で確定した決定事項。

### 選択範囲近傍への配置手段: `@popperjs/core`を仮想要素パターンで採用（自前実装・reactstrap Popoverは不採用）

作成の起点・入力フォームを選択範囲の近くに表示する手段として3案を検討した。

| Option | 説明 | 採否 |
|---|---|---|
| 自前で`getBoundingClientRect`＋固定値計算 | Selectionの矩形を都度計算しCSSのtop/leftを自前算出 | 不採用（はみ出し防止・反転・スクロール追随をすべて自前実装する必要がある） |
| reactstrap `Popover`（`target`にrefを渡す） | 既存UIライブラリのポップオーバーをそのまま使う | 不採用（`target`は永続的なDOM要素/refを要求し、テキスト選択という「実体を持たない対象」を直接指定できない） |
| `@popperjs/core`＋仮想要素 | `getBoundingClientRect()`のみを実装したオブジェクトを`createPopper`の参照要素として渡す | **採用** |

`@popperjs/core`はモノレポに既存の依存であり（`packages/editor`等では`dependencies`、`apps/app`では当初`devDependencies`）、`flip`/`preventOverflow`/`offset`の標準modifierだけでビューポート境界処理が完結する。DOM `Range`を`cloneRange()`して保持するだけでスクロール追随も自然に実現できる（クローンはドキュメントにアタッチされたまま位置を追跡し続けるため）。`apps/app`では`devDependencies`から`dependencies`への格上げが必要になり、`SelectionPopover`が実際にレンダーツリーへ組み込まれた時点でビルドグラフへの到達（`.next/node_modules/`にシンボリックリンクが生成されること）を実測確認した。

### 選択のライフサイクルを二段階に分割: `idle`/`selecting`/`composing`

当初のv1実装は「選択なし／ロック済み」の二値で、選択直後にいきなりフル入力フォームを表示していた。モックアップに合わせ、「選択なし」「作成の起点を表示中」「入力フォームを表示中」の3段階に拡張した。`selecting`段階ではライブな`Range`（`window.getSelection().getRangeAt(0)`から都度取得。`useTextSelection`自体はテキストデータのみを返すため、Rangeは別途取得する）を使い選択の変化に追随させ、作成の起点が選ばれた瞬間に`Range`を`cloneRange()`して`composing`段階の間ずっと使うことで、フォーム表示中にブラウザの選択状態が変化しても（例: 入力欄へのフォーカス移動）表示位置・表示継続に影響しないようにした。

### メンション候補取得は`inline-comment`機能内で共通化するが`CommentEditor.tsx`側とは共有しない

入力フォームに明示的なメンション選択ボタンを追加するにあたり、既存の`@`タイプ補完と新設のボタンが同じ`/users/`検索を必要とした。`inline-comment`機能内だけで見れば重複を避けられるため`fetchMentionUsers`として切り出したが、`CommentEditor.tsx`側の同種実装（既存タスク境界の判断で意図的に共通化されていない）には手を入れていない。

### 実ブラウザでのみ顕在化した2つの不具合

jsdomにはレイアウト・ペイントエンジインが無いため、ユニットテストでは検出できない種類の不具合が実ブラウザでの検証（統合タスク・E2Eタスク）で2件見つかった。

- **`mousedown`の既定動作によるボタンの取りこぼし**: `SelectionActionButton`はポータル経由で本文コンテナの外（`document.body`直下）に描画される。`mousedown`の既定動作（文書選択の解除）を止めないと、`mousedown`と`click`の間に選択が消えて状態が`idle`に落ち、ボタンが外れて`onCommit`が発火しない。`SelectionActionButton`側のみ`preventDefault`でラップして対処した（`InlineCommentForm`側には適用せず、テキストエリアへのカーソル配置を妨げないようにしている）。
- **スタッキングコンテキストの脱出によるクリック不能**: `SelectionPopover`のポータルは`document.body`直下に描画されるが、`.wiki`ページレイアウトの祖先要素（Bootstrapの`.z-1`クラスを持つflexアイテム。`position: static`でもflexアイテムとしてスタッキングコンテキストを形成する）の背後に回り込み、見た目は前面にあるのに実際にはクリック不能になっていた（`elementFromPoint`が背後の要素を指す）。ポータルの直下要素に`zIndex: 1070`（Bootstrapの`$zindex-popover`相当）を明示指定して解決した。

### Visual Verification（モックアップとの目視比較）は自動ゲート化しない

見た目の作り込みはモックアップ画像との目視比較で担保するが、これは自動合否判定（pixel diff等）ではなく、(a) 実装時にPlaywrightでスクリーンショットを撮り実装エージェント自身が見比べて明らかな差異があれば修正する自己修正ループ、(b) 最終的な見た目の合否は人間のレビュー（PRに添付したスクリーンショット）に委ねる、という2つの役割に限定した。`kiro-validate-impl`のGO/NO-GO判定の機械的チェックにも含めない——見た目の良し悪しは人間が最終判断する領域であり、自動ゲートで機能の完成をブロックしないという判断による。

## Bootstrap 5 テーマへの追随と通常コメントとの見た目統一（amend spec `inline-comment-visual-consistency` より統合）

実装済みの画面をモックアップと突き合わせたところ、(1) 作成の起点・入力フォームのボタン類にCSSクラスが1つも付いておらずブラウザ標準の見た目のままだった、(2) 本文中のハイライト色がテーマを切り替えても変わらない固定色で、かつ選択中・入力中・保存後の3状態でばらばらの見え方をしていた、(3) インラインコメントの一覧が通常コメントとは別の場所に別の見た目で並んでいた、という3つの差が見つかり、これを埋める作り直しを行った。以下は、この作り直しの過程で確定した決定事項と、実装時に見つかった限界。

### ハイライト色トークンを1段の間接参照にした理由

`--grw-inline-comment-marker-bg`を検索マーカー色`--grw-marker-bg`に直接束縛せず、`var(--grw-marker-bg, var(--grw-marker-bg-yellow))`という1段の間接参照にした。テーマは検索マーカーの色を目的に`--grw-marker-bg`を上書きしていることがあり（16テーマ中12テーマがcyan/red/blue/greenに変更）、インラインコメントのハイライトを直接そこに縛ると「検索マーカーは変えたいが、インラインコメントは既定の黄色のままにしたい」という指定ができなくなる。1段挟むことで、既定では要望どおり検索マーカーと同じ色になり、必要なテーマだけ個別に上書きできる。

作成中用の`--grw-inline-comment-marker-bg-pending`も同じ理由で1段挟み、既定値は保存済み側と別系統の色（`--grw-marker-bg-blue`）にして、テーマがどちらも上書きしていない場合でも両者が見分けられるようにした（この2トークン化と半透明化の詳細な経緯は、後発の「操作性の改善」節（次節）を参照。あちらはこちらで確定した2トークンの土台をさらに、選択中・入力中・保存後の3状態を1つの仕組みで一貫させる形に発展させたもの）。

検索マーカーの「ペンで塗った」ような`linear-gradient`の見た目は、`::highlight()`が`background-image`を指定できない（`color`/`background-color`/文字装飾/影に限られる）ため引き継げず、平らな塗りにした。共通化したのは色の値だけである。

### `CommentCard`は自分のCSSモジュールを持たない

通常コメントの箱の見た目はすでに`_comment-inheritance.scss`の`%bg-comment`／`%comment-section`／`%user-picture`というプレースホルダに1か所で置かれており、`Comment.module.scss`と`CommentEditor.module.scss`の2つのCSSモジュールが`@use`して`@extend`していた（プレースホルダ自身はCSSを出力しないため、3つ目のモジュールが加わっても規則は重複しない）。この既存の形をそのまま踏襲し、箱と見出し行だけを持つ`CommentCard`を切り出して`InlineCommentItem`用の3つ目のモジュールから同じプレースホルダを`@extend`する形にした。

`CommentCard`が自分のモジュールクラスを最も外側に持つ案は採らなかった。`Comment.module.scss`の規則はすべて`.comment-styles { :global(.page-comment) { … } }`という入れ子で書かれており、`CommentCard`が独自の外枠を持つとその入れ子が崩れ、`page-comment-newer`の不透明度・`page-comment-revision`の色・`page-comment-meta`の色・`page-comment-body .wiki`の段落余白のどれも一致しなくなる。`CommentCard`は`.page-comment`から下のDOMだけを描き、外側のモジュールの入れ物（と、そこから`_comment-inheritance.scss`のプレースホルダを`@extend`する責務）は使う側がそれぞれ持つ。

`Comment.tsx`自体を共有部品として使わず、枠だけを切り出したのは、`Comment.tsx`が本文の編集・削除・リビジョンへのリンク・返信の扱いを一緒に抱えているため。インラインコメントは`revision: Ref<IRevision>`を持たず（持つのは`anchorOriginRevisionId: string`）、v1では編集・削除の対象外なので、`Comment.tsx`をそのまま使うと使わない分岐を通すことになる。一方でクラス名だけを写し取る並行実装にすると、`_comment-inheritance.scss`を直したときに片方だけ変わる状態が起きても、型でもテストでも結びついていないため気付けない。差が出るのは見出し行の右端と本文の前後の中身だけで、箱そのものは同一なので、差し込み口付きの共有コンポーネントを1つ持つ形が最小だった。

設計レビューで見つかった2点の訂正（実装は最初からレビュー後の形で行われている）:
- `creator`が`null`／未populateでも`UserPicture`／`Username`を無条件に描く。既存の`Comment.tsx`は「投稿者情報が無い場合に何も表示しない」のではなく、`UserPicture`は既定アイコン、`Username`は"(anyone)"という代替表示をする作りに既になっている。`CommentCard`側で`creator != null`条件を追加して丸ごと隠すと、投稿者が未populateの既存コメントの見た目が変わり、Requirement 13.9（通常コメントの見た目を変えない）に違反する。
- `headerEnd`（見出し行の右側の差し込み）に共通の余白（`ms-auto`等）を`CommentCard`側で固定しない。通常コメントの右端（リビジョンリンク）とインラインコメントの右端（解決トグル）とで必要な余白が異なる（前者は投稿日時のすぐ右に`ms-2`、後者は行の右端に寄せる`ms-auto`）ため、余白は各呼び出し側が`headerEnd`に渡すReactNode自身に付ける。

実際に実装された`CommentCardProps.creator`の型は、当初案（`IUserHasId | Ref<IUser> | null | undefined`）よりも広く、`IUserSerializedSecurely<IUserHasId>`を含む。インラインコメント側の`listByPageId()`応答はサーバー側で既に`serializeUserSecurely`を通しており、その形をそのまま`CommentCard`まで運ぶとこの型が必要になったため（タスク境界を超える変更だが、コンパイルを通すために必須だった）。

### インラインコメントは`PageComment`自身で取得せず、`PageView`からpropsで渡す

`Comments`（`apps/app/src/client/components/Comments.tsx`）は`ShareLinkPageView.tsx`からも読み込まれている。`PageComment`の中で`useSWRxInlineComments(pageId)`を呼ぶと、共有リンク画面でもその取得が走ってしまう。APIは`certifySharedPage`を通していないので実データは返らないが、「共有リンク画面にインラインコメントのUIを一切出さない」ことを構造として保証できなくなる。

そこで取得は`PageView.tsx`側の1箇所（既存の`useSWRxInlineComments(isSharedPageView ? null : page._id)`）に閉じ、値として`Comments`／`PageComment`に渡す形にした。`ShareLinkPageView.tsx`は渡さない。

実際に渡す形は、当初案（`InlineCommentWithReplies[]`の素の配列）とは異なり、`{ comments, resolve, createReply }`という束になっている。一覧のスクロールナビゲーション（`scrollToRange`）・解決トグル・返信作成のいずれも`PageView.tsx`側の状態・関数に依存するため、配列だけを渡すとこれらを別途伝える経路が必要になり、`PageComment`が`PageView`の関数を「知らずに」使えるという構造上の利点（Requirement 13.8の共有リンク非公開保証の土台）が薄れる。束にして1本のpropsで渡すことで、`ShareLinkPageView.tsx`はこのprops自体を渡さない（空配列を渡すのではなく、prop省略時のフォールバックに委ねる）だけで済む。

### 既知の限界（実装時に軽微・許容と判断し先送り）

- **`InlineCommentItem.module.scss`の`.inline-comment-quote`は`:global`宣言の中にある。** `styles['inline-comment-quote']`のようにCSSモジュール経由で参照すると`undefined`になる（クラス名は素の文字列`inline-comment-quote`のまま使う必要がある）。この規則を将来リファクタリングする際に踏みやすい罠なので明記しておく。
- **`playwright.config.ts`の`devices[\`Desktop ${browser}\`]`は`browser`が小文字（`'firefox'`/`'webkit'`）のため、実際のPlaywright `devices`辞書のキー（`'Desktop Firefox'`/`'Desktop Webkit'`）と一致しない既存バグがある。** firefox/webkitプロジェクトは実質Chromiumにフォールバックしており、このスペックのE2Eによるテーマ切り替え・ハイライト色の検証はすべてChromiumでのみ実証されている（本amendの実装時に発見。修正は本amendの対象外）。
- `Comments.tsx`と`PageComment.tsx`の両方が`id="page-comments-list"`を持つ（本amend以前からの既存の重複。将来のE2Eも同じ罠を踏みうるため、直すなら別issueで）。
- 未解決・解決済みの札の配色（`bg-warning text-dark`）はテーマごとに再生成されない`--bs-warning-*`をそのまま使っており、Requirement 11の「テーマに追随する」の対象外として意図的に据え置いた（この配色を変える受け入れ基準を立てていないため）。

## 操作性の改善（amend spec `inline-comment-interaction-ux` より統合）

ユーザーから寄せられた4件のUX指摘（作成中と保存済みのハイライト色が同じで区別できない、本文中のハイライトから内容を確認する手段がない、一覧からハイライトへ移動する手段がない、一覧内の返信UIが通常コメントと不揃い）を受けて、表示・操作の一部を作り直した。以下は、この見直しの過程で確定した決定事項と、実装時に見つかった限界。

### ハイライト色の2トークン化と半透明化

作成中（選択中・入力中）と保存済みのハイライトに別々のカスタムプロパティ（`--grw-inline-comment-marker-bg-pending` / `--grw-inline-comment-marker-bg`）を与え、それぞれ独立にテーマから上書きできるようにした（旧`inline-comment-visual-consistency`のRequirement 12.8「同じ色を使う」という決定を撤回）。両者が重なったときにどちらも見えなくならないよう、境界線（`::highlight()`は`border`/`outline`に対応しない）ではなく、作成中側の適用色を`color-mix(in srgb, ... 70%, transparent)`で半透明にする方式を選んだ。トークン自体は不透明な値のまま定義し、半透明化は`PendingSelectionHighlight`が適用する箇所（`::selection`と`::highlight(growi-inline-comment-pending)`）だけに限定することで、トークンの再利用性を保ちながら影響範囲を最小化している。`color-mix()`非対応の古いブラウザでは透明度が効かないが、CSS Custom Highlight API自体がその種の環境では動作しないため、既存の`supportsCustomHighlightApi()`フォールバックと同じ範囲に収まる。

### 保存済みハイライトの当たり判定は新規実装（DOM要素を持たないため）

保存済みハイライトは`Range`オブジェクトの`CSS.highlights`登録のみで、対応するDOM要素・idを持たない。そのため素朴な`onMouseEnter`/`onClick`が使えず、本文コンテナに`pointermove`（`requestAnimationFrame`でスロットリング）／`click`を委譲し、解決済みの各`Range`の`getClientRects()`に対してポインタ座標を比較する新規フック（`use-highlight-hit-test.ts`）を実装した。デスクトップ幅ではhoverとclick両方、タブレット以下ではclick（タップ）のみを検出する（`useDeviceLargerThanMd()`で分岐）。

**このフックは「現在の当たり」だけを都度報告し、クリックで選ばれた状態を自分では保持しない**（ポインタがハイライトから離れると次の`pointermove`で`null`に戻る。戻り値の`source: 'hover' | 'click'`でどちらの操作由来かを呼び出し側に伝える）。クリックで開いたポップオーバーをホバーが外れても開いたままにする「固定」状態は、消費側（`InlineCommentBodyInteraction`）が持つ設計になっている。

閉じた直後にポップオーバーを即座に開き直さないための「再表示の抑制」は、`(commentId, source)`の組をキーに行っている。そのため、クリックで開いたポップオーバーを閉じた直後、閉じるボタンがハイライト上に重なっていてポインタが実際には動いていない場合、次の`pointermove`が`hover`扱いとなり抑制が効かず即座に開き直ることがある（AC 2.4の「外側クリックまたは閉じる操作で閉じる」自体には違反しないが、体感の使いにくさとして報告されたら、キーを`commentId`単独にし、フックが別のidまたは`null`を報告した時点で解除する形に直すとよい）。

### 一覧・本文双方が使う「オフセット→現在のRange」再構築ロジックを共有ユーティリティ化

`useAnchorResolver`が返すのはオフセットのみで、`Range`オブジェクト自体は`InlineCommentHighlight.tsx`の非公開関数`rangeFor()`が都度組み立てていた。本文中の当たり判定（新規）と一覧からのスクロール（新規）の両方がこのロジックを必要としたため、`resolved-range.ts`という共有モジュールに切り出し、`rangeForResolved`（単体変換）と`rangesById`（idキー付きの一括変換、未解決分は除外）の2関数として公開した。「解決済みオフセットの永続キャッシュは持たず都度再計算する」という既存方針は変えていない。

一覧からのスクロールは`PageView.tsx`の`scrollToRange(commentId)`が担う。対象の`Range`が見つかれば`scrollIntoView({block: 'center'})`した上で、既存の`growi-inline-comment`（保存済み）・`growi-inline-comment-pending`（作成中）とは別の3つ目のハイライト名（`growi-inline-comment-emphasis`）を2秒間だけ登録して一時的に強調し、見つからなければ`toastError()`で通知して`false`を返す（スクロールはしない）。

**既知の限界（2件、実装時に軽微・許容と判断し先送り）**:
- `InlineCommentHighlight.tsx`の副作用は`resolvedRanges`が新しい参照になるたびに保存済みハイライトを再登録する。これが強調表示の2秒の窓の最中に起きると、`CSS.highlights`の「後から登録した名前が上に描かれる」性質により、保存済み（黄）が強調（赤）の上に再度乗り、色が一瞬もとに戻ることがある。スクロール自体は影響を受けない、色のちらつきに留まる限界。
- `supportsCustomHighlightApi()`（`CSS.highlights`が使えるかの判定）が`InlineCommentHighlight.tsx`と`PageView.tsx`の2箇所に重複している（各タスクの担当範囲がそれぞれのファイルの外に出なかったため）。直すなら`resolved-range.ts`の隣に共有関数として切り出し、両方から呼ぶ形にするのが素直。

### 一覧内の返信UIは通常コメントの開閉パターンを踏襲し、エディタ組み立てを共有部品化

通常コメントの「Reply...」ボタン⇄入力欄の開閉（`PageComment.tsx`の`showEditorIds`パターン）と同じ見た目・状態管理を、インラインコメント側の返信トグル（`InlineCommentReplies.tsx`）にも採用した。`CommentEditor.tsx`自体は`useSWRxPageComment`に直結しており汎用化の影響範囲が大きいため再利用せず、代わりに`InlineCommentForm.tsx`が既に持っていたエディタ組み立て部分（`CodeMirrorEditorComment`＋メンション補完拡張＋送信/取り消しボタン）を`MentionAwareCommentInput`という共有部品に切り出し、起点フォーム（`InlineCommentForm`）と返信トグル（`InlineCommentReplies`）の両方から使う形にした。`CommentEditor.tsx`（通常コメント側）は無変更。

### i18nキーの新規追加とbaselineの整合

`inline_comment.reply_placeholder`（ポップオーバーの返信欄）・`inline_comment.range_not_found`（再アンカー失敗時の通知）をen_US専用キーとして追加した（本プロジェクトの英語ファースト方針により、他言語は未翻訳のまま据え置き）。`apps/app/tools/i18n-audit/baseline.json`の`missingByLocale`（ja_JP/zh_CN/fr_FR/ko_KR）を各+8引き上げているが、この内訳は「新規2キー×4言語」ではない（それでは+2にしかならない）。実際は、先行するamend spec `inline-comment-visual-consistency`が追加した`inline_comment.start_comment/resolved/unresolved/resolve/reopen/label`の6キー分のbaseline引き上げが漏れていた分と、本amendの新規2キー分の合計8。つまりこのブランチの`pnpm run lint:i18n`は本amend着手前から既に失敗しており、今回の引き上げがその積み残しも一緒に解消した。各言語のbaseline値は実測値と完全に一致しており、余裕はない。

## ハイライト復元の精度改善（amend spec `inline-comment-highlight-fix` より統合）

本文テキストの数え方・除外条件・再解決のきっかけについて、design.md が現在の設計として記述している内容を選ぶまでに比較検討した案と、その採否の理由を残す。

### 本文テキストと位置の数え方を `renderedTextOf` に一本化した理由（あとから補正する案は不採用）

コメント作成時（`use-text-selection` の `captureSelection`）とハイライト解決時（`useAnchorResolver`）が、それぞれ別のやり方で本文の文字数を数えることもできる。その場合、両者の差（たとえば数式の読み上げ用テキストのぶん）を数えて `approxOffset` を補正する必要があるが、この案は採らなかった。補正するには「何を除外対象とみなすか」という定義を2箇所目に複製することになり、除外条件を変えるたびに2箇所を同時に直さなければならない。数え方の定義が2箇所に分かれていること自体が、位置がずれる原因になる。

そこで `renderedTextOf` を「このコンテナに今どんな文字が存在するか」を答える唯一の関数とし、作成時・解決時の両方がそれを通る形にした（`.claude/rules/coding-style.md` の「単一の情報源」）。この形を成り立たせるために、テキストオフセットからDOM位置を求める向き（`resolveDomPosition`）だけでは足りず、DOM境界点からテキストオフセットを求める逆向き（`textOffsetOf`）を足す必要があった。代わりに、選択が変わるたびにコストが増える——`textOffsetOf` は境界点までの部分木を `Range.cloneContents()` で複製したうえで走査するため、単なる走査よりも重く、`captureSelection` は開始・終了の2回分これを呼ぶ。長いページでのドラッグ選択で体感の重さが報告された場合は、まずここを疑うとよい。解決側は以前から都度走査しており（永続キャッシュを持たない方針）、走査そのものは既に受け入れているコストだが、複製を伴う点は選択側に新しく足された負担である。

除外条件を変える改修を入れる際に、それ以前に保存された `approxOffset` を再計算するマイグレーションは行わない（design.md の「フロー上の決定事項」で方針として明記済み）。この判断が安全なのは、`approxOffset` の用途が「同じクオートがページ内に複数回出てくるときにどれを選ぶか」だけに限られているためである。したがって影響が残るのは「クオートがページ内で一意でなく、かつページ冒頭からそのクオートまでの間に除外対象の要素がある」という狭い組み合わせだけで、それも「ハイライトなし」より軽い劣化にとどまる。

### 除外条件を `aria-hidden="true"` の宣言に委ねた理由（クラス名を列挙する案は不採用）

除外対象を増やす方法として、`.katex` と同じ形で個別のクラス名（編集ボタン、表の編集ボタン、draw.io の編集ボタン…）を判定に足していく案があった。不採用。`renderedTextOf` は `inline-comment` フィーチャーが所有するファイルであり、この案ではそこが他機能のDOM構造を1つずつ知っている状態になる。同じ形の要素が今後増えるたびに `inline-comment` 側を直し続けることになり、`.claude/rules/coding-style.md` の「実行する側で個別分岐せず、宣言された集合を参照する」原則に反する。

代わりに、除外されるべき要素を持つ側が `aria-hidden="true"` を付けて表明する形を選んだ。`aria-hidden` は「スクリーンリーダーに読ませない＝人間が読む本文としても意味を持たない」ことを表す標準属性で、リポジトリ内の同種アイコンにも既に部分的に使われている慣習であり、この機能のために発明した印ではない。付ける側は `inline-comment` への依存を持たず、副次的にスクリーンリーダー利用者にとっても改善になる。

弱点も残る: `aria-hidden` は本来アクセシビリティ用の属性なので、将来「アクセシビリティ上は隠したいが、本文テキストとしては数えてほしい」要素が `.wiki` 配下に現れると、意図せずアンカーの対象から外れる。現時点でそのような要素は見つかっていないため、実際に登場した時点で個別に判断する。

### 静定シグナルの発火条件を広げた際に検討した代替案

`useAnchorResolver` の2つ目のトリガー（`anchors` の内容変化）に「今も描画中か」の確認を足すにあたって、そもそもこのトリガーを消して静定シグナル1本にする案を検討したが不採用とした。非同期ウィジェットが1つもない静的なページではDOM変化が起きないため静定シグナルも来ず、一覧取得が遅れて届いたアンカーが永久にハイライトされなくなる。このトリガーはその隙間を埋めるためにあり、消せない。確認に使う判定は `use-container-settle` から `hasRenderingElements` として公開し、静定シグナル自身の判断と同じ関数を両者が使う形にした（「何を描画中とみなすか」の定義を複製しない）。

再描画で古くなった `Range` を作り直す仕組みについては、`InlineCommentHighlight` と `InlineCommentBodyInteraction` にそれぞれ独自の `MutationObserver` を持たせ、自分が登録した `Range` がまだ有効かを各自で見張る案を検討したが不採用とした。「このコンテナで何か変わったか」を判定するロジックが3箇所（`use-container-settle` とこの2つ）に分かれ、監視範囲や間引き方がそれぞれ独立に調整されていくため、あとからズレが生じる。代わりに静定シグナルの発火条件を広げる1点の変更に寄せた——`resolveAll` が呼ばれるたびに新しい `Map` を返す既存の性質があるので、シグナルが増えれば表示側は既存の実装のまま新しい `Range` を得る。表示側の2ファイルには手を入れずに済む。

発火条件を広げると細かなDOM変化のたびに再計算が走るため、`requestAnimationFrame` 単位で1回にまとめる間引きが前提になる。間引きのぶん、再描画からハイライトが揃うまでにわずかな遅れが出るが、要件は同一フレーム内の即時性を求めていない。無限ループの心配は構造的にない——`resolveAll` はDOMを読むだけで書かないし、`CSS.highlights.set` もDOMツリーを変えない。mermaid・draw.io・lsx を多数含むページでは、目印付き要素が入れ替わるたびに監視全体の再計算頻度が上がる点は残るコストで、rAFの間引きで1フレームあたり最大1回に抑える以上の緩和はしていない。そのようなページでの実測プロファイリングは行っていないため、体感的な重さが報告された場合はまずここを疑うとよい。

なお、初回マウント時の判定だけを同期的に発火させて間引きの対象から外しているのは、`useAnchorResolver` がマウント時に静定シグナル経由と `anchors` 経由の2回解決するため、初回を1フレーム遅らせるとこの2回の順序が入れ替わってしまうという理由による。

### draw.io はレンダリング状態属性プロトコルに参加している（コードで確認済み）

`packages/remark-drawio/src/components/DrawioViewer.tsx` は Mermaid・PlantUML と同じ手順（描画開始時に `true`、完了・エラー時に `false`、リサイズによる再描画の直前に再び `true`）を実装しており、導入は2026年4月のコミット `de79d06173`（auto-scroll 関連の改善）である。

そのため、draw.io を含むページでハイライトのずれが再発した場合、この見立てを再検討する必要はない。疑うべきは静定シグナルの発火条件と、その監視期間（マウント時点から10秒）の側である。プロトコルに参加していない要素として実際に残っているのは、添付ファイル埋め込み（Ref/Refs/RefImg/RefsImg/Gallery、RichAttachment）であり、これは design.md の Revalidation Triggers に記録している。

### 既知の限界（2件、いずれも直さない判断をした）

- **`quote` だけは選択時の原文のまま**（`Range.toString()` 由来）で、本文テキスト（`renderedTextOf` の `text`）とは別の座標系に乗っている。そのため、除外対象のサブツリー（`.katex` や `aria-hidden="true"`）の内側にある、またはそれを跨ぐ範囲を選択すると、`quote` に本文テキストには存在しない文字が混ざり、完全一致・あいまい一致のどちらも当たらず「ハイライトなし」に落ちる（design.md の「フロー上の決定事項」参照）。直さなかったのは、誤った位置にハイライトを出すのではなく素直に「ハイライトなし」へ落ちる壊れ方であり、要件2.4/5.3のフォールバックで吸収できるためである。将来これを直す場合は、アンカーのデータ構造（`quote` も `renderedTextOf` ベースの文字列にする——ただし保存済みの全 `quote` が一致しなくなる）か、一致判定の側（マッチャーが除外対象由来の文字を吸収する）のどちらを動かすかを先に決める必要があり、どちらもこの機能の中心的な契約に触れる。
- **監視期間の打ち切りと、2つ目のトリガーの描画中ガードが重なる隙間**。`use-container-settle` は監視期間（10秒）を過ぎると監視をやめ、フォールバックの静定シグナルを1回出して終わる。その後に「描画中」の目印付き要素が残ったまま `anchors` が変化すると、ガードは再計算を見送るが、それを引き受ける静定シグナルはもう来ない——このとき、新しく投稿されたコメントはページを開き直すまでハイライトされない。「見送った再計算は静定シグナルが引き受ける」という設計どおりの帰結であり、10秒以上「描画中」の目印を出しっぱなしにする上流側の不具合が前提になるため、頻度は低いと判断して直さなかった。もし実際に起きるようになった場合は、ガードで見送ったことを記録して打ち切り時に一度だけ拾う、という形が素直な直し方になる。

## プレビューポップオーバーの改修（amend spec `inline-comment-popover-refinement` より統合）

`InlineCommentBodyInteraction`／`InlineCommentPreviewPopover` の hover挙動・解決操作・レイアウトを見直すにあたって比較検討した案と、その採否の理由を残す。

### ポインタ到達後のロックを、新しい状態ではなく既存の `pinnedId` への昇格として実装した理由

「マウスがポップオーバーに乗った後は自動で閉じない」という状態を、`pinnedId` とは別に `isLockedByHover: boolean` のような新しい状態として持たせる案を検討したが不採用とした。`pinnedId`（クリックで開いた場合に持たせている「明示的に閉じるまで維持」の状態）が持つ既存の性質——「一度立てば以降の hover 結果を無視する」「`suppressedHit`/`handleClose` で確実にクリアされる」——が、ポインタ到達後に必要な性質とまったく同じであるため、別状態を足すと「どちらが優先か」を毎回判定する箇所が増えるだけで得るものがない。`handlePointerEnterPopover` はポップオーバー自体への `pointerenter` を受けて `pinnedId = hoverPreviewId` に昇格させ `hoverPreviewId` をクリアするだけの薄い関数とし、以降の閉じる処理は既存の `pinnedId` の経路をそのまま通す。

### hover表示の遅延時間（出現150ms・消失250ms）を要件に数値として明記しなかった理由

要件は「短い遅延」とだけ求め、具体的な数値は設計判断とした。出現側の遅延は、ハイライトの上を素通りしただけの hover で毎回ポップオーバーが点滅するのを防げれば十分で、初見の要素に対するツールチップほど長くする理由がない。消失側の遅延は、ハイライトからポップオーバーまでの移動時間を吸収できれば十分で、同じ理由で短くしてある。どちらも「利用者が既に存在を知っている UI 要素への遷移」を前提にした値であり、初回表示のツールチップの定石（数百ms〜1秒級）をそのまま流用しなかった。体感として長すぎる・短すぎるという報告が出た場合はこの2値だけを調整すればよく、要件・設計いずれの契約も変わらない。

### ポップオーバーの解決トグルを、一覧側（`InlineCommentItem`）と共通コンポーネント化しなかった理由

`InlineCommentItem.tsx` とポップオーバーの解決バッジ＋ボタンは、クラス名・翻訳キー・判定（`resolvedAt != null`）まで完全に同じ見た目になる。それでも共有コンポーネントへ切り出さなかったのは、この改修のスコープが一覧側のロジックを触らないことを前提にしていたためで、共有化すると一覧側のファイルにも手が入ってしまう。加えて2箇所の周囲のレイアウト（一覧の`headerEnd`とポップオーバー本文内）が異なり、エラー表示の置き場所の要件も違うため、抽象化してもパラメータ化のコストに見合う再利用が今のところない。同じ見た目のマークアップが2箇所に存在する状態は許容し、3箇所目の利用が現れた時点で切り出しを検討する。

## 起点コメント・返信の編集・削除（amend spec `inline-comment-edit-delete` より統合）

投稿者本人による編集・削除、および解決済みインラインコメントの本文中非表示を追加するにあたって比較検討した案と、その採否の理由を残す。

### 通常コメントの編集・削除の仕組みは「権限のルールとカスケード削除の部品」だけを持ってきて、「通信の作法」は持ってこない

Requirement 18.9・15.5 が、編集・削除を通常コメント（`comments.update`／`comments.remove`）とまったく同じ権限モデルにすることを求めている。通常コメント側の実装（`Comment.tsx`／`CommentControl.tsx`／`DeleteCommentModal`／`apps/app/src/server/routes/comment.js`）を調査した結果、編集は `Comment.tsx` の `isReEdit` state が `CommentCard` を `CommentEditor` に切り替える形、削除は `CommentControl` → `PageComment.tsx` のモーダルstate → `DeleteCommentModal`／`DeleteCommentModalSubstance` という形で実装されており、どちらも apiv1 のプレーンな `Error` ベースのレスポンス（`ApiResponse.error`）を使っている。サーバー側はどちらも `prisma.comments.findUnique` → 未発見チェック → `Page.isAccessiblePageByViewer` → **投稿者本人チェック**（`creatorId` 比較）という順で処理し、削除は `removeWithReplies(commentId)`（トランザクション内で返信をすべて削除してから本体を削除）を呼ぶ。

*権限のルール*（投稿者本人限定、`creatorId` 比較、サーバー側が最終判断）と*カスケード削除の部品*（`removeWithReplies`）はそのまま持ってきたが、*通信の作法*は持ってこなかった——インラインコメント自身の既存ルート（`create.ts`／`create-reply.ts`／`list.ts`／`resolve.ts`）はすべて apiv3 なので、新しい更新・削除ルートも apiv1 風のペアを別に持ち込むのではなく、この既存の apiv3 の作法（ファクトリ関数、`ErrorV3`、`res.apiv3Err`／`res.apiv3`）に従っている。`creatorId`（ただの文字列）はどのエンドポイントが生成したオブジェクトであっても必ず入っている投稿者特定フィールドだが、`creator`（populatedなユーザーオブジェクト）は `listByPageId()` の出力以外では `null` になる。権限判定（クライアント側の表示切り替えであれ、サーバー側の認可であれ）は必ず `creatorId` で比較し、`creator` では比較しない。

### 更新・削除は操作ごとに1つの共有サービスメソッドとし、起点／返信で重複実装しない

**Context**: 更新・削除は起点コメント・返信の両方に必要で、下回りのPrisma操作（`comment` フィールドの更新／行の削除）はどちらでもまったく同じだが、既存の慣習（`create.ts` と `create-reply.ts` の分離）に合わせると*ルート・DTOの形*は起点と返信で分ける方が筋が良い。

**Alternatives Considered**:
1. 「インラインコメントらしき任意の行を更新する」単一のルート・サービスメソッドにまとめ、レスポンスを判別可能なunion型にする。
2. 操作ごとに起点用・返信用の2ルート・2DTOに分ける（`create`／`create-reply` の分離にならう）。共通のPrisma操作・Activity発行は、サービス内部の共有ヘルパーとして重複を避ける。

**Selected Approach**: (2)。

**Rationale**: `create.ts`／`create-reply.ts` がすでに「コメントの種類ごとに1ルート」という慣習を確立している。判別可能なunionレスポンスはこの慣習から最初に外れることになるうえ、得られる利益がない（`{inlineComment}` と `{inlineCommentReply}` という2つのレスポンス形は、すでに別々のDTOとして存在している）。実際に重複を避けるべき箇所（Prisma呼び出しの形、Activity発行）は、共有の内部ヘルパーが担うべき仕事であり、公開されるルート・サービスの表面がそれを担うべきではない。

**Trade-offs**: 操作ごとに2ファイルではなく4ファイルの新規ルートになるが、既存の「コメントの種類ごとに1ファイル」というパターン（`.claude/rules/coding-style.md` の「小さいファイルを多数」）に沿っている。

### 編集モードには、新しい編集専用コンポーネントではなく、任意の初期値propを足した `MentionAwareCommentInput` を再利用する

**Context**: 一覧側の編集フローとポップオーバー側の編集フローの両方で、現在の本文をあらかじめ入力欄に入れておく必要がある（Requirement 18.1, 15.5）。

**Alternatives Considered**:
1. 編集専用の新しい入力コンポーネントを作る。
2. `MentionAwareCommentInput` に任意の `initialValue` prop を足す（マウント時に一度だけ `codeMirrorEditor.initDoc(initialValue)` を適用する）。呼び出し側は `onSubmit` を、文脈に応じて `create` にも `update` にも配線できるようにする——コンポーネント自身はどちらなのかを知る必要がない。

**Selected Approach**: (2)。

**Rationale**: `MentionAwareCommentInput` はもともと永続化への依存を持たず（`onSubmit` は呼び出し側が注入する）——これはまさに「作成か編集か」の分岐が本来あるべき継ぎ目である（コンポーネント内部ではなく呼び出し側が決める）。これを再利用することで、作成時と編集時のメンション対応の編集体験（CodeMirror、メンション補完）が完全に一致し、見た目をあわせて保守すべき新規コンポーネントも増えない。

**Trade-offs**: 編集モード用の新しい `editorKey` は、コメントidごとに区別できる値（例: `inline_comment_edit_${commentId}`）にする必要がある。そうしないと、あるコメントの編集がページの「新規コメント」用エディタや、別のコメントの編集セッションとCodeMirrorのstateを共有してしまう。

### 一覧側の削除確認に `DeleteCommentModal` を再利用しなかった理由

`DeleteCommentModal`／`DeleteCommentModalSubstance` を再利用する代わりに、インラインコメント専用の新しい削除確認UIを使うことにした。`DeleteCommentModal` は通常コメント自身のstore・型（`ICommentHasId`）に強く結びついており、この機能の既存の方針（`inline-comment-popover-refinement` の「解決トグルのマークアップを共有化しない」判断と同じ）は、小さく型の異なるUIは無理に共有コンポーネント化しないというものである。

### 解決済みインラインコメントの本文中非表示を `inlineCommentAnchors` 1箇所でフィルタする理由

「解決済みコメントにはハイライトを付けない」（Requirement 2.7）をどこで実装するかについて、(1) 各消費者（`InlineCommentHighlight`、`InlineCommentBodyInteraction`）がそれぞれ独立にフィルタする案と、(2) `PageView.tsx` の `inlineCommentAnchors`（すべての消費者が `resolvedRanges` を介して間接的に読み取っている唯一の起点）で一度だけフィルタする案を検討し、(2) を選んだ。`resolvedRanges`（`useAnchorResolver` の出力）はすでに `InlineCommentHighlight` と `InlineCommentBodyInteraction` の両方が消費している唯一の絞り込みポイントであり、解決済みコメントはそもそも `Range` が計算されないだけなので、両方の消費者は解決状態を自分で意識する必要が一切なくなる（`.claude/rules/coding-style.md` の「単一の情報源を持ち、消費者ごとに個別分岐しない」原則）。

ポップオーバーを開いたまま対象が解決済みに変わった場合（Requirement 15.12）についても、`InlineCommentBodyInteraction` に `comment?.resolvedAt` を監視する新しい `useEffect` を追加する案と、すでにある「`comment == null` ならなにも描画しない」というガード（再アンカリング失敗のケース、Requirement 15.6ですでに使われている）に任せる案を検討し、後者を選んだ。`InlineCommentBodyInteraction` はidで `inlineComments` を検索しているため、フィルタ後は解決済みコメントもこのガードに引っかかって自然に対象外になる——新しい監視effectを足す必要がない。ただし、表示中のidに対応するコメントが `inlineComments` から消えて `comment` が `null` になった時点で、`pinnedId`／`hoverPreviewId` もあわせてクリアする小さなeffectを追加している。そうしないと、消えたidを指したままのstateが残ってしまう（同じidが二度と現れなくなる以上実害はないが、`handleClose` がすでに保っている「`pinnedId` は表示中のコメントが存在することを含意する」という不変条件を、この経路でも保つため）。コメントがこの経路で単に消えた場合、ポップオーバー自身の `onClose`／`suppressedHit` の後始末は走らない（`handleClose` を経由したときだけ走る）——解決済みである限り当たり判定がそのidを二度と報告しないため、抑制すべきものが残らず問題ない。

### Risks & Mitigations

- Risk: クライアント側の `creatorId === currentUser._id` チェックはそれ自体では認可の境界にならない（クライアント側のstateは古い可能性・偽装される可能性がある）。— Mitigation: `comments.update`／`comments.remove` とまったく同じく、サーバー側のルート・サービスが変更前に投稿者本人であることを独立に再検証する。クライアント側のチェックはどのボタンを表示するかだけを決める。
- Risk: 返信を持つ起点コメントを削除したときに、返信行が孤立して残ってしまう。— Mitigation: すでにトランザクション化され、通常コメントの削除で実績のある `removeWithReplies` をそのまま再利用する。
- Risk: `MentionAwareCommentInput` に新しい `initialValue` prop を足すことが、既存の「新規コメント」呼び出し元に対して純粋な追加にならず退行を生む可能性。— Mitigation: 既定値を `undefined`／空にし、既存の呼び出し元（`InlineCommentForm`、`InlineCommentReplies` の返信入力欄）に影響が出ないようにする。「`initialValue` を渡さない場合は現状と変わらない」ことを確認する退行テストでカバーする。

### 読み取り専用利用者の制限は書き込み系7ルートすべてにサーバー側で適用する

編集・削除の4ルート（`update.ts`／`update-reply.ts`／`delete.ts`／`delete-reply.ts`）は当初から、`comments.update`／`comments.remove`（apiv1）と同じ `excludeReadOnlyUserIfCommentNotAllowed` ミドルウェアを持ち、読み取り専用利用者の制限をサーバー側で最終判定していた（要件18.9）。

作成・返信作成・解決トグルの3ルート（`create.ts`／`create-reply.ts`／`resolve.ts`）にはこのミドルウェアが無く、読み取り専用利用者の制限がクライアント側の表示制御にしか存在しない期間があった——`inline-comment` 機能が最初にこの3ルートを実装した時点からの既存の欠落で、編集・削除の追加時にも対象範囲外として意図的に見送られていた（要件1・4の受け入れ基準に及ぶ変更だったため）。

この欠落は `inline-comment-readonly-restriction` というamend specで是正済み（2026-09-11起票・実装完了・本体へ折り込み済み。amend spec自体は`.claude/rules/spec-lifecycle.md`の手順により削除済み）。`create.ts`／`create-reply.ts`／`resolve.ts` の3ルートに同じミドルウェアを追加し（要件1.10・4.7）、対応するクライアント側の操作起点（`SelectionCapture`・`InlineCommentReplies`・`InlineCommentItem`・`InlineCommentPreviewPopover`）にも `NotAvailableIfReadOnlyUserNotAllowedToComment` ガードを追加した。現在は書き込み系7ルートすべてが同じ位置・同じミドルウェアでこの制限をサーバー側最終判定している。

## 見た目の刷新（amend spec `inline-comment-visual-refresh` より統合）

`InlineCommentItem`／`InlineCommentReplies`（一覧）と `InlineCommentPreviewPopover`（本文中ポップオーバー）の見た目を、承認済みモックアップに合わせて刷新した際の決定。承認済みモックアップ自体（配色トークン・寸法の仮の値を含む）はArtifactとして別途保管されており、ここには実装に反映した決定だけを残す。

### GROWIのBootstrapテーマは `-subtle`/`-emphasis` トークンをすでに生成している

モックアップの淡色バッジ（仮の配色）を、GROWIの実テーマでどう表現するか調べた。コンパイル済み `bootstrap.css` を直接grepし、`.bg-warning-subtle`／`.bg-danger-subtle`／`.bg-success-subtle`／`.text-warning-emphasis`／`.text-danger-emphasis`／`.text-success-emphasis` がいずれも生成済みであることを確認した。「淡色バッジ＋濃い文字色」という2階調の表現を、ハードコード色を一切使わずBootstrapの意味付きクラスだけで実現できる。

### Bootstrapに「ホバーで不透明度が変わる」汎用ユーティリティは無い

`.btn-close` と同じ「ホバーで濃くなる」挙動を編集・削除アイコンボタンにも持たせたかったが、`.link-opacity-*-hover` は `.link-*` 系カラーユーティリティに紐づいておりボタンには使えない。既存の `opacity-50` ユーティリティは `!important` 付きなので、素の `:hover` 規則を足しても勝てない。CSS Modulesに `opacity: 0.5` ／ `&:hover { opacity: 0.75; }`（Bootstrap自身の `$btn-close-opacity`／`$btn-close-hover-opacity` と同じ値）を直接書き、呼び出し側から `opacity-50` を外す形にした。

### ホバー表示のトリガーは「各カードの箱」でなければならない

通常コメントでは、起点・返信それぞれが独立した `Comment.tsx` インスタンスで自前の `.page-comment > .page-comment-main` を持つため、`.page-comment-main:hover > .page-comment-control` が自然に行単位で独立する。インラインコメント側は当初、起点と返信スレッド全体を包む外側のラッパーをトリガーにしていたため、アイテムのどこにマウスを乗せても起点と全返信のボタンが一斉に出てしまっていた。トリガーを `:global(.page-comment-main):hover`（各 `CommentCard` インスタンス自身の箱）に変更し、行ごとに独立させた。

### 通常コメント側の絶対配置は、親のパディングを無視する不具合だった

通常コメントの編集・削除アイコン（`CommentControl`）は当初 `position: absolute; top: 0; right: 0` でカード右上に配置されていたが、これはCSSの仕様上、包含ブロックの**パディング辺**を基準に配置され親自身のパディング（`padding: 1em`）を無視するため、カードの角にぴったり張り付いてしまっていた（実機での見た目の崩れとして発見）。インラインコメント一覧アイテムがすでに採用していた「ヘッダー行の `headerEnd` スロット内・`ms-auto` の通常のflexフロー」に統一し、両サーフェスの配置方式を揃えた。

### `CommentEditor` の `onSubmit` は永続化を完全に差し替える

一覧側の編集モードを通常コメントと同じ `CommentEditor` に揃えるにあたり、インラインコメント用のAPIで保存できるか調べた。`CommentEditor.tsx` の `postCommentHandler` は `onSubmit != null` を先に確認してから自前の更新・投稿パスへ落ちるため、`currentCommentId` の有無に関わらず `onSubmit` が優先される。`onSubmit` の上書きだけでインラインコメント用の保存に差し替えられる。

### `useCodeMirrorEditorIsolated` の初期値が復元されない2つの原因

編集モードに入っても入力欄に既存の本文が入らない不具合の原因は `packages/editor/src/client/stores/codemirror-editor.ts` にあり、2つあった。(1) `shouldUpdate` の判定が、そのフックインスタンスからの最初の発行のときだけ `isValid(newData)` のチェックを素通りしていた——CodeMirrorの `view`／`state` は非同期に初期化されるため、コンテナが着いた直後の再レンダーでは `newData` が無効なことがあり、その無効な値が共有atomに入ってしまう。`MentionAwareCommentInput` 側は「非nullになったら一度だけ `initDoc` を呼ぶ」設計なので、この空振りが唯一のチャンスを使い切る。(2) 原因1を直しても「キャンセル→再度開く」で再発した——`editorKey` ごとのJotai atomがアンマウント時に消えないため、再マウント直後の最初のレンダーが「前回の、すでに破棄されたエディタ」を見てしまう。発行側インスタンスのアンマウント時にatomをリセットすることで直した。この種の「初期化タイミング」の不具合は2回目までの確認では取り切れないため、最低3回開き直して確認する必要がある。

### 同じ長さの本文修正は `characterData` の変更しか起こさない

インラインコメントを付けた範囲の近くをエディタで少し直して保存し、リロードせずに閲覧モードへ戻るとハイライトが外れる不具合があった。タイプミスの修正など「文字数が変わらない範囲の本文修正」は、Reactが既存のテキストノードの `data` をその場で書き換えるだけで要素の追加・削除を伴わないため `characterData` 型の `MutationRecord` になり `childList` 型にはならない。`use-container-settle.ts` は `characterData: true` を指定しておらず監視が発火していなかった。`observer.observe(...)` に `characterData: true` を足して解決した。

### happy-dom の `querySelector` は改行区切りのクラス属性を解釈しない

`className` を複数行のプレーン文字列（改行区切り）に整形したところ、`document.querySelector('.foo')` が突然 `null` を返すようになった。`classList.contains()` は改行を区切り文字として正しく扱うが、`querySelector`／`querySelectorAll` のCSSセレクタ照合は扱わない。実ブラウザはHTML仕様どおり正しく扱うため本番挙動には影響しないが、テストが落ちたときに実装を疑う前に `className` が改行を含んでいないか確認する必要がある。

### 返信の表示順は各利用側の責務

`InlineCommentService.listByPageId()` はサーバーの取得順（`createdAt: 'desc'`、新しい順）のまま返し、表示順を整えない。一覧側（`InlineCommentReplies.tsx`）は自前で `reverse()` して古い順にしていたが、ポップオーバーにはそれが無かったため新しい順に表示されていた（一覧と逆）。ポップオーバー側にも同じ `reverse()` を足して揃えた。新しく返信を表示する画面を作るときは、サーバーの順序に依存せず必ず自分で表示順を決める必要がある。

### ポップオーバーは `CommentCard` を流用しなかった

起点・返信とも共有の箱（`CommentCard`）に入れる案を検討したが、共有スタイルが決めている値（投稿者アイコンの大きさ、吹き出しの飾り、背景の濃さ）がモックアップと違いすぎ、実機で「モックアップと別物」に見えた。ポップオーバーは独自のフラットなマークアップにした。

### 引用ブロックは共有コンポーネント化しなかった

一覧とポップオーバーの引用ブロックを1つの共有Reactコンポーネントに切り出す案を検討したが、差分が数行のCSS規則にとどまり、新しい抽象を1つ増やすコストに見合わないと判断した。

### 通常コメントとインラインコメントのコンポーネントは統合しなかった

`InlineCommentItem.tsx` と `Comment.tsx` を1つのコンポーネントにまとめる案を検討したが、ヘッダー行の中身が本質的に異なる（解決トグル＋状態バッジ vs リビジョン履歴リンク）ため、無理に1つにまとめると「インラインかどうかで分岐する巨大コンポーネント」になる。重複していた**部品**（削除確認の警告帯、編集・削除アイコンの組、編集モードのエディタ、リビジョン履歴リンク）だけを共通コンポーネントに切り出した。トレードオフとして、2つのコンポーネントが残るため片方だけを変更して挙動がずれる余地は残る——実際、この作業中に不透明度・寸法・ホバーの出方・編集モードのDOM構造が別々のタイミングでずれているのが見つかっている。

### ポップオーバーの編集・削除アイコンはホバー表示にしなかった

一覧アイテムと統一してホバー表示にする案を検討したが、ポップオーバー自体がホバー／クリックで一時的に表示される要素であり、その中でさらにホバー待ちの操作を要求すると発見しづらくなる。承認済みモックアップも編集ボタンを常時表示で描いていたため、常時表示のアイコンボタンのまま残した（一覧側との意図的な差）。

### Risks & Mitigations

- Risk: ホバー表示への変更で、タッチデバイスでの編集・削除操作の発見しやすさが下がる — Mitigation: これは通常コメント（`CommentControl.tsx`）にすでに存在する制約であり、この改修が新しく持ち込むものではない。別途改善するなら通常コメント側も含めた横断的な課題として扱う
- Risk: 「完了したと報告されたが実際は見た目が違った」という過去の失敗の再発 — Mitigation: 実ブラウザでのスクリーンショット照合を必須の完了条件とし、独立したレビューをゲートにした。タスク単位のレビューは「そのタスクが引用した設計箇条書きの部分集合」しか見ないため実装漏れが素通りしたことがあり、最終レビューにはコンポーネントごとの責務・制約の一覧全体を渡す必要がある
- Risk: 通常コメントとインラインコメントが2つのコンポーネントのまま残るため、片方だけ変更して挙動がずれる — Mitigation: 重複していた部品を共通コンポーネントに寄せ、残った差（ホバー表示の仕組み、ヘッダー行の中身）は各ファイルのコメントで「意図的な差である」と明記する
