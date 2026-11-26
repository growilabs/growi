# @growi/attachment-text-extractor

## 1.1.0

### Minor Changes

- [#12304](https://github.com/growilabs/growi/pull/12304) [`c7c5fa8`](https://github.com/growilabs/growi/commit/c7c5fa8cfa9641972f596d40db87580ddf3e2b62) Thanks [@yuki-takei](https://github.com/yuki-takei)! - Show the calling app in the request log (`app=`, from the optional `X-Growi-App-Id` header) and serve Prometheus metrics at `GET /metrics`. `/readyz` now keeps its result for 10 seconds. PPTX and XLSX files whose ZIP structure cannot be checked are refused with `extraction_failed`, and PDF and PPTX results are checked against the size limit page by page.
