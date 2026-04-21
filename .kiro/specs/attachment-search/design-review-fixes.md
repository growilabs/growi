# Design Review Fixes Log

_Generated: 2026-04-17_

本ドキュメントは 3-way split 後の 3 spec (`markitdown-extractor` / `attachment-search-indexing` / `attachment-search-ui`) に対して `/kiro-validate-design` が指摘した全 9 Critical/Minor Issues と、それらに対する解決の記録。

## 経緯

1. 当初は単一 spec `attachment-search` として設計
2. 要件 14 件 / タスク推定 20+ でスコープ広すぎと判断 → 3-way split (roadmap.md 作成)
3. 3 spec 分割後に `/kiro-validate-design` で各 spec を個別品質レビュー
4. UI spec: NO-GO (3 Critical)、indexing spec: GO with must-fix (3 Critical)、extractor spec: GO (3 Minor) の計 9 Issue
5. 本ドキュメントは 9 Issue すべてを解決した結果の記録

## Summary Table

| # | Spec | Category | Issue | Resolution Key |
|---|---|---|---|---|
| 1 | attachment-search-ui | 🔴 Critical | `isAttachmentFullTextSearchEnabledAtom` の配置が既存規約と不整合 | `~/states/server-configurations/` に移動、feature module 外 |
| 2 | attachment-search-ui | 🔴 Critical | admin 画面内の保存→即時反映整合が不統一 | 既存 GROWI の SWR `mutate()` パターン採用、scope 分離 |
| 3 | attachment-search-ui | 🔴 Critical | `AttachmentHitViewProps` に `score` 欠落、配列順依存のsilent regression リスク | props に `score` 追加、UI 層で `score desc` sort |
| 4 | attachment-search-indexing | 🔴 Critical | `pageEvent` 購読の網羅性が不透明、権限同期漏洩リスク | **Option D 採用**: 権限 snapshot 廃止、query-time permission lookup |
| 5 | attachment-search-indexing | 🔴 Critical | rebuildIndex 中断時の tmp index 累積リスク | 既存 Page 側の `${indexName}-tmp` 固定名 + drop & create パターンに統一 |
| 6 | attachment-search-indexing | 🔴 Critical | `requiresReindex` 状態遷移ルール未定義 | **count 方式 computed** (Config persist なし、30 秒 TTL cache) |
| 7 | markitdown-extractor | 🟡 Minor | OpenAPI spec の下流引き渡しと drift 検知未確定 | commit 済み `openapi.json` + 両 CI の `git diff --exit-code` |
| 8 | markitdown-extractor | 🟡 Minor | Python CI workflow の gate 条件未確定 | 必須 jobs テーブル確定 (image size 450MB / trivy CRITICAL+HIGH) |
| 9 | markitdown-extractor | 🟡 Minor | pdfminer.six フォールバックの feature detection 未定 | 起動時 capability probe + `/readyz` expose |

---

## Details

### Issue 1: atom 配置と hydrate 経路 (ui)

**Problem**: `isAttachmentFullTextSearchEnabledAtom` を `features/search-attachments/client/stores/` に置く設計は、hydrate を行う `apps/app/src/pages/basic-layout-page/hydrate.ts` が feature module を逆向きに import することを強いる。既存は `~/states/server-configurations/` 配下の atom のみ hydrate する規約。

**Resolution**: atom を既存規約に従い `~/states/server-configurations/is-attachment-full-text-search-enabled-atom.ts` に配置。feature module `client/stores/` には機能ゲート atom を置かず、`activeFacetAtom` などの feature-local UI state のみ保持。

**Applied changes** (attachment-search-ui/design.md):
- `File Structure Plan` の `stores/is-search-attachments-enabled-atom.ts` を削除
- `Modified Files` に `~/states/server-configurations/is-attachment-full-text-search-enabled-atom.ts` と `apps/app/src/pages/basic-layout-page/hydrate.ts` を追加
- `Jotai Atoms` セクションを書き換え: 配置先の決定と根拠 (依存方向維持) を明記
- `Open Question #4` を [Resolved] にマーク

---

### Issue 2: admin 画面内の保存→即時反映整合 (ui)

**Problem**: admin 画面で `AttachmentSearchSettings` から URI 保存した直後、同画面の `RebuildWithAttachmentsCheckbox` / `AttachmentExtractionFailures` が SSR hydrated atom を参照しているため次回ナビゲーションまで更新されない。2 つの判定ソース (atom vs SWR config hook) が混在。

**Resolution**: 既存 GROWI の canonical パターン (`useSWRxAppSettings` + `mutate()` in `PageBulkExportSettings`) を踏襲、**scope を分離**。

| Scope | 判定ソース |
|---|---|
| admin 画面内 | `use-attachment-search-config` の SWR (`config.extractorUri` 非空) を sole gate |
| 非 admin (検索 UI、添付モーダル) | 既存の SSR hydrated `isAttachmentFullTextSearchEnabledAtom` + `use-search-attachments-enabled` |

**Applied changes** (attachment-search-ui/design.md):
- Components summary 表の P0 dependency を更新 (`RebuildWithAttachmentsCheckbox` / `AttachmentExtractionFailures` → `use-attachment-search-config`)
- `AttachmentSearchSettings` の save() 内に `mutate()` 呼び出しを明文化
- 新規サブセクション「Admin 画面内の機能ゲート (in-page reactivity)」を追加
- Mermaid 図の admin UI → `UseEnabled` エッジを `UseConfig` に付け替え
- Requirements Traceability 6.3 / 7.2 を更新
- `Open Question #10` を [Resolved] 追加

---

### Issue 3: `score` フィールド欠落 (ui)

**Problem**: 上流 DTO `IAttachmentHit` の `score: number` が `AttachmentHitViewProps` に射影されていない。「最上位 1 件展開」が「配列先頭 = 最上位」の暗黙契約に依存、上流の配列順意味論変更で silent regression。

**Resolution**: `AttachmentHitViewProps` に `readonly score: number` を追加、UI 層で `[...hits].sort((a, b) => b.score - a.score)` してから先頭を展開。配列順非依存。

**Applied changes** (attachment-search-ui/design.md):
- `AttachmentHitViewProps` interface に `readonly score: number` 追加
- `AttachmentSubEntry` / `AttachmentHitCard` の Responsibilities に sort ロジックを明記
- Revalidation Triggers に「上流 `IAttachmentHit.score` の意味論または配列順序意味論の変更」を追加

---

### Issue 4: pageEvent 購読網羅性 (indexing)

**Problem**: `AttachmentGrantSync` が `updateMany` / `syncDescendantsUpdate` のみ購読すると、`delete` / `completelyDelete` / `revert` / `rename` / `duplicate` など他の pageEvent を取りこぼす可能性。権限 snapshot drift による snippet 漏洩リスク。

**Resolution**: **Option D 採用** — 添付 ES doc に権限情報 (`grant` / `granted_users` / `granted_groups` / `creator`) を**一切保存しない**。検索時に ES mget で親 Page の現在の権限を参照して filter する query-time permission lookup 方式。

- Page 権限変更への追従は不要 (常に最新権限を参照)
- pageEvent 購読の網羅性が snippet 漏洩に影響しない (構造的に防止)
- Page 削除は orphan cleanup (rebuildIndex 内) で eventual 整合、real-time cascade 不要
- **核心メリット**: snippet 漏洩が構造的に発生しない

**Applied changes** (attachment-search-indexing/design.md + requirements.md、サブエージェント大規模書き換え):
- `AttachmentGrantSync` コンポーネント完全削除
- ES attachments index mapping から権限系フィールド削除
- 検索クエリを 4-step flow (msearch + missing pageIds lookup + app-side filter) に書き換え
- 新規コンポーネント: `buildAccessiblePageIdLookupQuery`, `AttachmentSearchResultAggregator`, `AttachmentOrphanSweeper`
- Flow 3 (権限変更) を「query-time で自動解決 (コード不要)」に圧縮
- Security Considerations に「snippet 漏洩が構造的に発生しない」を明記
- Requirement 3 タイトルを「添付削除と orphan cleanup (親ページ変更は query-time で自動解決)」に変更

---

### Issue 5: rebuildIndex 中断時の tmp index 掃除 (indexing)

**Problem**: `rebuildIndex` 失敗時の tmp index が累積、shard limit 圧迫のリスク (特に GROWI.cloud 共有 ES)。開始時 cleanup が未定義。

**Resolution**: 既存 Page 側の実装 ([elasticsearch.ts:277,384](apps/app/src/server/service/search-delegator/elasticsearch.ts#L277)) を確認、**累積リスクは当初の誤認**であることを発見。既存 GROWI は `${indexName}-tmp` 固定名 + 開始時 drop & create パターンで冪等化している。本 spec もこれに完全統一。

**Applied changes** (attachment-search-indexing/design.md):
- tmp index 名を `attachments_vN` (version 付き) から **`attachments-tmp` (固定名)** に統一
- `AttachmentReindexBatch` Contracts に「開始時 `client.indices.delete({ index: 'attachments-tmp', ignore_unavailable: true })` で drop → create」を明記
- Logical Data Model / Migration Strategy を更新、累積なしの保証を明文化
- 既存 Page 側パターンへの参照リンク追加

---

### Issue 6: `requiresReindex` 状態遷移 (indexing)

**Problem**: admin config 応答に含める `requiresReindex: boolean` フラグの状態遷移ルール (いつ true / いつ false / どこに persist) が design 未定義。

**Resolution**: **state persist せず count 方式 computed** を採用。

```typescript
// 擬似コード
async function computeRequiresReindex(): Promise<boolean> {
  if (!isAttachmentFullTextSearchEnabled) return false;
  const mongoCount = await Attachment.countDocuments();
  if (mongoCount === 0) return false;
  const esUniqueCount = /* ES cardinality aggregation on attachmentId */;
  return mongoCount > esUniqueCount;
}
```

- **30 秒 TTL in-memory cache** で admin config GET の連打に対応、`PUT config` 成功時に即 invalidate
- Interpretation A (現 design: 全形式で metadata-only doc を作る) 前提、不支援形式も count 対象に含まれるため filter 不要
- **エッジケース挙動テーブル** 9 ケース (機能未有効 / 添付 0 / 初期 migration / rebuild 完了直後 / real-time 成功 / real-time 抽出失敗 / ES 書込失敗 / URI クリア / rebuild window) を design に記載

**Applied changes** (attachment-search-indexing):
- design.md: `AttachmentSearchConfig` DTO の `requiresReindex` を computed 値として明示、算出式とエッジケース表を追加
- requirements.md: Requirement 5.3 を「設定 API 応答に算出値 `requiresReindex` を含める」に書き換え、count 比較 + 30 秒 TTL を規定

---

### Issue 7: OpenAPI drift 検知 (extractor)

**Problem**: `scripts/export_openapi.py` の成果物が commit 必須か build 時生成かが未確定、下流 spec の orval 入力として重要。

**Resolution**: `services/` が pnpm workspace 外であるため pdf-converter の turbo 依存パターン (`@growi/pdf-converter#gen:swagger-spec`) は適用不可。**commit 済み `openapi.json` + 両 CI の `git diff --exit-code` 2 段検知**を採用。

- `packages/markitdown-client/openapi.json`: 上流 Python スクリプトが直接上書き、commit 必須
- Python CI: `export_openapi.py` 実行 + `git diff --exit-code packages/markitdown-client/openapi.json`
- Node CI: orval 実行 + `git diff --exit-code packages/markitdown-client/src/`
- PR レビューで schema 変更が可視化、両 CI の drift 検知で commit し忘れを即 fail

**Applied changes**:
- markitdown-extractor/design.md: API Contract に drift 検知パイプラインを記述、pdf-converter との差異を明記、`Open Question #3` を [Resolved]
- attachment-search-indexing/design.md: File Structure Plan に commit 方針を記述、drift 検知 2 段を明記、`Open Question #1` を [Resolved]

---

### Issue 8: Python CI workflow のゲート条件 (extractor)

**Problem**: `services/` は pnpm/turbo 外で CI workflow が唯一の品質ゲート。jobs と failure gate が design 未確定。image size 目標 / trivy スキャン / Requirement 3.3 (セキュリティハードニング) の CI enforce の有無も不明。

**Resolution**: 必須 jobs をテーブル化、**image size 450MB 上限 / trivy CRITICAL+HIGH で fail** を design レベルで固定。

| Job | コマンド | Gate |
|---|---|---|
| lockfile 整合性 | `uv sync --locked --no-dev` | 齟齬で fail |
| Lint | `uv run ruff check .` | エラーで fail |
| Format | `uv run ruff format --check .` | 崩れで fail |
| Unit tests | `uv run pytest` | 失敗で fail |
| Docker build | `docker build` | 失敗で fail |
| Image size | `docker image inspect`、**>450MB で fail** | 目標 250-400MB + 余裕 50MB |
| Trivy scan | `trivy image --severity CRITICAL,HIGH --exit-code 1` | 検出で fail |
| OpenAPI drift | `git diff --exit-code packages/markitdown-client/openapi.json` | 未 commit で fail |
| Release (main) | `docker push ghcr.io` | main branch push 時のみ |

**Applied changes** (markitdown-extractor/design.md):
- File Structure Plan § CI Workflow セクションを新設、必須 jobs テーブル化
- image size 上限 450MB を design レベルの NFR として固定
- `Open Question #2 / #4` を [Resolved] 化

---

### Issue 9: pdfminer.six フォールバックの feature detection (extractor)

**Problem**: PDF ページ分割のフォールバック切替 (`markitdown` の `extract_pages` 引数サポート有無) の feature detection 具体戦略が design 未確定。minor バージョン更新で挙動が silently 切り替わるリスク。

**Resolution**: **起動時 1 回の capability probe + `/readyz` expose** を固定。

- app factory 内で `inspect.signature(markitdown.MarkItDown().convert_stream).parameters` を検査し `extract_pages` 存在確認
- 結果を `PDF_EXTRACTION_STRATEGY: Literal['markitdown', 'pdfminer_fallback']` として module global cache
- `/readyz` に `pdf_extraction_strategy` を含め運用可視化
- 起動時に INFO ログで採用 strategy を出力
- ランタイム try/except は不採用 (起動時 1 回判定で確定)
- version pin: `markitdown>=0.1.5` (最小)、PR #1263 stable release 後に pin を上げて fallback 削除検討

**Applied changes** (markitdown-extractor/design.md):
- Per-format Extractors § pdf_extractor に Feature detection 戦略を明記
- テストで `MarkItDown` mock による両 strategy 判定の verify 要件追加
- `Open Question #1` を [Resolved] 化

---

## 設計品質の向上

3-way split + 9 Issue 解消を経て:

1. **snippet 漏洩リスクが構造的に消失** (Option D)
2. **既存 GROWI パターンを徹底的に踏襲**: 独自パターン導入ゼロ
   - atom 配置: `~/states/server-configurations/`
   - admin 即時反映: SWR `mutate()`
   - tmp index: `${indexName}-tmp` 固定名
   - 新規言語境界 (Python): pnpm/turbo 外、独立 CI pipeline
3. **drift 検知の明確化**: Python/Node 境界を跨ぐ 2 段 `git diff --exit-code`
4. **全 Open Question が Resolved or documented Risk 化**
