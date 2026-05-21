# Brief: otel-attributes-cleanup

## Problem
The OpenTelemetry infrastructure admin asked to remove `os.totalmem` from custom resource attributes, prompting a full audit of GROWI's custom resource attributes and metrics. The current setup mixes three concerns under "resource attributes":

1. **Host identity** (`os.type`, `os.platform`, `os.arch`) — legitimate identity, must stay.
2. **A measurement** (`os.totalmem`) — bytes value that gets stamped on every metric/trace/log, inflating payloads and misleading users in container environments where `os.totalmem()` returns the *host's* RAM, not the cgroup memory limit.
3. **Subsystem configuration** (`growi.attachment.type`) — a config value (aws / gcs / gridfs / ...) that is conceptually identical to `wiki_type` and `external_auth_types`, which already live as labels on the `growi.configs` info gauge.

In addition, GROWI is primarily operated as a container workload, so the missing pieces are: cgroup-aware memory limit, process RSS, and V8 heap stats — none of which exist today.

## Current State
- `apps/app/src/features/opentelemetry/server/custom-resource-attributes/`
  - `os-resource-attributes.ts` exports `os.type` / `os.platform` / `os.arch` / `os.totalmem`.
  - `application-resource-attributes.ts` exports `growi.service.type` / `growi.deployment.type` / `growi.attachment.type`.
- `apps/app/src/features/opentelemetry/server/custom-metrics/`
  - `application-metrics.ts` emits `growi.configs` (Prometheus info pattern, value = 1) with labels `site_url`, `site_url_hashed`, `wiki_type`, `external_auth_types`.
  - `page-counts-metrics.ts`, `user-counts-metrics.ts` emit gauges.
- No system / process memory metrics exist.
- `@opentelemetry/host-metrics` is **not** installed.

## Desired Outcome
- Resource attributes contain only identity-class data; no measurements, no subsystem config.
- Memory information (both static "limit" and live "usage") is observable as proper metrics, with the cgroup limit and the host total emitted as *separate* metrics so operators can tell containerized vs bare-metal resource constraints apart.
- Subsystem configuration (`attachment.type`) is consolidated into the existing `growi.configs` info gauge labels alongside `wiki_type` / `external_auth_types`.
- Dashboards & alerts on the otel-infra side can migrate from the removed resource attributes to the new metric names with minimal churn.

## Approach
**Reorganize, do not rewrite.** Three coordinated changes:

1. **Remove from resource attributes**
   - `os.totalmem` (move to a metric).
   - `growi.attachment.type` (move to a label on the existing info gauge).

2. **Add a new metrics module: `custom-metrics/system-metrics.ts`**, using only Node.js standard modules (`node:os`, `node:v8`, `node:process`) — no new package dependency.
   - `system.memory.limit` — `process.constrainedMemory()` (cgroup v1/v2 limit, Node 20.12+). Skip observation when the value is `0`/`undefined` (i.e. unconstrained).
   - `system.host.memory.total` — `os.totalmem()` (physical host memory, always observable).
   - `process.memory.usage` — `process.memoryUsage().rss`.
   - `process.runtime.v8.heap.used` — `v8.getHeapStatistics().used_heap_size`.
   - `process.runtime.v8.heap.total` — `v8.getHeapStatistics().total_heap_size`.
   - `process.runtime.v8.heap.external` — `process.memoryUsage().external`.
   - All as `ObservableGauge` with unit `By`.

3. **Extend `growi.configs` info gauge** in `application-metrics.ts` with a new `attachment_type` label (matching the existing snake_case naming of sibling labels).

### Why custom ObservableGauges, not `@opentelemetry/host-metrics`
The package (latest 0.38.3) does not emit `system.memory.limit` and does not use `process.constrainedMemory()` — it reads `os.totalmem()`/`os.freemem()` directly, which defeats the container-awareness goal. It also lacks V8 heap stats and would require us to hand-write the missing metrics anyway, while pulling in `systeminformation` and emitting network/CPU metrics we did not ask for. ~50 lines of custom code is cleaner and fully controllable.

## Scope
- **In**:
  - Removing `os.totalmem` from `os-resource-attributes.ts` (and updating its spec).
  - Removing `growi.attachment.type` from `application-resource-attributes.ts` (and updating its spec).
  - Adding `attachment_type` label to the `growi.configs` info gauge in `application-metrics.ts` (and updating its spec).
  - Creating `custom-metrics/system-metrics.ts` with the 6 metrics listed above, plus a spec file.
  - Wiring `addSystemMetrics()` into `custom-metrics/index.ts` `setupCustomMetrics()`.
  - Brief operator-facing note describing the rename mapping (resource attr removed → new metric/label) so the otel-infra admin can update dashboards.
- **Out**:
  - Any other custom resource attribute that already passes the identity test (`os.type/platform/arch`, `growi.service.type`, `growi.deployment.type` all stay as-is).
  - CPU metrics, event loop lag, GC metrics — not requested; can be added later if needed.
  - Network metrics.
  - Touching the anonymization layer (`http.target` etc.) — separate concern.
  - Span attributes — only resource attributes are reorganized in this spec.
  - Adopting `@opentelemetry/host-metrics` package.

## Boundary Candidates
- Resource attribute pruning (deletions only) — touches 2 files in `custom-resource-attributes/`.
- Metric additions — new file in `custom-metrics/` + wire-in.
- Info-gauge label extension — one-line change in `custom-metrics/application-metrics.ts`.

These three slices can be implemented and reviewed independently, but ship as one release for a single observable contract change.

## Out of Boundary
- Renaming or restructuring the existing `growi.*` metrics (`growi.pages.total`, `growi.users.total`, `growi.users.active`).
- Migrating `growi.deployment.type` to the OTel-standard `deployment.environment.name` (decided to keep as `growi.deployment.type` — different semantic from "environment").
- Touching `node-sdk-configuration.ts` core service identity attributes (`service.name`, `service.version`, `service.instance.id`).
- Anonymization (`http.target`).
- Adopting `@opentelemetry/host-metrics`.

## Upstream / Downstream
- **Upstream**: `growiInfoService.getGrowiInfo({ includeAttachmentInfo: true })` continues to be the source of `attachment.type`. No service-layer change required.
- **Downstream**: External OpenTelemetry collector / Prometheus / Grafana dashboards operated by the otel-infra admin. They will need to update queries that previously read `os.totalmem` and `growi.attachment.type` as resource attributes — coordination via a "what changed" note in the PR description.

## Existing Spec Touchpoints
- **Extends**: None — there is no prior `.kiro/specs/` entry for OpenTelemetry. This is a standalone refactor spec for the existing `features/opentelemetry/` module.
- **Adjacent**: `features/opentelemetry/server/anonymization/` is unrelated and untouched.

## Constraints
- Node.js runtime must be ≥ 20.12 for `process.constrainedMemory()` (verify against current `apps/app/package.json` `engines` field; the existing `@opentelemetry/host-metrics` peer would require ≥ 18.19 / 20.6, so 20.12 is well within the GROWI baseline).
- Must not introduce new runtime dependencies (in line with the rule that any package appearing in `apps/app/.next/node_modules/` after build needs `dependencies` classification — adding none means zero classification risk).
- Backwards-compatible at the OTLP wire level: only additions to metrics, only removals from resource attributes. Communicate the resource-attribute removals explicitly to the otel-infra admin.
- All new metric names follow OTel semconv where a stable name exists (`system.memory.*`, `process.memory.usage`). Where no standard exists, use `process.runtime.v8.*` to align with the existing Node.js community conventions.
