# Post-Implementation Validation — Regression and Boundary Review

> 注: spec.json の `language: en` に従い最終的には英訳予定。現状は実装者へのフィードバック材料としての日本語ドラフト。

## Context

- **対象 spec**: presentation (`phase: implementation-complete`, `cleanup_completed: true`, 完了日 2026-03-23)
- **きっかけ**: PR #11110 (Redmine #183154) — `slide: true` フロントマター付きページがクラッシュする回帰
- **回帰発生コミット**: `688c260d91` "fix type cheking" (2026-04-15) — spec 完了**後**
- **回帰修正コミット**: `6988253b93` "restore null guard for rendererOptions in GrowiSlides"
- **スコープ**: spec 完了後に発覚した境界違反 (Boundary Violation) を整理し、再発防止のための残課題を実装者に引き渡す

## Decision: **NO-GO (boundary integrity)**

PR #11110 のクラッシュ修正そのものは正しいが、回帰を許した構造的問題が複数残っており、同じ削除判断が将来再び行われ得る。spec の "Functional Equivalence" (要件 3) が、SWR ローディング状態という非機能経路で破綻していた事実を踏まえ、以下の追加対応を完了するまで「presentation feature は安定」とは言えない。

## Mechanical Results

| 項目 | 結果 |
|---|---|
| PR #11110 の新規ユニットテスト | ✅ PASS (`pnpm vitest run GrowiSlides.spec` — 3/3) |
| TBD/TODO/FIXME (feature 境界内) | ✅ CLEAN |
| Secret grep | ✅ CLEAN |
| Smoke boot | ⚠️ MANUAL_REQUIRED (`slide: true` 経路を実ブラウザで確認する自動テストが存在しない) |

## 回帰の構造

### 発生経路

1. **#10152 (2024)**: `useRendererConfig()` 呼び忘れで `rendererOptions == null` になる事故への対策として、[PagePresentationModal](apps/app/src/client/components/PagePresentationModal/PagePresentationModal.tsx) に `<RendererErrorMessage />` ガードを追加。**ただしモーダル経路のみ**。`SlideRenderer.tsx` (インライン `slide: true` 経路) は対象外。
2. **当 spec の本実装**: `GrowiSlides.tsx` に最後の砦として `rendererOptions == null || ...` ガードが存在していた。これは SWR ローディング中の `undefined` を吸収する役目も果たしていた (副次的に)。
3. **`688c260d91`**: 型定義 `PresentationOptions.rendererOptions: ReactMarkdownOptions` が必須を主張していたため、`rendererOptions == null` は「型上到達不能」と判断されガードを除去。biome-ignore コメントも "The actual code will never reach here." となっていた。
4. **クラッシュ顕在化**: `SlideRenderer.tsx` で `usePresentationViewOptions()` から得た `undefined` を `as ReactMarkdownOptions` でキャストし `<Slides>` に渡しているため、SWR データ取得完了前に `undefined.remarkPlugins` でクラッシュ。

### 根本原因 (4 重の安全網がすべて欠けていた)

| 防御層 | 状態 | 問題 |
|---|---|---|
| 型シグネチャ | ❌ | `consts/index.ts:7` で `rendererOptions: ReactMarkdownOptions` (必須)。実態は SWR ローディング中 `undefined` |
| 呼び出し側ガード | ❌ | `SlideRenderer.tsx:21` で `as ReactMarkdownOptions` キャストにより型情報を上書き |
| コンポーネント内ガード | ⚠️ → ✅ | PR #11110 で復元済み |
| E2E / Playwright | ❌ | `presentation.spec.ts` はモーダル経路のみ。`slide: true` ページの SWR ローディング経路は未カバー |

## Boundary Audit

### B1. Type/Runtime 乖離 (Boundary Commitment 違反)

**Design 3.3 (`PresentationOptions`)** で `rendererOptions: ReactMarkdownOptions` を必須として宣言しているが、呼び出し側 (`apps/app`) では SWR の loading 状態で `undefined` を渡している。境界仕様と実呼び出しが食い違っており、これが `688c260d91` の誤判断を生んだ。

**Owner**: presentation package (型シグネチャの責務)

### B2. 非対称な防御 (Cross-Task Integration)

`PagePresentationModal` 経路だけが `{!isLoading && rendererOptions == null && <RendererErrorMessage />}` のガードを持ち、`SlideRenderer` 経路は無防備。両方とも `usePresentationViewOptions()` を呼ぶ同型のクライアントだが、ローディングへの構えが揃っていない。

**Owner**: apps/app (呼び出し側 — spec 範囲外だが本 feature の安定動作を成立させるために必須)

### B3. 不変性違反 (PR 範囲外, ただし要追跡)

[GrowiSlides.tsx:35-44](packages/presentation/src/client/components/GrowiSlides.tsx#L35-L44):

```ts
rendererOptions.remarkPlugins.push([extractSections.remarkPlugin, ...]);
rendererOptions.components.section = presentation ? ... : ...;
```

`.claude/rules/coding-style.md` の immutability ルール違反。再レンダ毎に `remarkPlugin` が push され続けるはず。今回の PR スコープ外だが、`rendererOptions` を共有参照として外部から渡している以上、本来は新オブジェクトを作るべき。

**Owner**: presentation package

## Coverage Gaps

| 要件 | カバレッジ |
|---|---|
| Req 1. Module Separation | ✅ (vite build で確認可能) |
| Req 2. Build-Time CSS Extraction | ✅ |
| Req 3. **Functional Equivalence** | ⚠️ **`slide: true` 経路のローディング時挙動が非テスト**。PR #11110 のユニットテストで一部緩和されたが、E2E は依然欠落 |
| Req 4. Build Integrity | ✅ |

## Test Gaps

### PR #11110 のユニットテストの限界

- 検証しているのは「`rendererOptions` が null/undefined の時に throw しない」のみ
- 正常系 (rendererOptions が完備されたとき正しくレンダされる) は未検証 → ガード分岐の `||` を 1 つ削除してもテストは全 green のままになる可能性
- mock が重い (`next/head`, `marpit-base-css.vendor-styles.prebuilt`, `extract-sections`, `RichSlideSection` を全部 mock) ため、実際のレンダパスのバグは捕まらない

### Playwright 不足

実装者レポートでは「スライドモードのテストには専用ページのテストデータが必要なため Playwright での追加は断念」とあるが、既存の [`saving.spec.ts`](apps/app/playwright/23-editor/saving.spec.ts) が「ページ作成 → エディタで内容入力 → 保存 → ビューで確認」のパターンを既に確立しており、これを使えば実装可能。

#### 推奨される Playwright シナリオ

```ts
// apps/app/playwright/20-basic-features/presentation.spec.ts に追加

test('Slide page (slide: true frontmatter) renders without crashing', async ({ page }) => {
  await page.goto('/Sandbox/slide-test');

  // 1) エディタで slide: true フロントマター入りの内容を保存
  await page.getByTestId('editor-button').click();
  await expect(page.getByTestId('grw-editor-navbar-bottom')).toBeVisible();
  await appendTextToEditorUntilContains(page,
    '---\nslide: true\n---\n# Slide 1\n---\n# Slide 2'
  );
  await page.keyboard.press('Control+s');

  // 2) ビュー → スライドが見えること
  await page.getByTestId('view-button').click();
  await expect(page.locator('.marpit')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Slide 1' })).toBeVisible();

  // 3) リロード → SWR ローディング経路を踏ませてクラッシュしないこと
  await page.reload();
  await expect(page.locator('.marpit')).toBeVisible();
});
```

**ポイント**: 3 のリロード後検証が今回のバグの本丸 (SWR loading 中の `undefined` 通過) を再現する。PR #11110 のユニットテストでは到達しない実ブラウザ経路。

## Remediation (実装者向けフィードバック)

優先度順:

### P0 — 型と実態を揃える (再発の唯一の本質的予防)

[packages/presentation/src/client/consts/index.ts:7](packages/presentation/src/client/consts/index.ts#L7) の `rendererOptions` を optional に変更:

```ts
export type PresentationOptions = {
  rendererOptions?: ReactMarkdownOptions;  // undefined を型レベルで認める
  // ...
};
```

その上で:
- [apps/app SlideRenderer.tsx:21](apps/app/src/client/components/Page/SlideRenderer.tsx#L21) の `as ReactMarkdownOptions` キャストを削除
- [PagePresentationModal.tsx](apps/app/src/client/components/PagePresentationModal/PagePresentationModal.tsx) の `as ReactMarkdownOptions` も同様に削除し、既存の null チェックに型を従わせる
- `GrowiSlides.spec.tsx` の `undefined as any` / `null as any` も `undefined` だけで通るようになり、テストの本気度が上がる

これで `688c260d91` のような「型上不要だから削除」判断が型エラーで止まる。

### P1 — Playwright で `slide: true` 経路のスモークを追加

上記シナリオを `presentation.spec.ts` に追記。とくに **reload 後の表示確認** を必ず含める (SWR loading 経路のため)。

### P2 — ユニットテストに正常系を追加

`GrowiSlides.spec.tsx` に「`rendererOptions` が完備された時に `<ReactMarkdown>` が呼ばれる」ケースを追加。これがないとガード条件式自体の改悪を検知できない。

### P3 — Immutability 違反の修正 (別 issue 推奨)

[GrowiSlides.tsx:35-44](packages/presentation/src/client/components/GrowiSlides.tsx#L35-L44) のミューテーションを `useMemo` などで新オブジェクト生成に置き換え。本 PR スコープ外だが、`rendererOptions` を共有参照として扱う前提の以上、bug の温床。

## Revalidation Triggers (再発火条件)

以下が起きたら本検証を再実行:

- `PresentationOptions` の型変更
- `usePresentationViewOptions` の loading 制御変更
- `GrowiSlides` / `SlideRenderer` / `PagePresentationModal` のいずれかの null ガード除去
- `@growi/presentation` 内の `as` キャスト追加
- Marp ライブラリのメジャー更新 (CSS 再生成と合わせて)

## Summary Table

| Dim | Status | Owner |
|---|---|---|
| Tests (current PR) | PASS | LOCAL |
| Smoke boot for `slide: true` | MANUAL_REQUIRED | LOCAL + UPSTREAM (apps/app Playwright) |
| Cross-task contracts (type vs runtime) | VIOLATION | LOCAL (presentation package) |
| Shared state consistency (`rendererOptions` undefined handling) | INCONSISTENT | UPSTREAM (apps/app — `SlideRenderer` vs `PagePresentationModal`) |
| Boundary audit | 3 violations (B1/B2/B3) | Mixed |
| Requirements 1, 2, 4 | COVERED | — |
| Requirement 3 (Functional Equivalence) | PARTIAL — SWR loading path not covered | LOCAL + UPSTREAM |
| Architecture drift from design.md | None (component graph intact) | — |
| Dependency direction | OK | — |
| **OVERALL OWNERSHIP** | **LOCAL + UPSTREAM** | spec の境界仕様 (型) を LOCAL で締め、apps/app 側 (UPSTREAM) で呼び出し対称性と E2E を補強 |

## Notes

- spec.json の `phase` は `implementation-complete` のままにする (本検証は事後フィードバックであり、再 cleanup の対象)。
- 上記 P0/P1/P2/P3 をフォロー issue 化してから、最終 cleanup でこのファイルを英訳・要点化して `research.md` に追補するか `design.md` の "Risks & Mitigations" に統合するのが良い。
- 履歴参照: PR #10152 (Redmine #153963, 2024) — 本件と同根の `rendererOptions == null` 問題に対するモーダル経路だけの対策。当時ユニットテストは付かなかった。今回 spec 完了後の `688c260d91` がガードを消した時、この 2024 年の知見が ADR / spec / コメントに残っていなかったため再発を許した。
