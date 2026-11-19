GROWI Attachment Text Extractor docker image
==============================================

Supported tags and respective Dockerfile links
------------------------------------------------

* [`1.1.0`, `1.1`, `1`, `latest` (Dockerfile)](https://github.com/growilabs/growi/blob/attachment-text-extractor/v1.1.0/apps/attachment-text-extractor/docker/Dockerfile)
* [`1.0.0`, `1.0` (Dockerfile)](https://github.com/growilabs/growi/blob/attachment-text-extractor/v1.0.0/apps/attachment-text-extractor/docker/Dockerfile)

Images are published for `linux/amd64` and `linux/arm64`.

What is this
------------

Extracts the text of an attachment (PDF, Office documents, CSV, HTML, plain text)
for GROWI's full-text search. It parses untrusted files, so each conversion runs
in a short-lived child process under memory and time limits.

This page is for whoever writes the real deployment (Kubernetes, Docker Compose, ...):
the conditions the service is designed and tested under, each with its reason.
No deployment manifests are shipped.

> **Verified by the CI image check** (`scripts/image-check/check-image.sh`,
> on native linux/amd64 and linux/arm64 runners; figures from the run of
> 2026-11-18, started by hand so that it includes the memory measurement): the
> image builds; it starts with a read-only root filesystem, uid 10001, no
> network and no tmpfs, answers `/readyz` and extracts a PDF and a DOCX.
>
> | | linux/amd64 | linux/arm64 |
> |---|---|---|
> | Unpacked filesystem (limit 400,000,000 bytes) | 259,258,880 | 277,116,416 |
> | Idle | 34 - 35 MiB | 33 - 34 MiB |
> | Heaviest load (limit 2 Gi) | 1,013 - 1,167 MiB | 1,024 - 1,144 MiB |
> | Conversion child, XLSX (cap 320 MB) | 290 - 291 MB | 288 MB |
> | Conversion child, DOCX | 263 - 266 MB | 260 - 264 MB |
> | Conversion child, single-page 2-million-character PDF | 302 - 303 MB | 300 - 301 MB |
>
> **Still unverified:** behaviour under a real orchestrator (probes, rolling
> update, termination grace).

Run
---

```bash
docker run -d --read-only --user 10001:10001 --cap-drop ALL \
  --security-opt no-new-privileges --memory 2g \
  -e ATTACHMENT_EXTRACTOR_SERVICE_TOKEN -p 127.0.0.1:8000:8000 \
  growilabs/attachment-text-extractor:1
```

To build the image yourself, use the repository root as the build context (the
pnpm workspace is needed):
```bash
docker build -f apps/attachment-text-extractor/docker/Dockerfile -t attachment-text-extractor .
```

The service listens on `0.0.0.0:8000` (IPv4 only); no setting changes the address.

Settings (environment variables)
--------------------------------

`ATTACHMENT_EXTRACTOR_SERVICE_TOKEN` is required: the Bearer token `POST /extract`
demands. The service refuses to start when it is unset or blank, so that it can
never run open. Take it from a secret, never from a literal in a manifest.

| Variable | Default | Meaning |
|---|---|---|
| `MAX_CONCURRENCY` | 3 | Conversions at the same time; further requests get 503 `service_busy` |
| `MAX_CHILD_RSS_MB` | 320 | Memory at which a conversion child is stopped |
| `MAX_FILE_SIZE_MB` | 50 | Largest upload |
| `UPLOAD_TIMEOUT_S` | 15 | Time to receive an upload |
| `TIMEOUT_S` | 55 | Time for one conversion |
| `MAX_RESULT_BYTES`, `MAX_CSV_BYTES`, `MAX_HTML_BYTES` | 16 MiB, 8 MiB, 20 MiB (in bytes) | Largest extracted text, CSV input, HTML input |
| `MAX_XLSX_CELLS`, `MAX_PDF_PAGES` | 70,000, 5,000 | Per-document limits |
| `MAX_ARCHIVE_ENTRIES`, `MAX_ARCHIVE_UNCOMPRESSED_MB` | 10,000, 512 | Limits on a ZIP-based document |
| `LOG_LEVEL` | `INFO` | One of `CRITICAL`, `FATAL`, `ERROR`, `WARN`, `WARNING`, `INFO`, `DEBUG`, `NOTSET` (case-insensitive) |

Three size limits apply to an attachment, and the smallest one wins:

- GROWI's upload limit `MAX_FILE_SIZE` (set in GROWI; unlimited by default).
- GROWI's extraction limit `GROWI_ATTACHMENT_EXTRACTOR_MAX_FILE_SIZE_BYTES`
  (default 50 MiB). GROWI does not send a larger attachment to this service and
  logs it as too large.
- This service's `MAX_FILE_SIZE_MB` (default 50). A larger upload gets 413
  `file_too_large`, which GROWI also logs as too large.

Keep GROWI's extraction limit at or below `MAX_FILE_SIZE_MB`, so that GROWI
rejects a large file without sending it. If you raise `MAX_FILE_SIZE_MB`, check
the memory figures below again: they were measured with 50 MB.

There is no `WORKERS` setting: one container is one Node process, limited by
`MAX_CONCURRENCY` alone.

Conditions the service is designed for
--------------------------------------

**Memory limit 2 Gi; request 512 Mi.** The limit rests on the heaviest load
measured inside the image, 918 - 1,095 MiB, not on the worst-case sum. That
sum, in MiB, is `69 (idle) + MAX_CONCURRENCY x (MAX_CHILD_RSS_MB + 148 (the
memory watch reacts with a lag) + 157 (the HTTP process, per request))` = 69 +
3 x (320 + 148 + 157) = 1,944 with the defaults. It is a cautious estimate: it
adds peaks that do not coincide, and its terms come from earlier measurements
outside the image (the idle service holds 34 - 35 MiB in the image, not 69);
with terms from real conversions it came to about 2,025 - 2,070, at or just
over the limit. If you raise `MAX_CONCURRENCY` or `MAX_CHILD_RSS_MB`, recompute
the sum and raise the limit by the amount it grows. The request is 512 Mi
because an idle service holds about 35 MiB and most conversions stay far below
the worst case. To measure again (after upgrading anydoc, PDFium or the Node
base image, or changing memory-related code), start the CI workflow by hand:
the memory step runs only then.

**Non-root, read-only, no privileges.** Run as uid and gid 10001 (the image's
user) with a read-only root filesystem, all capabilities dropped and privilege
escalation forbidden (on Kubernetes also the `RuntimeDefault` seccomp profile
and no service account token): a parser bug must not become a foothold.

**A conversion child can read the HTTP process's environment, token included.**
A child runs as the same uid as the HTTP process (10001 in the image). It is
given only an explicit environment of its own, without the token, but a child
taken over by a hostile file can still read the HTTP process's environment
variables, token included, from `/proc`. This was confirmed with a child started
the same way as the service starts it, on Linux 6.8 with Yama's `ptrace_scope`
at 1, in a development container. It was not tried inside the image or on the
GROWI.cloud nodes. In the same development container the child could not open
the HTTP process's memory (`/proc/<pid>/mem`), which holds the uploads of other
requests in flight; on a node with looser ptrace settings (for example
`ptrace_scope` at 0) it may be able to, and that was not tried. No countermeasure has been decided yet; it
is item (h) of the `attachment-search` roadmap.

**No writable `/tmp` is required.** An upload is held in memory, never written to
disk; the only file the service writes is `/proc/self/oom_score_adj` of each
conversion child (so that the kernel picks a child, not the HTTP process, when
memory runs out). If you mount a memory-backed `/tmp` anyway, keep it small and
add its size to the memory sum: it counts against the limit. No persistent
volume and no `/dev/shm` are needed.

**No init process is needed.** Node is PID 1 (`node dist/main.js`, exec form) and
handles SIGTERM itself; conversion children end themselves when it disappears.

**Network: no egress, ingress from the GROWI app and your monitoring only.**
Conversion is fully local, so block all outbound traffic (a hostile file then
cannot make the service fetch or send anything) and allow inbound port 8000 from
the app alone, plus your monitoring system if it scrapes `/metrics` (see Logs
and metrics).

**Paths that need no token:** exactly four, `/healthz`, `/readyz`,
`/openapi.json` and `/metrics`. Only the network rule above protects them. A
path opens only when the request target as sent (the part before `?`) is exactly
one of them: `/./metrics` or `/%6Detrics` still needs the token.

**Health checks:**

- Liveness and startup: `GET /healthz`. It only says the process is alive, so a
  busy container is not restarted. Starting points: liveness every 10 s, timeout
  5 s, 6 failures; startup every 5 s, up to 12 failures.
- Readiness: `GET /readyz`. A check converts small probe files in a real
  conversion child under a 10 s limit, so give the check a timeout of 15 s, and a
  period no shorter than that (20 s, 3 failures). A 503 means "send no traffic
  for now" and can recover by itself; it is not a reason to restart.
- `/readyz` keeps the result of a check (ready, not ready, or failed) for 10 s,
  counted from when the check finished; calls in that time, and calls that
  arrive while a check runs, get that result without a new check. So a stuck
  component shows up at most 10 s later than the probe period alone would show
  it, and calling `/readyz` without a token starts at most one check every 10 s.
  Keep the readiness check period well above 10 s (20 s as above): a call is
  answered from the kept result whenever the previous check finished 10 s ago
  or less.
- A command-style health check (for example a Docker `HEALTHCHECK`) cannot use
  curl or wget: the slim image has neither. Run `node -e` against
  `http://127.0.0.1:8000/readyz` (not `localhost`: the service listens on IPv4
  only), with the in-script deadline below the check timeout (14 s inside a 15 s
  timeout).

**Graceful stop: at least 85 s.** On SIGTERM the service stops accepting and
waits for the requests in flight, with no upper bound of its own (a second
signal exits at once). Give a termination grace period of at least 85 s (15 s
upload + 55 s conversion + margin), after which the orchestrator kills. During a
rolling update keep the old container until the new one is ready.

**Scaling is by replicas.** The service is stateless; run at least two. CPU
request 500m / limit 2 and autoscaling on 70 % CPU between 2 and 10 replicas with
a 300 s scale-down window are starting points, never measured. CPU is only a proxy, since a container
with all slots busy answers 503; the busy slots, read from `/metrics` (see Logs
and metrics), say more directly how full a container is.

Logs and metrics
------------------------

Logs go to standard error, one `<UTC time> <level> <message>` per line; there is
no access log. Every `POST /extract` that passes the token check writes, at
level INFO, `extract format=… size=… duration_ms=… result=…
child_peak_rss_mb=… app=…` (never the file name or content); a request refused
with 401 leaves no line, but `/metrics` counts it. Diagnostic lines (WARNING or
ERROR) say what a conversion child warned about or how it failed (`conversion
child …`) and when readiness changed (`readiness probe failed: …`, then
`readiness probe passed again`). Start and stop write `listening on …` and
`SIGTERM received, …`; a start that fails writes one bare message naming the
setting at fault.

`app=` is the GROWI app that sent the request, taken from the `X-Growi-App-Id`
header (GROWI sends its GROWI.cloud app id there when it has one). The value is
`-` when the header is absent, and `(invalid)` when it does not have the
expected form (a letter or digit, then letters, digits, `.`, `_` or `-`, 64
characters at most) or is sent twice; a value of the wrong form is never written
out. The header is the caller's own claim and is not authenticated: any caller
can send another app's id. Use it to break the log down by app, never to decide
access, limits or anything else.

`GET /metrics` answers in the Prometheus text format, without the token (keep it
reachable from the app and your monitoring alone, by the network rule above).
It neither writes a log line nor starts a conversion child. It holds counts,
durations and process figures only: no file name or content, no app id, no
token.

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `attachment_extractor_slots_in_use` | gauge | none | Slots `POST /extract` holds at the moment of reading |
| `attachment_extractor_slots_max` | gauge | none | `MAX_CONCURRENCY` as configured |
| `attachment_extractor_http_responses_total` | counter | `endpoint`, `status` | Answers the service produced |
| `attachment_extractor_extract_results_total` | counter | `result` | `POST /extract` requests by result |
| `attachment_extractor_extract_duration_seconds` | histogram | `result` | `POST /extract` duration, as `duration_ms` on the log line; buckets 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 40, 60, 80 s |
| The client library's default process metrics | | | `process_cpu_seconds_total`, `process_resident_memory_bytes`, `nodejs_eventloop_lag_seconds` and others |

- `endpoint` is one of `/extract`, `/healthz`, `/readyz`, `/openapi.json`,
  `/metrics`, or `other` for any other request target (matched as for the token
  check, so `/./metrics` counts as `other`); `status` is the 3-digit HTTP status.
  No label ever carries a value the request sent freely (the `X-Growi-App-Id`
  value included).
- `result` takes the same values as `result=` on the log line. Every value is
  there from the start with 0, so a rate can be computed for a result that has
  not happened yet. The results are counted whatever `LOG_LEVEL` is, even when
  the log line itself is not written.
- The process metrics are those of the HTTP process alone; they do not include
  the conversion children's CPU or memory. For the whole container, children
  included, use your orchestrator's container metrics.
- For autoscaling, `attachment_extractor_slots_in_use /
  attachment_extractor_slots_max` per container says how full it is.

Which answers `attachment_extractor_http_responses_total` counts:

- Counted: every answer the service's HTTP framework produces. That is a route's
  answer (200, or an error with a JSON body), an early answer given before the
  body is read (such as 413 or 503), the 401 of the token check (an unknown path
  included), the 404 for an unknown path or a wrong method (such as
  `GET /extract`), the 500 of an unexpected error in a route, and an answer made
  after the caller disconnected (with the status it had when it was made).
- Not counted: answers Node's HTTP server gives by itself before the request
  reaches the service: 400 for a malformed request or one with no `Host`, 431
  for headers that are too large, 417 for an `Expect` other than
  `100-continue`, 408 when the headers or the request time out. Nor a
  connection closed before any answer, or an interim `100 Continue`.
