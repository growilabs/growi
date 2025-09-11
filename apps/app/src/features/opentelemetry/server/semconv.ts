/* eslint-disable max-len */
/*
### Unstable SemConv

<!-- Dev Note: ^^ This '#unstable-semconv' anchor is being used in jsdoc links in the code. -->

Because the "incubating" entry-point may include breaking changes in minor versions, it is recommended that instrumentation libraries **not** import `@opentelemetry/semantic-conventions/incubating` in runtime code, but instead **copy relevant definitions into their own code base**. (This is the same [recommendation](https://opentelemetry.io/docs/specs/semconv/non-normative/code-generation/#stability-and-versioning) as for other languages.)

For example, create a "src/semconv.ts" (or "lib/semconv.js" if implementing in JavaScript) file that copies from [experimental_attributes.ts](./src/experimental_attributes.ts) or [experimental_metrics.ts](./src/experimental_metrics.ts):

```ts
// src/semconv.ts
export const ATTR_DB_NAMESPACE = 'db.namespace';
export const ATTR_DB_OPERATION_NAME = 'db.operation.name';
```

```ts
// src/instrumentation.ts
import {
  ATTR_SERVER_PORT,
  ATTR_SERVER_ADDRESS,
} from '@opentelemetry/semantic-conventions';
import {
  ATTR_DB_NAMESPACE,
  ATTR_DB_OPERATION_NAME,
} from './semconv';

span.setAttributes({
  [ATTR_DB_NAMESPACE]: ...,
  [ATTR_DB_OPERATION_NAME]: ...,
  [ATTR_SERVER_PORT]: ...,
  [ATTR_SERVER_ADDRESS]: ...,
})
```

Occasionally, one should review changes to `@opentelemetry/semantic-conventions` to see if any used unstable conventions have changed or been stabilized. However, an update to a newer minor version of the package will never be breaking.
*/

export const ATTR_SERVICE_INSTANCE_ID = 'service.instance.id';
export const ATTR_HTTP_TARGET = 'http.target';
