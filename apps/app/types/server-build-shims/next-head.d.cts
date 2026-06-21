// next/head runtime self-patches `module.exports` to the Head component.
import OrigHead from 'next/dist/shared/lib/head.js';

declare const Head: typeof OrigHead;
export = Head;
