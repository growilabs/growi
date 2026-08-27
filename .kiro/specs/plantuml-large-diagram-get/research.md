# Gap Analysis — plantuml-large-diagram-get

対象要件: `.kiro/specs/plantuml-large-diagram-get/requirements.md`（Req 1〜8）
調査日: 2026-08-13 / 対象: 8.0.x ライン / 範囲: GET経路（テーマ軽量化＋上限超過時のエラー表示）

## 1. 現状（既存実装の把握）

- **テーマ付加**: [plantuml.ts](../../../apps/app/src/features/plantuml/services/plantuml.ts) の remark プラグイン。`node.value = \`${themeStyles}\n${node.value}\``（:29）で各図の先頭にテーマを前置 → `@akebifiky/remark-simple-plantuml` が `image` ノード化（`node.url = <baseUrl>/svg/<deflate+base64>`）→ 2nd visit（:39-66）で `const src = node.url`（:50）を `hProperties.src` に載せ替え、`hName: 'plantuml'` 要素を生成。`sanitizeOption` が `src` を許可（:70-75）。`plantumlUri.length === 0` で早期 return（:43）。
- **テーマ資産**: `themes/carbon-gray-{light,dark,common}.puml.ts` は**素のTSモジュールで文字列を default export**（common:702 で `export default style`）。light/dark は `import commonStyles from './carbon-gray-common.puml'` して `${commonStyles}` を内挿。plantuml.ts の import は拡張子なし（`'../themes/carbon-gray-dark.puml'`）で**特別なローダは無し**（`.puml.ts` へ通常のTS解決）。
- **表示**: [PlantUmlViewer.tsx](../../../apps/app/src/features/plantuml/components/PlantUmlViewer.tsx)（32行）。props は **`src: string` のみ**。`<div ref=containerRef {GROWI_IS_CONTENT_RENDERING_ATTR:'true'}><img src onLoad onError /></div>`。`onLoad`/`onError` は**同じ `handleLoaded`** に集約し、status属性を `'false'` にするだけ（成功/失敗を区別していない）。logger 未使用。
- **renderer 配線**: [renderer.tsx](../../../apps/app/src/client/services/renderer/renderer.tsx) が `components.plantuml = PlantUmlViewer`（:141/290/425）。`hProperties.src` が `src` prop になる。
- **i18n**: `apps/app/public/static/locales/{en_US,ja_JP,fr_FR,ko_KR,zh_CN}/translation.json`（各フラットJSON）。コンポーネントは `next-i18next` の `useTranslation()`→`t('key')`（例 `ReactMarkdownComponents/DrawioViewerWithEditButton.tsx`）。
- **類似の失敗ハンドリング**: [MermaidViewer.tsx](../../../apps/app/src/features/mermaid/components/MermaidViewer.tsx) が `try/catch`→`logger.error`（`loggerFactory('growi:features:mermaid:MermaidViewer')`）＋ status属性を `'false'`。**console警告＋status遷移の手本**。ただし**画面上のエラーUIは既存に無し**（インライン・エラー表示コンポーネントは新規）。

## 2. 要件 → 資産マップ（ギャップ）

| Req | 必要な要素 | 既存資産 | ギャップ |
|---|---|---|---|
| 1 テーマ軽量化 | テーマ文字列を小さくする | `themes/*.puml.ts`（素の文字列。common 12.8KB が主。`<style>` beta図ブロック :446-698、各 skinparam sub、light/dark の未使用パレット） | **Low（編集で可）** ＋ 削減量は設計/実測で決定 |
| 2 ダークモード維持 | ダーク配色を残す | light/dark のパレット値がダークの実体 | Low（パレットは残し、per要素/beta図ブロックを削る） |
| 3 図種別CSSなし | 単一静的テーマ | 現状も単一テーマ | Low（切替を入れないだけ） |
| 4 後方互換 | 描画挙動不変 | GET経路そのまま | Low |
| 5 効果を実測 | 前後のURL長を測定 | `node.url.length`/`src.length` が即URL長 | Low（測るだけ。基準図で検証） |
| 6 失敗検知（onError主＋閾値保険） | onError分離＋src長チェック | `onError` は現状 `handleLoaded` に集約 | **Missing**（onError分離・エラーstate・閾値判定） |
| 7 エラー表示＋console＋i18n | プレースホルダUI＋logger＋訳文 | Mermaidのlogger手本／i18n追加パターン／**エラーUIは新規** | **Missing**（UI新規、logger追加、5ロケール追加） |
| 8 閾値（固定・安全側） | 固定定数 | 定数置き場（`features/plantuml` 配下に新設） | Low（定数追加） |

## 3. 実装アプローチ（Extend で完結）

すべて既存の `features/plantuml` 拡張で収まる。新アーキテクチャ不要。

- **テーマ軽量化**: `carbon-gray-common.puml.ts` の**巨大 `<style>` beta図ブロック（:446-698: mindmap/gantt/json/timing/wbs/yaml…）を削除**が最も効く塊。加えて light/dark の**未使用パレット階調**、重複 `$primary_scheme()` sub-block を整理。ダーク配色（背景/文字/線/主要要素）は残す。**前置は文字列そのままなので、削った分だけURLが縮む**。
- **URL長判定（Req 6.2/8）**: `PlantUmlViewer` 内で `src.length > 固定閾値` を判定（再エンコード不要）。閾値は共有定数（`features/plantuml/interfaces` 等）に安全側の高め値で定義。
- **失敗検知（Req 6.1）**: `PlantUmlViewer` の `onError` を `handleLoaded` から分離し、`useState` でエラーフラグ→**プレースホルダUI**を描画。**成功/失敗どちらでも `GROWI_IS_CONTENT_RENDERING_ATTR` は `'false'` に遷移**（auto-scroll依存を壊さない）。
- **エラーUI＋console（Req 7）**: 新規プレースホルダ（`t('...')` メッセージ＋対処）。`PlantUmlViewer` に `next-i18next` と `loggerFactory`（Mermaid手本）を追加。
- **i18n（Req 7.5）**: 5ロケールの `translation.json` に新キー追加。

## 4. 複雑度・リスク

- **Effort: S〜M（2〜4日）** — 個々は小（文字列編集・src長判定・onError分離・i18n）。ただし**テーマ削減は「削る→実測→ダーク目視」を数回反復**するため、その iteration が主コスト。
- **Risk: Low〜Medium** — 未知技術なし。要注意は (a) **どこまで削ればURLが十分縮むか（基準図での実測必須）**、(b) **削減後のダーク/ライト目視回帰**、(c) エラーUIのstatus属性遷移漏れ（auto-scroll退行）。

## 5. Research Needed（設計フェーズへ）

1. **テーマ削減スコープの確定＋実測**: 「`<style>` beta図ブロック削除／未使用パレット削除／sub-block共通化」を段階適用し、**基準図（今回の問い合わせ図）のエンコード後URL長**を都度測る。目標: 主要サーバ上限（〜6,000〜8,000字）に収まるか。収まらない残余は C(本spec のエラー表示)＋B(POST) が受け皿。
2. **固定閾値の値**: 誤検知を避ける**安全側（高め）**の1値。onError（Req 6.1）が真の判定なので攻めない。ブラウザ/中間装置の一般上限を根拠に決定。
3. **エラーメッセージ文言＋5ロケール訳**（en/ja/fr/ko/zh）。対処は**汎用（図の分割・簡略化）のみ**。POST/自前サーバの推奨は本specに含めず別spec `plantuml-post-optin`（Req 11）へ移管済み（requirements.md 7.2 / design.md / tasks.md 1.2 と整合）。
4. **ダーク/ライト目視回帰の確認手順**（削減後に主要図種で崩れないか）。
5. **PlantUmlViewer 改修点**: onError分離、error state、プレースホルダ、logger追加、status属性の両分岐遷移。
6. **テスト**: `plantuml.spec.ts`（軽量化後テーマ内容・URL/ソース長）、`PlantUmlViewer.spec.tsx`（src長超過→UI、onError→UI、status属性、i18nは `useTranslation` モック）。`PageContentRenderer.spec.tsx:44` の `plantumlUri:''` 早期returnにも留意。
7. **Changeset**: GROWI本体の機能追加として要否確認。

## 6. 既存テスト参照先
- `features/plantuml/services/plantuml.spec.ts`（remark unit、`@akebifiky/...` no-op mock、light/dark の `it.each`）
- `features/plantuml/components/PlantUmlViewer.spec.tsx`（RTL、`fireEvent.load/error`、status属性・`img.src`）
- i18n手本: `ReactMarkdownComponents/DrawioViewerWithEditButton.tsx`（`useTranslation`/`t`）
- console/status手本: `features/mermaid/components/MermaidViewer.tsx`（logger＋status遷移）

---

# 追補ギャップ（設計反映後 / 2026-08-13）: テーマ削減の正確な削除範囲

design レビューの Issue 1（sequence退行）を受け、`carbon-gray-common.puml.ts` の `<style>` ブロック（`useBetaStyle`, :442-698）内の各図種サブブロックを**UML/非UMLで精密分類**した。**UML図種のルールは残し、真の非UML系のみ削除**する。

## `<style>` 内サブブロック分類（行は現行ファイル基準）

| サブブロック | 行 | 分類 | 方針 |
|---|---|---|---|
| `sequenceDiagram` | 452-458 | **UML** | **残す**（参加者間隔＝ParticipantPadding代替。削除で退行） |
| `boardDiagram` | 459-477 | 非UML | 削除 |
| `ganttDiagram` | 479-542 | 非UML | 削除 |
| `jsonDiagram` | 544-574 | 非UML | 削除 |
| `mindmapDiagram` | 576-596 | 非UML | 削除 |
| `saltDiagram` | 599-606 | 非UML | 削除 |
| `timingDiagram` | 608-627 | **UML** | **残す推奨**（timing はUML図。稀だが退行回避のため既定で残す。削るなら明示決定） |
| `wbsDiagram` | 629-661 | 非UML | 削除 |
| `wireDiagram` | 664-665 | 非UML（空） | 削除 |
| `yamlDiagram` | 667-696 | 非UML | 削除 |

- `skinparam useBetaStyle true`(:442) と `<style>`/`</style>` の枠、`sequenceDiagram`（＋timing）ルールは**維持**。削除の主対象は board/gantt/json/mindmap/salt/wbs/wire/yaml（`<style>` の大半の行）。
- **注意（追加の落とし穴）**: design は削除リストに `timing` を含めていたが、**timing はUML** なので既定で残す方針に補正（design側の記述も要整合）。

## パレット削減は「残した内容の参照」に依存
- `light/dark` の未使用パレット削減は、**`<style>`削除後に実際に参照される変数のみ残す**手順で行う。例: `timingDiagram` を残すと `$RED_80`(:623 constraintArrow) が必要。`ganttDiagram` を削ると `$RED_20`(:539 closed) は不要化。→ **style削除 → 参照 grep → 未参照パレット削除**の順。
- 実装タスクで「削除後に未定義変数参照が出ないこと（PlantUMLエラーなし）」を確認する。

## POST推奨メッセージは本specの対象外（確認）
- design/requirements の修正で、**画面の汎用エラーは本spec**、**POST推奨メッセージは別spec `plantuml-post-optin`（Req 11）** に移管済み。→ 本specにPOST関連のコード/文言ギャップは無い。

## 影響（design整合）
- design.md の削除リスト記述から `timing` を除外（UMLとして残す）＋「パレットは参照確認後に削除」を明記すると、tasks がより安全・具体化する。要 design 微修正 or tasks 側で明記。
