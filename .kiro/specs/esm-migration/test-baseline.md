# Test Baseline (pre-migration)

Phase 0.1 (_Requirements: 2.9, 6.3_) deliverable.

## 捕捉環境

- Branch: `support/esm` (master に対して spec のみ追加、実装差分なし)
- Node.js: v24.13.1
- pnpm: 10.32.1
- turbo: 2.1.3
- Vitest workspace: `app-unit` + `app-integration` + `app-components`
- 実行コマンド: `turbo run test --filter @growi/app --force -- --reporter=verbose --reporter=json --outputFile=run{N}.json`
- 実行回数: 3 連続 (`--force` で turbo キャッシュ無効化)

## サマリ

| Run | Test Files | Tests | Pass | Fail | Duration (vitest) |
|-----|-----------:|------:|-----:|-----:|------------------:|
| 1   | 155 | 1690 | 1690 | 0 | 25.41s |
| 2   | 155 | 1690 | 1690 | 0 | 15.07s |
| 3   | 155 | 1690 | 1690 | 0 | 14.99s |

**真の失敗 (3 回連続 fail)**: 0 件
**既知 flaky (1〜2 回 fail)**: 0 件

Phase 3 以降の Req 2.9 / 6.3 判定では、以下の per-spec テーブルと比較して差分のみを新規失敗として扱う。

## 判定ルール

- **3 回とも `✓`**: GREEN baseline — 新規失敗を許容しない
- **1〜2 回 `✗`**: 既知 flaky として許容 (差分判定の対象外)
- **3 回とも `✗`**: 既に壊れている — ESM 移行とは独立に修正が必要

## Per-spec Status (155 files)

| # | Spec File | Run1 | Run2 | Run3 | Tests |
|---|-----------|------|------|------|-------|
| 1 | `bin/openapi/generate-operation-ids/cli.spec.ts` | ✓ | ✓ | ✓ | 4 |
| 2 | `bin/openapi/generate-operation-ids/generate-operation-ids.spec.ts` | ✓ | ✓ | ✓ | 8 |
| 3 | `config/migrate-mongo-config.spec.ts` | ✓ | ✓ | ✓ | 4 |
| 4 | `docker/docker-entrypoint.spec.ts` | ✓ | ✓ | ✓ | 27 |
| 5 | `src/client/components/Admin/App/useFileUploadSettings.spec.ts` | ✓ | ✓ | ✓ | 10 |
| 6 | `src/client/components/Common/Dropdown/PageItemControl.spec.tsx` | ✓ | ✓ | ✓ | 2 |
| 7 | `src/client/components/DescendantsPageListModal/DescendantsPageListModal.spec.tsx` | ✓ | ✓ | ✓ | 6 |
| 8 | `src/client/components/Hotkeys/HotkeysManager.spec.tsx` | ✓ | ✓ | ✓ | 3 |
| 9 | `src/client/components/Hotkeys/Subscribers/CreatePage.spec.tsx` | ✓ | ✓ | ✓ | 2 |
| 10 | `src/client/components/Hotkeys/Subscribers/EditPage.spec.tsx` | ✓ | ✓ | ✓ | 6 |
| 11 | `src/client/components/Hotkeys/Subscribers/FocusToGlobalSearch.spec.tsx` | ✓ | ✓ | ✓ | 4 |
| 12 | `src/client/components/Hotkeys/Subscribers/ShowShortcutsModal.spec.tsx` | ✓ | ✓ | ✓ | 4 |
| 13 | `src/client/components/Hotkeys/Subscribers/ShowStaffCredit.spec.tsx` | ✓ | ✓ | ✓ | 2 |
| 14 | `src/client/components/Hotkeys/Subscribers/SwitchToMirrorMode.spec.tsx` | ✓ | ✓ | ✓ | 2 |
| 15 | `src/client/components/LoginForm/LoginForm.spec.tsx` | ✓ | ✓ | ✓ | 9 |
| 16 | `src/client/components/NotAvailableForReadOnlyUser.spec.tsx` | ✓ | ✓ | ✓ | 4 |
| 17 | `src/client/components/PageEditor/EditorNavbar/EditingUserList.spec.tsx` | ✓ | ✓ | ✓ | 12 |
| 18 | `src/client/components/PageHeader/PageTitleHeader.spec.tsx` | ✓ | ✓ | ✓ | 3 |
| 19 | `src/client/components/TemplateModal/use-formatter.spec.tsx` | ✓ | ✓ | ✓ | 4 |
| 20 | `src/client/util/mongo-id.spec.ts` | ✓ | ✓ | ✓ | 8 |
| 21 | `src/client/util/watch-rendering-and-rescroll.spec.tsx` | ✓ | ✓ | ✓ | 10 |
| 22 | `src/components/PageView/PageContentRenderer.spec.tsx` | ✓ | ✓ | ✓ | 3 |
| 23 | `src/components/PageView/use-hash-auto-scroll.spec.tsx` | ✓ | ✓ | ✓ | 15 |
| 24 | `src/components/Script/DrawioViewerScript/use-viewer-min-js-url.spec.ts` | ✓ | ✓ | ✓ | 4 |
| 25 | `src/components/utils/use-lazy-loader.spec.tsx` | ✓ | ✓ | ✓ | 18 |
| 26 | `src/features/ai-tools/suggest-path/server/integration-tests/suggest-path-integration.spec.ts` | ✓ | ✓ | ✓ | 41 |
| 27 | `src/features/ai-tools/suggest-path/server/routes/apiv3/index.spec.ts` | ✓ | ✓ | ✓ | 6 |
| 28 | `src/features/ai-tools/suggest-path/server/services/analyze-content.spec.ts` | ✓ | ✓ | ✓ | 20 |
| 29 | `src/features/ai-tools/suggest-path/server/services/evaluate-candidates.spec.ts` | ✓ | ✓ | ✓ | 23 |
| 30 | `src/features/ai-tools/suggest-path/server/services/generate-category-suggestion.spec.ts` | ✓ | ✓ | ✓ | 15 |
| 31 | `src/features/ai-tools/suggest-path/server/services/generate-memo-suggestion.spec.ts` | ✓ | ✓ | ✓ | 14 |
| 32 | `src/features/ai-tools/suggest-path/server/services/generate-suggestions.spec.ts` | ✓ | ✓ | ✓ | 20 |
| 33 | `src/features/ai-tools/suggest-path/server/services/resolve-parent-grant.spec.ts` | ✓ | ✓ | ✓ | 18 |
| 34 | `src/features/ai-tools/suggest-path/server/services/retrieve-search-candidates.spec.ts` | ✓ | ✓ | ✓ | 16 |
| 35 | `src/features/audit-log-bulk-export/server/routes/apiv3/audit-log-bulk-export.integ.ts` | ✓ | ✓ | ✓ | 11 |
| 36 | `src/features/audit-log-bulk-export/server/service/audit-log-bulk-export-job-clean-up-cron.integ.ts` | ✓ | ✓ | ✓ | 3 |
| 37 | `src/features/audit-log-bulk-export/server/service/audit-log-bulk-export-job-cron/audit-log-bulk-export-job-cron-service.integ.ts` | ✓ | ✓ | ✓ | 14 |
| 38 | `src/features/audit-log-bulk-export/server/service/audit-log-bulk-export.integ.ts` | ✓ | ✓ | ✓ | 11 |
| 39 | `src/features/callout/services/callout.spec.ts` | ✓ | ✓ | ✓ | 3 |
| 40 | `src/features/external-user-group/server/models/external-user-group-relation.integ.ts` | ✓ | ✓ | ✓ | 5 |
| 41 | `src/features/external-user-group/server/models/external-user-group.integ.ts` | ✓ | ✓ | ✓ | 5 |
| 42 | `src/features/external-user-group/server/service/external-user-group-sync.integ.ts` | ✓ | ✓ | ✓ | 3 |
| 43 | `src/features/external-user-group/server/service/keycloak-user-group-sync.integ.ts` | ✓ | ✓ | ✓ | 1 |
| 44 | `src/features/external-user-group/server/service/ldap-user-group-sync.integ.ts` | ✓ | ✓ | ✓ | 2 |
| 45 | `src/features/growi-plugin/server/models/growi-plugin.integ.ts` | ✓ | ✓ | ✓ | 4 |
| 46 | `src/features/growi-plugin/server/models/vo/github-url.spec.ts` | ✓ | ✓ | ✓ | 11 |
| 47 | `src/features/growi-plugin/server/services/growi-plugin/growi-plugin.integ.ts` | ✓ | ✓ | ✓ | 4 |
| 48 | `src/features/mermaid/components/MermaidViewer.spec.tsx` | ✓ | ✓ | ✓ | 4 |
| 49 | `src/features/openai/client/services/editor-assistant/fuzzy-matching.spec.ts` | ✓ | ✓ | ✓ | 50 |
| 50 | `src/features/openai/client/services/editor-assistant/get-page-body-for-context.spec.ts` | ✓ | ✓ | ✓ | 10 |
| 51 | `src/features/openai/client/services/editor-assistant/search-replace-engine.spec.ts` | ✓ | ✓ | ✓ | 24 |
| 52 | `src/features/openai/interfaces/editor-assistant/llm-response-schemas.spec.ts` | ✓ | ✓ | ✓ | 34 |
| 53 | `src/features/openai/interfaces/editor-assistant/sse-schemas.spec.ts` | ✓ | ✓ | ✓ | 28 |
| 54 | `src/features/openai/server/services/editor-assistant/llm-response-stream-processor.spec.ts` | ✓ | ✓ | ✓ | 44 |
| 55 | `src/features/openai/server/services/normalize-data/normalize-thread-relation-expired-at/normalize-thread-relation-expired-at.integ.ts` | ✓ | ✓ | ✓ | 3 |
| 56 | `src/features/openai/server/utils/generate-glob-patterns.spec.ts` | ✓ | ✓ | ✓ | 4 |
| 57 | `src/features/opentelemetry/server/anonymization/handlers/page-access-handler.spec.ts` | ✓ | ✓ | ✓ | 17 |
| 58 | `src/features/opentelemetry/server/anonymization/handlers/page-api-handler.spec.ts` | ✓ | ✓ | ✓ | 30 |
| 59 | `src/features/opentelemetry/server/anonymization/handlers/page-listing-api-handler.spec.ts` | ✓ | ✓ | ✓ | 23 |
| 60 | `src/features/opentelemetry/server/anonymization/handlers/search-api-handler.spec.ts` | ✓ | ✓ | ✓ | 21 |
| 61 | `src/features/opentelemetry/server/anonymization/utils/anonymize-query-params.spec.ts` | ✓ | ✓ | ✓ | 17 |
| 62 | `src/features/opentelemetry/server/custom-metrics/application-metrics.spec.ts` | ✓ | ✓ | ✓ | 6 |
| 63 | `src/features/opentelemetry/server/custom-metrics/page-counts-metrics.spec.ts` | ✓ | ✓ | ✓ | 5 |
| 64 | `src/features/opentelemetry/server/custom-metrics/user-counts-metrics.spec.ts` | ✓ | ✓ | ✓ | 5 |
| 65 | `src/features/opentelemetry/server/custom-resource-attributes/application-resource-attributes.spec.ts` | ✓ | ✓ | ✓ | 4 |
| 66 | `src/features/opentelemetry/server/custom-resource-attributes/os-resource-attributes.spec.ts` | ✓ | ✓ | ✓ | 3 |
| 67 | `src/features/opentelemetry/server/node-sdk.spec.ts` | ✓ | ✓ | ✓ | 10 |
| 68 | `src/features/page-bulk-export/server/service/page-bulk-export-job-clean-up-cron.integ.ts` | ✓ | ✓ | ✓ | 3 |
| 69 | `src/features/page-tree/components/ItemsTree.spec.tsx` | ✓ | ✓ | ✓ | 7 |
| 70 | `src/features/page-tree/hooks/_inner/use-auto-expand-ancestors.spec.tsx` | ✓ | ✓ | ✓ | 28 |
| 71 | `src/features/page-tree/hooks/_inner/use-data-loader.integration.spec.tsx` | ✓ | ✓ | ✓ | 5 |
| 72 | `src/features/page-tree/hooks/_inner/use-data-loader.spec.tsx` | ✓ | ✓ | ✓ | 18 |
| 73 | `src/features/page-tree/hooks/use-page-create.spec.tsx` | ✓ | ✓ | ✓ | 8 |
| 74 | `src/features/page-tree/hooks/use-page-dnd.spec.ts` | ✓ | ✓ | ✓ | 16 |
| 75 | `src/features/page-tree/hooks/use-placeholder-rename-effect.spec.tsx` | ✓ | ✓ | ✓ | 9 |
| 76 | `src/features/page-tree/states/_inner/page-tree-create.spec.tsx` | ✓ | ✓ | ✓ | 6 |
| 77 | `src/features/plantuml/components/PlantUmlViewer.spec.tsx` | ✓ | ✓ | ✓ | 4 |
| 78 | `src/features/rate-limiter/middleware/consume-points.integ.ts` | ✓ | ✓ | ✓ | 3 |
| 79 | `src/features/search/client/components/SearchPage/SearchResultContent.spec.tsx` | ✓ | ✓ | ✓ | 3 |
| 80 | `src/features/search/client/components/SearchPage/use-keyword-rescroll.spec.tsx` | ✓ | ✓ | ✓ | 9 |
| 81 | `src/features/search/utils/disable-user-pages.spec.ts` | ✓ | ✓ | ✓ | 4 |
| 82 | `src/lib/empty-module.spec.ts` | ✓ | ✓ | ✓ | 2 |
| 83 | `src/migrations/20210913153942-migrate-slack-app-integration-schema.integ.ts` | ✓ | ✓ | ✓ | 1 |
| 84 | `src/models/serializers/in-app-notification-snapshot/page-bulk-export-job-client.spec.ts` | ✓ | ✓ | ✓ | 1 |
| 85 | `src/pages/[[...path]]/use-same-route-navigation.spec.tsx` | ✓ | ✓ | ✓ | 3 |
| 86 | `src/pages/general-page/use-initial-csr-fetch.spec.tsx` | ✓ | ✓ | ✓ | 6 |
| 87 | `src/pages/utils/nextjs-routing-utils.spec.ts` | ✓ | ✓ | ✓ | 20 |
| 88 | `src/pages/utils/superjson-ssr.spec.ts` | ✓ | ✓ | ✓ | 10 |
| 89 | `src/server/middlewares/access-token-parser/access-token.integ.ts` | ✓ | ✓ | ✓ | 6 |
| 90 | `src/server/middlewares/access-token-parser/api-token.integ.ts` | ✓ | ✓ | ✓ | 6 |
| 91 | `src/server/middlewares/certify-shared-page-attachment/certify-shared-page-attachment.spec.ts` | ✓ | ✓ | ✓ | 5 |
| 92 | `src/server/middlewares/certify-shared-page-attachment/validate-referer/retrieve-site-url.spec.ts` | ✓ | ✓ | ✓ | 3 |
| 93 | `src/server/middlewares/certify-shared-page-attachment/validate-referer/validate-referer.spec.ts` | ✓ | ✓ | ✓ | 7 |
| 94 | `src/server/middlewares/exclude-read-only-user.spec.ts` | ✓ | ✓ | ✓ | 3 |
| 95 | `src/server/middlewares/login-required.spec.ts` | ✓ | ✓ | ✓ | 19 |
| 96 | `src/server/middlewares/safe-redirect.spec.ts` | ✓ | ✓ | ✓ | 6 |
| 97 | `src/server/models/page-redirect.integ.ts` | ✓ | ✓ | ✓ | 4 |
| 98 | `src/server/models/page.integ.ts` | ✓ | ✓ | ✓ | 31 |
| 99 | `src/server/models/update-post.spec.ts` | ✓ | ✓ | ✓ | 3 |
| 100 | `src/server/models/user/user.integ.ts` | ✓ | ✓ | ✓ | 7 |
| 101 | `src/server/models/v5.page.integ.ts` | ✓ | ✓ | ✓ | 24 |
| 102 | `src/server/routes/apiv3/app-settings/file-upload-setting.integ.ts` | ✓ | ✓ | ✓ | 10 |
| 103 | `src/server/routes/apiv3/page/get-page-info.integ.ts` | ✓ | ✓ | ✓ | 10 |
| 104 | `src/server/routes/apiv3/page/respond-with-single-page.spec.ts` | ✓ | ✓ | ✓ | 6 |
| 105 | `src/server/routes/attachment/image-content-type-validator.spec.ts` | ✓ | ✓ | ✓ | 22 |
| 106 | `src/server/service/acl.integ.ts` | ✓ | ✓ | ✓ | 17 |
| 107 | `src/server/service/activity/update-activity.spec.ts` | ✓ | ✓ | ✓ | 8 |
| 108 | `src/server/service/config-manager/config-loader.spec.ts` | ✓ | ✓ | ✓ | 4 |
| 109 | `src/server/service/config-manager/config-manager.integ.ts` | ✓ | ✓ | ✓ | 13 |
| 110 | `src/server/service/config-manager/config-manager.spec.ts` | ✓ | ✓ | ✓ | 12 |
| 111 | `src/server/service/file-uploader/multipart-uploader.spec.ts` | ✓ | ✓ | ✓ | 13 |
| 112 | `src/server/service/file-uploader/utils/headers.spec.ts` | ✓ | ✓ | ✓ | 9 |
| 113 | `src/server/service/growi-bridge/index.spec.ts` | ✓ | ✓ | ✓ | 11 |
| 114 | `src/server/service/growi-info/growi-info.integ.ts` | ✓ | ✓ | ✓ | 8 |
| 115 | `src/server/service/import/construct-convert-map.integ.ts` | ✓ | ✓ | ✓ | 1 |
| 116 | `src/server/service/import/import.spec.ts` | ✓ | ✓ | ✓ | 1 |
| 117 | `src/server/service/mail/mail.spec.ts` | ✓ | ✓ | ✓ | 16 |
| 118 | `src/server/service/mail/oauth2.spec.ts` | ✓ | ✓ | ✓ | 8 |
| 119 | `src/server/service/mail/ses.spec.ts` | ✓ | ✓ | ✓ | 5 |
| 120 | `src/server/service/mail/smtp.spec.ts` | ✓ | ✓ | ✓ | 8 |
| 121 | `src/server/service/page-listing/page-listing.integ.ts` | ✓ | ✓ | ✓ | 15 |
| 122 | `src/server/service/page/delete-completely-user-home-by-system.integ.ts` | ✓ | ✓ | ✓ | 2 |
| 123 | `src/server/service/page/page-grant.integ.ts` | ✓ | ✓ | ✓ | 25 |
| 124 | `src/server/service/page/page.integ.ts` | ✓ | ✓ | ✓ | 13 |
| 125 | `src/server/service/page/v5.migration.integ.ts` | ✓ | ✓ | ✓ | 17 |
| 126 | `src/server/service/page/v5.non-public-page.integ.ts` | ✓ | ✓ | ✓ | 24 |
| 127 | `src/server/service/page/v5.page.integ.ts` | ✓ | ✓ | ✓ | 5 |
| 128 | `src/server/service/page/v5.public-page.integ.ts` | ✓ | ✓ | ✓ | 42 |
| 129 | `src/server/service/passport.spec.ts` | ✓ | ✓ | ✓ | 18 |
| 130 | `src/server/service/revision/normalize-latest-revision-if-broken.integ.ts` | ✓ | ✓ | ✓ | 10 |
| 131 | `src/server/service/search-query.spec.ts` | ✓ | ✓ | ✓ | 4 |
| 132 | `src/server/service/search/search-service.integ.ts` | ✓ | ✓ | ✓ | 6 |
| 133 | `src/server/service/user-group.integ.ts` | ✓ | ✓ | ✓ | 9 |
| 134 | `src/server/service/yjs/guard-socket.spec.ts` | ✓ | ✓ | ✓ | 3 |
| 135 | `src/server/service/yjs/upgrade-handler.spec.ts` | ✓ | ✓ | ✓ | 6 |
| 136 | `src/server/service/yjs/websocket-connection.integ.ts` | ✓ | ✓ | ✓ | 5 |
| 137 | `src/server/service/yjs/yjs.integ.ts` | ✓ | ✓ | ✓ | 6 |
| 138 | `src/server/util/compare-objectId.spec.ts` | ✓ | ✓ | ✓ | 4 |
| 139 | `src/server/util/is-simple-request.spec.ts` | ✓ | ✓ | ✓ | 39 |
| 140 | `src/server/util/safe-path-utils.spec.ts` | ✓ | ✓ | ✓ | 25 |
| 141 | `src/server/util/scope-util.spec.ts` | ✓ | ✓ | ✓ | 10 |
| 142 | `src/server/util/stream.spec.ts` | ✓ | ✓ | ✓ | 1 |
| 143 | `src/services/general-xss-filter/general-xss-filter.spec.ts` | ✓ | ✓ | ✓ | 4 |
| 144 | `src/services/renderer/recommended-whitelist.spec.ts` | ✓ | ✓ | ✓ | 24 |
| 145 | `src/services/renderer/rehype-plugins/relative-links-by-pukiwiki-like-linker.spec.ts` | ✓ | ✓ | ✓ | 8 |
| 146 | `src/services/renderer/rehype-plugins/relative-links.spec.ts` | ✓ | ✓ | ✓ | 11 |
| 147 | `src/services/renderer/remark-plugins/pukiwiki-like-linker.spec.ts` | ✓ | ✓ | ✓ | 8 |
| 148 | `src/states/page/use-fetch-current-page.spec.tsx` | ✓ | ✓ | ✓ | 28 |
| 149 | `src/utils/axios/convert-strings-to-dates.spec.ts` | ✓ | ✓ | ✓ | 16 |
| 150 | `src/utils/axios/index.spec.ts` | ✓ | ✓ | ✓ | 15 |
| 151 | `src/utils/locale-utils.spec.ts` | ✓ | ✓ | ✓ | 18 |
| 152 | `src/utils/promise.spec.ts` | ✓ | ✓ | ✓ | 3 |
| 153 | `src/utils/to-array-from-csv.spec.ts` | ✓ | ✓ | ✓ | 5 |
| 154 | `test/setup/crowi.integ.ts` | ✓ | ✓ | ✓ | 6 |
| 155 | `test/setup/mongo/utils.spec.ts` | ✓ | ✓ | ✓ | 17 |