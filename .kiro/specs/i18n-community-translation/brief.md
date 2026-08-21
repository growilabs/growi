# Brief: i18n-community-translation

## Problem

GROWI は 5 言語（en_US / ja_JP / zh_CN / fr_FR / ko_KR）を提供しているが、コミュニティのユーザーが翻訳に貢献する導線が無い。現状で貢献するには、GitHub のアカウントを持ち、リポジトリを fork し、`apps/app/public/static/locales/<lang>/<ns>.json` の正しい位置に手で JSON を書き、PR を出す必要がある。翻訳したいだけの wiki 利用者にはハードルが高すぎる。

その結果が翻訳の劣化として表れている。en_US を基準にした実測で、`ko_KR/commons.json` は 182 キーに対して 90 キーしかなく **92 件欠損**している。`translation` は ja_JP 9 件 / zh_CN 12 件 / fr_FR 8 件 / ko_KR 24 件、`admin` は各言語 11〜14 件が欠けている。欠けたキーは `fallbackLng: 'en_US'` によって英語で表示されるため、利用者からは「一部だけ英語のまま」に見える。

同種の OSS wiki である BookStack は、翻訳の PR を受け付けず TMS に誘導している（「コード経由でのマージは競合と同期の問題を起こす」ため）。GROWI も、翻訳をコードレビューの経路に乗せ続ける限り同じ摩擦を抱える。

## Current State

- 翻訳ファイルは `apps/app/public/static/locales/` に 5 言語 × 3 namespace = 15 ファイル、en_US で 2,169 キー（約 57.7k words）
- 翻訳の受け皿となる外部サービスは未接続。同期の仕組みも無い
- `packages/editor` は locale ファイルを持たず、`toolbar.*` 16 キーを `apps/app` の `translation.json` に依存している。翻訳の配置を変える場合は連動が必要
- `apps/app/resource/locales/` は別系統（`welcome.md` / `sandbox*.md` / ejs のメールテンプレート、5 言語 × 各 6 ファイル以上）で、i18next の管理外

## Desired Outcome

- 翻訳したい利用者が、GitHub の操作を知らなくても翻訳を投稿できる
- 投稿された翻訳がリポジトリに反映される経路が自動化されていて、人手のコピーが要らない
- 言語ごとの進捗（どの言語が何 % 埋まっているか）が見える
- 翻訳 JSON は引き続き git にコミットされ、**実行時に外部サービスへ取りに行かない**

## Approach

**POEditor を受け皿として採用する。**

選定理由は、公開されている OSS プランの条件が「OSI 認定ライセンスであること」だけで、商用製品の有無に関する除外条項が無いこと。GROWI は MIT なので額面上通る。承認されれば文字列数・言語数・貢献者数がすべて無制限になる。i18next JSON を専用フォーマットとして正式にサポートし、入れ子 JSON も扱える（キーのパスは Context フィールドに入る）。

他候補を落とした理由:

- **Crowdin** — OSS 条件 #4 が「対象 OSS に関連する商用製品を持っていないこと」と明記しており、GROWI.cloud があるため額面上失格。製品としては最良で、BookStack など wiki 系の前例も強い
- **Transifex** — 「収益化モデルを持たないこと」が条件で同じく失格
- **Locize** — 公開された OSS プランが無く裁量対応のみ。加えて Growth $49/月がユーザー 10 人上限で、コミュニティ翻訳者を受け入れるなら Professional $99/月が実質下限。さらに本来の売りが CDN 経由の実行時配信であり、オンプレミスで自己ホストされる GROWI は第三者 CDN への実行時依存を採れない
- **Weblate** — 無料 Libre プラン、匿名提案可、GPL-3.0 でセルフホスト可と条件面は強いが、商用製品に関する条項は「書かれていないだけ」で、明示的に通ると言えるのは POEditor の方
- **Pontoon** — Mozilla 製・BSD・セルフホスト可だが、JSON 対応が WebExtensions 形式主体で i18next の入れ子との相性にリスクがある
- **GitLocalize** — git ネイティブで翻訳が PR として届くが、無料枠が 1,000 words/月 で GROWI の約 57.7k words に対して小さい
- **inlang Fink** — 関連ツールの廃止が続いており（Ninja 廃止、Paraglide の Next アダプタ廃止、SDK v2 の完全リリース未了）、本番の受け皿として賭けにくい
- **Localazy** — 無料枠 200 keys、OSS 条件が非公開、セルフホスト不可
- **Tolgee** — クラウド無料枠が 500 キーで GROWI の 2,169 に届かず、席課金（3/4/8/20）でコミュニティ翻訳と噛み合わない。git 連携もネイティブに無い

**同期は API v2 で自作する。** POEditor の GitHub 連携は Plus プラン（$60/月）以上の機能であり、OSS 無償枠で解放されるかが未確認のため。`projects/upload` と `projects/export` にプラン制限の記載は無く（アップロードは 20 秒に 1 リクエストのスロットル）、GitHub Actions から双方向の同期を組める。GitHub 連携が OSS 枠に含まれるなら、そちらに寄せた方が保守は軽くなる。

**翻訳 JSON は git に残す。** ビルド時に pull するだけとし、実行時に POEditor を参照しない。GROWI はオンプレミスで自己ホストされる製品なので、外部サービスへの実行時依存を作らない。

## Scope

- **In**: POEditor への OSS 申請、プロジェクト構成、双方向同期の実装（GitHub Actions）、貢献者向けの導線と手引き、レビュー体制の設計、進捗の可視化
- **Out**: 翻訳そのものを埋める作業、`apps/app/resource/locales/` 配下の markdown / ejs テンプレート、namespace 構成の変更

## Boundary Candidates

- 外部サービスとの契約・申請（人手の手続き）と、同期の自動化（コード）
- リポジトリ → POEditor の反映（ソース言語の更新）と、POEditor → リポジトリの反映（翻訳の取り込み）

## Out of Boundary

- 実行時の翻訳配信を外部サービスに委ねること。オンプレミス配布と両立しない
- 翻訳の品質保証や機械翻訳の導入
- namespace の再編。ただし後述のとおり依存関係がある

## Upstream / Downstream

- **Upstream**: `i18n-key-audit`（リポジトリ側のキーが整合してから同期を繋ぐ方が事故が少ない）。ただし厳密な前提ではなく、並行して進められる
- **Downstream**: 翻訳ファイルの構成を整理する将来の作業（i18next の namespace 再編、またはコンパイラ方式への移行。どちらで行うかは未決）。いずれの場合も同期の設定を作り直す必要が出る

## Existing Spec Touchpoints

- **Parent**: umbrella spec `i18n`（`.kiro/specs/i18n/roadmap.md`）
- **Extends**: なし（新規領域）
- **Adjacent**: `i18n-key-audit`

## Constraints

- **未確認で設計に効く点**: POEditor の 1 プロジェクトが namespace ファイル 1 個に対応するのか、1 プロジェクトで複数ファイルを持てるのか。「1 namespace = 1 プロジェクト」であれば、namespace を細かく割るほど TMS 側の運用が破綻する。**namespace 分割の粒度を決める前に確認すること。**
- OSS プランの承認は申請してみないと確定しない。ライセンス種別・プロジェクトの説明・URL を添えて申請する
- 通りすがりの翻訳者もアカウント作成は必要（Weblate のような匿名提案モードは無い）。ただしボランティア向けの public join page があり、招待メールを 1 通ずつ送る必要は無い
- コンパイラ方式（Paraglide）へ移行した場合、メッセージファイルはフラット JSON になる。POEditor の Key-Value JSON と互換なので受け皿としては残るが、同期の設定は作り直しになる
