# Security Audit Baseline (pre-migration)

Phase 0.2 (_Requirements: 4.1, 4.3, 4.4, 7.3_) deliverable.

## 捕捉方法

```bash
pnpm audit --audit-level=moderate --json > .kiro/specs/esm-migration/audit-baseline.json
```

## サマリ (2026-04-21 時点, pnpm 10.32.1)

- 総 advisory 件数: **129**
- Severity 分布:
  - `critical`: 17
  - `high`: 74
  - `moderate`: 38

## axios override のカバレッジ検証

`package.json` の `pnpm.overrides.axios: ^1.15.0` は以下の advisory をカバーするためのもの:

- **CVE ID**: CVE-2026-40175
- **GHSA ID**: GHSA-fvcv-3m26-pcqx
- **タイトル**: Unrestricted Cloud Metadata Exfiltration via Header Injection Chain
- **概要**: 他依存による `Object.prototype` 汚染 + Axios の config merge で header に CRLF が混入することによる HTTP Request Smuggling。AWS IMDSv2 等 cloud metadata endpoint の認証バイパスが可能
- **Severity**: Critical (CVSS ~10.0)
- **修正バージョン**: axios >= 1.15.0
- **参考**: <https://github.com/advisories/GHSA-fvcv-3m26-pcqx>, <https://github.com/axios/axios/security/advisories/GHSA-fvcv-3m26-pcqx>

### カバレッジ確認結果

`audit-baseline.json` 内で `module_name == "axios"` の advisory は **0 件**。すなわち override により `^1.15.0` に解決された結果、CVE-2026-40175 系統を含む全 axios advisory が解消されていることを確認。Phase 5.3 で override を削除する際に、この条件が崩れる場合は override を維持する (tasks.md 5.3 参照)。

## Phase 5 での使い方

Phase 5.1 / 5.2 / 5.3 で各 override を順次削除するたびに、`pnpm audit --audit-level=moderate --json` を再取得し本 baseline と diff を取る。新規 HIGH/CRITICAL advisory が出た場合は該当 override を戻し、CVE ID を参照する正当化コメントを package.json に付与する。
