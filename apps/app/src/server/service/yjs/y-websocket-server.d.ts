declare module 'y-websocket/bin/utils' {
  import type { IncomingMessage } from 'http';
  import type { WebSocket } from 'ws';
  import type { WebsocketProvider } from 'y-websocket';
  import * as Y from 'yjs';

  export class WSSharedDoc extends Y.Doc {
    name: string;
    conns: Map<WebSocket, Set<number>>;
    awareness: WebsocketProvider['awareness'];
    whenInitialized: Promise<void>;
    constructor(name: string);
  }

  export interface YWebsocketPersistence {
    bindState: (docName: string, ydoc: WSSharedDoc) => void;
    writeState: (docName: string, ydoc: WSSharedDoc) => Promise<void>;
    provider: unknown;
  }

  export function setPersistence(
    persistence: YWebsocketPersistence | null,
  ): void;
  export function getPersistence(): YWebsocketPersistence | null;

  export const docs: Map<string, WSSharedDoc>;

  export function getYDoc(docname: string, gc?: boolean): WSSharedDoc;

  export function setupWSConnection(
    conn: WebSocket,
    req: IncomingMessage,
    opts?: { docName?: string; gc?: boolean },
  ): void;

  export function setContentInitializor(
    f: (ydoc: Y.Doc) => Promise<void>,
  ): void;
}
