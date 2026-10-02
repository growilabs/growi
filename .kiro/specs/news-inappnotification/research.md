# Research & Design Decisions

---
**Purpose**: Discovery findings and architectural rationale for the news-inappnotification feature.

---

## Summary

- **Feature**: `news-inappnotification`
- **Discovery Scope**: Complex Integration（新機能 + 既存 InAppNotification UI 拡張）
- **Key Findings**:
  - `CronService` 抽象クラスが `server/service/cron.ts` に存在。`NewsCronService extends CronService` のみで cron 基盤が利用可能
  - `InfiniteScroll` コンポーネントが `client/components/InfiniteScroll.tsx` に存在。`SWRInfiniteResponse` を受け取る汎用実装で再利用可能
  - サイドバーパネルは `Sidebar/InAppNotification/InAppNotification.tsx` が state を管理。フィルタ追加はここへの `useState` 追加で対応できる
  - マージドビュー（すべて）はサーバーサイド JOIN 不要。クライアントサイドで日時ソートするだけで実現できる
  - 既存 `useSWRxInAppNotifications` は `useSWR`（ページネーション）ベース。無限スクロールのために `useSWRInfinite` 版（`useSWRINFx` prefix）を新設する必要がある

---

## Research Log

### InAppNotification 既存実装の分析

- **Context**: NewsItem を既存 InAppNotification に乗せるか、別モデルにするかの判断
- **Sources**: `server/models/in-app-notification.ts`, `server/routes/apiv3/in-app-notification.ts`, `server/service/in-app-notification.ts`
- **Findings**:
  - InAppNotification は per-user ドキュメント設計。`user` フィールドが必須で、配信時点で全ユーザー分のドキュメントを生成する
  - `status` フィールド（UNOPENED/OPENED）は per-user ドキュメントが存在することを前提としており、配信時点でのドキュメント生成が不可避
  - `targetModel` と `action` が enum 制約を持ち、ニュースの externalId 管理に使えない
  - `snapshot` フィールドにニュース本文を格納した場合、ユーザー数分の本文コピーが発生する
- **Implications**: NewsItem は別モデルとして実装する。requirements.md の Note に記載された設計根拠が技術的に正確であることを確認

### CronService パターンの確認

- **Context**: フィード定期取得の実装方針
- **Sources**: `server/service/cron.ts`, `server/service/access-token/access-token-deletion-cron.ts`
- **Findings**:
  - `abstract getCronSchedule(): string` と `abstract executeJob(): Promise<void>` を実装するだけでよい
  - `node-cron` を使用。スケジュール変更は `getCronSchedule()` のオーバーライドで対応
  - `startCron()` を呼ぶだけで cron が開始される
- **Implications**: `NewsCronService` の実装は最小限で済む

### InfiniteScroll 実装パターン

- **Context**: 要件 5.4「無限スクロール」の実装方針
- **Sources**: `client/components/InfiniteScroll.tsx`, `stores/page-listing.tsx`
- **Findings**:
  - `InfiniteScroll` コンポーネントは `SWRInfiniteResponse` を props で受け取る汎用コンポーネント
  - `IntersectionObserver` でセンチネル要素を監視し、`setSize(size + 1)` でページ追加
  - `useSWRInfinite` のキー命名規則: `useSWRINFx*` prefix
  - `InAppNotificationSubstance.tsx` に `// TODO: Infinite scroll implemented` コメントあり。今回の実装でこの TODO を解消する
- **Implications**: `useSWRINFxNews` と `useSWRINFxInAppNotifications` を新設し、既存の `InfiniteScroll` コンポーネントをそのまま利用する

### フロントエンド状態管理パターン

- **Context**: フィルタタブ（すべて/通知/お知らせ）と未読トグルの状態管理方針
- **Sources**: `Sidebar/InAppNotification/InAppNotification.tsx`, Jotai atom パターン
- **Findings**:
  - 既存の「未読のみ」トグルは `useState` で管理され、prop として子コンポーネントに渡している
  - Jotai は cross-component の持続的 state に使用。パネル内のローカル UI state には `useState` で十分
  - フィルタタブは同様に `useState` で `'all' | 'news' | 'notifications'` を管理する
- **Implications**: Jotai は不要。`useState` で統一する

### クライアントサイドマージの実現可能性

- **Context**: 「すべて」フィルタで通知とニュースを時系列マージする実装
- **Findings**:
  - InAppNotification は `createdAt` 順、NewsItem は `publishedAt` 順
  - 両者を `useSWRInfinite` で別々に取得し、各ページのデータをマージしてソート
  - ページング境界をまたぐマージは複雑になるため、「すべて」フィルタ時は両 API を large limit（例: 20件）で fetch し、クライアントマージする方針
- **Implications**: 無限スクロールのマージは実装複雑度が高い。「すべて」フィルタ時は両データソースを独立した `useSWRInfinite` で管理し、表示時にマージする

### i18n キー管理

- **Context**: 新規 UI ラベルの多言語化
- **Sources**: `public/static/locales/ja_JP/commons.json`
- **Findings**:
  - `in_app_notification` 名前空間に既存キーが存在（`only_unread`, `no_notification` 等）
  - 対応ロケール: `ja_JP`, `en_US`, `zh_CN`, `ko_KR`, `fr_FR`
- **Implications**: 同名前空間に追加キー（`news`, `all`, `notifications`, `no_news`）を追加する

---

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks | Notes |
|---|---|---|---|---|
| サーバーサイドマージ | DB の aggregate で通知+ニュースを JOIN してソート | クライアントが単純 | 異なるモデルの JOIN は複雑、ページング境界の処理が難しい | 採用しない |
| **クライアントサイドマージ** | 別 API で取得しクライアントで日時ソート | 各 API が独立してシンプル | 「すべて」時は2回 API コール | **採用** |
| ニュース専用ページ | `/me/news` 等の別ページにニュースを表示 | 実装シンプル | 導線が分散、要件 5.1 に不合致 | 採用しない |

---

## Design Decisions

### Decision: NewsItem と NewsReadStatus を別モデルとする

- **Context**: InAppNotification モデルで代替できないか検討
- **Alternatives Considered**:
  1. InAppNotification モデルを拡張して newsItem を追加
  2. 新規 NewsItem + NewsReadStatus モデルを作成
- **Selected Approach**: 新規モデルを作成（Option 2）
- **Rationale**: InAppNotification は per-user ドキュメント設計。配信時に全ユーザー分のドキュメントを生成する必要があり、SaaS 規模でストレージ効率が悪い。NewsItem は全ユーザーで1件を共有し、NewsReadStatus は既読時のみ作成する
- **Trade-offs**: 新モデル追加のコストはあるが、スケール時のストレージ効率は大幅に向上する
- **Follow-up**: TTL インデックス（90日）の動作確認

### Decision: growiVersionRegExps のフィルタは cron 側で適用

- **Context**: バージョン条件のフィルタタイミング
- **Alternatives Considered**:
  1. DB に全件保存し、API クエリ時にフィルタ
  2. cron 取得時にフィルタし、該当アイテムのみ保存
- **Selected Approach**: cron 取得時にフィルタ（Option 2）
- **Rationale**: GROWI のバージョンはインスタンス起動時に確定し、動的に変わらない。DB に不要なデータを保存しない方がクリーン
- **Trade-offs**: バージョンアップ後に古いアイテムが再表示されない（次回 cron まで）。許容範囲内

### Decision: useSWRInfinite で InAppNotification も再実装

- **Context**: 既存 `useSWRxInAppNotifications` は `useSWR` ベース（ページネーション）
- **Alternatives Considered**:
  1. 既存 hook をそのまま使い、InAppNotification の無限スクロールは別途実装
  2. `useSWRInfinite` ベースの新 hook に切り替え
- **Selected Approach**: `useSWRINFxInAppNotifications` を新設（Option 2）
- **Rationale**: `InfiniteScroll` コンポーネントは `SWRInfiniteResponse` を要求する。既存 TODO コメントも無限スクロール実装を示唆している
- **Trade-offs**: 既存 `useSWRxInAppNotifications` は `InAppNotificationPage.tsx` でも使われているため、両方を維持する

---

## Risks & Mitigations

- クライアントサイドマージで「すべて」フィルタ時に2倍の API コール — 初回は許容。将来的にサーバーサイド集約 API を検討
- フィード URL が HTTPS でない場合のセキュリティリスク — `NEWS_FEED_URL` のバリデーションで `https://` を強制
- `growiVersionRegExps` の regex が不正な場合 — try-catch でキャッチし、そのアイテムをスキップしてログ記録

---

## References

- [node-cron documentation](https://github.com/node-cron/node-cron) — cron スケジュール構文
- [SWR Infinite Loading](https://swr.vercel.app/docs/pagination#infinite-loading) — `useSWRInfinite` パターン
- [Mongoose TTL indexes](https://mongoosejs.com/docs/guide.html#indexes) — TTL インデックス設定
