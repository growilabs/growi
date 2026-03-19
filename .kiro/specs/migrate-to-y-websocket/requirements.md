# Requirements Document

## Introduction

GROWI's collaborative editing system currently uses `y-socket.io` (v1.1.3) as the Yjs transport layer for real-time document synchronization. A critical race condition in `y-socket.io`'s `initDocument()` method causes clients to occasionally split into isolated Y.Doc instances on the server, resulting in permanent desynchronization until browser reload. The `y-socket.io` library has been unmaintained since September 2023.

This specification defines the requirements for migrating the collaborative editing transport layer from `y-socket.io` to `y-websocket`, the official Yjs WebSocket provider maintained by the Yjs core team. The migration resolves the document initialization race condition while maintaining all existing collaborative editing functionality.

**Scope**: Server-side Yjs document management, client-side Yjs provider, WebSocket authentication, MongoDB persistence integration, and awareness/presence tracking.

**Out of Scope**: Changes to the Yjs document model itself, CodeMirror editor integration, page save/revision logic, or the global Socket.IO infrastructure used for non-Yjs events.

## Requirements

### Requirement 1: Document Synchronization Integrity

**Objective:** As a wiki user editing collaboratively, I want all clients editing the same page to always share a single server-side Y.Doc instance, so that edits are never lost due to document desynchronization.

#### Acceptance Criteria

1. When multiple clients connect to the same page simultaneously, the Yjs Service shall ensure that exactly one Y.Doc instance exists on the server for that page.
2. When a client connects while another client's document initialization is in progress, the Yjs Service shall return the same Y.Doc instance to both clients without creating a duplicate.
3. When a client reconnects after a brief network disconnection, the Yjs Service shall synchronize the client with the existing server-side Y.Doc containing all other clients' changes.
4. While multiple clients are editing the same page, the Yjs Service shall propagate each client's changes to all other connected clients in real time.
5. If a client's WebSocket connection drops and reconnects, the Yjs Service shall not destroy the server-side Y.Doc while other clients remain connected.

### Requirement 2: WebSocket Transport Layer

**Objective:** As a system operator, I want the collaborative editing transport to use y-websocket instead of y-socket.io, so that the system benefits from active maintenance and the race-condition-free document initialization pattern.

#### Acceptance Criteria

1. The Yjs Service shall use `y-websocket` (or `@y/websocket-server`) as the server-side Yjs transport, replacing `y-socket.io`.
2. The Editor Client shall use `y-websocket`'s `WebsocketProvider` as the client-side Yjs provider, replacing `y-socket.io`'s `SocketIOProvider`.
3. The WebSocket server shall coexist with the existing Socket.IO server on the same HTTP server instance without port conflicts.
4. The Yjs Service shall support the `resyncInterval` capability (periodic state re-synchronization) to recover from any missed updates.

### Requirement 3: Authentication and Authorization

**Objective:** As a system administrator, I want WebSocket connections for collaborative editing to be authenticated and authorized, so that only permitted users can access page content via the Yjs channel.

#### Acceptance Criteria

1. When a WebSocket upgrade request is received for collaborative editing, the Yjs Service shall authenticate the user using the existing session/passport mechanism.
2. When an authenticated user attempts to connect to a page's Yjs document, the Yjs Service shall verify that the user has read access to that page before allowing the connection.
3. If an unauthenticated or unauthorized WebSocket upgrade request is received, the Yjs Service shall reject the connection with an appropriate HTTP error status.
4. Where guest access is enabled for a page, the Yjs Service shall allow guest users to connect to that page's collaborative editing session.

### Requirement 4: MongoDB Persistence Compatibility

**Objective:** As a system operator, I want the Yjs persistence layer to continue using the existing MongoDB storage, so that no data migration is required and existing drafts are preserved.

#### Acceptance Criteria

1. The Yjs Service shall continue to use the `yjs-writings` MongoDB collection for document persistence.
2. The Yjs Service shall maintain compatibility with the existing `MongodbPersistence` implementation (extended `y-mongodb-provider`).
3. When a Y.Doc is loaded from persistence, the Yjs Service shall apply the persisted state before sending sync messages to connecting clients.
4. When a Y.Doc receives updates, the Yjs Service shall persist each update to MongoDB with an `updatedAt` timestamp.
5. When all clients disconnect from a document, the Yjs Service shall flush the document state to MongoDB before destroying the in-memory instance.

### Requirement 5: Awareness and Presence Tracking

**Objective:** As a wiki user, I want to see which other users are currently editing the same page, so that I can coordinate edits and avoid conflicts.

#### Acceptance Criteria

1. While a user is editing a page, the Editor Client shall broadcast the user's presence information (name, username, avatar, cursor color) via the Yjs awareness protocol.
2. When a user connects or disconnects from a collaborative editing session, the Yjs Service shall emit awareness state size updates to the page's Socket.IO room (`page:{pageId}`).
3. When the last user disconnects from a document, the Yjs Service shall emit a draft status notification (`YjsHasYdocsNewerThanLatestRevisionUpdated`) to the page's Socket.IO room.
4. The Editor Client shall display the list of active editors based on awareness state updates from the Yjs provider.

### Requirement 6: YDoc Status and Sync Integration

**Objective:** As a system component, I want the YDoc status detection and force-sync mechanisms to continue functioning, so that draft detection, save operations, and revision synchronization work correctly.

#### Acceptance Criteria

1. The Yjs Service shall continue to expose `getYDocStatus(pageId)` returning the correct status (ISOLATED, NEW, DRAFT, SYNCED, OUTDATED).
2. The Yjs Service shall continue to expose `getCurrentYdoc(pageId)` returning the in-memory Y.Doc instance if one exists.
3. When the `document-loaded` event fires (or equivalent), the Yjs Service shall call `syncYDoc` to synchronize the document with the latest revision based on YDoc status.
4. The Yjs Service shall continue to expose `syncWithTheLatestRevisionForce(pageId)` for API-triggered force synchronization.

### Requirement 7: Development Environment Support

**Objective:** As a developer, I want the collaborative editing to work in the local development environment, so that I can develop and test collaborative features.

#### Acceptance Criteria

1. The Vite dev server configuration (`packages/editor/vite.config.ts`) shall support the y-websocket-based collaborative editing setup.
2. When running `turbo run dev`, the WebSocket endpoint for collaborative editing shall be available alongside the existing Socket.IO endpoints.

### Requirement 8: Dependency Cleanup

**Objective:** As a maintainer, I want the y-socket.io dependency to be completely removed after migration, so that the codebase has no dead dependencies.

#### Acceptance Criteria

1. When the migration is complete, the `y-socket.io` package shall be removed from all `package.json` files in the monorepo.
2. The system shall have no remaining imports or type references to `y-socket.io` modules.
3. The `y-websocket` (and/or `@y/websocket-server`) package shall be listed in the appropriate `dependencies` or `devDependencies` section based on the Turbopack externalisation rule.
