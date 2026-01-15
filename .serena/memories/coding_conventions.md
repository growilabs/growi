# コーディング規約とスタイルガイド

## Linter・フォーマッター設定

### Biome設定（統一予定）
- **適用範囲**: 
  - dist/, node_modules/, coverage/ などは除外
  - .next/, bin/, config/ などのビルド成果物は除外
  - package.json などの設定ファイルは除外
- **推奨**: 新規開発では Biome を使用

## TypeScript設定
- **ターゲット**: ESNext
- **モジュール**: ESNext  
- **厳格モード**: 有効（strict: true）
- **モジュール解決**: Bundler
- **その他**:
  - allowJs: true（JSファイルも許可）
  - skipLibCheck: true（型チェックの最適化）
  - isolatedModules: true（単独モジュールとしてコンパイル）

## Stylelint設定
- SCSS/CSSファイルに対して適用
- recess-order設定を使用（プロパティの順序規定）
- recommended-scss設定を適用

## ファイル命名規則
- TypeScript/JavaScriptファイル: キャメルケースまたはケバブケース
- コンポーネントファイル: PascalCase（Reactコンポーネント）
- 設定ファイル: ドット記法（.biome.json など）

## テストファイル命名規則（Vitest）
vitest.workspace.mts の設定に基づく：

### 単体テスト（Unit Test）
- **ファイル名**: `*.spec.{ts,js}`
- **環境**: Node.js
- **例**: `utils.spec.ts`, `helper.spec.js`

### 統合テスト（Integration Test）
- **ファイル名**: `*.integ.ts`
- **環境**: Node.js（MongoDB設定あり）
- **例**: `api.integ.ts`, `service.integ.ts`

### コンポーネントテスト（Component Test）
- **ファイル名**: `*.spec.{tsx,jsx}`
- **環境**: happy-dom
- **例**: `Button.spec.tsx`, `Modal.spec.jsx`

## ディレクトリ構造の規則
- `src/`: ソースコード
- `test/`: Jest用の古いテストファイル（廃止予定）
- `test-with-vite/`: Vitest用の新しいテストファイル
- `playwright/`: E2Eテストファイル
- `config/`: 設定ファイル
- `public/`: 静的ファイル
- `dist/`: ビルド出力

## 移行ガイドライン
- 新規開発: Biome + Vitest を使用
- 既存コード: 段階的に Jest → Vitest に移行