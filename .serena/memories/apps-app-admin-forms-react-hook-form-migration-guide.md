# Admin フォーム - React Hook Form 移行ガイドライン

## プロジェクトコンテキスト

### 現状 (2025年10月時点)
**✅ PR #10051 完了: Admin フォームの IME 問題は100%解決済み**

全27ファイルが React Hook Form に移行完了し、以下の問題を解決：
1. ✅ **日本語 IME 入力の問題**: 非制御コンポーネント化により完全解決
2. ✅ **空値更新の問題**: 完全解決
3. ⏳ **レガシーライブラリ問題**: Unstated は現在も使用中（次のステップで解決予定）

### 最終目標 (理想像)
- React Hook Form を利用（✅ 完了）
- Unstated を完全に廃止（⏳ 次のステップ）
- グローバルステートは Jotai で管理（⏳ 次のステップ）

### 現在の構成 (中間地点)
**React Hook Form + Unstated Container のハイブリッド構成**

この構成により：
1. ✅ IME 入力問題を解決（非制御コンポーネント化）
2. ✅ 空値更新問題を解決
3. ✅ Container は残しているが、将来的に Jotai への移行パスを確保
4. ✅ 段階的な移行によりリグレッションを最小化

## 移行パターン（確立済み）

### 基本的なフォームセットアップ

```typescript
import { useForm } from 'react-hook-form';

type FormData = {
  fieldName: string;
  // ... 他のフィールド
};

const {
  register,
  handleSubmit,
  reset,
} = useForm<FormData>();
```

**重要**: `defaultValues` は指定しない。`useEffect` で `reset()` を呼ぶため不要。

### フォーム値の復元

Container の state とフォームを同期するため、`useEffect` で `reset()` を使用：

```typescript
useEffect(() => {
  reset({
    fieldName: container.state.fieldName || '',
    // ... 他のフィールド
  });
}, [container.state.fieldName, reset]);
```

### Container を使ったフォーム送信

```typescript
const onSubmit = useCallback(async(data: FormData) => {
  try {
    // 重要: API 呼び出し前に setState の完了を待つ
    await Promise.all([
      container.changeField1(data.field1),
      container.changeField2(data.field2),
    ]);
    
    await container.updateHandler();
    toastSuccess(t('updated_successfully'));
  }
  catch (err) {
    toastError(err);
  }
}, [container, t]);

return (
  <form onSubmit={handleSubmit(onSubmit)}>
    {/* フォームフィールド */}
  </form>
);
```

## 重要な注意点

### ⚠️ 1. API 呼び出し前に Container の setState を await する（最重要！）

**問題**: Unstated Container の `setState` は非同期処理です。`change*()` メソッドの後に `await` せずに API ハンドラーを即座に呼ぶと、API リクエストは**古い/古びた値**で送信されます。

❌ **間違い:**
```typescript
container.changeSiteUrl(data.siteUrl);
await container.updateHandler(); // 古い値が送信される！
```

✅ **正しい:**
```typescript
await container.changeSiteUrl(data.siteUrl);
await container.updateHandler(); // 新しい値が送信される
```

複数フィールドの場合は `Promise.all()` を使用：
```typescript
await Promise.all([
  container.changeTitle(data.title),
  container.changeConfidential(data.confidential),
]);
await container.updateHandler();
```

### 2. ラジオボタンの値の型の一致

**問題**: ラジオボタンは**文字列**の値を持ちますが、Container の state は boolean かもしれません。型が一致しないと、選択状態の復元ができません。

❌ **間違い:**
```typescript
// HTML: <input type="radio" value="true" />
reset({
  isEmailPublished: true, // boolean - 文字列 "true" とマッチしない
});
```

✅ **正しい:**
```typescript
reset({
  isEmailPublished: String(container.state.isEmailPublished ?? true),
});
```

### 3. チェックボックスの値の扱い

チェックボックスは boolean 値を直接使えます（変換不要）：
```typescript
reset({
  fileUpload: container.state.fileUpload ?? false,
});
```

### 4. リアルタイム Container 更新に watch() を使わない

**削除したパターン**: フォームの変更を `watch()` と `useEffect` でリアルタイムに Container に同期し戻すのは不要で、複雑さを増すだけです。

❌ **これはやらない:**
```typescript
const watchedValues = watch();
useEffect(() => {
  container.changeField(watchedValues.field);
}, [watchedValues]);
```

✅ **submit 時だけ更新:**
- Container の state は最終的な API リクエストにのみ使用される
- `onSubmit` で API ハンドラーを呼ぶ前に更新すればよい

### 5. フォームフィールドの disabled vs readOnly

**問題**: `disabled` フィールドはフォーム送信データから除外されます。

フィールドを編集不可にしたいが、フォームデータには含めたい場合：
- `disabled` の代わりに `readOnly` を使用
- または属性を削除して Container/API レイヤーで処理

### 6. defaultValues を指定しない

`useForm()` の引数に `defaultValues` を渡さないこと。

理由：
- `useEffect` で `reset()` を呼んでいるため、初期値はそちらで設定される
- コードの重複を避ける
- 他のファイルとパターンを統一

```typescript
// ❌ 冗長
const { register, reset } = useForm({
  defaultValues: { field: container.state.field }
});
useEffect(() => {
  reset({ field: container.state.field });
}, [container.state.field]);

// ✅ シンプル
const { register, reset } = useForm();
useEffect(() => {
  reset({ field: container.state.field });
}, [container.state.field]);
```

## 高度なパターン

### モジュラーコンポーネント設計（SecuritySetting の例）

大規模なフォームは、複数の小さなコンポーネントに分割することを推奨します。

**親コンポーネント（統合）:**
```typescript
type FormData = {
  sessionMaxAge: string;
  // Container で管理される他のフィールドは不要
};

const Parent: React.FC<Props> = ({ container }) => {
  const { register, handleSubmit, reset } = useForm<FormData>();

  useEffect(() => {
    reset({
      sessionMaxAge: container.state.sessionMaxAge || '',
    });
  }, [reset, container.state.sessionMaxAge]);

  const onSubmit = useCallback(async(data: FormData) => {
    try {
      // React Hook Form で管理されているフィールドのみ更新
      await container.setSessionMaxAge(data.sessionMaxAge);
      // 全ての設定を保存（Container 管理のフィールドも含む）
      await container.updateGeneralSecuritySetting();
      toastSuccess(t('updated'));
    }
    catch (err) {
      toastError(err);
    }
  }, [container, t]);

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      {/* React Hook Form 管理のフィールド */}
      <SessionMaxAgeSettings register={register} t={t} />
      
      {/* Container 直接管理のフィールド */}
      <PageListDisplaySettings container={container} t={t} />
      <PageAccessRightsSettings container={container} t={t} />
      
      <button type="submit">{t('Update')}</button>
    </form>
  );
};
```

**子コンポーネント（React Hook Form 管理）:**
```typescript
type Props = {
  register: UseFormRegister<{ sessionMaxAge: string }>;
  t: (key: string) => string;
};

export const SessionMaxAgeSettings: React.FC<Props> = ({ register, t }) => {
  return (
    <input
      className="form-control"
      type="text"
      {...register('sessionMaxAge')}
      placeholder="2592000000"
    />
  );
};
```

**子コンポーネント（Container 直接管理）:**
```typescript
type Props = {
  container: AdminGeneralSecurityContainer;
  t: (key: string) => string;
};

export const PageListDisplaySettings: React.FC<Props> = ({ container, t }) => {
  return (
    <select
      className="form-control"
      value={container.state.currentOwnerRestrictionDisplayMode}
      onChange={(e) => container.changeOwnerRestrictionDisplayMode(e.target.value)}
    >
      <option value="Displayed">{t('Displayed')}</option>
      <option value="Hidden">{t('Hidden')}</option>
    </select>
  );
};
```

### 統一された Submit ボタン

複数のセクションを持つフォームでも、Submit ボタンは1つに統一：
- React Hook Form のフィールドは `onSubmit` で処理
- Container 管理のフィールドは既に state に反映されている
- 1つの `updateHandler()` で全て保存

## テストチェックリスト

フォーム移行後に必ずテストすること：

1. ✅ **日本語 IME 入力と漢字変換** - 最も重要！
2. ✅ **ページリロード後にフォームの値が正しく復元される**
3. ✅ **空値を送信できる**（フィールドをクリアできる）
4. ✅ **フォーム送信で現在の入力値が送信される**（古い/古びた値ではない）
5. ✅ **ラジオボタンとチェックボックスが正しく復元される**
6. ✅ **複数セクションがある場合、全ての設定が1つの Submit で保存される**

## PR #10051 の成果

全27ファイルを React Hook Form に移行完了：

### 主要な成果
1. **企業認証システム**: LDAP (10フィールド)、OIDC (16フィールド)、SAML (9フィールド)
2. **SecuritySetting のモジュラー化**: 636行のクラスコンポーネント → 8つの Function Component
3. **セキュリティ設定**: LocalSecurity (1フィールド)、Import (4フィールド)
4. **カスタマイズ**: CustomizeCss (1フィールド)、Slack (2フィールド)
5. **その他**: 17ファイル

### アーキテクチャの改善
- TypeScript 完全対応
- PropTypes 廃止
- Function Component への統一
- モジュラー設計の採用
- テスト容易性の向上

## 将来の移行パス: Unstated から Jotai へ

### フェーズ 1: React Hook Form 移行（✅ 完了）
- 全ての Admin フォームを React Hook Form に移行
- IME 問題と空値問題を解決
- 非制御コンポーネントパターンを確立

### フェーズ 2: Jotai 導入準備（次のステップ）
1. **Container の分析**
   - どの state が本当にグローバルである必要があるか特定
   - ローカル state で十分なものを useState に移行

2. **API レイヤーの分離**
   - Container の `update*Handler()` メソッドを独立した API 関数に抽出
   - `apps/app/src/client/util/apiv3-client.ts` パターンに従う

3. **段階的な Container の削除**
   - 小さな Container から始める
   - Jotai atom で置き換え
   - 各ステップでテストを実行

### フェーズ 3: 完全な Jotai 移行（最終目標）
```typescript
// 理想的な最終形態
import { atom, useAtom } from 'jotai';
import { useForm } from 'react-hook-form';

// グローバル state
const sessionMaxAgeAtom = atom<string>('');

const SecuritySetting = () => {
  const [sessionMaxAge, setSessionMaxAge] = useAtom(sessionMaxAgeAtom);
  const { register, handleSubmit, reset } = useForm();

  useEffect(() => {
    reset({ sessionMaxAge });
  }, [sessionMaxAge, reset]);

  const onSubmit = async(data: FormData) => {
    // 直接 API 呼び出し
    await apiv3Put('/admin/security-settings', {
      sessionMaxAge: data.sessionMaxAge,
      // ... 他の設定
    });
    
    // Jotai state を更新
    setSessionMaxAge(data.sessionMaxAge);
    toastSuccess('Updated');
  };

  return <form onSubmit={handleSubmit(onSubmit)}>{/* ... */}</form>;
};
```

## 適用可能な範囲

このガイドラインは以下の Admin フォームに適用可能：

- Unstated Container でグローバルステートを管理しているフォーム
- `apps/app/src/client/services/Admin*Container.js` 配下の Container を使用しているフォーム
- `/admin` ルート配下のコンポーネント
- 将来的に Jotai に移行予定のフォーム

## 関連ファイル

### 現在使用中
- Container 群: `apps/app/src/client/services/Admin*Container.js`
- ボタンコンポーネント: `apps/app/src/client/components/Admin/Common/AdminUpdateButtonRow.tsx`
- React Hook Form: v7.45.4

### 将来導入予定
- Jotai: グローバル state 管理
- SWR または React Query: サーバー state 管理（検討中）

## 参考実装

以下のファイルがベストプラクティスの参考になります：

1. **モジュラー構造**: `apps/app/src/client/components/Admin/Security/SecuritySetting/`
2. **React Hook Form 基本**: `apps/app/src/client/components/Admin/Security/OidcSecuritySettingContents.tsx`
3. **複雑なフォーム**: `apps/app/src/client/components/Admin/Security/SamlSecuritySettingContents.tsx`
4. **既存の良い実装**: `apps/app/src/client/components/Admin/Customize/CustomizeCssSetting.tsx`
