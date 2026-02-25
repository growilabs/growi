/**
 * The interface to handle server-to-server message
 */
export interface S2sMessageHandlable {
  shouldHandleS2sMessage(s2sMessage): boolean;

  handleS2sMessage(s2sMessage): Promise<void>;
}
