# Implementation Plan

- [x] 1. SKILL.md のスキャフォールディングとフロントマター作成
- [x] 1.1 スキルディレクトリの作成と YAML フロントマター付きの SKILL.md ファイルを初期化する
  - `.claude/skills/tailwind-to-bootstrap/SKILL.md` を作成
  - YAML フロントマター（`name: tailwind-to-bootstrap`, `description`）を記述
  - スキルのイントロダクション（GROWI 固有コンテキスト: `tw:` プレフィックスの説明、`apps/app` へのスコープ、Bootstrap 5.3.8 との共存状況）を記述
  - 既存スキル（tech-stack, monorepo-overview 等）のフォーマットに準拠していることを確認
  - _Requirements: 4.1, 4.2, 4.5_

- [x] 2. クラスマッピングテーブルセクションの作成
- [x] 2.1 (P) レイアウト・表示系とフレックスボックス配置のマッピングテーブルを作成する
  - Display ユーティリティ（flex, grid, block, hidden, inline-flex 等）の Tailwind→Bootstrap 対応表を記述
  - Flexbox alignment（items-center, justify-between, flex-col 等）の対応表を記述
  - Overflow と positioning の対応表を記述
  - 3 列テーブル形式（Tailwind, Bootstrap, Notes）で記述
  - _Requirements: 1.1_

- [x] 2.2 (P) スペーシング系のマッピングテーブルを作成する
  - Padding（p-*, px-*, py-*, pt-*, pb-*, pl-*, pr-*）の対応表を記述
  - Margin（m-*, mx-*, my-*, ml-*, mr-*, 負のマージン）の対応表を記述
  - Gap（gap-*）の対応表を記述
  - Tailwind（4px 基準）と Bootstrap（rem 基準）のスケール差異について注釈を記載
  - _Requirements: 1.2_

- [x] 2.3 (P) タイポグラフィ系のマッピングテーブルを作成する
  - フォントサイズ（text-xs, text-sm, text-base, text-lg 等）の対応表を記述
  - フォントウェイト（font-medium, font-semibold 等）の対応表を記述
  - テキスト配置、装飾、行間、truncate 等の対応表を記述
  - _Requirements: 1.3_

- [x] 2.4 (P) サイズ・色・ボーダー・レスポンシブのマッピングテーブルを作成する
  - サイズ（w-full, h-auto, size-* 等）の対応表を記述（Bootstrap のサイズユーティリティの限界と代替 CSS について注釈）
  - 色・背景（bg-primary, text-muted-foreground 等）の対応表を記述（セマンティックカラー名の差異について注釈）
  - ボーダー・角丸（border, rounded-md, rounded-full 等）の対応表を記述
  - レスポンシブブレークポイント（sm:, md:, lg: → -sm-, -md-, -lg-）の変換規則を記述
  - _Requirements: 1.4, 1.5, 1.6, 1.7_

- [x] 3. 変換不可能パターンセクションの作成
- [x] 3.1 Bootstrap に等価がないパターンの一覧と代替実装ガイダンスを作成する
  - Ring ユーティリティ、`:has()` セレクタ、`data-[state=*]` 属性、arbitrary values、named groups 等の一覧を作成
  - 各パターンに対するカスタム CSS またはインラインスタイルによる代替実装の指針を記述
  - shadcn/ui の CSS 変数（`--primary`, `--border`, `--ring` 等）から Bootstrap テーマ変数（`--bs-*`）への移行マッピングテーブルを作成
  - `tw-animate-css` 由来のアニメーション（animate-in, fade-in, zoom-in, slide-in 等）の Bootstrap/カスタム CSS 代替テーブルを作成
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 4. shadcn/ui コンポーネント変換ガイドセクションの作成
- [x] 4.1 12 個のコンポーネントの変換方針テーブルと CVA/cn() 代替パターンを作成する
  - 各コンポーネント（avatar, button, collapsible, command, dialog, dropdown-menu, hover-card, input-group, input, select, textarea, tooltip）の Bootstrap 対応先と複雑度を記載した変換方針テーブルを作成
  - CVA バリアント定義を Bootstrap クラスベースバリアントに変換する Before/After コード例を作成
  - `cn()` ユーティリティから `clsx` のみへの移行パターンのコード例を作成
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 4.2 Radix UI 維持アプローチとダークモード移行の指針を作成する
  - Radix UI プリミティブを維持しつつ className のみ Bootstrap クラスに置換するアプローチを記述
  - `data-[state=*]` に依存するスタイルのカスタム CSS 対応パターンを記述
  - shadcn/ui の `.dark` クラスセレクタから Bootstrap 5.3 の `data-bs-theme="dark"` への移行手順を記述
  - ダークモード用カスタムプロパティの Bootstrap 変数マッピングを記述
  - _Requirements: 3.4, 3.5_

- [x] 5. 変換ワークフローセクションの作成
- [x] 5.1 ステップバイステップの変換手順と検索パターン、依存クリーンアップ手順を作成する
  - 単一コンポーネント変換のステップバイステップ手順（検索 → マッピング参照 → 変換 → 検証）を記述
  - `tw:` プレフィックス付きクラス、`cn()` 使用箇所、shadcn/ui インポートの grep 検索パターンを記述
  - `cn()` ユーティリティ使用箇所の除去・置換手順を記述
  - 全変換完了後の Tailwind 関連パッケージ・設定ファイルの除去手順を記述
  - shadcn/ui コンポーネント間の依存関係を考慮した変換順序の指針（リーフ → 中間 → 複合 → 高複雑度 → 消費側 → クリーンアップ）を記述
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 6. コンテンツ検証と統合確認
- [x] 6.1 マッピングの正確性を検証し、SKILL.md が Claude Code で正常に認識されることを確認する
  - マッピングテーブルの全エントリが Bootstrap 5.3 のユーティリティクラスとして実在することを確認
  - Before/After コード例の構文が正しいことを確認
  - YAML フロントマターが既存スキルのフォーマット（name, description フィールド）に準拠していることを確認
  - SKILL.md が 500 行以内に収まっていることを確認（超過時はセクションの最適化を実施）
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
