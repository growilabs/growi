---
'@growi/attachment-text-extractor': minor
---

Show the calling app in the request log (`app=`, from the optional `X-Growi-App-Id` header) and serve Prometheus metrics at `GET /metrics`. `/readyz` now keeps its result for 10 seconds. PPTX and XLSX files whose ZIP structure cannot be checked are refused with `extraction_failed`, and PDF and PPTX results are checked against the size limit page by page.
