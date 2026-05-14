# Requirements Document

## Project Description (Input)
ユーザーパスワードのハッシュ化アルゴリズムの改善。CodeQL ALert の内容を読みパスワード生成ロジックの改修、マイグレーションスクリプトの実装、リリースバージョンより前のバージョンにダウングレードした場合も考慮する。既にインストール済みのシステムに対する後方互換は気にしてください

## Introduction

現行の GROWI ローカル認証は `SHA-256(PASSWORD_SEED + plaintext)` でパスワードを保存しており、ユーザー単位のソルトを持たない。CodeQL はこれをパスワードストレージ用の弱い暗号ハッシュとして検出する。本フィーチャーでは、適応型 KDF（bcrypt または Argon2id）への移行、既存インストール済みシステムへの後方互換性維持（遅延マイグレーション）、マイグレーションスクリプト、およびダウングレードシナリオへの対応を実現する。

## Boundary Context

- **In scope**: ローカル認証（ユーザー名/パスワード）のパスワードハッシュアルゴリズム改善、遅延マイグレーション（ログイン時の自動再ハッシュ）、マイグレーション状態レポートスクリプト、クリーンアップマイグレーションスクリプト、ダウングレード事前準備スクリプト
- **Out of scope**: LDAP・OAuth・SAML・Passkey 等の外部認証プロバイダー、`apiToken` フィールドのハッシュ化改善、`PASSWORD_SEED` 環境変数の即時廃止
- **Adjacent expectations**: 遅延マイグレーション完了前（全ユーザーが再ログインするまで）は、既存 SHA-256 ハッシュの検証に `PASSWORD_SEED` 環境変数が引き続き設定されている必要がある

## Requirements

### Requirement 1: 新規パスワードへの適応型 KDF 適用

**Objective:** As a GROWI システム管理者, I want 新たに設定・変更されるパスワードに業界標準の適応型 KDF を使用したい, so that CodeQL アラートが解消され、GPU ブルートフォース攻撃への耐性が確保される.

#### Acceptance Criteria

1. When ユーザーがパスワードを設定または変更する, the GROWI authentication system shall 適応型 KDF（bcrypt cost factor ≥ 12 または Argon2id）とユーザー単位のランダムソルトを使用してパスワードをハッシュする。
2. The GROWI authentication system shall アルゴリズム識別子とパラメータを埋め込んだ自己記述形式（例: bcrypt の `$2b$12$…` プレフィックス）でハッシュを保存し、外部メタデータなしでアルゴリズムを検出できるようにする。
3. When 新しいパスワードが設定される, the GROWI authentication system shall レガシー SHA-256+PASSWORD_SEED 方式をハッシュの保存に使用しない。
4. The GROWI authentication system shall ユーザー単位のランダムソルトにより、同一の平文パスワードから異なるハッシュが生成されることを保証する。

### Requirement 2: 既存 SHA-256 ハッシュパスワードへの後方互換性

**Objective:** As a 既存 GROWI ユーザー, I want アップグレード後もパスワードをリセットせずにログインしたい, so that 移行期間中もサービスを中断なく継続利用できる.

#### Acceptance Criteria

1. When レガシー SHA-256 ハッシュパスワードを持つユーザーがログイン情報を送信する, the GROWI authentication system shall レガシー SHA-256+PASSWORD_SEED 方式で送信されたパスワードを検証する。
2. When ユーザーがレガシー SHA-256 検証パスで認証に成功する, the GROWI authentication system shall 同一のログイントランザクション内で自動的に新しい適応型 KDF でパスワードを再ハッシュし、保存済みハッシュを置き換える。
3. While レガシーフォーマットと新フォーマットのハッシュを持つユーザーがシステムに共存する, the GROWI authentication system shall ユーザー側の操作を必要とせず両フォーマットを透過的に処理する。
4. If 保存済みパスワードのハッシュフォーマットを判別できない, the GROWI authentication system shall ログイン試行を拒否し、ユーザー識別子を含む構造化ログエントリを WARNING レベルで出力する。

### Requirement 3: マイグレーションスクリプト

**Objective:** As a GROWI システム管理者, I want マイグレーションスクリプトによって移行の進捗を把握し管理したい, so that 適切なタイミングでレガシーハッシュを安全に削除できる.

#### Acceptance Criteria

1. The GROWI migration system shall データを変更せずに、ハッシュフォーマット別のユーザー数（レガシー SHA-256 のみ、新適応型 KDF のみ、両フォーマット共存、パスワード未設定）を報告するステータスマイグレーションスクリプトを提供する。
2. When 管理者がステータスマイグレーションスクリプトを実行する, the GROWI migration system shall カウントを人間が読める形式で標準出力に出力する。
3. The GROWI migration system shall 新適応型 KDF フォーマットへの移行が完了したユーザーのみを対象に、レガシー SHA-256 認証情報データを削除するクリーンアップマイグレーションスクリプトを提供する。
4. If クリーンアップマイグレーションスクリプトがレガシー SHA-256 ハッシュのみを保持するユーザー（ログインによる未移行）を検出する, the GROWI migration system shall データを変更せずに中断し、影響ユーザー数を示すエラーメッセージを表示する。

### Requirement 4: ダウングレード安全策

**Objective:** As a GROWI システム管理者, I want バージョンをダウングレードする前に影響範囲を把握し、ユーザー影響を最小化する手順を実行したい, so that ダウングレード後もユーザーが認証を継続できるか、または影響ユーザーが事前に通知を受けられる.

#### Acceptance Criteria

1. The GROWI migration system shall 新適応型 KDF フォーマットへの移行が完了しているユーザー数（新フォーマットをサポートしないバージョンにダウングレードするとログイン不可になるユーザー）を報告するダウングレード事前準備スクリプトを提供する。
2. When ダウングレード事前準備スクリプトが実行される, the GROWI migration system shall 新フォーマットハッシュを持つ全ユーザーにパスワードリセットメールを送信するオプションを提供し、ダウングレード後に新しいパスワードを設定できるようにする。
3. When ダウングレード事前準備スクリプトがパスワードリセットメールを送信する, the GROWI migration system shall 該当ユーザーのパスワードをリセット必須状態としてマークし、新しいパスワードが設定されるまでログインを禁止する。
