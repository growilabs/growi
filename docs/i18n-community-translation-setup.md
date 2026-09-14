# GROWI 翻訳プログラム運用準備手順（メンテナー向け）

このドキュメントは、GROWI のコミュニティ翻訳の受け皿となる POEditor 環境と、リポジトリ側の自動反映に必要な承認ボットアカウントを、メンテナーが実際に用意するための手順書です。

対象読者は、GROWI 組織の GitHub リポジトリ設定権限と、GROWI 用の POEditor アカウントを作成できる立場にあるメンテナーです。貢献者（翻訳者）向けの案内は [`docs/i18n-community-translation.md`](./i18n-community-translation.md) を参照してください。この文書はその前提となる環境を作る側の手順です。

## この手順が満たすべき条件

- POEditor の OSS プランが承認されるまで、本番運用（実際の同期ワークフローの起動）を進めてはいけません（`.kiro/specs/i18n-community-translation/requirements.md` 要件7.2）。OSS プランが承認されない場合は、同等の規模を満たす代替プラン・代替サービスが確認できるまで本番運用へ移行しません。
- この条件は、以下の手順のうち「1. POEditor OSS プランの申請」が承認された後にのみ、後続タスク（5.1・5.2 のワークフロー配線、6.1・6.2 の実環境確認）を本番相当で動かしてよいことを意味します。承認前の段階では、テスト用の POEditor プロジェクト（無償の Free プランなど、上限のある個人・テスト用プロジェクト）で動作確認を行っても構いません。OSS プラン承認前に行うのはあくまで動作確認であり、実際の翻訳者を受け入れる本番運用ではありません。

## 1. POEditor OSS プランの申請

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

## 2. namespace ごとに専用の POEditor プロジェクトを作成する

### 2.1 なぜ3プロジェクトに分けるのか

POEditor の1プロジェクトは「フラットな用語リスト1本」であり、複数ファイル・複数 namespace を1プロジェクト内で構造的に分離する機能を持ちません。GROWI の翻訳ファイルは `admin.json` / `translation.json` / `commons.json` の3 namespace に分かれており、`commons.json` には他ファイルと同一のキー文字列が意図的に複製されているものがあります。これを1プロジェクトに混在させると、同一キー文字列が別の namespace で別の訳を持つケースで衝突が起きます。

そのため、namespace ごとに独立した POEditor プロジェクトを作るという設計判断がすでに確定しています（`.kiro/specs/i18n-community-translation/research.md` の Design Decision「namespace ごとに独立した POEditor プロジェクトを作る」）。この手順ではその判断に従い、3つのプロジェクトを作成します。

### 2.2 作成するプロジェクト

以下の3プロジェクトを、POEditor の「New project」機能で作成します。

| namespace | 対応するリポジトリ側ファイル | プロジェクト名の例 |
|---|---|---|
| `admin` | `apps/app/public/static/locales/<lang>/admin.json` | GROWI - admin |
| `translation` | `apps/app/public/static/locales/<lang>/translation.json`（`packages/editor` の `toolbar.*` キーもここに含まれる） | GROWI - translation |
| `commons` | `apps/app/public/static/locales/<lang>/commons.json` | GROWI - commons |

各プロジェクトで、対応する言語を追加します。基準言語（ソース言語）は `en_US`、翻訳対象言語は `ja_JP` / `zh_CN` / `fr_FR` / `ko_KR` の4言語です（`docs/i18n-community-translation.md` の「対応している言語」と同じ一覧）。

### 2.3 初回の用語投入

プロジェクト作成直後は用語（キー）が空です。初回投入は、後続タスク5.1で配線される `i18n-sync-push` ワークフロー（または `apps/app/tools/i18n-sync/` のスクリプトを手動実行する形）で、リポジトリ側の `en_US` の JSON ファイルをアップロードして行います。この初回投入自体は本ドキュメントの手順の範囲外です（後続タスクの担当）。

### 2.4 プロジェクト ID をリポジトリに反映する（後続の作業）

3プロジェクトを作成すると、それぞれに POEditor 上のプロジェクト ID が割り当てられます。このプロジェクト ID は非公開情報ではなく、公開してよい情報です（トークンではないため）。

`apps/app/tools/i18n-sync/sync-config.ts` の `SYNC_TARGETS` には、現在プレースホルダー値が入っています。

- `admin`: `PENDING_ADMIN_PROJECT_ID`
- `translation`: `PENDING_TRANSLATION_PROJECT_ID`
- `commons`: `PENDING_COMMONS_PROJECT_ID`

3プロジェクトの作成後、これらのプレースホルダーを実際のプロジェクト ID に置き換えるコード変更を行ってください。この置き換えは本ドキュメントの手順書という文書だけでは完結せず、`sync-config.ts` を編集してコミットする作業が別途必要です。

## 3. 各プロジェクトで public join page を有効化する

貢献者向けの参加方法（`docs/i18n-community-translation.md` の「参加方法」）は、GitHub アカウントなしで POEditor プロジェクトに参加できることを前提にしています。これは POEditor プロジェクトの「public join page」機能で実現します（要件1.1: GitHub アカウントを要求せずに参加手段を提示する）。

1. 作成した3プロジェクトそれぞれについて、プロジェクトの設定画面を開きます。
2. 「Public」または「Join」に相当する設定を有効化し、招待メールなしで誰でも参加できる公開参加リンク（public join page の URL）を発行します。
3. 発行された参加リンクを控えます。3プロジェクト分（`admin` / `translation` / `commons`）、それぞれ別の URL になります。
4. 控えた参加リンクを `docs/i18n-community-translation.md` の「参加方法」セクションにある `（参加リンクをここに追記する。...）` の記載箇所に追記してください。これは `docs/i18n-community-translation.md` 自体の編集であり、本タスクの境界外（タスク4.1で作成済みの別ファイル）のため、別のコード変更として行ってください。

参加した利用者は、POEditor アカウント自体は必要です（匿名投稿はできません）が、個別の招待メールを待つ必要はありません（`.kiro/specs/i18n-community-translation/brief.md` の Constraints 節）。

## 4. 承認ボットアカウントを用意する

### 4.1 なぜ必要か

「訳文のみ」の変更提案 PR は、既存の i18n CI ゲート（`lint:i18n`、`ci-app-lint` に含まれる）を通過した場合に限り、人レビューを待たずに反映されます。この経路は、既存の `.github/mergify.yml` にある「Automatic queue to merge」ルール（`#approved-reviews-by >= 1` かつ変更要求レビューが無いこと）にそのまま乗せることで実現します。このルール自体は変更しません。

GitHub は PR 作成者自身による自己承認を拒否するため、「PR を作る ID」とは別の ID が承認レビューを送る必要があります。この別 ID が、ここで用意する承認ボットアカウントです（`.kiro/specs/i18n-community-translation/design.md` の Boundary Commitments「承認ボットの必要性」、および Security Considerations）。

「構造変更」を伴う PR（namespace 内のキーの増減など）には承認ボットは関与しません。これは通常の人レビュー必須 PR として作成され、人が承認すれば同じ既存ルールでキューに乗ります。

### 4.2 用意する2つの選択肢

以下のどちらかを選び、GROWI 組織の判断で決定してください。どちらを選んでも、最終的に得られるのは「PR への承認レビューだけができるトークン」です。

**選択肢A: 専用の GitHub App をインストールする**

1. GROWI 組織（または対象リポジトリ）向けに、新しい GitHub App を作成します。
2. この GitHub App に付与する権限は、Pull requests に対する `Read and write`（承認レビューを送るために必要な最小権限）に限定します。`Contents` への書き込み権限は付与しません（承認だけができれば十分で、それ以上の権限は攻撃対象を広げるだけであるため。`.kiro/specs/i18n-community-translation/design.md` の Security Considerations）。
3. この GitHub App を対象リポジトリにインストールします。
4. インストール後に発行されるインストールアクセストークン（または、同期ワークフロー内で GitHub App の秘密鍵から都度トークンを生成する運用）を、後述の GitHub Actions シークレットとして使います。

**選択肢B: 専用のボットユーザーアカウントを発行する**

1. PR を作成する既定の ID（通常の `GITHUB_TOKEN`、または5.1/5.2で使う別のボット ID）とは別に、GROWI 組織に所属する専用の GitHub ユーザーアカウントを新規作成します（例: `growi-i18n-approval-bot` のような専用アカウント）。
2. このアカウントを対象リポジトリのコラボレーターとして、PR にレビューを送れる権限（少なくとも Write 相当、または承認レビューが送れる最小権限）で招待します。
3. このアカウントで Personal Access Token（PAT）を発行します。スコープは pull request への承認レビューを送るのに必要な最小範囲に限定し、`repo` 全体や `contents` への書き込みを含む広いスコープは選びません。

### 4.3 発行したトークンをシークレットとして登録する

選択肢A・Bのどちらで得たトークンも、GitHub Actions のリポジトリシークレット `I18N_SYNC_APPROVAL_TOKEN` として登録します（`.kiro/specs/i18n-community-translation/design.md` の Security Considerations）。

- 他の用途（PR 作成用のトークンや、POEditor API トークン）と共有せず、この用途専用のシークレットとして登録してください。
- このトークンに `contents: write` のような書き込み権限を持たせないことを、登録前に必ず確認してください。

このシークレットの実際のワークフローへの配線（`i18n-sync-pull` ワークフローからの参照）はタスク5.2の範囲です。本ドキュメントの手順は、シークレットの値そのものを用意するところまでです。

## 5. POEditor API トークンを用意する

上記の3プロジェクト作成・public join page 有効化とは別に、同期ワークフロー（push/pull）が POEditor API を呼び出すための API トークンが必要です。POEditor のアカウント設定画面から API トークンを発行し、GitHub Actions のリポジトリシークレット `POEDITOR_API_TOKEN` として登録してください（`.kiro/specs/i18n-community-translation/design.md` の Security Considerations、および要件2〜3で参照される同期ワークフローの認証情報）。このトークンもログやコードに平文で出力しないでください。

## 6. この手順の成果物を使う後続タスク

この手順を実行すると、以下が用意された状態になります。

- POEditor 上の3プロジェクト（`admin` / `translation` / `commons`）と、それぞれの public join page の URL
- `apps/app/tools/i18n-sync/sync-config.ts` のプレースホルダー値を置き換えるためのプロジェクト ID
- 承認ボットの ID とトークン（`I18N_SYNC_APPROVAL_TOKEN` として登録予定）
- POEditor API トークン（`POEDITOR_API_TOKEN` として登録予定）

これらは以下の後続タスクが直接使う前提です。

- タスク5.1（push ワークフローの配線）・5.2（pull ワークフローの配線、承認ボット・GitHub 操作の実アダプタ実装）は、上記のシークレット（`POEDITOR_API_TOKEN` / `I18N_SYNC_APPROVAL_TOKEN`）と、置き換え済みのプロジェクト ID を前提に配線します。
- タスク6.1（push 経路の実環境確認）・6.2（pull 経路の実環境確認）は、実際の POEditor プロジェクト（本番用の3プロジェクト、または OSS プラン承認前であればテスト用の POEditor プロジェクト）に対して動作確認を行うために、この手順で用意した環境を使います。

OSS プラン承認前にタスク6.1・6.2を進める場合は、本ドキュメント冒頭の「この手順が満たすべき条件」に従い、本番の3プロジェクトではなくテスト用のプロジェクトを使ってください。
