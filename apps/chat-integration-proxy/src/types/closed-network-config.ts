// The operator's declaration of closed-network GROWI destinations
// (Requirement 13.1). `allowList` is handed to `judgeGrowiUri`'s third
// argument verbatim; `trustedCaCertsFor` answers "which certificate authority
// do we trust when connecting to this host", which the networking layer feeds
// to its TLS options. Without the second half, the only working closed-network
// configuration would be turning certificate verification off altogether
// (design.md, 閉域 section).
//
// It lives in `types/` rather than next to the only implementation
// (`runtime/config.ts`) for the same reason `SecretCipher` does: the consumer
// is `relation/growi-uri-resolver.ts`, and design.md's declared dependency
// order puts `runtime/` outside the chain -- "`runtime/` は最も外側。上のどこ
// からも import されない". A `relation/**` file naming this type from
// `runtime/config.ts` would be a layer violation (`src/architecture.spec.ts`
// catches it), and re-declaring the interface would give the app two
// declarations that can drift apart.

export interface ClosedNetworkConfig {
  /** Hostnames, already normalised the way `judgeGrowiUri` normalises them. */
  readonly allowList: ReadonlyArray<string>;
  /** PEM certificates to trust for that hostname; empty when none was declared. */
  readonly trustedCaCertsFor: (hostname: string) => ReadonlyArray<string>;
}
