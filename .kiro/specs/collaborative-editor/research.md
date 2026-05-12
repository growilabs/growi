# Research & Design Decisions

## Summary
- **Feature**: `collaborative-editor`
- **Key Findings**:
  - y-websocket uses atomic `map.setIfUndefined` for document creation — eliminates TOCTOU race conditions
  - `y-websocket@2.x` bundles both client and server utils with `yjs@^13` compatibility
  - `ws` package already installed in GROWI; Express HTTP server supports adding WebSocket upgrade alongside Socket.IO

## Design Decisions

### Decision: Use y-websocket@2.x for both client and server

- **Context**: Need yjs v13 compatibility on both client and server sides
- **Alternatives Considered**:
  1. y-websocket@3.x client + custom server — more work, v3 SyncStatus not needed
  2. y-websocket@3.x + @y/websocket-server — requires yjs v14 migration (out of scope)
  3. y-websocket@2.x for everything — simplest path, proven code
- **Selected**: Option 3 — `y-websocket@2.x`
- **Rationale**: Minimizes custom code, proven server utils, compatible with yjs v13, clear upgrade path to v3 + @y/websocket-server when yjs v14 migration happens
- **Trade-offs**: Miss v3 SyncStatus feature, but `sync` event + `resyncInterval` meets all requirements
- **Follow-up**: Plan separate yjs v14 migration, then upgrade to y-websocket v3 + @y/websocket-server

### Decision: WebSocket path prefix `/yjs/`

- **Context**: Need URL pattern that doesn't conflict with Socket.IO
- **Selected**: `/yjs/{pageId}`
- **Rationale**: Simple, semantic, no conflict with Socket.IO's `/socket.io/` path or Express routes

### Decision: Session-based authentication on WebSocket upgrade

- **Context**: Must authenticate WebSocket connections without Socket.IO middleware
- **Selected**: Parse session cookie from HTTP upgrade request, deserialize user from session store
- **Rationale**: Reuses existing session infrastructure — same cookie, same store, same passport serialization
- **Trade-offs**: Couples to express-session internals, but GROWI already has this coupling throughout

### Decision: Keep Socket.IO for awareness event fan-out

- **Context**: GROWI uses Socket.IO rooms (`page:{pageId}`) to broadcast awareness updates to non-editor components
- **Selected**: Continue using Socket.IO `io.in(roomName).emit()` for awareness events, bridging from y-websocket awareness
- **Rationale**: Non-editor UI components already listen on Socket.IO rooms; changing this is out of scope

## Critical Implementation Constraints

### engine.io `destroyUpgrade` setting

Socket.IO's engine.io v6 defaults `destroyUpgrade: true` in its `attach()` method. This causes engine.io to destroy all non-Socket.IO upgrade requests after a 1-second timeout. The Socket.IO server **must** be configured with `destroyUpgrade: false` to allow `/yjs/` WebSocket handshakes to succeed.

### Next.js upgradeHandler race condition (guardSocket pattern)

Next.js's `NextCustomServer.upgradeHandler` registers an `upgrade` listener on the HTTP server. When the Yjs async handler yields at its first `await`, Next.js's synchronous handler runs and calls `socket.end()` for unrecognized paths. The `guardSocket` pattern temporarily replaces `socket.end()`/`socket.destroy()` with no-ops before the first `await`, restoring them after auth completes.

- `prependListener` cannot solve this — it only changes listener order, cannot prevent subsequent listeners from executing
- Removing Next.js's listener is fragile and breaks HMR
- Synchronous auth is impossible (requires async MongoDB/session store queries)

### React render-phase violation in use-collaborative-editor-mode

Provider creation and awareness event handlers must be placed **outside** `setProvider(() => { ... })` functional state updaters. If inside, `awareness.setLocalStateField()` triggers synchronous awareness events that update other components during render. All side effects go in the `useEffect` body; `setProvider(_provider)` is called with a plain value.

### y-websocket bindState ordering

y-websocket does NOT await `bindState` before sending sync messages. However, within `bindState` itself, the ordering is guaranteed: persistence load → YDocStatus check → syncYDoc → awareness registration. This consolidation is intentional.

## References
- [y-websocket GitHub](https://github.com/yjs/y-websocket)
- [y-websocket-server GitHub](https://github.com/yjs/y-websocket-server) (yjs v14, future migration target)
- [ws npm](https://www.npmjs.com/package/ws)
- [y-mongodb-provider](https://github.com/MaxNoetzold/y-mongodb-provider)
