# Mutation Risk Analysis — `GrowiSlides.tsx` の `rendererOptions` 破壊的変更

> 注: spec.json の `language: en` に従い最終的には英訳予定。validation-post-impl.md の P3 項目を深掘りした実装者向け資料。

## 該当コード

[packages/presentation/src/client/components/GrowiSlides.tsx:35-44](packages/presentation/src/client/components/GrowiSlides.tsx#L35-L44):

```tsx
rendererOptions.remarkPlugins.push([
  extractSections.remarkPlugin,
  {
    isDarkMode,
    disableSeparationByHeader,
  },
]);
rendererOptions.components.section = presentation
  ? PresentationRichSlideSection
  : RichSlideSection;
```

これは **render 関数の中で props で受け取ったオブジェクトを破壊的に書き換えている**。React の基本原則違反だが、それだけでなく、この `rendererOptions` の出自がさらに事態を悪化させる。

## 背景: `rendererOptions` の正体

[apps/app/src/stores/renderer.tsx:210-240](apps/app/src/stores/renderer.tsx#L210-L240):

```ts
export const usePresentationViewOptions = () =>
  useSWR(
    ['presentationViewOptions', currentPagePath, rendererConfig],
    async (...) => generatePresentationViewOptions(...)
  );
```

- **SWR は同じキーに対して同じオブジェクト参照を返す** (キャッシュが invalidate されるまで)
- そのオブジェクトは [SlideRenderer.tsx](apps/app/src/client/components/Page/SlideRenderer.tsx) と [PagePresentationModal.tsx](apps/app/src/client/components/PagePresentationModal/PagePresentationModal.tsx) の**両方**から参照される
- つまり `rendererOptions` は **GrowiSlides の所有物ではない**。アプリ全体で共有されるシングルトン的なリソースである

この前提で、ミューテーションが引き起こす問題を具体的にみていく。

---

## バグシナリオ

### バグ 1: 再レンダごとの `remarkPlugin` 多重積み

GrowiSlides は何らかのきっかけで再レンダされる (親が再レンダ、props 変更、isDarkMode 変更、etc.)。

```
初回 render:    remarkPlugins = [..., extractSections] (1個)
2 回目 render:  remarkPlugins = [..., extractSections, extractSections] (2個)
3 回目 render:  remarkPlugins = [..., extractSections, extractSections, extractSections] (3個)
...
N 回目:        N 個積まれる
```

`extractSections.remarkPlugin` は名前のとおり markdown AST から `<section>` を抽出する変換プラグイン。これが **N 回連続で同じ AST に適用される**。結果として:

- セクション分割が二重・三重に行われる (`<section>` の中にさらに `<section>` が入る等)
- 描画速度が再レンダごとに線形劣化する
- React DevTools で「数回操作したらスライドの構造が壊れる」現象が起きうる

**実害が小さく見える理由**: 多くの場合 GrowiSlides はマウント直後に SWR データが落ち着いて再レンダが止まる短いライフサイクルしかない。だが下記 2/3 と組み合わさると顕在化する。

### バグ 2: 他コンポーネントへの漏れ出し (共有参照汚染)

SWR が同じオブジェクトを `PagePresentationModal` にも返す。つまり:

```
[ユーザー操作]                          [rendererOptions の中身]
1. /Sandbox/foo (普通のページ)          remarkPlugins = [...default]
2. プレゼンモーダルを開く               PagePresentationModal が <Presentation> 経由で
                                       GrowiSlides を render
                                       → push! remarkPlugins = [...default, extractSections]
3. モーダル閉じる                      remarkPlugins = [...default, extractSections]
                                       (元に戻らない)
4. SWR キャッシュは生きてる             同じオブジェクトに extractSections が残ったまま
5. もう一度モーダルを開く               → push! [...default, extractSections, extractSections]
```

**深刻な側面**: GrowiSlides は自分が render されるたびに「他コンポーネントが使っているオブジェクト」を変更してしまう。`PagePresentationModal` の閉じる/開くを繰り返すと remarkPlugins がどんどん肥大化する。

さらに **`components.section` の書き換え** も同様:

```ts
rendererOptions.components.section = presentation
  ? PresentationRichSlideSection
  : RichSlideSection;
```

`<Slides presentation>` で開いた後にどこかで `<Slides>` (`presentation` 無し) が render されると、`section` が `RichSlideSection` に変わる。逆も同様。**どちらが「最後に書いた者」かで挙動が変わる** = 順序依存の非決定性が混入する。

### バグ 3: `isDarkMode` トグル時の古いオプション残留

`extractSections.remarkPlugin` は **オプション付きで** push される:

```ts
remarkPlugins.push([extractSections.remarkPlugin, { isDarkMode, disableSeparationByHeader }]);
```

このタプルは「**push した時点の** `isDarkMode` の値を捕獲」する。後で再 push されたタプルは新しい値を持つが、**前のタプルは消えない**。

```
ライト時 render:  push([plugin, { isDarkMode: false }])
ユーザがダークに切替 → 再 render
ダーク時 render:  push([plugin, { isDarkMode: false }, [plugin, { isDarkMode: true }])
                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                  古いタプルが残存
```

ReactMarkdown はこれら全部を順に実行する。`extractSections` プラグインが darkmode 別に分岐していると **2 回別々のテーマで分割される** → 結果不定 (どちらが「勝つ」かはプラグインの実装次第)。

### バグ 4: React StrictMode の二重 render で症状倍速化

開発時 (`React.StrictMode` 有効) は **意図的に render を 2 回呼ぶ** ことで副作用の純粋性を検査する。今回のコードは render 内に副作用 (push, 代入) があるため、StrictMode 環境では **1 回のマウントで 2 回 push される**。本番より早く症状が顕在化するか、逆に「dev で挙動が違う」謎現象として報告される可能性がある。

### バグ 5: Concurrent Rendering / Suspense との衝突

React 18+ の concurrent rendering では render 関数が **中断・再開される** ことがある。中断された render でも push は実行済みになり、再開された render でもう一度 push される。React の前提 (「render は純粋であるべき」) が破られているので、Concurrent 機能を使う将来の最適化と相性が悪い。

### バグ 6: `688c260d91` の遠因にもなりうる

ミューテーション前提のコードは、見る人に「`rendererOptions` は書き換えてよい (= 自分のもの) 」という誤解を与える。これは型シグネチャの「必須」と相まって、`rendererOptions == null` ガードが「死んでる」ように見える要因の一つ。実際 [GrowiSlides.tsx:31](packages/presentation/src/client/components/GrowiSlides.tsx#L31) の biome-ignore コメント変遷:

- 旧: `"This is for type checking only. The actual code will never reach here."`
- 新: `"early return when rendererOptions is null"`

ここで「rendererOptions は必須 = 書き換えてもよい」という認知バイアスが、ガード除去という別判断を後押しした構造的問題が見える。

---

## なぜ「いまのところ動いているように見える」のか

実害が出にくいタイミング:

- **マウント直後の SWR data 確定タイミング**: 大抵 1〜2 回の render で安定。N=2 程度ならプラグインの冪等性で気付かれない。
- **`extractSections.remarkPlugin` の冪等性**: もし二回実行しても結果が同じ AST に収束する実装になっていれば症状が見えない (が、保証されているとは限らない)。
- **SWR キャッシュの寿命**: ページ遷移などでキャッシュが破棄されれば一旦リセットされる。

逆に **顕在化条件**:

- スライドページにいる間にテーマ切替を繰り返す
- プレゼンモーダルを開閉する
- 同一ページ内で `<Slides>` が複数マウントされる (将来追加された場合)
- React StrictMode を本番でも有効化する
- Suspense / Concurrent 機能を本格的に使う

---

## 推奨される修正

```tsx
// useMemo で新オブジェクトを派生させる
const slideRendererOptions = useMemo(() => {
  if (rendererOptions == null) return null;
  return {
    ...rendererOptions,
    remarkPlugins: [
      ...(rendererOptions.remarkPlugins ?? []),
      [extractSections.remarkPlugin, { isDarkMode, disableSeparationByHeader }],
    ],
    components: {
      ...rendererOptions.components,
      section: presentation ? PresentationRichSlideSection : RichSlideSection,
    },
  };
}, [rendererOptions, isDarkMode, disableSeparationByHeader, presentation]);

if (slideRendererOptions == null) return <></>;

return (
  <>
    <Head><style>{css}</style></Head>
    <div className={`slides ${MARP_CONTAINER_CLASS_NAME}`}>
      <ReactMarkdown {...slideRendererOptions}>
        {children ?? '## No Contents'}
      </ReactMarkdown>
    </div>
  </>
);
```

ポイント:

- **新オブジェクト**を作って `ReactMarkdown` に渡す → 元の SWR キャッシュは無傷
- **`useMemo` の依存配列**で再計算条件を明示 → 同じ入力なら同じ出力 (純粋性回復)
- **テーマ切替時は新しい派生オブジェクトに丸ごと切り替わる** → 古い `{ isDarkMode: false }` タプルは消える

---

## まとめ

| 観点 | 現状 | 影響 |
|---|---|---|
| 純粋性 | render 内で副作用 | StrictMode / Concurrent と非互換 |
| 所有権 | 共有参照を改変 | 他コンポーネントへ漏れ出し |
| 蓄積 | 再 render ごとに push | プラグイン多重実行、性能劣化 |
| 状態管理 | 古いオプションが残る | テーマ切替で結果が不定 |
| 認知 | 「書き換えてよい」誤認 | 型ガード除去の遠因 |

要するに、**「動いているように見える」のは SWR の再フェッチが頻発しないことと extractSections の冪等性に暗黙に依存している** だけで、その依存が破れる条件は将来増える一方 (Concurrent, StrictMode 本番化, 機能追加で同一ページ上に複数の `<Slides>`、etc.)。今回の rendererOptions null バグと同様、「型/コード上は動くから問題なさそう」という外観の裏で、実は条件が揃うと爆発する地雷を内蔵している、というのが「バグの温床」と表現した理由。

---

## Cross-Reference

- 親レポート: [validation-post-impl.md](./validation-post-impl.md) — Section "Remediation" の P3 を本書で詳細化
- 関連コード:
  - [packages/presentation/src/client/components/GrowiSlides.tsx](packages/presentation/src/client/components/GrowiSlides.tsx)
  - [packages/presentation/src/client/consts/index.ts](packages/presentation/src/client/consts/index.ts) (型シグネチャ)
  - [apps/app/src/stores/renderer.tsx](apps/app/src/stores/renderer.tsx) (SWR キャッシュ供給元)
  - [apps/app/src/client/components/Page/SlideRenderer.tsx](apps/app/src/client/components/Page/SlideRenderer.tsx) (呼び出し側)
  - [apps/app/src/client/components/PagePresentationModal/PagePresentationModal.tsx](apps/app/src/client/components/PagePresentationModal/PagePresentationModal.tsx) (もう一方の呼び出し側 — 共有参照の漏れ出し先)
- 関連 .claude rules:
  - `.claude/rules/coding-style.md` — "Immutability (CRITICAL)" セクション
