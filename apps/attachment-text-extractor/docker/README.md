GROWI Attachment Text Extractor docker image
==============================================

Extracts the text of an attachment (PDF, Office documents, CSV, HTML, plain text)
for GROWI's full-text search. It parses untrusted files, so each conversion runs
in a short-lived child process under memory and time limits.

This page is for whoever writes the real deployment (Kubernetes, compose, ...):
the conditions the service is designed and tested under, each with its reason.
No deployment manifests are shipped.

> **Not yet verified in a real container.** The image has never been built. The
> first run of the CI image job (`scripts/image-check/check-image.sh`) verifies
> that it builds, stays within 400 MB, and starts and extracts a PDF and a DOCX
> with a read-only root filesystem as uid 10001 without capabilities, network or
> tmpfs; it also measures memory inside the image. Nothing more is claimed, and
> nothing below has been observed on a cluster.


Build and run
-------------

The build context is the repository root (the pnpm workspace is needed):

```bash
docker build -f apps/attachment-text-extractor/docker/Dockerfile -t attachment-text-extractor .

docker run -d --read-only --user 10001:10001 --cap-drop ALL \
  --security-opt no-new-privileges --memory 2g \
  -e ATTACHMENT_EXTRACTOR_SERVICE_TOKEN -p 127.0.0.1:8000:8000 \
  attachment-text-extractor
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
| `LOG_LEVEL` | `INFO` | Python logging level names |

There is no `WORKERS` setting: one container is one Node process, limited by
`MAX_CONCURRENCY` alone.


Conditions the service is designed for
--------------------------------------

**Memory limit 2 Gi; request 512 Mi.** The worst case, in MiB, is
`69 (idle) + MAX_CONCURRENCY x (MAX_CHILD_RSS_MB + 148 (the memory watch reacts
with a lag) + 157 (the HTTP process, per request))` = 69 + 3 x (320 + 148 + 157)
= 1,944 with the defaults. That sum is cautious (it adds peaks that do not
coincide) and its terms were measured with synthetic results; with real
conversions the same sum came to about 2,025 - 2,070 (at or just over the
limit), while the heaviest load actually measured stayed at 1,135 - 1,285 MiB
(outside a container). The 2 Gi limit therefore rests on that measured load,
not on the worst-case sum; the CI image job repeats the measurement inside the
image. If you raise `MAX_CONCURRENCY` or `MAX_CHILD_RSS_MB`, recompute the sum
and raise the limit by the amount it grows. The request is 512 Mi because an
idle service holds about 70 MiB and most conversions stay far below the worst
case.

**Non-root, read-only, no privileges.** Run as uid and gid 10001 (the image's
user) with a read-only root filesystem, all capabilities dropped and privilege
escalation forbidden (on Kubernetes also the `RuntimeDefault` seccomp profile
and no service account token): a parser bug must not become a foothold.

**No writable `/tmp` is required.** An upload is held in memory, never written to
disk; the only file the service writes is `/proc/self/oom_score_adj` of each
conversion child (so that the kernel picks a child, not the HTTP process, when
memory runs out). If you mount a memory-backed `/tmp` anyway, keep it small and
add its size to the memory sum: it counts against the limit. No persistent
volume and no `/dev/shm` are needed.

**No init process is needed.** The start command is `node dist/main.js` in exec
form, so Node is PID 1 and handles SIGTERM itself; conversion children are its
direct children and end themselves as soon as it disappears.

**Network: no egress, ingress from the GROWI app only.** Conversion is fully
local, so block all outbound traffic: a hostile file then cannot make the
service fetch or send anything. Allow inbound traffic on port 8000 from the
GROWI app alone.

**Health checks** (neither path needs the token):

- Liveness and startup: `GET /healthz`. It only says the process is alive, so a
  busy container is not restarted. Starting points: liveness every 10 s, timeout
  5 s, 6 failures; startup every 5 s, up to 12 failures.
- Readiness: `GET /readyz`. Every call converts small probe files in a real
  conversion child under a 10 s limit, so give the check a timeout of 15 s, and a
  period no shorter than that (20 s, 3 failures). A 503 means "send no traffic
  for now" and can recover by itself; it is not a reason to restart.

**Graceful stop: at least 85 s.** On SIGTERM the service stops accepting and
waits for the requests in flight, with no upper bound of its own (a second
signal exits at once). Give a termination grace period of at least 85 s (15 s
upload + 55 s conversion + margin), after which the orchestrator kills. During a
rolling update keep the old container until the new one is ready.

**Scaling is by replicas.** The service is stateless; run at least two. CPU
request 500m / limit 2 and autoscaling on 70 % CPU between 2 and 10 replicas with
a 300 s scale-down window were carried over from the previous (Python) service:
starting points, not measured optima. CPU is only a proxy, since a container
with all slots busy answers 503.


Logs and licence notices
------------------------

Logs go to standard error, one `<UTC time> <level> <message>` per line; there is
no access log. Every `POST /extract` that passes the token check writes, at
level INFO, `extract format=… size=… duration_ms=… result=…
child_peak_rss_mb=…` (never the file name or content); a request refused with
401 leaves no line. Diagnostic lines (WARNING or ERROR) say what a conversion
child warned about or how it failed (`conversion child …`) and when readiness
changed (`readiness probe failed: …`, then `readiness probe passed again`).
Start and stop write `listening on …` and `SIGTERM received, …`; a start that
fails writes one bare message naming the setting at fault.

Third-party licence notices are in the image under `/licenses`.
