# Implementation Plan

- [ ] 1. Add y-websocket dependency and adapt persistence layer
- [ ] 1.1 (P) Add y-websocket package to apps/app and packages/editor
  - Add `y-websocket@^2.0.4` to both `apps/app/package.json` and `packages/editor/package.json`
  - Classify as `dependencies` in apps/app (server-side `bin/utils` is used at runtime) and verify Turbopack externalisation after build
  - Run `pnpm install` to update lockfile
  - _Requirements: 2.1, 8.3_

- [ ] 1.2 (P) Adapt the MongoDB persistence layer to the y-websocket persistence interface
  - Update `create-mongodb-persistence.ts` to return an object matching y-websocket's `setPersistence` shape (`bindState`, `writeState`, `provider`)
  - The `bindState` implementation extends the current logic: load persisted Y.Doc, compute diff, store update, apply persisted state, register incremental update handler with `updatedAt` metadata
  - After applying persisted state within `bindState`, determine `YDocStatus` and call `syncYDoc` to synchronize with the latest revision — this guarantees correct ordering (persistence load completes before sync runs)
  - Also within `bindState`, register the awareness event listener on the document for the AwarenessBridge (emit awareness state size and draft status to Socket.IO rooms)
  - Accept `io` (Socket.IO server instance) and sync dependencies via factory parameters
  - The `writeState` implementation calls `flushDocument` — same as current
  - Update the `Persistence` type import from y-websocket's `bin/utils` instead of y-socket.io
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 6.3, 5.2, 5.3_

- [ ] 2. Implement WebSocket upgrade authentication handler
- [ ] 2.1 Create the upgrade handler that authenticates WebSocket connections using session cookies
  - Parse the `cookie` header from the HTTP upgrade request to extract the session ID
  - Load the session from the session store (Redis or MongoDB, matching GROWI's express-session configuration)
  - Deserialize the user from the session via passport's `deserializeUser`
  - Extract `pageId` from the URL path (`/yjs/{pageId}`)
  - Verify page access using `Page.isAccessiblePageByViewer(pageId, user)`
  - Allow guest access when the page permits it and the user is null
  - Reject unauthorized requests with `401 Unauthorized` or `403 Forbidden` by writing HTTP response headers and destroying the socket — before `handleUpgrade` is called
  - Attach the authenticated user to the request object for downstream use
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 3. Rewrite YjsService to use y-websocket server utilities
- [ ] 3.1 Replace YSocketIO with ws.WebSocketServer and y-websocket document management
  - Change the constructor to accept both `httpServer` and `io` (instead of only `io`)
  - Create a `WebSocket.Server` with `noServer: true` mode
  - Call y-websocket's `setPersistence` with the adapted persistence layer from task 1.2
  - Register the HTTP `upgrade` event handler on `httpServer`, routing requests with path prefix `/yjs/` to the upgrade handler from task 2.1, then to `wss.handleUpgrade`, and finally to y-websocket's `setupWSConnection` with the extracted `pageId` as `docName`
  - Ensure Socket.IO's upgrade handling for `/socket.io/` is not affected by checking the URL path before intercepting
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.3_

- [ ] 3.2 Integrate document status API and force-sync
  - Replace `ysocketio.documents.get(pageId)` with y-websocket's `docs.get(pageId)` for `getCurrentYdoc` and `syncWithTheLatestRevisionForce`
  - Preserve all public API behavior of `IYjsService` (getYDocStatus, getCurrentYdoc, syncWithTheLatestRevisionForce)
  - Update `sync-ydoc.ts` type imports: change `Document` from y-socket.io to y-websocket's `WSSharedDoc` (or `Y.Doc`)
  - Note: sync-on-load (`syncYDoc`) and awareness bridging are handled inside `bindState` of the PersistenceAdapter (task 1.2), not via `setContentInitializor`
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 4. Update server initialization flow
- [ ] 4.1 Pass httpServer to YjsService initialization
  - Update `initializeYjsService` to accept both `httpServer` and `io` parameters
  - Update the call site in `crowi/index.ts` to pass `httpServer` alongside `socketIoService.io`
  - Verify the initialization order: httpServer created → Socket.IO attached → YjsService initialized with both references
  - _Requirements: 2.3_

- [ ] 5. Migrate client-side provider to WebsocketProvider
- [ ] 5.1 (P) Replace SocketIOProvider with WebsocketProvider in the collaborative editor hook
  - Change the import from `y-socket.io` to `y-websocket`
  - Construct the WebSocket URL dynamically: use `wss://` when the page is served over HTTPS, `ws://` otherwise, appending `/yjs` as the base path
  - Use `pageId` as the `roomname` parameter (same as current)
  - Map options: `autoConnect: true` → `connect: true`; keep `resyncInterval: 3000`
  - Awareness API calls remain identical: `provider.awareness.setLocalStateField`, `.getStates()`, `.on('update', ...)`
  - Sync event listener remains identical: `provider.on('sync', handler)`
  - Lifecycle cleanup remains identical: `provider.disconnect()`, `provider.destroy()`
  - _Requirements: 2.2, 2.4, 5.1, 5.4_

- [ ] 6. Update Vite dev server configuration
- [ ] 6.1 (P) Configure the packages/editor Vite dev server to use y-websocket
  - Replace the `YSocketIO` import with y-websocket server utilities (`setupWSConnection`, `setPersistence`)
  - Create a `WebSocket.Server` with `noServer: true` in Vite's `configureServer` hook
  - Handle WebSocket upgrade events on the dev server's `httpServer` for the `/yjs/` path prefix
  - Ensure the Vite HMR WebSocket and the Yjs WebSocket do not conflict (different paths)
  - _Requirements: 7.1, 7.2_

- [ ] 7. Remove y-socket.io and finalize dependencies
- [ ] 7.1 Remove all y-socket.io references from the codebase
  - Remove `y-socket.io` from `apps/app/package.json` and `packages/editor/package.json`
  - Verify no remaining imports or type references to `y-socket.io` modules across the monorepo
  - Run `pnpm install` to update the lockfile
  - Verify `y-websocket` is classified correctly (`dependencies` vs `devDependencies`) by checking Turbopack externalisation: run `turbo run build --filter @growi/app` and check `apps/app/.next/node_modules/` for y-websocket
  - _Requirements: 8.1, 8.2, 8.3_

- [ ] 8. Integration and concurrency tests
- [ ] 8.1 Add integration tests for the WebSocket connection and sync flow
  - Test the full connection flow: WebSocket upgrade → authentication → document creation → sync step 1/2
  - Test multi-client sync: two clients connect to the same page, verify both receive each other's edits via the same server-side Y.Doc
  - Test reconnection: client disconnects and reconnects, verify it receives updates that occurred during disconnection
  - Test persistence round-trip: document persisted when all clients disconnect, state restored when a new client connects
  - _Requirements: 1.3, 1.4, 4.3, 4.5_

- [ ] 8.2 Add concurrency tests for document initialization safety
  - Test simultaneous connections: multiple clients connect to the same page at the exact same time, verify that exactly one Y.Doc instance exists on the server (the core race condition fix)
  - Test disconnect-during-connect: one client disconnects while another is connecting, verify no document corruption or data loss
  - _Requirements: 1.1, 1.2, 1.5_

- [ ] 8.3 Add unit tests for the upgrade authentication handler
  - Test valid session cookie → user deserialized → page access granted → upgrade proceeds
  - Test expired/invalid session → 401 response → socket destroyed
  - Test valid user but no page access → 403 response → socket destroyed
  - Test guest user with guest-accessible page → upgrade proceeds
  - Test missing or malformed URL path → rejection
  - _Requirements: 3.1, 3.2, 3.3, 3.4_
