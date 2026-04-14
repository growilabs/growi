# Requirements Document

## Introduction

本仕様は、GROWI の share link 専用ページ取得 API エンドポイントの要件を定義する。

現行の `/_api/v3/page` ルートは、通常の認証アクセスと share link アクセスの両方を単一ルートで処理している。ミドルウェアチェーン（`accessTokenParser → certifySharedPage → loginRequired`）と handler 内の条件分岐によって混在しており、コードの可読性と保守性に課題がある。

本機能では share link アクセス専用のエンドポイントを分離することで、責務を明確化する。同時に、既存のミドルウェア・サービス関数を最大限に再利用し、ロジックの重複を最小化することを設計原則とする。

---

## Requirements

### Requirement 1: 専用エンドポイントの提供

**Objective:** As a クライアントアプリケーション, I want share link 専用の独立した API エンドポイント, so that share link 経由のページアクセスが通常の認証付きアクセスと明確に分離される。

#### Acceptance Criteria

1. The Share Link Page API shall provide a dedicated endpoint distinct from the general `/_api/v3/page` endpoint for share link-based page access.
2. When a request is sent to the dedicated share link endpoint, the Share Link Page API shall process it independently of the authenticated page access middleware chain (`accessTokenParser`, `loginRequired`).
3. The Share Link Page API shall accept `shareLinkId` and `pageId` as required request parameters.
4. The Share Link Page API shall return a response in the same JSON structure as the existing page API (`{ page, meta }`).

---

### Requirement 2: シェアリンクの検証

**Objective:** As a GROWI システム, I want share link validation before returning any page data, so that 無効・期限切れのリンクからページデータが漏洩しない。

#### Acceptance Criteria

1. When a request is received, the Share Link Page API shall verify that a ShareLink document with the specified `shareLinkId` exists in the database and its `relatedPage` field matches the specified `pageId`.
2. If the ShareLink document does not exist, its `relatedPage` does not match `pageId`, or the ShareLink has expired, the Share Link Page API shall return a 404 error response without exposing any page data.
3. While link sharing is disabled via the `security:disableLinkSharing` configuration, the Share Link Page API shall return a 403 error response for all requests regardless of link validity.

---

### Requirement 3: ページデータの返却

**Objective:** As a share link 閲覧者, I want to receive page content and metadata via the API, so that ページを正常にレンダリングできる。

#### Acceptance Criteria

1. When a valid and non-expired share link is provided, the Share Link Page API shall return the page document including its latest revision data.
2. When returning page data for a share link request, the Share Link Page API shall set `isMovable`, `isDeletable`, `isAbleToDeleteCompletely`, and `isRevertible` to `false` in the meta field.
3. When returning page data for a share link request, the Share Link Page API shall return `bookmarkCount` as `0`.
4. If the referenced page does not exist, the Share Link Page API shall return a 404 error response.

---

### Requirement 4: 認証不要のアクセス

**Objective:** As an 未認証ユーザー, I want to access share link pages without logging in, so that share link の公開アクセス性が担保される。

#### Acceptance Criteria

1. The Share Link Page API shall not require user authentication (session cookie, access token) to process requests.
2. When an unauthenticated request includes a valid and non-expired `shareLinkId`, the Share Link Page API shall return the page data.
3. While link sharing is enabled, the Share Link Page API shall serve page data to any requester regardless of authentication state.

---

### Requirement 5: コード重複の最小化

**Objective:** As a 開発者, I want the share link endpoint to reuse existing middleware and service layer code, so that ロジックの重複による保守コストとバグリスクを低減できる。

#### Acceptance Criteria

1. The Share Link Page API shall reuse the existing page data retrieval service function (e.g., `findPageAndMetaDataByViewer`) with the `isSharedPage: true` option, rather than reimplementing page fetch and metadata computation logic.
2. The Share Link Page API shall reuse the existing `certifySharedPage` middleware for ShareLink validation, rather than duplicating the validation logic.
3. The Share Link Page API implementation shall not duplicate the page response serialization logic already present in the existing `/_api/v3/page` route handler. The extracted `respondWithSinglePage` utility shall be shared between both endpoints.
4. Where applicable, common request validators (e.g., `pageId` format checks) shall be shared between the dedicated endpoint and the existing route rather than redefined.
