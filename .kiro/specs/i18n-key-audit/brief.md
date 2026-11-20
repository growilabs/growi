# Brief: i18n-key-audit

## Problem

`apps/app` の翻訳キーには、壊れていることを誰も検知できない状態が続いている。i18n 関連のスクリプト・lint ルール・CI ステップは一切存在せず（`.github/workflows/` 22 ファイルを grep して 0 件）、安全網は手書きの vitest 2 本だけである（`features/growi-vault/client/i18n-reconcile.spec.ts` が 8 キー、`client/components/Admin/g2g-error-keys-locale-drift.spec.ts` が `admin:g2g:*` を en_US に対してのみ確認）。

結果として次の 3 つが分からない。

- **どのキーが使われていないか** — en_US の 2,169 キーのうち 1,130 キーは静的リテラルから一度も参照されていない（真に動的なキー 50 件と `keyPrefix` 7 件が説明する分を含む上限値）。減らそうにも、どれを消してよいか判断できない。
- **どの言語でどのキーが欠けているか** — en_US を基準にした実測で、`ko_KR/commons.json` は 182 キーに対し 90 キーしかなく **92 件欠損**している。`translation` は ja_JP 9 件 / zh_CN 12 件 / fr_FR 8 件 / ko_KR 24 件、`admin` は 11〜14 件がそれぞれ欠けている。
- **tsx に書いたキーが typo かどうか** — `t()` は `string` を受け取るだけなので、存在しないキーを書いてもビルドも lint も通る。

そして実際に壊れている。discovery の実測で、ユーザーに見えている不具合が 2 件見つかった。

**バグ 1: どのロケールにも存在しないキーを 27 箇所が参照している。**
静的リテラルのユニークキー 1,306 件のうち 30 件が en_US で解決できず、そのうち 27 件はどの言語のどのファイルにも存在しない。`Successfully updated`、`Failed to update`、`fix_page_grant.modal.alert_message`、`Browsing of this page is restricted`、`page_tree.move_blocked`、`page_tree.move_failed`、`My Drafts`、`Slack Member ID`、`Forbidden`、`ExternalUserGroup` など。`t('common:failed_to_copy')` は存在しない namespace `common` を指している（正しくは `commons`）。

**バグ 2: 管理画面が本番でだけ生キーを表示する。**
管理ページは `pages/admin/_shared/get-server-side-common-props.ts` で `['commons','admin']` しか読み込まないが、`client/components/Admin` 配下の 43 コンポーネントが namespace を指定せず（＝既定の `translation`）`Created` / `Cancel` / `Close` / `Name` / `Email` / `Update` / `Description` / `User` / `Edit` / `UserGroup` / `Create` / `add` など 20 キーを引いている。これらは `translation.json` にしか無い。開発環境では `config/next-i18next.config.mjs` が `isDev` のときだけ `ChainedBackend` / `HttpBackend` を配線するので HTTP で取りに行って解決してしまい、**本番でだけ再現する**。本番のクライアントには backend が無いため、SSR ストアに無い namespace は取得しようがない。

## Current State

- locale は既に 3 namespace に分割されている（`public/static/locales/{en_US,ja_JP,zh_CN,fr_FR,ko_KR}/{translation,admin,commons}.json`）
- `i18next ^23.16.5` / `next-i18next ^15.3.1` / `react-i18next ^15.1.1`
- `src/@types/i18next.d.ts` の `CustomTypeOptions` は `returnNull: false` のみで、`resources` 型拡張は無い。したがって `t()` の引数は `string`
- 静的解析の網羅性の限界: `t()` 2,179 件のうち **50 件**は評価しないと単一のキーに解決できない（テンプレートリテラル 193 件のうち変数セグメントが残る 27 件＋変数・式の 23 件。残る 166 件はローカル定数の畳み込みで静的に解決できる）。この 50 件もほぼすべて列挙可能な有限集合から引いている
- 過去 12 か月で `public/static/locales` を触ったコミットは 221 件あり、ドリフトは今も進行している

## Desired Outcome

- 未使用キー・言語間の欠損・存在しないキー参照が CI で検出され、非ゼロ終了でマージを止められる
- 上記の実バグ 2 件が解消し、ゲートを有効にした状態でグリーンになっている
- 動的キー 50 件が誤検出として鳴り続けることがない（宣言によって除外されている）
- 翻訳 JSON が CI によって勝手に書き換えられることがない

## Approach

`i18next-cli` を検出の単一ツールとして採用し、CI に読み取り専用の 2 ステップとして入れる。

- `status` — コードにあって既定言語に無いキー（バグ 1 の類）と、言語間のドリフト（ko_KR の 92 件欠損の類）を検出する。読み取り専用。
- `extract --ci --dry-run` — JSON にあってコードから参照されていないキーを報告する。

`i18next-parser` は 2025 年 9 月に開発終了しリポジトリもアーカイブされているため採用しない。後継が `i18next-cli` であり、GROWI が実際に使っている `keyPrefix`（7 箇所）・`useTranslation(['admin','commons'])`（6 箇所）・`ns:key` 前置（238 キー）をいずれも理解する。`i18n-unused` は namespace の概念を持たず、`admin.json` の `save` をどこかの `t('save')` と取り違えて「使用済み」と判定するので使わない。

動的キー 50 件は `extract.preservePatterns` に宣言して未使用扱いを止める。

`extract` は既定で JSON を書き換えるため、**CI では `--dry-run` を必ず付ける**。これを外すとコミュニティの翻訳を黙って削除しうる。

実バグ 2 件はこの spec の中で直す。ゲートを入れると即座に落ちるので、検出と修正が同じ文脈にあり、ゲートが有効になった状態で完了できる。バグ 2 の修正方針（`admin` ページの namespace リストに `translation` を足すか、共有ラベル 20 件を `commons` に移すか）は design 段階で決める。前者は 1 行だが admin のペイロードを 1 ロケールあたり約 31 KB 再び膨らませ、後者は call site の書き換えを伴う。

## Scope

- **In**: `i18next-cli` の導入と設定、CI ワークフローへの 2 ステップ追加、`preservePatterns` の宣言、実バグ 2 件の修正、既存の手書き vitest 2 本の扱いの整理
- **Out**: `translation.json` の解体や `admin` 1,166 キーの機能別分割といった翻訳ファイル構成の整理（やりたいこととして残っているが、i18next の namespace 再編として行うかコンパイラ方式への移行に含めるかが未決。`.kiro/specs/i18n/roadmap.md` の「未決 1: 翻訳ファイルの構成をどう直すか」を参照）、`preloadAllLang` の是正（直接実装で先行）、キーの型付け（selector API / `CustomTypeOptions`）、TMS 連携

バグ 2 の修正は namespace に触れるが、**共有ラベル 20 件を動かす範囲に留める**。構成の整理そのものは未決なので、1,166 キーの組み替えには踏み込まない。

## Boundary Candidates

- 検出（CI が何を落とすか）と、検出に引っかかった既存の不整合の解消
- ツール設定（`preservePatterns` を含む宣言）と、CI ワークフローへの組み込み

## Out of Boundary

- キーの型付けによる compile-time 検証。CI 検出のみで足りるという判断が済んでいる（`.kiro/specs/i18n/roadmap.md` の決定事項を参照）
- 未使用キーを実際に削除すること。検出と、削除の判断は別。1,130 件という数字は動的キーを含む上限値なので、機械的な一括削除は危険
- namespace 構成の変更。整理方式が未決のあいだは着手しない（umbrella の「未決 1」）

## Upstream / Downstream

- **Upstream**: なし。単独で着手できる
- **Downstream**: `i18n-community-translation`（POEditor と同期する前に、リポジトリ側のキーが整合している方がよい）。namespace 再編に進む場合も、このゲートが再編中の取りこぼしを止める安全網になる

## Existing Spec Touchpoints

- **Parent**: umbrella spec `i18n`（`.kiro/specs/i18n/roadmap.md`）
- **Extends**: なし（新規領域）
- **Adjacent**: `i18n-community-translation`

## Constraints

- 静的解析は原理的に完全にならない。`t()` 2,179 件のうち 50 件が真に動的で、`preservePatterns` による宣言は人手のメンテナンス対象になる
- `i18next-cli` は 2025-09-25 が初回公開の若いツール。`extract` が既定で書き込む点は運用上の危険として扱う
- この spec は i18next を維持する前提に立っている。コンパイラ方式（Paraglide）への移行は**未決**（`.kiro/specs/i18n/roadmap.md` の「未決 2: コンパイラ方式（Paraglide JS）の採否」を参照）で、移行した場合はこの spec の成果を捨てることになる。それでも先に入れる価値がある理由は 2 つ: 設定のみで安いこと、そして**このゲートが出す数字こそが、その未決の判断を裏付ける材料になる**こと
