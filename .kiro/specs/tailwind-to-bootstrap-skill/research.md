# Research & Design Decisions

## Summary
- **Feature**: `tailwind-to-bootstrap-skill`
- **Discovery Scope**: Extension（既存の Claude Skills システムへの新規 Skill 追加）
- **Key Findings**:
  - Tailwind は `apps/app` にのみ存在し、`tw:` プレフィックスで Bootstrap と完全に分離されている
  - 12 個の shadcn/ui コンポーネントが Radix UI + Tailwind で構築されている
  - Bootstrap に直接マッピングできない Tailwind 機能が多数存在する（`:has()` セレクタ、`data-[state=*]` 属性、アニメーション等）

## Research Log

### Tailwind 利用状況の調査
- **Context**: プロジェクト内での Tailwind の利用範囲と利用パターンの把握
- **Sources Consulted**: `apps/app/src/components/ui/*.tsx`, `apps/app/src/styles/tailwind.css`, `apps/app/package.json`, `apps/app/postcss.config.js`
- **Findings**:
  - Tailwind CSS v4.1.14 を `@tailwindcss/postcss` プラグインで使用
  - `prefix(tw)` により全クラスに `tw:` プレフィックスが付与
  - shadcn/ui の 12 コンポーネント: avatar, button, collapsible, command, dialog, dropdown-menu, hover-card, input-group, input, select, textarea, tooltip
  - CSS 変数は OKLCH カラースペースで定義（`--primary`, `--destructive`, `--background` 等）
  - `cn()` ユーティリティ（`clsx` + `tailwind-merge`）で動的クラス結合
  - CVA (class-variance-authority) でバリアント管理
- **Implications**: Skill はこれらすべてのパターンの変換ガイダンスを提供する必要がある

### Bootstrap 利用状況の調査
- **Context**: 既存 Bootstrap パターンとバージョンの確認
- **Sources Consulted**: `apps/app/package.json`, `apps/app/src/features/growi-plugin/` 配下のコンポーネント
- **Findings**:
  - Bootstrap 5.3.8 を使用
  - 主にプラグイン管理ページ等のレガシーコンポーネントで利用
  - `d-flex`, `btn`, `card`, `form-control` 等の標準ユーティリティクラスを使用
  - Bootstrap CSS 変数は sRGB カラースペース（`--bs-primary`, `--bs-danger` 等）
- **Implications**: Bootstrap 5 のユーティリティ API を前提としたマッピングテーブルが必要

### Claude Skills 構造の調査
- **Context**: 新規 Skill のフォーマットと配置場所の決定
- **Sources Consulted**: `.claude/skills/*/SKILL.md`, `.claude/settings.json`, `apps/app/.claude/skills/*/SKILL.md`
- **Findings**:
  - SKILL.md は YAML フロントマター（`name`, `description`, `user-invocable`）付き Markdown
  - ディレクトリ名は kebab-case、ファイル名は `SKILL.md`（大文字）
  - グローバルスキルは `.claude/skills/` に配置
  - `user-invocable: false` で自動呼び出し、省略時は手動呼び出し可能
  - 典型的な長さ: グローバルスキル 200-270 行、アプリ固有 100-200 行
  - コード例、テーブル、ASCII ツリー等を積極的に使用
- **Implications**: 新規 Skill は `.claude/skills/tailwind-to-bootstrap/SKILL.md` に配置し、既存スキルと同じフォーマットに従う

### 変換不可能パターンの分析
- **Context**: Bootstrap で再現不可能な Tailwind 機能の特定
- **Sources Consulted**: shadcn/ui コンポーネントソースコード、Bootstrap 5.3 ドキュメント
- **Findings**:
  - `:has()` セレクタ（`tw:has-[>svg]`, `tw:group-has-[>input]`）→ Bootstrap に等価なし
  - `data-[state=*]` 属性セレクタ → Radix UI 固有、カスタム CSS 必要
  - アニメーション（`tw:animate-in`, `tw:fade-in-0`, `tw:zoom-in-95`）→ Bootstrap は `fade`, `collapse` のみ
  - 任意値（`tw:[calc(...)]`, `tw:rounded-[calc(...)]`）→ カスタム CSS 必要
  - OKLCH カラースペース → sRGB への変換が必要
  - サイズスケールの不一致（Tailwind: 4px基準 vs Bootstrap: rem 基準）
- **Implications**: 変換不可能パターンには代替 CSS 実装の指針が必要

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 単一 SKILL.md | 全マッピングとガイダンスを1ファイルに集約 | シンプル、発見容易、既存パターン準拠 | 長大化の可能性（推定 300-500 行） | 既存スキルと同一パターンで最も整合的 |
| 分割ファイル構成 | マッピングテーブルとガイダンスを別ファイルに分離 | 各ファイルが短くなる | 既存スキルパターンから逸脱、SKILL.md 以外のファイルは慣例外 | 既存の Claude Skills では単一ファイル構成のみ |

## Design Decisions

### Decision: 単一 SKILL.md ファイル構成
- **Context**: 新規 Skill のファイル構成をどうするか
- **Alternatives Considered**:
  1. 単一 SKILL.md に全情報を集約
  2. 複数ファイルに分割（マッピングテーブル、ガイダンス等）
- **Selected Approach**: 単一 SKILL.md に全情報を集約
- **Rationale**: 既存の全スキルが SKILL.md 単一ファイル構成。プロジェクトの慣例に準拠することが最優先
- **Trade-offs**: ファイルが長くなる可能性があるが、Markdown のセクション構造で管理可能
- **Follow-up**: 500 行を超える場合はセクション構造の最適化を検討

### Decision: グローバルスキルとして配置
- **Context**: Skill の配置場所（グローバル vs アプリ固有）
- **Alternatives Considered**:
  1. `.claude/skills/tailwind-to-bootstrap/` （グローバル）
  2. `apps/app/.claude/skills/tailwind-to-bootstrap/` （アプリ固有）
- **Selected Approach**: `.claude/skills/tailwind-to-bootstrap/` にグローバルスキルとして配置
- **Rationale**: Tailwind→Bootstrap 変換の知識は GROWI プロジェクト全体で参照される可能性がある。`apps/app` 固有のスキルは自動呼び出し対象だが、変換作業は明示的に実行するものなので手動呼び出し（`user-invocable` 省略/true）が適切
- **Trade-offs**: `apps/app` 以外では Tailwind を使用していないが、将来の参照可能性を考慮
- **Follow-up**: なし

### Decision: マッピングテーブル形式
- **Context**: Tailwind→Bootstrap の対応情報をどう表現するか
- **Alternatives Considered**:
  1. Markdown テーブル形式
  2. コード例の並置（Before/After）
  3. 両方の組み合わせ
- **Selected Approach**: テーブル形式を主体とし、複雑なパターンにはコード例を併用
- **Rationale**: テーブルは一覧性が高くクイックリファレンスとして最適。コンポーネント単位の変換にはコード例が必要
- **Trade-offs**: テーブルでは表現しきれない複雑なパターンがある
- **Follow-up**: 実装時にテーブルとコード例のバランスを調整

## Risks & Mitigations
- Bootstrap に等価クラスがないパターンが多数 → カスタム CSS 実装ガイダンスを提供
- SKILL.md が長大化する可能性 → セクション構造で整理、重要度の高いパターンを優先
- カラースペースの違い（OKLCH vs sRGB） → 近似色でのマッピング指針を提供
- Radix UI + Bootstrap の組み合わせは非標準 → Radix UI 維持 + スタイリングのみ置換のアプローチを推奨

## References
- Bootstrap 5.3 Utilities: https://getbootstrap.com/docs/5.3/utilities/api/
- Tailwind CSS v4 Documentation: https://tailwindcss.com/docs
- shadcn/ui Documentation: https://ui.shadcn.com/
- Radix UI Primitives: https://www.radix-ui.com/primitives
