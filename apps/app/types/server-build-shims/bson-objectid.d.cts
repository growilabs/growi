// Runtime: `module.exports` is the ObjectID constructor (self-patched dual
// default). Redeclare with `export =` carrying both the constructor value
// and the instance type.
import Orig from 'bson-objectid/objectid.js';

declare const ObjectID: typeof Orig;
type ObjectID = InstanceType<typeof Orig>;
export = ObjectID;
