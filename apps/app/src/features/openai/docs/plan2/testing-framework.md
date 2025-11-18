# テスト戦略 - roo-code知見とPhase 5対応

## 🧪 テスト設計方針

### roo-codeから学んだベストプラクティス

#### 1. 包括的テストカバレッジ
- **実用的なコード例**: 関数、クラス、インデント、タブ/スペース混在
- **エラーケース徹底検証**: マーカー検証、シーケンス検証、境界値テスト
- **パフォーマンステスト**: 大きなファイル、複数diff処理

#### 2. 段階的バリデーション
```typescript
// roo-codeテストパターンの適用
describe('GROWI Editor Assistant Validation', () => {
  describe('Phase 1: 基本的なバリデーション', () => {
    it('should require startLine field')
    it('should require non-empty search field')
    it('should accept valid replace field (empty allowed)')
  })
  
  describe('Phase 2: 検索処理', () => {
    it('should find exact matches at specified line')
    it('should find fuzzy matches within threshold')
    it('should reject matches below threshold')
  })
  
  describe('Phase 3: 置換処理', () => {
    it('should replace content at correct position')
    it('should preserve indentation')
    it('should handle multiple replacements in order')
  })
})
```

## 📋 Phase 5テスト項目

### 1. 核心機能テスト

#### Search-Replace基本動作
```typescript
describe('Search-Replace Core Functionality', () => {
  test('完全一致での置換', async () => {
    const originalContent = `function test() {
  console.log("hello");
}`;
    const diff = {
      search: 'console.log("hello");',
      replace: 'console.log("world");',
      startLine: 2
    };
    
    const result = await performSearchReplace(yText, diff.search, diff.replace, diff.startLine);
    expect(result).toBe(true);
    expect(yText.toString()).toContain('console.log("world");');
  });

  test('Fuzzy Matching（80%類似度）', async () => {
    const originalContent = `function  test() {
    console.log( "hello" );
}`;
    const diff = {
      search: 'console.log("hello");',  // スペース違い
      replace: 'console.log("world");',
      startLine: 2
    };
    
    const result = await performSearchReplace(yText, diff.search, diff.replace, diff.startLine);
    expect(result).toBe(true);  // 80%以上の類似度で成功
  });

  test('類似度不足での失敗', async () => {
    const diff = {
      search: 'completely_different_content',
      replace: 'new_content',
      startLine: 2
    };
    
    const result = await performSearchReplace(yText, diff.search, diff.replace, diff.startLine);
    expect(result).toBe(false);  // 類似度不足で失敗
  });
});
```

#### startLine必須バリデーション
```typescript
describe('startLine Validation', () => {
  test('サーバー側バリデーション', () => {
    const invalidDiff = { search: 'test', replace: 'new' }; // startLineなし
    expect(() => validateDiffStructure(invalidDiff)).toThrow('startLine is required');
  });

  test('クライアント側バリデーション', () => {
    const diffs = [{ search: 'test', replace: 'new' }]; // startLineなし
    expect(() => validateDiffs(diffs)).toThrow('startLine is required for client processing');
  });
});
```

### 2. エラーハンドリングテスト

#### 詳細エラー報告
```typescript
describe('Error Handling and Reporting', () => {
  test('類似度不足エラーの詳細情報', async () => {
    const result = await fuzzyMatcher.findBestMatch(content, 'nonexistent', { preferredStartLine: 1 });
    
    expect(result.success).toBe(false);
    expect(result.error).toEqual({
      type: 'SIMILARITY_TOO_LOW',
      message: expect.stringContaining('類似度が不十分'),
      details: {
        searchContent: 'nonexistent',
        bestMatch: expect.any(String),
        similarity: expect.any(Number),
        suggestions: expect.arrayContaining([
          'read_fileツールで最新のファイル内容を確認',
          '空白やインデントの違いを確認'
        ])
      }
    });
  });

  test('修正提案の生成', () => {
    const error = createSimilarityError('search_text', 'best_match', 0.6);
    expect(error.details.suggestions).toContain('類似度の閾値を下げることを検討');
  });
});
```

### 3. インデント・フォーマット保持テスト

#### roo-code互換のインデント処理
```typescript
describe('Indentation and Formatting', () => {
  test('タブインデントの保持', async () => {
    const originalContent = `function test() {
\tconsole.log("hello");
}`;
    const diff = {
      search: '\tconsole.log("hello");',
      replace: '\tconsole.log("world");',
      startLine: 2
    };
    
    const result = await performSearchReplace(yText, diff.search, diff.replace, diff.startLine);
    expect(yText.toString()).toContain('\tconsole.log("world");');
  });

  test('スペースインデントの保持', async () => {
    const originalContent = `function test() {
    console.log("hello");
}`;
    const diff = {
      search: '    console.log("hello");',
      replace: '    console.log("world");',
      startLine: 2
    };
    
    const result = await performSearchReplace(yText, diff.search, diff.replace, diff.startLine);
    expect(yText.toString()).toContain('    console.log("world");');
  });

  test('混在インデントの処理', async () => {
    // タブとスペースが混在する場合の正規化テスト
  });
});
```

### 4. 複数diff処理テスト

#### 順序・競合処理
```typescript
describe('Multiple Diff Processing', () => {
  test('複数diffの順序処理', async () => {
    const diffs = [
      { search: 'line1', replace: 'newLine1', startLine: 1 },
      { search: 'line3', replace: 'newLine3', startLine: 3 },
      { search: 'line2', replace: 'newLine2', startLine: 2 }
    ];
    
    // startLineでソートされて処理されることを確認
    const result = await applyMultipleDiffs(yText, diffs);
    expect(result.appliedCount).toBe(3);
    expect(result.success).toBe(true);
  });

  test('部分失敗時の処理継続', async () => {
    const diffs = [
      { search: 'existing', replace: 'new1', startLine: 1 },
      { search: 'nonexistent', replace: 'new2', startLine: 2 },
      { search: 'existing2', replace: 'new3', startLine: 3 }
    ];
    
    const result = await applyMultipleDiffs(yText, diffs);
    expect(result.appliedCount).toBe(2);  // 1つ失敗、2つ成功
    expect(result.failedParts).toHaveLength(1);
  });
});
```

### 5. パフォーマンステスト

#### roo-code準拠の効率検証
```typescript
describe('Performance Tests', () => {
  test('大きなファイルでの処理時間', async () => {
    const largeContent = 'line\n'.repeat(10000);  // 10,000行
    const startTime = performance.now();
    
    const result = await performSearchReplace(
      createYTextFromString(largeContent),
      'line',
      'newLine',
      5000  // 中央付近の行
    );
    
    const endTime = performance.now();
    expect(endTime - startTime).toBeLessThan(1000);  // 1秒以内
    expect(result).toBe(true);
  });

  test('Middle-out検索の効率性', async () => {
    // 指定行から近い位置にある内容が素早く見つかることを確認
    const content = generateTestContent(1000);
    const matcher = new ClientFuzzyMatcher();
    
    const result = await matcher.findBestMatch(content, 'target_line', {
      preferredStartLine: 500,
      bufferLines: 20
    });
    
    expect(result.success).toBe(true);
    expect(result.matchedLine).toBeCloseTo(500, 20);  // 指定行から20行以内
  });
});
```

## 🎯 Phase 5テスト実行指針

### 優先度1: 必須動作確認
1. **startLine必須バリデーション**: サーバー・クライアント両方
2. **基本的なsearch-replace**: 完全一致での置換
3. **Fuzzy Matching**: 80%閾値での動作

### 優先度2: エラーハンドリング
1. **詳細エラー報告**: 失敗理由と修正提案
2. **部分失敗処理**: 一部差分の失敗時の継続処理
3. **バリデーションエラー**: 不正データの適切な処理

### 優先度3: 高度機能
1. **インデント保持**: タブ・スペース・混在の処理
2. **複数diff順序**: startLineによる適切なソート
3. **パフォーマンス**: 大きなファイルでの応答性

## 🔧 テスト環境セットアップ

### テストデータ生成
```typescript
// テスト用のコンテンツ生成
export function createTestContent(type: 'javascript' | 'typescript' | 'mixed') {
  switch (type) {
    case 'javascript':
      return `function test() {
  console.log("hello");
  return true;
}`;
    case 'typescript':
      return `interface User {
  name: string;
  age: number;
}`;
    case 'mixed':
      return `function test() {
\tconsole.log("tab indent");
    console.log("space indent");
}`;
  }
}
```

### モックYText実装
```typescript
// Yjs YTextのモック実装
export class MockYText {
  private content: string = '';
  
  toString(): string { return this.content; }
  insert(index: number, text: string): void { /* 実装 */ }
  delete(index: number, length: number): void { /* 実装 */ }
}
```

---

**テスト戦略作成日**: 2025-06-18  
**参考資料**: roo-code test suite (1,186行)  
**対象Phase**: Phase 2A・2B実装の検証
