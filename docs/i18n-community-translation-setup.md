# GROWI 翻訳プログラム運用準備手順（メンテナー向け）

このドキュメントは、GROWI のコミュニティ翻訳の受け皿となる POEditor 環境と、リポジトリ側の自動反映に必要な承認ボットアカウントを、メンテナーが実際に用意するための手順書です。

対象読者は、GROWI 組織の GitHub リポジトリ設定権限と、GROWI 用の POEditor アカウントを作成できる立場にあるメンテナーです。貢献者（翻訳者）向けの案内は [`docs/i18n-community-translation.md`](./i18n-community-translation.md) を参照してください。この文書はその前提となる環境を作る側の手順です。

## この手順が満たすべき条件

- POEditor の OSS プランが承認されるまで、本番運用（実際の同期ワークフローの起動）を進めてはいけません（`.kiro/specs/i18n-community-translation/requirements.md` 要件7.2）。OSS プランが承認されない場合は、同等の規模を満たす代替プラン・代替サービスが確認できるまで本番運用へ移行しません。
- この条件は、以下の手順のうち「1. POEditor OSS プランの申請」が承認された後にのみ、後続タスク（5.1・5.2 のワークフロー配線、6.1・6.2 の実環境確認）を本番相当で動かしてよいことを意味します。承認前の段階では、テスト用の POEditor プロジェクト（無償の Free プランなど、上限のある個人・テスト用プロジェクト）で動作確認を行っても構いません。OSS プラン承認前に行うのはあくまで動作確認であり、実際の翻訳者を受け入れる本番運用ではありません。

## 1. POEditor OSS プランの申請

POEditor 上のプロジェクトは単一（後述の「2. 単一の POEditor プロジェクトを作成する」）なので、この OSS プラン申請も GROWI プロジェクト全体に対して一度だけ行えば済みます。namespace ごとに申請し直す必要はありません。

### 1.1 申請できる条件

POEditor が公開している OSS プログラムの適用条件は「OSI 認定ライセンスであること」のみで、商用製品の有無を理由にした除外条項はありません（`.kiro/specs/i18n-community-translation/brief.md` の Approach 節）。GROWI は MIT ライセンスなので、この条件を満たします。

承認された場合、文字列数・言語数・貢献者数の上限が撤廃されます（要件7.1）。承認されるかどうか、および承認までの所要期間は POEditor 側の裁量であり、GROWI 側でコントロールできません。

### 1.2 申請手順

1. POEditor（`https://poeditor.com/`）にサインインします。GROWI 組織として使うアカウント（個人アカウントではなく、複数のメンテナーが引き継げるアカウント）を用意してください。
2. POEditor が提供している OSS プログラムの申請ページへ進みます（POEditor 側のサイト内に申請導線があります。具体的な申請フォームの URL はサイト構成の変更で変わる可能性があるため、`poeditor.com` 内の OSS / Open Source 向けページを都度確認してください）。
3. 申請フォームには少なくとも次の情報を用意します。
   - プロジェクト名（GROWI）
   - ライセンス種別（MIT）
   - リポジトリの公開 URL（`https://github.com/growilabs/growi`）
   - プロジェクトの簡単な説明（GROWI がチーム向け Wiki プラットフォームであること）
4. 申請後は POEditor からの返信を待ちます。承認・却下いずれの通知が来ても、このドキュメントの「1. この手順が満たすべき条件」に戻り、次のステップに進んでよいかを確認してください。

### 1.3 却下された場合

要件7.2により、却下された場合は同等規模（文字列数・言語数・貢献者数に実用上の上限がない）の代替プラン・代替サービスが確認できるまで本番運用に進みません。代替の検討は本ドキュメントの範囲外です（`.kiro/specs/i18n-community-translation/brief.md` の「他候補を落とした理由」に、検討済みの候補とその却下理由が記録されています。POEditor 自体が使えなくなった場合はこの記録を出発点に再検討してください）。

## 2. 単一の POEditor プロジェクトを作成する

### 2.1 なぜ1プロジェクトで足りるのか

GROWI の翻訳ファイルは `admin.json` / `translation.json` / `commons.json` の3 namespace に分かれており、`commons.json` には他ファイルと同一のキー文字列が意図的に複製されているものがあります。以前はこの衝突を避けるため namespace ごとに POEditor プロジェクトを分ける設計でしたが、現在は同期ツール側（`apps/app/tools/i18n-sync/`）が各 namespace の用語を `{namespace: 内容}` という構造で包んでから POEditor に送るようになっており、同一キー文字列が別の namespace に存在してもツール側の仕組みで区別できます。そのため、POEditor 上のプロジェクトを namespace ごとに分ける必要がなくなり、単一のプロジェクトで全 namespace の内容をまとめて扱えます（詳しい実装は `.kiro/specs/i18n-community-translation-single-project/design.md` を参照してください。この手順書ではその詳細までは踏み込みません）。

なお、GROWI 側で namespace ごとの絞り込み表示自体が不要になったわけではありません。同期ツールは用語を POEditor に送る際、その用語がどの namespace に属するかをタグとして付与します。貢献者は POEditor 画面上のタグ絞り込み機能を使うことで、関心のある namespace だけに絞って翻訳作業ができます（詳細は `docs/i18n-community-translation.md` の「参加方法」を参照してください）。

### 2.2 作成するプロジェクト

POEditor の「New project」機能で、GROWI の翻訳全体を受け皿とするプロジェクトを1つ作成します。

| 対応するリポジトリ側ファイル | プロジェクト名の例 |
|---|---|
| `apps/app/public/static/locales/<lang>/{admin,translation,commons}.json`（3 namespace すべて。`translation.json` には `packages/editor` の `toolbar.*` キーも含まれる） | GROWI |

このプロジェクトに、対応する言語を追加します。基準言語（ソース言語）は `en_US`、翻訳対象言語は `ja_JP` / `zh_CN` / `fr_FR` / `ko_KR` の4言語です（`docs/i18n-community-translation.md` の「対応している言語」と同じ一覧）。

**プロジェクト設定で Fallback Language を必ず「未設定（None）」にしてください。** 設定されていると、ある言語で未翻訳のままのキーが、export 時にフォールバック言語（多くの場合ソース言語の English）の文言で埋められてしまいます。この状態で pull を実行すると、まだ翻訳が入っていないキーが軒並み English に置き換わったとみなされ、リポジトリ側の既存の正しい翻訳を上書きしてしまいます（実プロジェクトでの実測により確認済み。`.kiro/specs/i18n-community-translation/research.md` 参照）。

### 2.3 初回の用語投入

プロジェクト作成直後は用語（キー）が空です。初回投入は、後続タスク5.1で配線される `i18n-sync-push` ワークフロー（または `apps/app/tools/i18n-sync/` のスクリプトを手動実行する形）で、リポジトリ側の `en_US` の JSON ファイルをアップロードして行います。この初回投入自体は本ドキュメントの手順の範囲外です（後続タスクの担当）。

**ソース言語（en_US）だけでなく、既存の ja_JP / zh_CN / fr_FR / ko_KR の訳文も初回に投入してください。** push ワークフローは `en_US` しかアップロードしないため、これを行わないと POEditor 上でこれら4言語が実際には翻訳済みであるにもかかわらず0%のまま表示され、翻訳者に「何も翻訳されていない」という誤った状態を見せてしまいます。

この投入には `apps/app/tools/i18n-sync/seed-existing-translations.ts`（`pnpm run i18n:sync:seed`）を使います。`POEDITOR_API_TOKEN` と `I18N_SYNC_SEED_LANGUAGE`（`ja_JP` / `zh_CN` / `fr_FR` / `ko_KR` のいずれか1つ）を環境変数に設定し、4言語それぞれについて1回ずつ実行してください（`uploadTerms`のレート制限により1回の実行につき1言語のみを扱う設計です）。

```bash
cd apps/app
POEDITOR_API_TOKEN=<token> I18N_SYNC_SEED_LANGUAGE=ja_JP pnpm run i18n:sync:seed
POEDITOR_API_TOKEN=<token> I18N_SYNC_SEED_LANGUAGE=zh_CN pnpm run i18n:sync:seed
POEDITOR_API_TOKEN=<token> I18N_SYNC_SEED_LANGUAGE=fr_FR pnpm run i18n:sync:seed
POEDITOR_API_TOKEN=<token> I18N_SYNC_SEED_LANGUAGE=ko_KR pnpm run i18n:sync:seed
```

この処理は非破壊（`syncTerms: false`）なので、途中で失敗しても再実行して問題ありません。

### 2.4 プロジェクト ID をリポジトリに反映する（後続の作業）

プロジェクトを作成すると、POEditor 上のプロジェクト ID が割り当てられます。このプロジェクト ID は非公開情報ではなく、公開してよい情報です（トークンではないため）。

`apps/app/tools/i18n-sync/sync-config.ts` の `SHARED_POEDITOR_PROJECT_ID` には、現在プレースホルダー値 `'PENDING_SHARED_PROJECT_ID'` が入っています。

プロジェクトの作成後、このプレースホルダーを実際のプロジェクト ID に置き換えるコード変更を行ってください。この置き換えは本ドキュメントの手順書という文書だけでは完結せず、`sync-config.ts` を編集してコミットする作業が別途必要です。

## 3. public join page を有効化する

貢献者向けの参加方法（`docs/i18n-community-translation.md` の「参加方法」）は、GitHub アカウントなしで POEditor プロジェクトに参加できることを前提にしています。これは POEditor プロジェクトの「public join page」機能で実現します（要件1.1: GitHub アカウントを要求せずに参加手段を提示する）。プロジェクトが単一になったことで、この設定も一度だけ行えば済みます。

1. 作成したプロジェクトの設定画面を開きます。
2. 「Public」または「Join」に相当する設定を有効化し、招待メールなしで誰でも参加できる公開参加リンク（public join page の URL）を発行します。
3. 発行された参加リンクを控えます。プロジェクトは1つなので、URL も1つです。
4. 控えた参加リンクを `docs/i18n-community-translation.md` の「参加方法」セクションにある `（参加リンクをここに追記する。...）` の記載箇所に追記してください。これは `docs/i18n-community-translation.md` 自体の編集であり、本タスクの境界外（タスク4.1で作成済みの別ファイル）のため、別のコード変更として行ってください。

参加した利用者は、POEditor アカウント自体は必要です（匿名投稿はできません）が、個別の招待メールを待つ必要はありません（`.kiro/specs/i18n-community-translation/brief.md` の Constraints 節）。

## 4. 承認ボットアカウントを用意する

### 4.1 なぜ必要か

「訳文のみ」の変更提案 PR は、既存の i18n CI ゲート（`lint:i18n`、`ci-app-lint` に含まれる）を通過した場合に限り、人レビューを待たずに反映されます。この経路は、既存の `.github/mergify.yml` にある「Automatic queue to merge」ルール（`#approved-reviews-by >= 1` かつ変更要求レビューが無いこと）にそのまま乗せることで実現します。このルール自体は変更しません。

GitHub は PR 作成者自身による自己承認を拒否するため、「PR を作る ID」とは別の ID が承認レビューを送る必要があります。この別 ID が、ここで用意する承認ボットアカウントです（`.kiro/specs/i18n-community-translation/design.md` の Boundary Commitments「承認ボットの必要性」、および Security Considerations）。

「構造変更」を伴う PR（namespace 内のキーの増減など）には承認ボットは関与しません。これは通常の人レビュー必須 PR として作成され、人が承認すれば同じ既存ルールでキューに乗ります。

### 4.2 用意する2つの GitHub App

この仕組みでは、「PR を作る identity」と「PR を承認する identity」を、別々の GitHub App として用意します。

- **publish 用 App**（PR を作る側）
  - 権限: `contents: write`（同期ブランチの push）、`pull_requests: write`（PR の作成・更新）
  - リポジトリにインストールしておく
- **approval 用 App**（承認レビューを送る側）
  - 権限: `pull_requests: write` のみ
  - `contents: write` は付与しない（ブランチや PR の中身を書き換える権限を持たせない）
  - リポジトリにインストールしておく

2つに分ける理由は、GitHub が PR 作成者自身による自己承認を拒否するためです（4.1 参照）。この制限は人のアカウントだけでなく GitHub App にも同様に働きます。つまり、publish 用 App が作った PR を、別の App（approval 用 App）としてインストールした identity から承認すれば、自己承認とはみなされません。

### 4.3 リポジトリに保存するもの（長期保存するのは秘密鍵だけ）

GitHub App の installation token は数十分〜1時間程度で失効する短命な値です。この短命な token を repository secret として固定で保存し使い回す設計は避けます。長期保存してよいのは「秘密鍵」（と、秘密ではない App ID）だけです。

- repository **secrets**（暗号化して保存）
  - `I18N_SYNC_PUBLISH_APP_PRIVATE_KEY` — publish 用 App の秘密鍵（PEM 形式）
  - `I18N_SYNC_APPROVAL_APP_PRIVATE_KEY` — approval 用 App の秘密鍵（PEM 形式）
- repository **variables**（暗号化不要・秘密ではない値）
  - `I18N_SYNC_PUBLISH_APP_ID` — publish 用 App の App ID
  - `I18N_SYNC_APPROVAL_APP_ID` — approval 用 App の App ID

installation ID は保存不要です（後述の `actions/create-github-app-token` が、対象リポジトリへのインストールから自動的に解決します）。

`I18N_SYNC_PUBLISH_TOKEN` / `I18N_SYNC_APPROVAL_TOKEN` という名前の値そのものを repository secret として保存することはしません。これらは次節の通り、workflow を実行するたびにその場で発行する一時的な値として扱います。

### 4.4 workflow 実行時に token を発行する

各 App の秘密鍵から installation token を発行するには、公式の [`actions/create-github-app-token`](https://github.com/actions/create-github-app-token)（現時点の最新版 `v3.2.0`。今後さらに新しいバージョンが出ている場合はそちらを確認して固定してください）を使います。JWT の作成や `/app/installations/{id}/access_tokens` の呼び出しをこの action がまとめて行うため、自前でその手順を組む必要はありません。

```yaml
- name: Mint publish app token
  id: mint-publish
  uses: actions/create-github-app-token@v3.2.0
  with:
    app-id: ${{ vars.I18N_SYNC_PUBLISH_APP_ID }}
    private-key: ${{ secrets.I18N_SYNC_PUBLISH_APP_PRIVATE_KEY }}

- name: Mint approval app token
  id: mint-approval
  uses: actions/create-github-app-token@v3.2.0
  with:
    app-id: ${{ vars.I18N_SYNC_APPROVAL_APP_ID }}
    private-key: ${{ secrets.I18N_SYNC_APPROVAL_APP_PRIVATE_KEY }}
```

発行した token は、それぞれの用途に直接渡します。`steps.mint-publish.outputs.token` は `actions/checkout` の `token`、PR 作成コマンドの認証情報として使い、`steps.mint-approval.outputs.token` は承認レビュー送信コマンドの認証情報として使います。

> 重要: `|| secrets.GITHUB_TOKEN` のようなフォールバックは書きません。秘密鍵の登録が漏れていた場合、この発行ステップ自体をその場で失敗させます。フォールバックで `GITHUB_TOKEN` に静かに切り替わると、`GITHUB_TOKEN` が作った PR イベントは他のワークフローを起動しないため `ci-app-lint` が付かず、承認されてもマージキューに気づかれないまま残り続けるという分かりにくい失敗になります。

### 4.5 人が毎回 token を作り直す必要はない

一度2つの App を作成してリポジトリにインストールし、それぞれの秘密鍵と App ID を登録すれば、以降は workflow の実行のたびに installation token が自動で発行されます。installation token 自体は短時間で失効しますが、次の実行では新しい token がその場で発行されるため、人が期限切れに気づいて再発行する作業は発生しません。

人の手作業が必要なのは、最初に2つの App を作成・インストールし、秘密鍵と App ID を登録する一度限りの作業（4.2 のプロビジョニング）だけです。

## 5. POEditor API トークンを用意する

上記のプロジェクト作成・public join page 有効化とは別に、同期ワークフロー（push/pull）が POEditor API を呼び出すための API トークンが必要です。POEditor のアカウント設定画面から API トークンを発行し、GitHub Actions のリポジトリシークレット `POEDITOR_API_TOKEN` として登録してください（`.kiro/specs/i18n-community-translation/design.md` の Security Considerations、および要件2〜3で参照される同期ワークフローの認証情報）。このトークンもログやコードに平文で出力しないでください。

## 6. この手順の成果物を使う後続タスク

この手順を実行すると、以下が用意された状態になります。

- POEditor 上の1プロジェクトと、その public join page の URL
- `apps/app/tools/i18n-sync/sync-config.ts` の `SHARED_POEDITOR_PROJECT_ID` プレースホルダー値を置き換えるためのプロジェクト ID
- 2つの GitHub App（publish 用・approval 用）とそれぞれの private key、App ID（長期保存するのはこれらのみ。installation ID は保存不要）
- 実行時に `actions/create-github-app-token` で installation token を mint する運用手順（publish 用と approval 用で別 identity になることを含む）
- POEditor API トークン（`POEDITOR_API_TOKEN` として登録予定）

これらは以下の後続タスクが直接使う前提です。

- タスク5.1（push ワークフローの配線）・5.2（pull ワークフローの配線、承認ボット・GitHub 操作の実アダプタ実装）・5.3（pull ワークフローの GitHub 認証を runtime 発行 token 方式へ移行）は、上記のシークレット（`POEDITOR_API_TOKEN`、および2つの App の private key / App ID）と、置き換え済みのプロジェクト ID を前提に配線します。
- タスク6.1（push 経路の実環境確認）・6.2（pull 経路の実環境確認）は、実際の POEditor プロジェクト（本番用のプロジェクト、または OSS プラン承認前であればテスト用の POEditor プロジェクト）に対して動作確認を行うために、この手順で用意した環境を使います。

OSS プラン承認前にタスク6.1・6.2を進める場合は、本ドキュメント冒頭の「この手順が満たすべき条件」に従い、本番のプロジェクトではなくテスト用のプロジェクトを使ってください。
