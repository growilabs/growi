/** A frame or result that does not follow the protocol; the parent treats it as an abnormal child. */
export class WireProtocolError extends Error {
  override readonly name = 'WireProtocolError';
}
