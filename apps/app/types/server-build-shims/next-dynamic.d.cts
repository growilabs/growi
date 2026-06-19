// next/dynamic runtime self-patches `module.exports` to the dynamic() factory.
import OrigDynamic from 'next/dist/shared/lib/dynamic.js';
declare const dynamic: typeof OrigDynamic;
export = dynamic;
