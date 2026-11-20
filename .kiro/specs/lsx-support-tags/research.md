# Research & Design Decisions Template

## Summary
- **Feature**: `lsx-support-tags`
- **Discovery Scope**: Extension（既存 `packages/remark-lsx` の拡張。新規ライブラリ・新規外部サービス連携なし）
- **Key Findings**:
  - `packages/remark-lsx` は `apps/app` に依存しない設計であり、既存の `listPages({ getExcludedPaths })` ファクトリと同じ形（依存性注入）でタグ解決処理を渡す必要がある。
  - タグ名からページIDを求める処理は、既存の `PageTagRelation`（Prisma 拡張, `apps/app/src/server/models/page-tag-relation.ts`）に新しい拡張メソッドを1つ追加するだけで実現でき、新規モデル・新規テーブルは不要。
  - 閲覧権限フィルター（`addConditionToFilteringByViewerForList`）は、ページIDの一覧（`_id: { $in: [...] }`）を対象にした絞り込みと自然に組み合わせられる。既存のパス絞り込みと同じ合流点（`Page.find()` に対する `.and()` の連鎖）に条件を1つ追加するだけで済む。
  - `depth`・`filter`・`except` は `prefix` を起点に `.and()` 条件を追加していく実装であり、タグ条件も同じ合流点にもう1つ `.and()` 条件を追加するだけで済む。要件定義時に想定した「併用時に矛盾するかもしれない」という懸念は、実装を確認した結果、当てはまらないと分かった。
  - 表示側（`generatePageNodeTree`）は、取得済みページの祖先パスを遡って木を再構築する実装であり、取得結果が `prefix` 配下でありさえすれば、ページ同士が隙間なく連続していなくても正しく動く。変更不要。

## Research Log

### タグ名からページIDを求める既存の手がかり
- **Context**: `$lsx` にタグ絞り込みを追加するには、タグ名の集合からページID一覧を求める処理が必要。既存のコードに再利用できるものがあるか確認した。
- **Sources Consulted**: `apps/app/src/server/models/page-tag-relation.ts`, `apps/app/src/server/models/tag.ts`, `apps/app/src/server/routes/tag.js`, `apps/app/src/server/service/search-delegator/elasticsearch.ts`
- **Findings**:
  - `PageTagRelation` は Prisma 拡張済み（`Prisma.defineExtension`）で、`findByPageId`・`listTagNamesByPage`・`getIdToTagNamesMap` など「ページ→タグ」方向の解決メソッドは既にある。「タグ→ページ」方向（今回必要な向き）のメソッドはまだ無い。
  - `Tag` モデルの Prisma 拡張には `getIdToNameMap` はあるが、名前からタグを引く `findMany({ where: { name: { in: [...] } } })` は素の Prisma 呼び出しで十分間に合う（専用メソッドを新設する必要はない）。
  - 検索機能（Elasticsearch）の `tag:` キーワードは `tag_names` フィールドへの `term` クエリで実現されており、Elasticsearch が有効な環境でしか動かない。`$lsx` は Elasticsearch 非依存の基本機能なので、この経路は使えない（要件のスコープ判断どおり）。
- **Implications**: 新しいメソッド `findPageIdsWithAllTags(tagNames)` を `PageTagRelation` の既存 Prisma 拡張に1つ追加するのが最小の変更。既存の「Mongoose static は `Prisma.defineExtension` に対応させる」という規約（`.claude/rules/model.md`）にもそのまま従える。

### `packages/remark-lsx` から `apps/app` への依存注入の実際の配線
- **Context**: `packages/remark-lsx` は `apps/app` の Prisma クライアントに直接依存できない。既存の `getExcludedPaths` がどう配線されているかを確認し、同じ形をタグ解決にも適用できるか調べた。
- **Sources Consulted**: `packages/remark-lsx/src/server/index.ts`, `apps/app/src/server/crowi/index.ts`
- **Findings**:
  - `apps/app/src/server/crowi/index.ts` の `setupRoutesForPlugins()` が `lsxRoutes(this, this.express)` を呼んでおり、`this`（crowi インスタンス）と Express app を渡している。
  - `packages/remark-lsx/src/server/index.ts` の `middleware(crowi, app)` は、`crowi.pageService.getExcludedPathsBySystem()` を呼ぶクロージャをその場で作り、`listPages({ getExcludedPaths })` に渡している。
  - crowi インスタンスには Prisma クライアントへの参照は生えていない（`this.prisma` のようなものは存在しない）。タグ解決処理は Prisma の `prisma` シングルトン（`apps/app/src/utils/prisma.ts`）に依存するため、`crowi` 経由では取得できない。
- **Implications**: `middleware` の引数を `(crowi, app, deps)` に拡張し、呼び出し側（`apps/app/src/server/crowi/index.ts`）が `~/utils/prisma` から得た `resolveTagPageIds` 関数を明示的に渡す形にする。`packages/remark-lsx` は具体的な実装を知らず、関数の型だけを知っていればよい。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 依存性注入（`resolveTagPageIds` を第三引数で渡す） | 既存の `getExcludedPaths` と同じ形。タグ解決の実装は `apps/app` 側に閉じ込める | `packages/remark-lsx` が `apps/app`/Prisma に依存しない状態を維持できる。既存パターンと一貫性がある | 呼び出し側（`apps/app/src/server/crowi/index.ts`）の配線を1箇所変更する必要がある | 採用 |
| `packages/remark-lsx` が Mongoose の `PageTagRelation` モデル名を直接 `mongoose.model()` で取得する | `generate-base-query.ts` が `Page` モデルを同じ方法で取得しているのと同じやり方 | 配線変更が不要 | `PageTagRelation`/`Tag` は既に Prisma 拡張へ移行済みで、業務ロジック（`findPageIdsWithAllTags` に相当する処理）は Prisma 拡張側にしか存在しない。Mongoose 経由で同じ問い合わせを再実装すると、ロジックが2箇所に分裂する | 不採用（データアクセスの単一の真実の源が失われる） |

## Design Decisions

### Decision: タグ→ページID解決の実装場所
- **Context**: タグ名の集合からページID一覧を求める処理をどこに置くか
- **Alternatives Considered**:
  1. `packages/remark-lsx` 内に独自のクエリ処理を実装する
  2. `apps/app` の `PageTagRelation` Prisma 拡張に新しいメソッドを追加し、`packages/remark-lsx` へは関数として注入する
- **Selected Approach**: 2番目。`apps/app/src/server/models/page-tag-relation.ts` の既存拡張に `findPageIdsWithAllTags(tagNames: string[]): Promise<string[]>` を追加し、`apps/app/src/server/crowi/index.ts` から `lsxRoutes` の第三引数として渡す。
- **Rationale**: `packages/remark-lsx` を `apps/app`/Prisma から独立させたまま、既存の「タグ関連の問い合わせは `PageTagRelation` の Prisma 拡張に集約する」という単一の真実の源を保てる。既存の `getExcludedPaths` と同じ配線パターンなので、レビュアーにも理解しやすい。
- **Trade-offs**: `packages/remark-lsx/src/server/index.ts` の `middleware` の引数が1つ増える（既存の呼び出し側は1箇所のみで、影響範囲は小さい）。
- **Follow-up**: `findPageIdsWithAllTags` の戻り値が空配列になるケース（指定したタグ名がすべて存在しない／一部が存在しない）を実装時に単体テストで確認する。

### Decision: 複数タグ指定時の入力形式
- **Context**: `$lsx` の属性値は単一の文字列であり、同じ属性キーを複数回指定する書き方はできない。複数タグをどう書けるようにするか
- **Alternatives Considered**:
  1. カンマ区切りの1文字列（例: `tag=議事録,会議`）
  2. 別の区切り文字（スペース区切りなど）
- **Selected Approach**: カンマ区切り。`tag=議事録,会議` のように書くと、両方のタグを持つページのみが一覧に入る（要件定義で確認済みの AND）。
- **Rationale**: `depth` オプションの `1:3` のような区切り記法と同様、既存の `$lsx` のオプション文字列の書き方に馴染む。スペース区切りは、ディレクティブのパーサー側でスペース区切りの引数（bare attribute）を別の意味（`prefix` の複数語対応, `packages/remark-lsx/src/client/services/renderer/lsx.ts` のケース4）として既に使っているため、混乱を避ける。
- **Trade-offs**: タグ名自体にカンマを含められない（既存の運用でタグ名にカンマを使っているケースがあれば影響するが、現時点でその制約は確認されていない）。
- **Follow-up**: 実装時にタグ名の前後の空白除去・重複除去を行う。

## Risks & Mitigations
- 人気のタグ（該当ページが多数）を指定すると、タグ解決処理が1回のリクエストで多数のページIDを集める可能性がある — 既存のパス指定の `$lsx` も同様に大きな配下を持つ場合があり、既存の件数表示・「もっと見る」の仕組みでページングされるため、今回新たに追加する仕組みではない。実装時に実データ規模での応答時間を確認する。
- `packages/remark-lsx` の `middleware` 関数の引数を変更するため、`apps/app` 側の呼び出しを合わせて変更し忘れると型エラーで検出できるはずだが、ビルド順序（Turborepo）に注意する。

## References
- GitHub Discussion #11865（本要望の起点）
