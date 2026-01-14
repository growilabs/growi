# Google Workspace OAuth 2.0 メール送信機能実装計画

## 概要

Google Workspace (Gmail) の OAuth 2.0 (XOAUTH2) 認証を使ったメール送信機能を実装する。2025年5月1日以降、Gmail SMTP ではユーザー名とパスワード認証がサポートされなくなったため、OAuth 2.0 への移行が必要。

## 背景

- **問題**: Gmail SMTP でのユーザー名・パスワード認証が2025年5月1日にサポート終了
- **解決策**: OAuth 2.0 (XOAUTH2) 認証方式の実装
- **参考**: https://support.google.com/a/answer/2956491?hl=ja
- **ライブラリ**: nodemailer v6.9.15 は OAuth 2.0 をサポート済み（バージョンアップ不要）

## 技術仕様

### 必須設定パラメータ

| パラメータ | 説明 | セキュリティ |
|-----------|------|------------|
| `mail:oauth2ClientId` | Google Cloud Console で取得する OAuth 2.0 クライアント ID | 通常 |
| `mail:oauth2ClientSecret` | OAuth 2.0 クライアントシークレット | `isSecret: true` |
| `mail:oauth2RefreshToken` | OAuth 2.0 リフレッシュトークン | `isSecret: true` |
| `mail:oauth2User` | 送信者のGmailアドレス | 通常 |

### nodemailer 設定例

```typescript
const transportOptions = {
  service: 'gmail',
  auth: {
    type: 'OAuth2',
    user: 'user@example.com',
    clientId: 'CLIENT_ID',
    clientSecret: 'CLIENT_SECRET',
    refreshToken: 'REFRESH_TOKEN',
  },
};