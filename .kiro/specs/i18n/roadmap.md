# i18n Sub-spec Roadmap

> 本ファイルは umbrella spec `i18n` 内の sub-spec 進行管理。リポジトリ全体の roadmap は `.kiro/steering/roadmap.md` を参照すること。

## Overview

`apps/app` の多言語化アーキテクチャの改善。2026-08-06 の discovery で、次の 4 課題を起点に分解した。

1. i18n の JSON が効率的に読み込まれていない。`translation.json` が肥大化し、メンテもしにくく、画面ごとに適切な範囲だけを読み込む形になっていない
2. コミュニティのユーザーが翻訳に貢献しにくい
3. 使われていないキーが分からず、`en_US` を基準にした他言語の欠損キーも分からない
4. tsx に書いたキーの typo を検出できていない

このうち 2・3・4 は境界がはっきりしているので sub-spec に落ちた。1 は「どのライブラリの上で解くか」がまだ決まっていないため、**未決の論点として本ロードマップが保持する**（後述）。

## 前提の訂正（discovery の実測）

着手前の認識は「`translation.json` 1 本が肥大している」だったが、実測すると locale は既に 3 namespace に分割済みだった（en_US で `admin` 1,166 キー / `translation` 830 / `commons` 182、計 2,169）。実際の問題は**分け方が機能していないこと**である。

- `translation.json` の最上位 248 キーのうち 177 個が英文そのままのキー（`"Help"`, `"Edit"` 等）で、汎用の置き場になっている
- `useTranslation()` 359 件のうち 232 件（65%）が namespace を指定せず既定の `translation` に依存
- i18n 関連のスクリプト・lint ルール・CI ステップは一切存在しない
- `t()` 2,179 件のうち 50 件が真に動的なキーで、静的解析だけでは網羅できない（当初 162 件と数えたが、テンプレートリテラル 193 件のうち 166 件はローカル定数の畳み込みで静的に解決できた。典型は `DecorationTab.tsx` の `const i18nKey = 'editor_guide.decoration'` で、構文上だけ動的だった）

SSR ペイロード肥大（`/me/*` で 513 KB、`/admin/{app,ai,vault}` で 347 KB）の主犯も namespace の粒度ではなく `preloadAllLang: true` フラグ 5 箇所だった。詳細は「直接実装」を参照。

## Approach Decision

- **Chosen**: 「検出」「貢献」「配信」の 3 つの関心で切る。検出（CI ゲート）と貢献（TMS）はライブラリ選択に依存しないので先に独立 sub-spec として進め、配信（翻訳ファイルの構成をどう整理するか）はライブラリ選択と不可分なので未決のまま umbrella が保持する。
- **Why**: 4 課題のうち 3 つは既存ライブラリ＋設定だけで解ける。それらを「配信の設計が決まるまで」待たせる理由が無い。一方で配信だけは、i18next の namespace を切り直すのか、コンパイラ方式へ移行して namespace 概念ごと無くすのかで作業内容がまるごと変わるため、先に決め打つと call site を 2 度触る無駄が出る。
- **Rejected alternatives**:
  - 4 課題を 1 spec にまとめる案: 20+ タスクになり、かつライブラリ選択という未決事項に全体が人質に取られる。
  - namespace 再編を先に独立 spec として起票する案: 最も工数が重い箱を、ライブラリ選択が未決のまま着手することになる。
  - 配信の設計を先に決めてから全体に着手する案: 判断材料（ドリフトや未使用キーの実態）が揃っていない段階で最も重い決定を下すことになる。CI ゲートを先に入れればその材料が数字で得られる。

## Scope

- **In**:
  - 未使用キー / 言語間の欠損 / 存在しないキー参照の CI ゲート化 — `i18n-key-audit`
  - discovery で見つかった実バグ 2 件の修正 — `i18n-key-audit`
  - POEditor を受け皿にしたコミュニティ翻訳の導線と同期経路 — `i18n-community-translation`
  - `preloadAllLang` の是正 — 直接実装（spec なし）
  - 翻訳ファイル構成の整理をどの方式で行うかの判断 — 本ロードマップが保持（未決）

- **Out**:
  - `apps/app/resource/locales/` 配下（`welcome.md` / `sandbox*.md` / ejs のメールテンプレート、5 言語 × 各 6 ファイル以上）。i18next の管理外で別系統
  - 翻訳そのものを埋める作業
  - キーの型付けによる compile-time 検証（下記「決定事項」で CI 検出のみと決定済み）

## Constraints

- `packages/editor` は locale ファイルを持たず、`toolbar.*` 16 キーを `apps/app` の `translation.json` に依存している。翻訳ファイルの構成を変える場合は連動しないとエディタのツールバーが壊れる
- GROWI はオンプレミスで自己ホストされる製品なので、翻訳の**実行時に外部サービスへ取りに行く構成は採れない**。TMS はオーサリングと同期に限定し、JSON は git にコミットし続ける
- GROWI は Turbopack を dev / prod 両方で使う（`tech.md` の Bundler Strategy）。bundler プラグインを要求する i18n ライブラリはこの方針と衝突しうる
- GROWI のロケールは URL ではなく MongoDB のユーザーレコード由来（`user.lang` → `app:globalLang` → `Accept-Language`）。URL ベースのロケール解決を前提とするライブラリはそのままでは使えない
- `support/typescript7` ブランチが並行して存在する。型の重い機構を持ち込むと衝突しうる

## Boundary Strategy

- **Why this split**: 検出と貢献はライブラリ選択に依存しないので、未決事項を待たずに独立して完了できる。配信だけが依存するので、そこだけを umbrella に残した。
- **Shared seams to watch**:
  - `i18n-key-audit` の CI ゲートと `i18n-community-translation` の同期は、どちらも locale JSON を対象にする。TMS 側からの取り込みでゲートが落ちる経路を設計時に確認すること
  - POEditor の 1 プロジェクトが namespace ファイル 1 個に対応するのか未確認。「1 namespace = 1 プロジェクト」なら、翻訳ファイル構成を細かく割るほど TMS 側の運用が破綻する。**構成の整理に着手する前に確認すること**

## 決定事項

- **TMS は POEditor**。公開されている OSS プランの条件が「OSI 認定ライセンスであること」だけで、Crowdin の条件 #4（対象 OSS に関連する商用製品を持っていないこと）や Transifex の「収益化モデルを持たないこと」に相当する除外条項が無い。GROWI は MIT なので額面上通る。承認されれば文字列数・言語数・貢献者数すべて無制限。
- **キーの typo 検出は CI 検出のみ**。i18next 23→26 のメジャーアップと selector API への codemod は行わない。i18next の型付けはキー数千規模で `tsc` が OOM する既知問題があり、`support/typescript7` ブランチ（tsgo で深い再帰型が TS2589 を踏む報告あり）と衝突するリスクがあるため。
- **Lingui は選択肢から除外**。`@lingui/swc-plugin` が Next.js 16 の Turbopack と AST スキーマ非互換（`Host: 1, Plugin: 24406387`, lingui/js-lingui#2423）。回避策は Babel に落とす（Turbopack が無効になる）か macro を使わない（Lingui の利点が消える）のみで、上記 Constraints の Turbopack 方針と両立しない。macro ベースの i18n ライブラリを検討する際は、まずこの制約を確認すること。

## 直接実装（spec なし）

- [x] **`preloadAllLang` の是正（3/5 ファイル、2026-08-13 実施）** — SSR の `__NEXT_DATA__` に 200〜513 KB を注入していたが、他言語から実際に読んでいるキーは `meta.display_name` の 1 個だけ（言語ピッカーの表示名）だった。対応したのは `pages/admin/ai.page.tsx` / `pages/admin/vault.page.tsx`（言語ピッカー自体が無いのでフラグ削除のみ、347 KB → 62 KB）と `pages/admin/app.page.tsx`（表示名 5 件をサーバー側で読んで Jotai atom 経由で渡す形に変更）。

### 訂正: `installer` と `me` は対象外（changeLanguage への依存を見落としていた）

着手前の想定は「残る `installer` / `me` / `admin/app` も表示名 5 件を渡す形に置き換えれば済む」だったが、実装直前の確認で誤りだと分かった。この 2 ページの言語ピッカーは表示名を出すだけでなく、**その場でアプリ全体の言語を切り替える**（`i18n.changeLanguage(...)` を呼ぶ）:

- `InstallerForm.tsx` — 言語ドロップダウンをクリックした瞬間に切り替える
- `stores/personal-settings.tsx` の `useUpdateBasicInfo` — 「Me」ページで基本情報を保存した直後に、選んだ言語へ切り替える

`i18n.changeLanguage()` は、切り替え先の言語のリソース（`translation` / `admin` / `commons` 各 namespace）が既にクライアント側に読み込まれていることを前提にしている。ところが本番環境では i18next のクライアント側に「読み込み元」(backend) が一つも登録されていない（`config/next-i18next.config.mjs` の `use: isDev ? (...) : []`）。つまり本番では、読み込まれていない言語に切り替えようとしても後から取りに行く手段が無く、`fallbackLng`（`en_US`）に静かに戻ってしまう。`preloadAllLang: true` を外すと、まさにこの「取りに行けない」状況を作ってしまう。

このため `installer` / `me` は今回の是正から除外し、`admin/ai` / `admin/vault` / `admin/app` の 3 ファイルのみ実施した。この 2 ページ本来の対応は、本番でも i18next クライアントに読み込み元を持たせる（または別の切り替え方式にする）という、翻訳ファイル構成の整理と同じくらい重さのある別課題であり、本ロードマップの「進める順序」に別項目として積み残す。

## Specs (dependency order)

- [ ] `i18n-key-audit` — 未使用キー / 言語間の欠損 / 存在しないキー参照を CI ゲート化し、discovery で見つかった実バグ 2 件を修正する。Dependencies: なし。Status: 2026-08-06 brief drafted（`.kiro/specs/i18n-key-audit/brief.md`）、requirements 以降は未着手
- [ ] `i18n-community-translation` — POEditor を受け皿にしたコミュニティ翻訳の導線と同期経路。Dependencies: なし（ただしリポジトリ側のキーが整合してから同期を繋ぐ方が事故が少ないので、`i18n-key-audit` の後が望ましい）。Status: 2026-08-06 brief drafted（`.kiro/specs/i18n-community-translation/brief.md`）、requirements 以降は未着手

## 進める順序

1. `preloadAllLang` の是正（直接実装、3/5 ファイル、実施済み。残る `installer` / `me` は上記「訂正」の通り別課題として積み残し）
2. `i18n-key-audit`（CI ゲート＋実バグ 2 件を狭く修正）
3. `i18n-community-translation`（POEditor 申請と同期）

**3 つともライブラリ選択に依存しない。** これらを進めたうえで、翻訳ファイル構成の整理をどちらの案で行うかを改めて判断する。そのときには CI ゲートのおかげでドリフト・未使用キーの実態が数字で見えており、POEditor 運用の実感もあるので、判断材料が今より良くなっている。

判断を早めるべき兆候: `i18n-key-audit` が出す数字が人手で回らない規模だったとき、または翻訳ファイルの構成が原因の不具合が繰り返し出たとき。

---

## 未決 1: 翻訳ファイルの構成をどう直すか

**`translation.json` の肥大化はやりたいこととして残っている。** ただし、それを i18next の namespace 再編としてやるのか、コンパイラ方式への移行に含めてやるのかは**まだ決めない**。いま急いで決める理由が無く、判断材料も足りていないため。

### 評価軸の訂正（重要）

discovery の途中で、この論点を一度「ペイロードが何 KB か」で評価して「実害が測れていないのでやらない」と結論した。**これは評価軸の取り違えで、誤りだった。** 元の課題設定は「`translation.json` が肥大化しており、**メンテもしにくい**」であり、保守性の問題である。測りやすいという理由で性能の問題にすり替えてはいけない。

保守性の問題としては、実害は測れている:

- `translation.json` の最上位 248 キーのうち **177 個が英文そのままのキー**（`"Help"`, `"Edit"`, `"Sign in"`）。意味のある単位に分かれておらず、汎用の置き場になっている
- `admin` の 1,166 キーは i18next 公式の目安（1 ファイル 300 件）の約 4 倍
- `useTranslation()` 359 件のうち **232 件（65%）が namespace を指定していない**。どのキーがどこに属するかが呼び出し側から読み取れない
- 過去 12 か月で locale ファイルに 221 コミット入っているのに、`ko_KR/commons.json` の 92 件欠損が誰にも検知されていなかった

### 両案が共有する目標と、分かれる点

「`translation.json` を解体して意味のある単位に整理する」という目標は、**どちらの案でも達成される**。したがってこれは 2 案を分ける材料にならない。

- i18next 維持 → namespace の切り直しとして実施
- コンパイラ方式 → namespace という概念ごと消え、メッセージが feature ごとに co-locate される

分かれるのはコストと副作用だけである。

### 「namespace 再編は移行すると丸ごと無駄」も訂正

discovery の途中でそう書いたが、正確ではない。**最も高価な知的作業は「2,169 キーそれぞれがどの機能に属するかを決めること」で、この判断は移行しても引き継がれる**（co-locate 先を決めるのに使える）。捨てることになるのは i18next 固有の配管（call site の `ns:` 前置、`serverSideTranslations` のリスト）だけ。

ただし、先に i18next で配管を通してから移行すると **call site を 2 度触る**ことになる。これは実在する無駄なので、順序の判断材料にはなる。

### いま着手しない理由

「やらない」ではなく「いま着手しない」。理由は 2 つだけ:

1. ライブラリ選択が未決なので、call site を 2 度触るリスクがある
2. 先に `i18n-key-audit` を入れると、ドリフトや未使用キーの実態が数字で見える。整理の設計はその数字を見てからの方が良い

`i18n-key-audit` と `i18n-community-translation` が回り始めたら、この論点に戻る。

なお namespace 設計に起因するバグ 2（管理画面が本番でだけ生キーを表示する）は、整理の議論を待たずに `i18n-key-audit` の中で**狭く**直す（`admin` の ns リストに `translation` を足すか、共有ラベル 20 件を `commons` へ移す）。1,166 キーの組み替えには踏み込まない。

---

## 未決 2: コンパイラ方式（Paraglide JS）の採否

**採否はまだ決めない。** 保守性の向上は魅力的であり、成立性も確認できている。一方で移行コストは小さくない。判断材料を両側とも記録しておく。

### 位置づけの訂正（2 度訂正している）

1 度目: spike の成功を「GO」と記録した。spike が証明したのは「機構として成立する（Lingui のように構造的に塞がれてはいない）」ことだけで、「移行すべき」ではない。当時は移行コストを測らないまま推奨に踏み込んでいた。

2 度目: その反省から「現時点で移行は推奨しない」と書き直した。**これも踏み込みすぎだった。** 判断材料が揃っていない段階で反対側の結論を出しただけで、同じ誤りの裏返しである。正しい状態は「未決」。

### 魅力（保守性）

- namespace という管理対象が消える。「どのページがどの ns を要求するか」の管理も、`ns:` 前置も不要になる
- キーが TypeScript の関数名になるので typo が原理的に起こらない
- 未使用メッセージが「使われていない export」になり、通常の dead code 解析で分かる
- 言語間のドリフトがコンパイル時に出る
- SSR の `__NEXT_DATA__` への翻訳注入が不要になる

### コスト（実測）

| コスト要因 | 実測 |
|---|---|
| フラット化しても JS 識別子にならないキー | **277 件（13%）** — `Move/Rename`、`Click to copy`、`Sign in`、`Page Path` など。Paraglide のメッセージ名は関数名になるので全部リネームが要る |
| 補間 `{{...}}` を含むメッセージ | 111 件（構文変換が要る） |
| HTML タグを含むメッセージ | 96 件（要確認だがおそらく中立） |
| i18next 複数形サフィックス付きキー | 4 件（ほぼ問題なし） |
| `<Trans>` の使用 | **0 件**（移行で最も厄介な部分が存在しない。追い風） |

移行の実体は「2,179 call site の書き換え」＋「277 キーのリネーム」＋「2,169 キー × 5 言語の再キー化で既存訳を落とさない」。最後がいちばん危険で、マッピングを 1 つ誤ると、ある言語の訳が黙って消える。

### 4 課題との関係（性能は決め手にならない）

| 課題 | i18next 維持での解 | Paraglide の優位 |
|---|---|---|
| コミュニティ貢献 | POEditor。ライブラリ選択と無関係 | なし |
| 未使用キー・言語間欠損 | `i18next-cli` の CI ステップ。設定のみ | 構造的に起きない |
| キーの typo | `i18next-cli status` の CI ゲート。設定のみ | 原理的に起きない。ただし CI 検出で足りると決定済み |
| 読み込み効率 | `preloadAllLang` 是正で 513→93 KB、347→62 KB | 構造的に優位 |
| **`translation.json` の保守性** | namespace の切り直し | namespace 概念ごと消える |

読み込み効率は、是正後の通常ページが 38 KB（gzip 数 KB）なので**性能を理由に移行を選ぶ材料にはならない**。判断は保守性で行う。

### 成立性の検証結果（2026-08-06 実施）

Next.js 16.3 + React 18 + Turbopack + Paraglide 2.23.1 の最小 Pages Router アプリを作り、GROWI と同じ「Express カスタムサーバ + Next」の構成で動かして確認した。ただし検証アプリはメッセージ 4 件 / 2 言語 / 1 ページで、**移行コストは何も検証していない**。

成立を確認した項目:

- Turbopack の本番ビルドが通る。プラグインも設定も不要（Lingui を落とした AST スキーマ非互換を踏まない）
- GROWI の `en_US` / `ja_JP` というアンダースコア形式のロケールコードがそのまま使える（BCP-47 への変換は不要だった）
- メッセージが 1 件 1 ファイルにコンパイルされる
- メッセージ関数が明示ロケールを取れる（`page_delete({}, { locale: 'ja_JP' })`）。**言語ピッカーはこれだけで解決するので、`preloadAllLang` 相当の問題が構造的に発生しない**
- `defineCustomServerStrategy` の `getLocale` は **async で、リクエストを受け取って DB を引ける**。GROWI の「ロケールは MongoDB のユーザーレコード由来」という要件が正式にサポートされている
- Pages Router で `getServerSideProps` と**コンポーネントのレンダリング両方**が正しいロケールを見る（別フェーズになる懸念は、サーバ層で `paraglideMiddleware` が包むことで解消した）
- 2 ロケールを交互に並行 60 リクエストしても混線ゼロ（AsyncLocalStorage による分離が効いている）

**発見した落とし穴 2 つ。どちらも GROWI に直撃する。**

1. **Paraglide の runtime が二重にロードされると、ロケールが伝わらない。** カスタムサーバが読む runtime と、Next のバンドルに取り込まれた runtime が別インスタンスになり、AsyncLocalStorage の値が届かない。しかも壊れ方が分かりにくく、**カスタム strategy は正しく呼ばれて `ja_JP` を返しているのに、ページは baseLocale のままレンダリングされる**。GROWI は Express カスタムサーバ + Next という、まさにこの構成。
   対策は、Paraglide の生成物を実パッケージとして切り出し `serverExternalPackages` で外部化して 1 インスタンスに揃えること。spike ではこれで解決し、上記の全項目が通った。GROWI には既に Turbopack の externalisation 運用（`.next/node_modules/` の扱い、`apps/app/.claude/rules/package-dependencies.md`）があるので、仕組み自体は馴染みがある。
2. **`import { m } from '.../messages'` という名前空間 import は tree-shaking を無効化する。** 未使用メッセージがクライアントバンドルに残った。名前付き import（`import { page_delete } from '.../messages'`）に変えると未使用メッセージは完全に落ちる。Paraglide が自動 import の利便性のために公開している `m` と、バンドル削減が両立しない。**名前付き import を規約として強制する必要がある。**

### 動的キーについて（検証の副産物）

真に動的な 50 件は、ほぼすべて**列挙可能な有限集合**から引いている（監査ログの action、検索のソート軸、ファイルアップロード種別、装飾スタイル、サーバ由来のエラーコード）。コンパイラ方式へ移行する場合は「値 → メッセージ関数」の明示的な対応表に落とすことになり、これは `coding-style.md` が推奨するデータ駆動の形そのもので、文字列連結より良いコードになる。i18next を維持する場合は `i18next-cli` の `preservePatterns` に宣言する。

### 採用する場合に設計すべき点

(1) Paraglide 生成物のパッケージ化と外部化、(2) 名前付き import を強制する lint、(3) 動的キー 50 件の対応表設計、(4) 既存 2,169 キーのフラット化（277 件のリネームを含む）と 5 言語分の既存訳の引き継ぎ、(5) `packages/editor` の `toolbar.*` 16 キーの扱い、(6) POEditor 側の同期設定の作り直し。

---

_Updated: 2026-08-06. discovery による初版。`.kiro/steering/roadmap.md` に直接書いていた内容を umbrella spec へ移設した。TMS は POEditor に確定、Lingui は Turbopack 非互換で除外、キーの typo 検出は CI のみと決定。翻訳ファイル構成の整理方式と Paraglide 採否は未決として保持する。この 2 点については判断を 2 度言い直している（検証成功を「GO」と書いたのが 1 度目の誤り、その反省で「推奨しない」と書いたのが 2 度目の誤り）ため、経緯を本文に残した。_
