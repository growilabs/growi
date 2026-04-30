# Requirements Document

## Project Description (Input)

### 誰が問題を抱えているか (Who)
GROWI を AI のナレッジハウスまたはデータ参照元として活用したいユーザ、および git クライアントや grep / find といった既存のファイルベースツールで wiki の内容にアクセスしたいチーム。Obsidian Vault のような "自分の知識が手元のファイルとして存在する" 体験を GROWI でも得たいと考えている利用者層。

### 現状 (Current Situation)
GROWI は pages / revisions を MongoDB に保存しており、Markdown 形式の原本ファイルはファイルシステム上に存在しない。このため、
- AI エージェントや CLI ツールから `grep` / `find` による情報抽出ができない
- git クライアントで clone してローカルに取り込んで活用することができない
- Obsidian 系のファイルベース AI 連携ワークフローに乗せられない

という制約がある。一方で Markdown で保存できることが GROWI の本質的アドバンテージであるにもかかわらず、外部からの機械的アクセス性でファイルシステムベースのシステムに劣るという矛盾がある。

### 何が変わるべきか (What Should Change)
GROWI に **"GROWI Vault"** と呼ぶ新機能を追加し、ユーザが自分の閲覧可能な GROWI ページ群を標準 git クライアントで clone し、ローカルのファイルシステムとして扱えるようにする。MVP は read-only (per-user ACL フィルタ済み) で提供し、書き込み (topic branch push → server-side merge) は将来スコープとする。

## Introduction

GROWI Vault は、GROWI 上のページを git プロトコル経由で read-only に取得できるようにする追加機能である。本機能の主目的は、AI エージェント・CLI ツール・Obsidian 型ワークフローといった "ファイルシステム前提の外部ツール" から GROWI のナレッジを活用可能にすることである。ユーザは GROWI のアカウント資格情報を用いて自分が閲覧権限を持つページのみを含むリポジトリを clone でき、他ユーザの非公開ページは存在自体が観測不能であることを保証する。

## Boundary Context

- **In scope (MVP)**:
  - ユーザが閲覧権限を持つ GROWI ページの **latest revision** の Markdown 本文を、GROWI のページ階層を反映したディレクトリ構造で git 経由で取得できる
  - ACL (public / anyone-with-link / group / only-me) に基づくユーザ単位の可視範囲フィルタリング
  - 標準 git クライアント (`git clone` / `git fetch` / `git pull`) での read-only アクセス
  - GROWI 既存の認証情報を用いた認証と監査ログ記録
  - 管理者による機能の有効化 / 無効化、および clone 活動の観測

- **Out of scope (MVP)**:
  - 書き込み (branch push / server-side merge) — 将来 spec に委ねる
  - ページ添付ファイル (attachments) の export
  - コメント / いいね / ブックマーク / タグ等ページ間メタデータの export
  - 下書き / 未公開状態ページの export
  - 機能有効化以前の revision 履歴の import (git 履歴は有効化時点以降に限定)
  - 外部 git ホスティング (GitHub / GitLab 等) との同期連携

- **Adjacent expectations**:
  - GROWI の pages / revisions / user / group / page-acl モデルが本機能の source of truth であり、本機能は既存モデルのスキーマを変更しない
  - Yjs ベースのリアルタイム共同編集は別機能が担当し、GROWI Vault は revision が確定した時点の内容のみを反映する
  - 管理者による GROWI Vault 機能の有効化は、既存の admin 設定 UI 経由で行う

## Requirements

### Requirement 1: Per-user git clone アクセス

**Objective:** As a GROWI ユーザ, I want 自分のアカウントで認可されたページ群を標準 git クライアントで clone したい, so that grep や AI エージェントを含むファイルベースのワークフローで wiki の内容を活用できる

#### Acceptance Criteria

1. When 有効な GROWI 認証情報を伴って GROWI Vault エンドポイントに対して `git clone` が実行された場合, the GROWI Vault shall 当該ユーザが閲覧権限を持つページのみを含むリポジトリを応答として返す
2. When 既にクローン済みのリポジトリに対して `git fetch` または `git pull` が実行された場合, the GROWI Vault shall 前回取得以降に発生したページの変更を応答に含める
3. The GROWI Vault shall 追加ツール導入無しで標準 git クライアント (git コマンドライン等) が動作する transport を提供する
4. If ユーザが `git push` を試みた場合, then the GROWI Vault shall read-only である旨のエラー応答を返し、書き込みを受理しない

### Requirement 2: Page tree をファイルシステム階層として表現

**Objective:** As a GROWI Vault 利用者, I want GROWI 上のページ階層がそのまま clone 結果のディレクトリ構造として現れてほしい, so that 既存のページパスを認知コスト無しで手元ファイルとして参照できる

#### Acceptance Criteria

1. When GROWI ページが `/A/B/C` というパスに存在する場合, the GROWI Vault shall リポジトリ内に `A/B/C.md` に相当するパスで Markdown ファイルを配置する
2. The GROWI Vault shall Markdown ページファイルに `.md` 拡張子を使用する
3. When GROWI ページパスがクロスプラットフォームファイルシステムで安全でない文字 (Windows 予約文字、セグメント内のパス区切り文字、前後空白、制御文字等) を含む場合, the GROWI Vault shall ファイル名を衝突無く可逆にマップする決定的なエンコーディングを適用する
4. When 2 つ以上の GROWI ページが大文字小文字を区別しないファイルシステム上で衝突するファイル名にマップされる場合, the GROWI Vault shall クローン後も個別にアドレス可能となるよう衝突ファイル名を曖昧性解消する
5. Where ページが GROWI のページツリー上で親ページを持たない orphan page である場合, the GROWI Vault shall 通常のページツリーとは分離された well-known な予約場所の下に該当ファイルを配置する
6. The GROWI Vault shall path-to-filename マッピング規則を利用者向けに文書化し、利用者が GROWI ページに対応するファイルを予測できるようにする
7. The GROWI Vault shall `/trash` 配下のページをリポジトリに含めない (ごみ箱ページは常にサーバー側で除外する)
8. The GROWI Vault shall `/user` 配下のページを ACL フィルタ後にリポジトリに含める。ただし、利用者が `git sparse-checkout` を用いて `/user` 配下をローカルチェックアウトから除外できることをドキュメントに明記する

### Requirement 3: ACL に基づく per-user 可視範囲制御

**Objective:** As a GROWI 管理者およびユーザ, I want 既存の GROWI ACL が git 経由のアクセスでも一貫して適用されてほしい, so that 他ユーザの非公開ページの内容や存在が leak しない状態で本機能を安心して有効化できる

#### Acceptance Criteria

1. When ユーザが GROWI Vault を clone した場合, the GROWI Vault shall 当該ユーザが GROWI 既存の ACL 上で閲覧権限を持つページ (public、該当する場合 anyone-with-link、所属グループのページ、本人が owner の only-me ページ) のみを応答リポジトリに含める
2. If ページが only-me ACL を持ちリクエスト元ユーザが owner でない場合, then the GROWI Vault shall 当該ページをファイル名・中間ディレクトリの痕跡を含めてユーザの clone から完全に除外する
3. If ページが group ACL を持ちリクエスト元ユーザが認可されたいずれのグループにも所属しない場合, then the GROWI Vault shall 当該ページをユーザの clone から完全に除外する
4. When ユーザが有効な認証情報を伴わずに匿名でアクセスした場合, the GROWI Vault shall public ACL を持つページのみを応答に含める
5. The GROWI Vault shall ユーザが閲覧権限を持たないページの存在が応答のいかなる観測経路 (ref 一覧、tree 内容、エラーメッセージ、object 転送等) からも推測不可能であることを保証する

### Requirement 4: 認証と認可

**Objective:** As a GROWI ユーザ, I want 既存の GROWI アカウントと同じ識別子で GROWI Vault にアクセスしたい, so that 追加の認証基盤を覚えずに本機能を利用開始できる

#### Acceptance Criteria

1. When ユーザが GROWI がサポートする git 互換の認証手段 (personal access token 等) で資格情報を提示した場合, the GROWI Vault shall リクエストを当該ユーザとして認証する
2. If 提示された資格情報が存在しない、無効、または revoke されている場合, then the GROWI Vault shall 標準的な git 認証失敗応答を返し、かつどのページが存在するかの情報を開示しない
3. Where 提示された資格情報が制限されたスコープのみを許可している場合, the GROWI Vault shall 応答に含めるページの判定においてそのスコープを尊重する
4. The GROWI Vault shall 認証された各 clone / fetch 操作をログに記録し、管理者がアクセスパターンを監査できるようにする

### Requirement 5: Content freshness (同期)

**Objective:** As a GROWI Vault 利用者, I want GROWI で更新されたページ内容が git 経由で取得できる内容に妥当な遅延で反映されてほしい, so that 古い内容を AI エージェントや手元ツールに食わせて判断を誤らせることを避けられる

#### Acceptance Criteria

1. When GROWI 上でページが作成・更新・削除された場合, the GROWI Vault shall 文書化された freshness 境界内に後続の `git fetch` 応答へ変更を反映する
2. When ページ変更が発生していない状態でユーザが続けて fetch を実行した場合, the GROWI Vault shall 2 回目以降の fetch で新規 commit を返さない
3. The GROWI Vault shall 反映した各変更について、対象ページと変更種別 (作成 / 更新 / 削除) を識別可能な commit メタデータを提供する
4. If 反映処理が運用者に観測可能な理由 (背圧、内部エラー等) で一時的に失敗した場合, then the GROWI Vault shall 直近で commit に成功した状態をユーザへの応答として維持し、かつ失敗を管理者に surface する

### Requirement 6: ACL 変更の伝播

**Objective:** As a GROWI ユーザおよび管理者, I want ページの ACL 変更が git 経由のアクセスにも遅滞なく反映されてほしい, so that 権限剥奪後も旧 ACL 前提で clone できてしまう状態を防止できる

#### Acceptance Criteria

1. When ページの ACL 変更によりユーザが閲覧権限を失った場合, the GROWI Vault shall 当該ユーザの後続 fetch 応答に当該ページの内容を含めず、ユーザが pull した後のクローンの HEAD tree から当該ページのファイルが削除される状態にする
2. When ページの ACL 変更によりユーザが新たに閲覧権限を得た場合, the GROWI Vault shall 当該ユーザの後続 fetch 応答に当該ページの現在の内容を含める
3. The GROWI Vault shall ACL 変更をコンテンツ更新と同等の freshness 境界内で後続 fetch 応答に反映する

### Requirement 7: 管理者による機能制御と観測

**Objective:** As a GROWI 管理者, I want GROWI Vault 機能を組織方針に応じて有効化・無効化し、利用状況を把握したい, so that 運用とコンプライアンス要件を満たせる

#### Acceptance Criteria

1. Where GROWI Vault 機能が管理者により無効化されている場合, the GROWI Vault shall 全ての clone / fetch リクエストを feature-disabled 応答で拒否する
2. When 管理者が GROWI Vault 機能を有効化した場合, the GROWI Vault shall 認証された git clone / fetch リクエストの受付を開始する
3. The GROWI Vault shall 管理者が監査に利用できる形で、最低限「タイムスタンプ・リクエスト元ユーザ・操作種別」を含む監査記録を提供する
4. If GROWI Vault のストレージ使用量が運用者設定の閾値を超過した場合, then the GROWI Vault shall 当該状況を管理者へ surface する

### Requirement 8: 将来スコープの明示的除外

**Objective:** As a 本 spec の利用者, I want MVP に含まれないものを明確に理解したい, so that 期待値ミスアライメントを防ぎ、現状と将来の境界を明示できる

#### Acceptance Criteria

1. The GROWI Vault shall MVP スコープにおいて git クライアントからの書き込み操作 (push 等) を受理しない。書き込み対応は将来の spec に委ねる
2. The GROWI Vault shall MVP スコープにおいてページ添付ファイルを clone リポジトリ内容に export しない
3. The GROWI Vault shall MVP スコープにおいて GROWI のページ間メタデータ (コメント、ブックマーク、いいね、タグ等) をファイルコンテンツとして export しない
4. The GROWI Vault shall 機能が最初に有効化される以前の revision を import せず、git 履歴は有効化時点以降の変更のみを含める
5. The GROWI Vault shall MVP スコープにおいて下書き / 未公開状態のページを export しない
