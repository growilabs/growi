# Server-build type shims (NodeNext)

These `.d.cts` declaration shims are referenced ONLY from
`tsconfig.build.server.json` `paths` (esm-migration task 3.6).

Why: the server build compiles with `module: NodeNext`, which models
Node.js semantics for an ES module importing a CommonJS package: the
default import binding is `module.exports` (the namespace), NOT the
`export default` declared by the package's bundled `.d.ts`. The packages
shimmed here all self-patch `module.exports` at runtime (or only ever run
through a bundler that applies interop), so their real default IS the
declared component/class/function. Each shim redeclares the module with
`export =` so NodeNext typing matches that runtime reality.

These shims affect TYPE CHECKING of the server build only:
- the live client bundle resolves the original packages via Turbopack
  (this tsconfig is not consulted),
- `tsgo --noEmit` / Vitest use the root tsconfig (Bundler resolution),
  which keeps using the packages' own types.

Remove a shim when the upstream package ships NodeNext-correct types
(`export =`, or a true ESM entry with proper `exports` map).

IMPORTANT: only packages whose value imports never execute in the server
runtime may be shimmed here. `typescript-transform-paths` rewrites every
paths-matched specifier in emitted JS to a relative path (pointing at the
shim, which has no runtime), so shimming a server-runtime dependency breaks
the build output. Server-runtime packages with the same interop problem get
a runtime-real adapter instead (see `src/server/util/extensible-custom-error.ts`
and the local narrowing in `src/server/service/s2s-messaging/nchan.ts`).
