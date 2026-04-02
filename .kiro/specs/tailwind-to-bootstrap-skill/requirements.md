# Requirements Document

## Project Description (Input)
現在 GROWI のフロントエンドは Bootstrap で作られています。しかし部分的に tailwind (shadcn/ui) が利用されています。tailwind が利用されている箇所、またどのように部分的に利用可能になっているかは調査してください。やってほしいことは tailwind クラスを bootstrap クラスに置換するための Claude Skills を作成してほしい

## Introduction

GROWI のフロントエンドは主に Bootstrap ベースで構築されているが、`apps/app` パッケージにおいて Tailwind CSS v4 が `tw:` プレフィックス付きで部分的に導入されている。12個の shadcn/ui コンポーネント（`apps/app/src/components/ui/`）が Tailwind ユーティリティクラスでスタイリングされている。

本仕様では、Tailwind (`tw:` プレフィックス付き) ユーティリティクラスを Bootstrap の等価クラスに変換するための Claude Skill を作成する。この Skill は AI エージェントがコード変換作業を行う際のリファレンスとして機能し、Tailwind から Bootstrap への段階的なマイグレーションを支援する。

## Requirements

### Requirement 1: クラスマッピングリファレンス

**Objective:** AI エージェントとして、Tailwind ユーティリティクラスと Bootstrap クラスの対応表を参照したい。これにより、正確かつ一貫性のあるクラス変換を実行できる。

#### Acceptance Criteria
1. The Skill shall Tailwind のレイアウト系ユーティリティ（`tw:flex`, `tw:grid`, `tw:block`, `tw:hidden` 等）と対応する Bootstrap クラス（`d-flex`, `d-grid`, `d-block`, `d-none` 等）のマッピングを提供する
2. The Skill shall Tailwind のスペーシング系ユーティリティ（`tw:p-*`, `tw:m-*`, `tw:gap-*` 等）と対応する Bootstrap クラス（`p-*`, `m-*`, `gap-*` 等）のマッピングを提供する
3. The Skill shall Tailwind のテキスト/タイポグラフィ系ユーティリティ（`tw:text-*`, `tw:font-*`, `tw:leading-*` 等）と対応する Bootstrap クラスのマッピングを提供する
4. The Skill shall Tailwind のサイズ系ユーティリティ（`tw:w-*`, `tw:h-*`, `tw:size-*` 等）と対応する Bootstrap クラスまたは代替 CSS の指針を提供する
5. The Skill shall Tailwind の色・背景系ユーティリティ（`tw:bg-*`, `tw:text-*` カラー系）と Bootstrap のテーマカラークラスまたはカスタム CSS 変数への変換指針を提供する
6. The Skill shall Tailwind のボーダー・角丸系ユーティリティ（`tw:border-*`, `tw:rounded-*` 等）と対応する Bootstrap クラスのマッピングを提供する
7. The Skill shall Tailwind のレスポンシブプレフィックス（`tw:sm:`, `tw:md:`, `tw:lg:` 等）と Bootstrap のレスポンシブブレークポイントクラスの変換規則を提供する

### Requirement 2: 変換不可能なクラスのガイダンス

**Objective:** AI エージェントとして、Bootstrap に直接対応するクラスが存在しない Tailwind ユーティリティへの対処法を知りたい。これにより、変換作業中に適切な判断を下せる。

#### Acceptance Criteria
1. The Skill shall Bootstrap に等価クラスが存在しない Tailwind ユーティリティ（例: `tw:ring-*`, `tw:shadow-*` の一部、`tw:backdrop-*` 等）の一覧を提供する
2. When Bootstrap に直接対応するクラスが存在しない場合、the Skill shall カスタム CSS またはインラインスタイルによる代替実装の指針を提供する
3. The Skill shall shadcn/ui の CSS 変数（`--primary`, `--border`, `--ring` 等）を Bootstrap テーマ変数に移行するための指針を提供する
4. If Tailwind のアニメーション系ユーティリティ（`tw-animate-css` 由来）が使用されている場合、the Skill shall 代替となる CSS アニメーション実装の指針を提供する

### Requirement 3: shadcn/ui コンポーネント変換ガイド

**Objective:** AI エージェントとして、shadcn/ui コンポーネントを Bootstrap ベースに変換する際のパターンを知りたい。これにより、コンポーネント単位での体系的な変換を実行できる。

#### Acceptance Criteria
1. The Skill shall 現在存在する 12 個の shadcn/ui コンポーネント（avatar, button, collapsible, command, dialog, dropdown-menu, hover-card, input-group, input, select, textarea, tooltip）それぞれの変換方針を提供する
2. The Skill shall CVA (class-variance-authority) によるバリアント定義を Bootstrap のクラスベースバリアントに変換する方法を示す
3. The Skill shall `cn()` ユーティリティ関数（`clsx` + `tailwind-merge`）の代替となるクラス結合パターンを提供する
4. The Skill shall Radix UI プリミティブを維持しつつスタイリングのみ Bootstrap に移行するアプローチを示す
5. When コンポーネントがダークモード対応（`.dark` クラスセレクター）を含む場合、the Skill shall Bootstrap のダークモード対応方法を提供する

### Requirement 4: Skill のフォーマットと構成

**Objective:** GROWI 開発者として、既存の Claude Skills と一貫したフォーマットで Skill が提供されることを期待する。これにより、開発ワークフローにシームレスに統合できる。

#### Acceptance Criteria
1. The Skill shall `.claude/skills/` ディレクトリ配下に SKILL.md ファイルとして配置される
2. The Skill shall YAML フロントマター（`name`, `description`, `user-invocable` フィールド）を含む
3. The Skill shall Markdown 形式でマッピングテーブル、コード例、ガイダンスを構造化して記述する
4. The Skill shall 変換前（Tailwind `tw:` プレフィックス付き）と変換後（Bootstrap）のコード例を並置して示す
5. The Skill shall GROWI 固有のコンテキスト（`tw:` プレフィックスの使用、`apps/app` パッケージへのスコープ、既存 Bootstrap テーマとの統合）を考慮した内容を含む

### Requirement 5: 変換ワークフローの手順

**Objective:** AI エージェントとして、Tailwind から Bootstrap への変換を体系的に実行するためのステップバイステップの手順を知りたい。これにより、変換漏れや不整合を防止できる。

#### Acceptance Criteria
1. The Skill shall 単一コンポーネントファイルを変換する際の推奨手順（クラスの特定 → マッピング参照 → 変換 → 検証）を提供する
2. The Skill shall `tw:` プレフィックス付きクラスの検索方法（grep/検索パターン）を示す
3. When 変換対象のファイルが `cn()` ユーティリティを使用している場合、the Skill shall `cn()` 呼び出しの除去・置換手順を提供する
4. The Skill shall 変換後に不要となるパッケージ依存（`tailwindcss`, `@tailwindcss/postcss`, `tailwind-merge`, `tw-animate-css`, `class-variance-authority`）の除去手順を提供する
5. If 変換対象のコンポーネントが shadcn/ui コンポーネントをインポートしている場合、the Skill shall 依存先コンポーネントも含めた変換順序の指針を提供する

