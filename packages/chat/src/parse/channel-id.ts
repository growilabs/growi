// The only way to obtain a `NativeChannelId`: every channel id that crosses
// the protocol, is typed by an administrator, or is read back from storage
// passes through here.
//
// A chat adapter encodes a channel id with its service's name in front
// (`slack:C0CBFQ5558V`); that encoding belongs inside the proxy and must
// never reach the protocol, where an administrator's typed `C0CBFQ5558V`
// would no longer match it. Refusing the prefix here makes such a leak fail
// where it happens rather than as a mismatch far downstream.
import type { NativeChannelId } from '../contract/common.js';
import { PLATFORM_NAMES } from './platform-names.js';
import { str } from './shape.js';

const CHANNEL_ID_MAX = 200;

const ADAPTER_ENCODING = new RegExp(`^(?:${PLATFORM_NAMES.join('|')}):`);

/** `undefined` for anything that is not a service's own channel id. */
export const parseNativeChannelId = (
  v: unknown,
): NativeChannelId | undefined => {
  const id = str(v, CHANNEL_ID_MAX);
  if (id === undefined || ADAPTER_ENCODING.test(id)) {
    return undefined;
  }
  return id as NativeChannelId;
};

/** For a value the caller already expects to be valid; throws otherwise. */
export const toNativeChannelId = (value: string): NativeChannelId => {
  const id = parseNativeChannelId(value);
  if (id === undefined) {
    throw new TypeError(`Not a chat service's own channel id: ${value}`);
  }
  return id;
};
