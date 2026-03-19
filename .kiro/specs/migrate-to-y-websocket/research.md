# Research & Design Decisions

## Summary
- **Feature**: `migrate-to-y-websocket`
- **Discovery Scope**: Complex Integration
- **Key Findings**:
  - y-socket.io's `initDocument()` has a TOCTOU race condition due to `await` between Map get and set — y-websocket uses atomic `map.setIfUndefined` which eliminates this class of bug
  - `@y/websocket-server@0.1.5` requires `yjs@^14` (incompatible), but `y-websocket@2.0.4` bundles server utils with `yjs@^13` support
  - The `ws` package is already installed in GROWI (`ws@^8.17.1`); Express HTTP server supports adding a WebSocket upgrade handler alongside Socket.IO

## Research Log

### y-socket.io Race Condition Root Cause
- **Context**: Clients occasionally desynchronize — some see edits, others don't
- **Sources Consulted**: `node_modules/y-socket.io/dist/server/server.js` (minified source)
- **Findings**:
  - `initDocument()` does `_documents.get(name)`, then `await persistence.bindState(name, doc)`, then `_documents.set(name, doc)`
  - The `await` yields to the event loop, allowing a concurrent `initDocument` call to create a second Y.Doc for the same name
  - Each socket's sync listeners are bound to the doc returned by its `initDocument` call
  - Namespace-level broadcasts partially mask the issue, but resync intervals and disconnect handlers operate on the wrong doc instance
- **Implications**: The only fix is replacing the transport layer; patching y-socket.io is fragile since the library is unmaintained

### y-websocket Document Initialization Safety
- **Context**: Verify y-websocket does not have the same race condition
- **Sources Consulted**: `@y/websocket-server/src/utils.js`, y-websocket v2 `bin/utils.cjs`
- **Findings**:
  - Uses `map.setIfUndefined(docs, docname, () => { ... })` from lib0 — synchronous atomic get-or-create
  - Document is registered in the Map before any async operation (persistence, contentInitializor)
  - `persistence.bindState` is called but NOT awaited inline — the document is already in the Map
  - Concurrent connections calling `getYDoc` with the same name receive the same WSSharedDoc instance
- **Implications**: The primary race condition is eliminated by design

### y-websocket Package Version Compatibility
- **Context**: Choose correct package versions for GROWI's yjs v13 stack
- **Sources Consulted**: npm registry for y-websocket, @y/websocket-server
- **Findings**:
  - `y-websocket@3.0.0` (Apr 2025): Client-only, peers on `yjs@^13.5.6` — compatible
  - `y-websocket@3.0.0`: Removed server utils (moved to separate package)
  - `@y/websocket-server@0.1.5` (Feb 2026): Requires `yjs@^14.0.0-7` — **incompatible**
  - `y-websocket@2.0.4` (Jul 2024): Includes both client and server utils (`./bin/utils`), peers on `yjs@^13.5.6` — compatible
  - `y-websocket@2.1.0` (Dec 2024): Also includes server utils, peers on `yjs@^13.5.6` — compatible
- **Implications**: Must use y-websocket v2.x for server utils, or vendor/adapt server code from @y/websocket-server

### HTTP Server and WebSocket Coexistence
- **Context**: Determine how to add raw WebSocket alongside existing Socket.IO
- **Sources Consulted**: `apps/app/src/server/crowi/index.ts`, `apps/app/src/server/service/socket-io/socket-io.ts`
- **Findings**:
  - HTTP server created via `http.createServer(app)` at crowi/index.ts:582
  - Socket.IO attaches to this server and handles its own `upgrade` events for `/socket.io/` path
  - `ws@^8.17.1` already installed in apps/app
  - WebSocket.Server with `noServer: true` can coexist by handling `upgrade` events for a different path prefix
  - Socket.IO only intercepts upgrade requests matching its path (`/socket.io/`)
- **Implications**: Safe to add `ws.Server` with path prefix `/yjs/` on the same HTTP server

### Authentication for Raw WebSocket
- **Context**: y-socket.io piggybacks on Socket.IO middleware for session/passport; raw WebSocket needs custom auth
- **Sources Consulted**: `apps/app/src/server/crowi/express-init.js`, `apps/app/src/server/service/socket-io/socket-io.ts`
- **Findings**:
  - Socket.IO attaches session middleware via `io.engine.use(expressSession(...))`
  - Express session uses cookie-based session ID (`connect.sid` or configured name)
  - Raw WebSocket `upgrade` request carries the same HTTP cookies
  - Can reconstruct session by: (1) parsing cookie from upgrade request, (2) loading session from store (Redis or MongoDB)
  - Passport user is stored in `req.session.passport.user`, deserialized via `passport.deserializeUser`
- **Implications**: Authentication requires manual session parsing in the `upgrade` handler, but uses the same session store and cookie

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: y-websocket@2.x (client + server) | Use v2.x which bundles both client and server utils | Single package, proven server code, yjs v13 compatible | Older client (missing v3 SyncStatus), v2 may stop receiving updates | Simplest migration path |
| B: y-websocket@3.x client + custom server | Use v3 client + inline server adapter based on @y/websocket-server | Latest client features, full control over server code | Must maintain custom server code (~200 lines) | Recommended if v3 features needed |
| C: y-websocket@3.x + @y/websocket-server | Use v3 client + official server package | Official packages for both sides | Requires yjs v14 upgrade (breaking change) | Too risky for this migration scope |

## Design Decisions

### Decision: Use y-websocket@2.x for both client and server

- **Context**: Need yjs v13 compatibility on both client and server sides
- **Alternatives Considered**:
  1. y-websocket@3.x client + custom server — more work, v3 SyncStatus not needed now
  2. y-websocket@3.x + @y/websocket-server — requires yjs v14 migration (out of scope)
  3. y-websocket@2.x for everything — simplest path, proven code
- **Selected Approach**: Option A — use `y-websocket@2.x` (specifically 2.0.4 or 2.1.0)
- **Rationale**: Minimizes custom code, proven server utils, compatible with existing yjs v13, clear upgrade path to v3 + @y/websocket-server when yjs v14 migration happens separately
- **Trade-offs**: Miss v3 SyncStatus feature, but current `sync` event + `resyncInterval` meets all requirements
- **Follow-up**: Plan separate yjs v14 migration in future, then upgrade to y-websocket v3 + @y/websocket-server

### Decision: WebSocket path prefix `/yjs/`

- **Context**: Need URL pattern for Yjs WebSocket connections that doesn't conflict with Socket.IO
- **Alternatives Considered**:
  1. `/yjs/{pageId}` — clean, matches existing `/yjs|{pageId}` pattern semantics
  2. `/ws/yjs/{pageId}` — more explicit WebSocket prefix
  3. `/api/v3/yjs/{pageId}` — matches API convention
- **Selected Approach**: `/yjs/{pageId}` path prefix
- **Rationale**: Simple, semantic, no conflict with Socket.IO's `/socket.io/` path or Express routes
- **Trade-offs**: None significant

### Decision: Session-based authentication on WebSocket upgrade

- **Context**: Must authenticate WebSocket connections without Socket.IO middleware
- **Alternatives Considered**:
  1. Parse session cookie from upgrade request, load session from store — reuses existing session infrastructure
  2. Token-based auth via query params — simpler but requires generating/managing tokens
  3. Separate auth endpoint + upgrade — adds complexity
- **Selected Approach**: Parse session cookie from the HTTP upgrade request and deserialize the user from the session store
- **Rationale**: Reuses existing session infrastructure (same cookie, same store, same passport serialization), no client-side auth changes needed
- **Trade-offs**: Couples to express-session internals, but GROWI already has this coupling throughout

### Decision: Keep Socket.IO for awareness event fan-out

- **Context**: GROWI uses Socket.IO rooms (`page:{pageId}`) to broadcast awareness updates to non-editor components (page viewers, sidebar, etc.)
- **Selected Approach**: Continue using Socket.IO `io.in(roomName).emit()` for awareness size events and draft status notifications. Hook into y-websocket's per-document awareness events and bridge to Socket.IO.
- **Rationale**: Non-editor UI components already listen on Socket.IO rooms; changing this is out of scope
- **Trade-offs**: Two transport layers (WebSocket for Yjs sync, Socket.IO for UI events) — acceptable given the separation of concerns

## Risks & Mitigations
- **Risk**: y-websocket server `persistence.bindState` is not awaited before first sync → client may briefly see empty doc
  - **Mitigation**: Override `setupWSConnection` to await `doc.whenInitialized` before sending sync step 1, or ensure `bindState` completes fast (MongoDB read is typically <50ms)
- **Risk**: Socket.IO and ws competing for HTTP upgrade events
  - **Mitigation**: Socket.IO only handles `/socket.io/` path; register ws handler for `/yjs/` path with explicit path check before `handleUpgrade`
- **Risk**: Session cookie parsing edge cases (SameSite, Secure flags, proxy headers)
  - **Mitigation**: Reuse existing express-session cookie parser and session store; test with the same proxy configuration
- **Risk**: Document cleanup race when last client disconnects and a new client immediately connects
  - **Mitigation**: y-websocket's `getYDoc` atomic pattern handles this — new client gets a fresh doc if cleanup completed, or the existing doc if not yet cleaned up

## References
- [y-websocket GitHub](https://github.com/yjs/y-websocket) — official Yjs WebSocket provider
- [y-websocket-server GitHub](https://github.com/yjs/y-websocket-server) — server-side utilities (yjs v14)
- [y-socket.io npm](https://www.npmjs.com/package/y-socket.io) — current library (unmaintained since Sep 2023)
- [ws npm](https://www.npmjs.com/package/ws) — WebSocket implementation for Node.js
- [y-mongodb-provider](https://github.com/MaxNoetzold/y-mongodb-provider) — MongoDB persistence for Yjs
