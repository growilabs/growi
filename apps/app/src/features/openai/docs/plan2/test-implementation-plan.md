# Editor Assistant テスト計画 - 包括的デグレ防止戦略

## 🎯 テスト戦略概要

### 目的
- **デグレ防止**: 将来の改修時における機能退行の完全防止
- **信頼性確保**: Editor Assistant機能の確実な動作保証
- **保守性向上**: テスト駆動による安全な機能拡張基盤

### LLM統合テストの課題と解決策
- **課題**: 実際のLLM呼び出しはコスト・時間・不安定性
- **解決**: モック・スタブを活用した確定的テスト環境

## 📋 3層テスト戦略

### 1️⃣ Unit Tests (*.spec.ts) - 個別機能テスト
**環境**: Node.js  
**対象**: 純粋関数、ユーティリティ、ビジネスロジック

#### 🔍 Client-side Core Functions
```typescript
// search-replace-engine.spec.ts
- performSearchReplace()の全パターン
- 完全一致、fuzzyマッチング、失敗ケース
- YText操作の検証

// fuzzy-matching.spec.ts  
- ClientFuzzyMatcher全メソッド
- 類似度計算の精度検証
- middle-out検索アルゴリズム

// text-normalization.spec.ts
- Unicode正規化の各種パターン
- スマートクォート、タイポグラフィ文字
- エッジケース（空文字列、特殊文字）

// error-handling.spec.ts
- エラー分類の正確性
- 修復提案の妥当性
- エラーメッセージの多言語対応
```

#### 🛡️ Server-side Validation & Processing
```typescript
// llm-response-stream-processor.spec.ts
- isDiffItem()バリデーション全パターン
- startLine必須チェックの厳密性
- エラーログの詳細度検証

// schemas.spec.ts (新規)
- LlmEditorAssistantDiffSchemaの全バリデーション
- SseFinalizedSchemaのエラー報告機能
- 不正データに対する適切な拒否
```

### 2️⃣ Integration Tests (*.integ.ts) - システム統合テスト  
**環境**: Node.js + MongoDB Memory Server  
**対象**: API〜データベース間の実際の統合動作

#### 🌐 API Integration Tests
```typescript
// edit-endpoint.integ.ts (新規)
- /api/v3/ai/edit エンドポイントの完全テスト
- 認証・認可の検証
- リクエスト/レスポンス形式の厳密チェック
- エラーハンドリングの統合検証

// stream-processing.integ.ts (新規)  
- SSEストリーミングの実際の動作
- 大きなレスポンスの分割処理
- 接続エラー時の復旧処理
- タイムアウト処理
```

#### 🗄️ Data Layer Integration
```typescript
// database-interaction.integ.ts (新規)
- スレッド保存・取得の整合性
- エラーログの永続化
- パフォーマンス監視データの記録
```

### 3️⃣ Component Tests (*.spec.tsx) - UI統合テスト
**環境**: happy-dom + React Testing Library  
**対象**: Reactコンポーネントとuser interaction

#### 🖱️ User Interface Tests
```typescript
// use-editor-assistant.spec.tsx (新規)
- useEditorAssistantフックの全ライフサイクル
- detectedDiff処理の完全フロー
- エラー状態でのUI表示
- ロード状態の適切な表示

// ai-assistant-sidebar.spec.tsx (新規)
- サイドバーコンポーネントの統合動作
- ユーザー入力からAPI呼び出しまで
- 成功・失敗ケースでのUI変化
- アクセシビリティ準拠の検証
```

## 🎭 LLM呼び出しのモック戦略

### OpenAI API モック
```typescript
// test/mocks/openai-mock.ts (新規)
export const createMockOpenAIResponse = (scenario: 'success' | 'error' | 'timeout') => {
  // 実際のOpenAI APIレスポンス形式を模倣
  // 確定的な結果を返す
}

// 使用例: 様々なLLMレスポンスパターンを再現
- 正常なsearch/replace応答
- 不正なJSON形式
- startLine欠損
- ネットワークエラー
- レート制限エラー
```

### SSE Stream モック
```typescript
// test/mocks/sse-mock.ts (新規)
export const createMockSSEStream = (data: any[]) => {
  // Server-Sent Eventsの実際の動作を模倣
  // チャンク分割、リアルタイム配信の再現
}
```

## 📈 テストカバレッジ目標

### カバレッジ指標
- **行カバレッジ**: 95%以上
- **分岐カバレッジ**: 90%以上  
- **関数カバレッジ**: 100%
- **ステートメントカバレッジ**: 95%以上

### 重要度別テスト密度
```typescript
// 🔴 Critical (100%カバレッジ必須)
- search-replace-engine.ts
- fuzzy-matching.ts  
- llm-response-stream-processor.ts
- schemas validation

// 🟡 Important (95%カバレッジ目標)
- error-handling.ts
- text-normalization.ts
- use-editor-assistant.tsx

// 🟢 Standard (85%カバレッジ目標)  
- utility functions
- UI components
```

## 🏗️ テスト実装順序

### Phase 1: Core Unit Tests (優先度最高)
1. `search-replace-engine.spec.ts`
2. `fuzzy-matching.spec.ts`
3. `llm-response-stream-processor.spec.ts`
4. `schemas.spec.ts`

### Phase 2: Integration Tests  
1. `edit-endpoint.integ.ts`
2. `stream-processing.integ.ts`

### Phase 3: Component Tests
1. `use-editor-assistant.spec.tsx`
2. `ai-assistant-sidebar.spec.tsx`

### Phase 4: E2E Simulation Tests
1. `editor-assistant-workflow.spec.ts` (統合シナリオ)

## 🛡️ デグレ防止のための継続的品質保証

### Pre-commit Hooks
```bash
# .husky/pre-commit に追加
npm run test:editor-assistant
npm run test:coverage -- --threshold=95
```

### CI/CD パイプライン統合
```yaml
# .github/workflows/test.yml に追加
- name: Run Editor Assistant Tests
  run: |
    npm run test:unit -- src/features/openai
    npm run test:integration -- src/features/openai  
    npm run test:components -- src/features/openai
```

### 品質ゲート
- **すべてのテストがパス**: 必須
- **カバレッジ95%以上**: 必須  
- **新機能には対応テスト**: 必須
- **エラーパターンの網羅**: 推奨

---

**作成日**: 2025-06-18  
**対象**: Phase 5 包括テスト実装  
**参考**: apps/app/src/features/openai/docs/plan2/testing-framework.md
