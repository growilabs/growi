# Test Baseline (pre-migration, GROWI v8)

Phase R.6.5 (0.1) (_Requirements: 2.9, 6.3_) deliverable。Phase 0.1 の旧ベースライン (master / 155 files / 1690 tests) を GROWI v8 基準で全面再取得したもの。

## 捕捉環境

- Branch: `dev/8.0.x` HEAD `447ddd20ad` の git worktree (`/workspace/growi-baseline`)
- Node.js: v24.15.0
- pnpm: 11.1.1
- turbo: 2.9.16
- Vitest projects (JSON 出力から観測): `app-unit` / `app-integration` / `app-components` / `app-integration-vault`
- 実行コマンド: `turbo run test --filter @growi/app --force -- --reporter=verbose --reporter=json --outputFile=/tmp/test-baseline-run{N}.json`
- 実行回数: 3 連続 (`--force` で turbo キャッシュ無効化)

注記:

- worktree には route-middleware snapshot (R.6.2) 用の naming-only 変更 10 ファイル (middleware factory の named function 化、挙動同一) が適用されている
- mongodb-memory-server のバイナリキャッシュ (`apps/app/node_modules/.cache/mongodb-binaries/mongod-x64-ubuntu-6.0.9`) が完全であることが前提 — 切り詰められたバイナリは全 integ テストを SIGSEGV させる

## サマリ

| Run | Test Files | Tests | Pass | Fail | Duration (vitest) |
|-----|-----------:|------:|-----:|-----:|------------------:|
| 1   | 219 | 2669 | 2669 | 0 | 43.10s |
| 2   | 219 | 2669 | 2669 | 0 | 45.44s |
| 3   | 219 | 2669 | 2665 | 4 | 40.41s |

**真の失敗 (3 回連続 fail)**: 0 件
**既知 flaky (1〜2 回 fail)**: 1 file — `src/features/growi-vault/__tests__/clone-e2e.integ.ts`

### 既知 flaky の詳細

`src/features/growi-vault/__tests__/clone-e2e.integ.ts` (describe `GROWI Vault — clone E2E contract`) の以下 4 テストが **Run3 のみ** 失敗 (Run1/Run2 は通過):

1. admin clone yields exact bodies for every fixture page
2. member clone includes public pages and excludes admin-only page
3. anonymous clone includes public pages and excludes admin-only page
4. single-page rename removes the old file and adds the new file in the clone

失敗理由: テスト内で起動する ephemeral git HTTP server への `git clone` が `fatal: repository 'http://127.0.0.1:<port>/vault.git/' not found` で失敗 (server 起動タイミング起因)。同ファイルの 5 テスト目 (`HTTP request with invalid PAT returns 401`、clone を伴わない) は Run3 でも通過している。

検算: 3 つの JSON の `testResults` はいずれも 219 files、`assertionResults` 合計はいずれも 2669 tests で、上記サマリおよび vitest log の `Test Files` / `Tests` 行と一致。ファイルごとのテスト数も 3 run で完全一致 (不一致 0 件)。

Phase 3 以降の Req 2.9 / 6.3 判定では、以下の per-spec テーブルと比較して差分のみを新規失敗として扱う。

## 判定ルール

- **3 回とも `✓`**: GREEN baseline — 新規失敗を許容しない
- **1〜2 回 `✗`**: 既知 flaky として許容 (差分判定の対象外)
- **3 回とも `✗`**: 既に壊れている — ESM 移行とは独立に修正が必要

## Per-spec Status (219 files)

ファイルパスは `/workspace/growi-baseline/apps/app/` からの相対。✓/✗ は per-file 判定 (そのファイルの全テストが passed なら ✓)。Tests 列はファイルごとのテスト数 (3 run で全ファイル一致)。

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
| 18 | `src/client/components/PageEditor/EditorNavbarBottom/GrantSelector.spec.tsx` | ✓ | ✓ | ✓ | 2 |
| 19 | `src/client/components/PageHeader/PageTitleHeader.spec.tsx` | ✓ | ✓ | ✓ | 3 |
| 20 | `src/client/components/Sidebar/InAppNotification/InAppNotificationForms.spec.tsx` | ✓ | ✓ | ✓ | 7 |
| 21 | `src/client/components/TemplateModal/use-formatter.spec.tsx` | ✓ | ✓ | ✓ | 4 |
| 22 | `src/client/util/mongo-id.spec.ts` | ✓ | ✓ | ✓ | 8 |
| 23 | `src/client/util/watch-rendering-and-rescroll.spec.tsx` | ✓ | ✓ | ✓ | 10 |
| 24 | `src/components/PageView/PageContentRenderer.spec.tsx` | ✓ | ✓ | ✓ | 3 |
| 25 | `src/components/PageView/use-hash-auto-scroll.spec.tsx` | ✓ | ✓ | ✓ | 15 |
| 26 | `src/components/Script/DrawioViewerScript/patch-stencil-registry-urls.spec.ts` | ✓ | ✓ | ✓ | 9 |
| 27 | `src/components/Script/DrawioViewerScript/use-viewer-min-js-url.spec.ts` | ✓ | ✓ | ✓ | 4 |
| 28 | `src/components/utils/use-lazy-loader.spec.tsx` | ✓ | ✓ | ✓ | 18 |
| 29 | `src/features/ai-tools/suggest-path/server/integration-tests/suggest-path-integration.spec.ts` | ✓ | ✓ | ✓ | 41 |
| 30 | `src/features/ai-tools/suggest-path/server/routes/apiv3/index.spec.ts` | ✓ | ✓ | ✓ | 6 |
| 31 | `src/features/ai-tools/suggest-path/server/services/analyze-content.spec.ts` | ✓ | ✓ | ✓ | 20 |
| 32 | `src/features/ai-tools/suggest-path/server/services/evaluate-candidates.spec.ts` | ✓ | ✓ | ✓ | 23 |
| 33 | `src/features/ai-tools/suggest-path/server/services/generate-category-suggestion.spec.ts` | ✓ | ✓ | ✓ | 15 |
| 34 | `src/features/ai-tools/suggest-path/server/services/generate-memo-suggestion.spec.ts` | ✓ | ✓ | ✓ | 14 |
| 35 | `src/features/ai-tools/suggest-path/server/services/generate-suggestions.spec.ts` | ✓ | ✓ | ✓ | 20 |
| 36 | `src/features/ai-tools/suggest-path/server/services/resolve-parent-grant.spec.ts` | ✓ | ✓ | ✓ | 18 |
| 37 | `src/features/ai-tools/suggest-path/server/services/retrieve-search-candidates.spec.ts` | ✓ | ✓ | ✓ | 16 |
| 38 | `src/features/audit-log-bulk-export/server/routes/apiv3/audit-log-bulk-export.integ.ts` | ✓ | ✓ | ✓ | 11 |
| 39 | `src/features/audit-log-bulk-export/server/service/audit-log-bulk-export-job-clean-up-cron.integ.ts` | ✓ | ✓ | ✓ | 3 |
| 40 | `src/features/audit-log-bulk-export/server/service/audit-log-bulk-export-job-cron/audit-log-bulk-export-job-cron-service.integ.ts` | ✓ | ✓ | ✓ | 14 |
| 41 | `src/features/audit-log-bulk-export/server/service/audit-log-bulk-export.integ.ts` | ✓ | ✓ | ✓ | 11 |
| 42 | `src/features/callout/services/callout.spec.ts` | ✓ | ✓ | ✓ | 3 |
| 43 | `src/features/external-user-group/server/models/external-user-group-relation.integ.ts` | ✓ | ✓ | ✓ | 5 |
| 44 | `src/features/external-user-group/server/models/external-user-group.integ.ts` | ✓ | ✓ | ✓ | 5 |
| 45 | `src/features/external-user-group/server/service/external-user-group-sync.integ.ts` | ✓ | ✓ | ✓ | 3 |
| 46 | `src/features/external-user-group/server/service/keycloak-user-group-sync.integ.ts` | ✓ | ✓ | ✓ | 1 |
| 47 | `src/features/external-user-group/server/service/ldap-user-group-sync.integ.ts` | ✓ | ✓ | ✓ | 2 |
| 48 | `src/features/growi-plugin/server/models/growi-plugin.integ.ts` | ✓ | ✓ | ✓ | 4 |
| 49 | `src/features/growi-plugin/server/models/vo/github-url.spec.ts` | ✓ | ✓ | ✓ | 11 |
| 50 | `src/features/growi-plugin/server/services/growi-plugin/growi-plugin.integ.ts` | ✓ | ✓ | ✓ | 4 |
| 51 | `src/features/growi-vault/__tests__/clone-e2e.integ.ts` | ✓ | ✓ | ✗ | 5 |
| 52 | `src/features/growi-vault/__tests__/vault-gateway.integ.ts` | ✓ | ✓ | ✓ | 11 |
| 53 | `src/features/growi-vault/client/admin/VaultAdminSettings.spec.tsx` | ✓ | ✓ | ✓ | 37 |
| 54 | `src/features/growi-vault/client/i18n-reconcile.spec.ts` | ✓ | ✓ | ✓ | 16 |
| 55 | `src/features/growi-vault/server/index.spec.ts` | ✓ | ✓ | ✓ | 46 |
| 56 | `src/features/growi-vault/server/middlewares/vault-pat-auth.spec.ts` | ✓ | ✓ | ✓ | 18 |
| 57 | `src/features/growi-vault/server/models/vault-reconcile-log.spec.ts` | ✓ | ✓ | ✓ | 38 |
| 58 | `src/features/growi-vault/server/models/vault-sync-state.spec.ts` | ✓ | ✓ | ✓ | 37 |
| 59 | `src/features/growi-vault/server/routes/__tests__/vault-admin-reconcile.spec.ts` | ✓ | ✓ | ✓ | 15 |
| 60 | `src/features/growi-vault/server/routes/__tests__/vault-page-reconcile.spec.ts` | ✓ | ✓ | ✓ | 10 |
| 61 | `src/features/growi-vault/server/routes/vault-admin.spec.ts` | ✓ | ✓ | ✓ | 17 |
| 62 | `src/features/growi-vault/server/routes/vault-gateway.spec.ts` | ✓ | ✓ | ✓ | 25 |
| 63 | `src/features/growi-vault/server/services/reconcile/__tests__/reconcile-acl-evaluator.spec.ts` | ✓ | ✓ | ✓ | 14 |
| 64 | `src/features/growi-vault/server/services/reconcile/__tests__/reconcile-concurrency-controller.spec.ts` | ✓ | ✓ | ✓ | 20 |
| 65 | `src/features/growi-vault/server/services/reconcile/__tests__/reconcile-flow.integ.ts` | ✓ | ✓ | ✓ | 8 |
| 66 | `src/features/growi-vault/server/services/reconcile/__tests__/reconcile-history-store.spec.ts` | ✓ | ✓ | ✓ | 16 |
| 67 | `src/features/growi-vault/server/services/reconcile/__tests__/reconcile-orchestrator-overhead.integ.ts` | ✓ | ✓ | ✓ | 3 |
| 68 | `src/features/growi-vault/server/services/reconcile/__tests__/reconcile-orchestrator.spec.ts` | ✓ | ✓ | ✓ | 19 |
| 69 | `src/features/growi-vault/server/services/reconcile/__tests__/reconcile-service.spec.ts` | ✓ | ✓ | ✓ | 29 |
| 70 | `src/features/growi-vault/server/services/reconcile/__tests__/reconcile-target-resolver.spec.ts` | ✓ | ✓ | ✓ | 29 |
| 71 | `src/features/growi-vault/server/services/resilience/__tests__/bootstrap-heartbeat.spec.ts` | ✓ | ✓ | ✓ | 12 |
| 72 | `src/features/growi-vault/server/services/resilience/__tests__/bootstrap-runner.spec.ts` | ✓ | ✓ | ✓ | 35 |
| 73 | `src/features/growi-vault/server/services/resilience/__tests__/bootstrap-state-machine.spec.ts` | ✓ | ✓ | ✓ | 36 |
| 74 | `src/features/growi-vault/server/services/resilience/__tests__/bootstrap-trigger-resolver.spec.ts` | ✓ | ✓ | ✓ | 39 |
| 75 | `src/features/growi-vault/server/services/resilience/__tests__/drift-detector.spec.ts` | ✓ | ✓ | ✓ | 21 |
| 76 | `src/features/growi-vault/server/services/resilience/__tests__/resilience-flow.integ.ts` | ✓ | ✓ | ✓ | 20 |
| 77 | `src/features/growi-vault/server/services/resilience/__tests__/resilience-index.spec.ts` | ✓ | ✓ | ✓ | 11 |
| 78 | `src/features/growi-vault/server/services/resilience/__tests__/retry-policy.spec.ts` | ✓ | ✓ | ✓ | 24 |
| 79 | `src/features/growi-vault/server/services/vault-bootstrapper.spec.ts` | ✓ | ✓ | ✓ | 18 |
| 80 | `src/features/growi-vault/server/services/vault-dispatcher.spec.ts` | ✓ | ✓ | ✓ | 21 |
| 81 | `src/features/growi-vault/server/services/vault-manager-client.spec.ts` | ✓ | ✓ | ✓ | 16 |
| 82 | `src/features/growi-vault/server/services/vault-namespace-mapper.spec.ts` | ✓ | ✓ | ✓ | 21 |
| 83 | `src/features/growi-vault/server/services/vault-settings-service.spec.ts` | ✓ | ✓ | ✓ | 7 |
| 84 | `src/features/mermaid/components/MermaidViewer.spec.tsx` | ✓ | ✓ | ✓ | 4 |
| 85 | `src/features/news/client/components/NewsItem.spec.tsx` | ✓ | ✓ | ✓ | 13 |
| 86 | `src/features/news/server/models/news-item.spec.ts` | ✓ | ✓ | ✓ | 5 |
| 87 | `src/features/news/server/models/news-read-status.spec.ts` | ✓ | ✓ | ✓ | 3 |
| 88 | `src/features/news/server/routes/news-integration.integ.ts` | ✓ | ✓ | ✓ | 11 |
| 89 | `src/features/news/server/routes/news.spec.ts` | ✓ | ✓ | ✓ | 16 |
| 90 | `src/features/news/server/services/news-cron-service.spec.ts` | ✓ | ✓ | ✓ | 14 |
| 91 | `src/features/news/server/services/news-service.spec.ts` | ✓ | ✓ | ✓ | 19 |
| 92 | `src/features/openai/client/services/editor-assistant/fuzzy-matching.spec.ts` | ✓ | ✓ | ✓ | 50 |
| 93 | `src/features/openai/client/services/editor-assistant/get-page-body-for-context.spec.ts` | ✓ | ✓ | ✓ | 10 |
| 94 | `src/features/openai/client/services/editor-assistant/search-replace-engine.spec.ts` | ✓ | ✓ | ✓ | 24 |
| 95 | `src/features/openai/interfaces/editor-assistant/llm-response-schemas.spec.ts` | ✓ | ✓ | ✓ | 34 |
| 96 | `src/features/openai/interfaces/editor-assistant/sse-schemas.spec.ts` | ✓ | ✓ | ✓ | 28 |
| 97 | `src/features/openai/server/services/editor-assistant/llm-response-stream-processor.spec.ts` | ✓ | ✓ | ✓ | 44 |
| 98 | `src/features/openai/server/services/normalize-data/normalize-thread-relation-expired-at/normalize-thread-relation-expired-at.integ.ts` | ✓ | ✓ | ✓ | 3 |
| 99 | `src/features/openai/server/utils/generate-glob-patterns.spec.ts` | ✓ | ✓ | ✓ | 4 |
| 100 | `src/features/opentelemetry/server/anonymization/handlers/page-access-handler.spec.ts` | ✓ | ✓ | ✓ | 17 |
| 101 | `src/features/opentelemetry/server/anonymization/handlers/page-api-handler.spec.ts` | ✓ | ✓ | ✓ | 30 |
| 102 | `src/features/opentelemetry/server/anonymization/handlers/page-listing-api-handler.spec.ts` | ✓ | ✓ | ✓ | 23 |
| 103 | `src/features/opentelemetry/server/anonymization/handlers/search-api-handler.spec.ts` | ✓ | ✓ | ✓ | 21 |
| 104 | `src/features/opentelemetry/server/anonymization/utils/anonymize-query-params.spec.ts` | ✓ | ✓ | ✓ | 17 |
| 105 | `src/features/opentelemetry/server/custom-metrics/application-metrics.spec.ts` | ✓ | ✓ | ✓ | 6 |
| 106 | `src/features/opentelemetry/server/custom-metrics/installed-at-metrics.spec.ts` | ✓ | ✓ | ✓ | 5 |
| 107 | `src/features/opentelemetry/server/custom-metrics/mongoose-connection-pool-metrics.spec.ts` | ✓ | ✓ | ✓ | 16 |
| 108 | `src/features/opentelemetry/server/custom-metrics/page-counts-metrics.spec.ts` | ✓ | ✓ | ✓ | 5 |
| 109 | `src/features/opentelemetry/server/custom-metrics/setup-custom-metrics.spec.ts` | ✓ | ✓ | ✓ | 5 |
| 110 | `src/features/opentelemetry/server/custom-metrics/system-metrics.spec.ts` | ✓ | ✓ | ✓ | 13 |
| 111 | `src/features/opentelemetry/server/custom-metrics/user-counts-metrics.spec.ts` | ✓ | ✓ | ✓ | 5 |
| 112 | `src/features/opentelemetry/server/custom-metrics/yjs-metrics.spec.ts` | ✓ | ✓ | ✓ | 13 |
| 113 | `src/features/opentelemetry/server/custom-resource-attributes/application-resource-attributes.spec.ts` | ✓ | ✓ | ✓ | 3 |
| 114 | `src/features/opentelemetry/server/custom-resource-attributes/os-resource-attributes.spec.ts` | ✓ | ✓ | ✓ | 3 |
| 115 | `src/features/opentelemetry/server/node-sdk-configuration.spec.ts` | ✓ | ✓ | ✓ | 4 |
| 116 | `src/features/opentelemetry/server/node-sdk.spec.ts` | ✓ | ✓ | ✓ | 10 |
| 117 | `src/features/page-bulk-export/server/service/page-bulk-export-job-clean-up-cron.integ.ts` | ✓ | ✓ | ✓ | 7 |
| 118 | `src/features/page-bulk-export/server/service/page-bulk-export-job-cron/notify-export-result-and-clean-up.integ.ts` | ✓ | ✓ | ✓ | 4 |
| 119 | `src/features/page-tree/components/ItemsTree.spec.tsx` | ✓ | ✓ | ✓ | 7 |
| 120 | `src/features/page-tree/hooks/_inner/use-auto-expand-ancestors.spec.tsx` | ✓ | ✓ | ✓ | 28 |
| 121 | `src/features/page-tree/hooks/_inner/use-data-loader.integration.spec.tsx` | ✓ | ✓ | ✓ | 5 |
| 122 | `src/features/page-tree/hooks/_inner/use-data-loader.spec.tsx` | ✓ | ✓ | ✓ | 18 |
| 123 | `src/features/page-tree/hooks/use-page-create.spec.tsx` | ✓ | ✓ | ✓ | 8 |
| 124 | `src/features/page-tree/hooks/use-page-dnd.spec.ts` | ✓ | ✓ | ✓ | 16 |
| 125 | `src/features/page-tree/hooks/use-placeholder-rename-effect.spec.tsx` | ✓ | ✓ | ✓ | 9 |
| 126 | `src/features/page-tree/states/_inner/page-tree-create.spec.tsx` | ✓ | ✓ | ✓ | 6 |
| 127 | `src/features/plantuml/components/PlantUmlViewer.spec.tsx` | ✓ | ✓ | ✓ | 4 |
| 128 | `src/features/rate-limiter/middleware/consume-points.integ.ts` | ✓ | ✓ | ✓ | 3 |
| 129 | `src/features/search/client/components/SearchPage/SearchResultContent.spec.tsx` | ✓ | ✓ | ✓ | 3 |
| 130 | `src/features/search/client/components/SearchPage/use-keyword-rescroll.spec.tsx` | ✓ | ✓ | ✓ | 9 |
| 131 | `src/features/search/utils/disable-user-pages.spec.ts` | ✓ | ✓ | ✓ | 4 |
| 132 | `src/interfaces/activity-vault-reconcile.spec.ts` | ✓ | ✓ | ✓ | 6 |
| 133 | `src/interfaces/activity.spec.ts` | ✓ | ✓ | ✓ | 16 |
| 134 | `src/lib/empty-module.spec.ts` | ✓ | ✓ | ✓ | 2 |
| 135 | `src/migrations/20210913153942-migrate-slack-app-integration-schema.integ.ts` | ✓ | ✓ | ✓ | 1 |
| 136 | `src/models/serializers/in-app-notification-snapshot/page-bulk-export-job-client.spec.ts` | ✓ | ✓ | ✓ | 1 |
| 137 | `src/pages/[[...path]]/use-same-route-navigation.spec.tsx` | ✓ | ✓ | ✓ | 3 |
| 138 | `src/pages/general-page/use-initial-csr-fetch.spec.tsx` | ✓ | ✓ | ✓ | 6 |
| 139 | `src/pages/utils/nextjs-routing-utils.spec.ts` | ✓ | ✓ | ✓ | 20 |
| 140 | `src/pages/utils/superjson-ssr.spec.ts` | ✓ | ✓ | ✓ | 10 |
| 141 | `src/server/middlewares/access-token-parser/access-token.integ.ts` | ✓ | ✓ | ✓ | 7 |
| 142 | `src/server/middlewares/access-token-parser/api-token.integ.ts` | ✓ | ✓ | ✓ | 7 |
| 143 | `src/server/middlewares/access-token-parser/extract-access-token.spec.ts` | ✓ | ✓ | ✓ | 9 |
| 144 | `src/server/middlewares/certify-shared-page-attachment/certify-shared-page-attachment.spec.ts` | ✓ | ✓ | ✓ | 5 |
| 145 | `src/server/middlewares/certify-shared-page-attachment/validate-referer/retrieve-site-url.spec.ts` | ✓ | ✓ | ✓ | 3 |
| 146 | `src/server/middlewares/certify-shared-page-attachment/validate-referer/validate-referer.spec.ts` | ✓ | ✓ | ✓ | 7 |
| 147 | `src/server/middlewares/deny-uploads-direct-access.spec.ts` | ✓ | ✓ | ✓ | 1 |
| 148 | `src/server/middlewares/exclude-read-only-user.spec.ts` | ✓ | ✓ | ✓ | 3 |
| 149 | `src/server/middlewares/login-required.spec.ts` | ✓ | ✓ | ✓ | 19 |
| 150 | `src/server/middlewares/safe-redirect.spec.ts` | ✓ | ✓ | ✓ | 6 |
| 151 | `src/server/models/access-token.integ.ts` | ✓ | ✓ | ✓ | 4 |
| 152 | `src/server/models/page-redirect.integ.ts` | ✓ | ✓ | ✓ | 4 |
| 153 | `src/server/models/page.integ.ts` | ✓ | ✓ | ✓ | 31 |
| 154 | `src/server/models/update-post.spec.ts` | ✓ | ✓ | ✓ | 3 |
| 155 | `src/server/models/user/user.integ.ts` | ✓ | ✓ | ✓ | 7 |
| 156 | `src/server/models/v5.page.integ.ts` | ✓ | ✓ | ✓ | 24 |
| 157 | `src/server/routes/apiv3/app-settings/file-upload-setting.integ.ts` | ✓ | ✓ | ✓ | 10 |
| 158 | `src/server/routes/apiv3/page/get-page-info.integ.ts` | ✓ | ✓ | ✓ | 10 |
| 159 | `src/server/routes/apiv3/page/respond-with-single-page.spec.ts` | ✓ | ✓ | ✓ | 6 |
| 160 | `src/server/routes/attachment/image-content-type-validator.spec.ts` | ✓ | ✓ | ✓ | 22 |
| 161 | `src/server/service/acl.integ.ts` | ✓ | ✓ | ✓ | 17 |
| 162 | `src/server/service/activity/update-activity.spec.ts` | ✓ | ✓ | ✓ | 8 |
| 163 | `src/server/service/attachment.spec.ts` | ✓ | ✓ | ✓ | 2 |
| 164 | `src/server/service/config-manager/config-definition.spec.ts` | ✓ | ✓ | ✓ | 29 |
| 165 | `src/server/service/config-manager/config-loader.spec.ts` | ✓ | ✓ | ✓ | 4 |
| 166 | `src/server/service/config-manager/config-manager.integ.ts` | ✓ | ✓ | ✓ | 13 |
| 167 | `src/server/service/config-manager/config-manager.spec.ts` | ✓ | ✓ | ✓ | 12 |
| 168 | `src/server/service/config-manager/reconcile-config.spec.ts` | ✓ | ✓ | ✓ | 24 |
| 169 | `src/server/service/file-uploader/multipart-uploader.spec.ts` | ✓ | ✓ | ✓ | 13 |
| 170 | `src/server/service/file-uploader/utils/headers.spec.ts` | ✓ | ✓ | ✓ | 9 |
| 171 | `src/server/service/growi-bridge/index.spec.ts` | ✓ | ✓ | ✓ | 11 |
| 172 | `src/server/service/growi-info/growi-info.integ.ts` | ✓ | ✓ | ✓ | 8 |
| 173 | `src/server/service/import/construct-convert-map.integ.ts` | ✓ | ✓ | ✓ | 1 |
| 174 | `src/server/service/import/import.spec.ts` | ✓ | ✓ | ✓ | 1 |
| 175 | `src/server/service/mail/mail.spec.ts` | ✓ | ✓ | ✓ | 16 |
| 176 | `src/server/service/mail/oauth2.spec.ts` | ✓ | ✓ | ✓ | 8 |
| 177 | `src/server/service/mail/ses.spec.ts` | ✓ | ✓ | ✓ | 5 |
| 178 | `src/server/service/mail/smtp.spec.ts` | ✓ | ✓ | ✓ | 8 |
| 179 | `src/server/service/page-listing/page-listing.integ.ts` | ✓ | ✓ | ✓ | 15 |
| 180 | `src/server/service/page-operation.spec.ts` | ✓ | ✓ | ✓ | 5 |
| 181 | `src/server/service/page/delete-completely-user-home-by-system.integ.ts` | ✓ | ✓ | ✓ | 2 |
| 182 | `src/server/service/page/grant-preserve-on-update.integ.ts` | ✓ | ✓ | ✓ | 2 |
| 183 | `src/server/service/page/page-grant.integ.ts` | ✓ | ✓ | ✓ | 29 |
| 184 | `src/server/service/page/page.integ.ts` | ✓ | ✓ | ✓ | 13 |
| 185 | `src/server/service/page/v5.migration.integ.ts` | ✓ | ✓ | ✓ | 17 |
| 186 | `src/server/service/page/v5.non-public-page.integ.ts` | ✓ | ✓ | ✓ | 24 |
| 187 | `src/server/service/page/v5.page.integ.ts` | ✓ | ✓ | ✓ | 5 |
| 188 | `src/server/service/page/v5.public-page.integ.ts` | ✓ | ✓ | ✓ | 42 |
| 189 | `src/server/service/passport.spec.ts` | ✓ | ✓ | ✓ | 18 |
| 190 | `src/server/service/revision/normalize-latest-revision-if-broken.integ.ts` | ✓ | ✓ | ✓ | 10 |
| 191 | `src/server/service/search-delegator/elasticsearch.integ.ts` | ✓ | ✓ | ✓ | 2 |
| 192 | `src/server/service/search-query.spec.ts` | ✓ | ✓ | ✓ | 4 |
| 193 | `src/server/service/search/search-service.integ.ts` | ✓ | ✓ | ✓ | 6 |
| 194 | `src/server/service/user-group.integ.ts` | ✓ | ✓ | ✓ | 9 |
| 195 | `src/server/service/yjs/guard-socket.spec.ts` | ✓ | ✓ | ✓ | 3 |
| 196 | `src/server/service/yjs/upgrade-handler.spec.ts` | ✓ | ✓ | ✓ | 6 |
| 197 | `src/server/service/yjs/websocket-connection.integ.ts` | ✓ | ✓ | ✓ | 5 |
| 198 | `src/server/service/yjs/yjs.integ.ts` | ✓ | ✓ | ✓ | 6 |
| 199 | `src/server/util/compare-objectId.spec.ts` | ✓ | ✓ | ✓ | 4 |
| 200 | `src/server/util/is-simple-request.spec.ts` | ✓ | ✓ | ✓ | 39 |
| 201 | `src/server/util/mongoose-utils.spec.ts` | ✓ | ✓ | ✓ | 10 |
| 202 | `src/server/util/safe-path-utils.spec.ts` | ✓ | ✓ | ✓ | 25 |
| 203 | `src/server/util/scope-util.spec.ts` | ✓ | ✓ | ✓ | 10 |
| 204 | `src/server/util/stream.spec.ts` | ✓ | ✓ | ✓ | 1 |
| 205 | `src/services/general-xss-filter/general-xss-filter.spec.ts` | ✓ | ✓ | ✓ | 4 |
| 206 | `src/services/renderer/recommended-whitelist.spec.ts` | ✓ | ✓ | ✓ | 24 |
| 207 | `src/services/renderer/rehype-plugins/relative-links-by-pukiwiki-like-linker.spec.ts` | ✓ | ✓ | ✓ | 8 |
| 208 | `src/services/renderer/rehype-plugins/relative-links.spec.ts` | ✓ | ✓ | ✓ | 11 |
| 209 | `src/services/renderer/remark-plugins/pukiwiki-like-linker.spec.ts` | ✓ | ✓ | ✓ | 8 |
| 210 | `src/states/page/use-fetch-current-page.spec.tsx` | ✓ | ✓ | ✓ | 28 |
| 211 | `src/states/ui/editor/selected-grant.spec.ts` | ✓ | ✓ | ✓ | 5 |
| 212 | `src/states/ui/editor/use-sync-selected-grant.spec.tsx` | ✓ | ✓ | ✓ | 2 |
| 213 | `src/utils/axios/convert-strings-to-dates.spec.ts` | ✓ | ✓ | ✓ | 16 |
| 214 | `src/utils/axios/index.spec.ts` | ✓ | ✓ | ✓ | 15 |
| 215 | `src/utils/locale-utils.spec.ts` | ✓ | ✓ | ✓ | 18 |
| 216 | `src/utils/promise.spec.ts` | ✓ | ✓ | ✓ | 3 |
| 217 | `src/utils/to-array-from-csv.spec.ts` | ✓ | ✓ | ✓ | 5 |
| 218 | `test/setup/crowi.integ.ts` | ✓ | ✓ | ✓ | 6 |
| 219 | `test/setup/mongo/utils.spec.ts` | ✓ | ✓ | ✓ | 17 |
