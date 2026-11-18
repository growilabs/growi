export type RegisteredRoute = {
  readonly method: string;
  /** Mount prefix + route path. A route registered as '/' under a mount may end with '/'. */
  readonly path: string;
  /** Handler names in registration order; the last one is the route body. '' when unnamed. */
  readonly middlewareNames: readonly string[];
};

type ExpressLayer = {
  name?: string;
  path?: string;
  regexp?: { source: string; fast_slash?: boolean };
  route?: {
    path: string | RegExp | Array<string | RegExp>;
    methods: Record<string, boolean>;
    stack: Array<{ handle: { name?: string }; name?: string; method?: string }>;
  };
  handle:
    | { stack?: ExpressLayer[]; name?: string }
    | ((...args: unknown[]) => unknown);
};

/**
 * Extract the static prefix that a mount Layer's regexp matches.
 * Express 4 stores the `regexp` source for `app.use('/prefix', router)` as
 * `/^\/prefix\/?(?=\/|$)/i`; `fast_slash` is true for unprefixed `app.use(router)`.
 */
export const extractMountPrefix = (layer: ExpressLayer): string => {
  if (layer.path != null && typeof layer.path === 'string') {
    return layer.path;
  }
  if (layer.regexp?.fast_slash) {
    return '';
  }
  const source = layer.regexp?.source ?? '';
  // Source shape: "^\/foo\/?(?=\/|$)" — strip anchors and look-ahead.
  const match = source.match(/^\^\\\/(.*)\\\/\?\(\?=\\\/\|\$\)$/);
  if (match != null) {
    return `/${match[1].replace(/\\\//g, '/')}`;
  }
  // Parameterized mounts (`/users/:id`) include ([^\/]+?). Preserve the
  // source so output stays stable, but mark it so reviewers can spot it.
  return `<regexp:${source}>`;
};

const walkStack = (
  stack: ExpressLayer[],
  prefix: string,
  routes: RegisteredRoute[],
): void => {
  for (const layer of stack) {
    if (layer.route != null) {
      const { route } = layer;
      const routePath = Array.isArray(route.path)
        ? route.path.map(String).join('|')
        : String(route.path);
      const fullPath = `${prefix}${routePath}`;

      const methods = Object.keys(route.methods)
        .filter((k) => route.methods[k])
        .sort();

      for (const method of methods) {
        const middlewareNames = route.stack
          .filter(
            (l) =>
              l.method == null ||
              l.method.toLowerCase() === method.toLowerCase(),
          )
          .map((rl) => {
            const handleName = (rl.handle?.name ?? '').trim();
            const layerName = (rl.name ?? '').trim();
            return handleName !== '' ? handleName : layerName;
          });
        routes.push({
          method: method.toUpperCase(),
          path: fullPath,
          middlewareNames,
        });
      }
      continue;
    }

    // Mount layer: recurse if the handle exposes its own router stack.
    const handle = layer.handle as { stack?: ExpressLayer[] } | undefined;
    if (handle?.stack != null && Array.isArray(handle.stack)) {
      walkStack(handle.stack, `${prefix}${extractMountPrefix(layer)}`, routes);
    }
  }
};

export const listRegisteredRoutes = (app: {
  _router: unknown;
}): readonly RegisteredRoute[] => {
  const router = app._router as { stack?: ExpressLayer[] } | undefined;
  if (router == null || !Array.isArray(router.stack)) {
    throw new Error(
      'Express _router.stack is not available. Routes may not be attached.',
    );
  }
  const routes: RegisteredRoute[] = [];
  walkStack(router.stack, '', routes);
  return routes;
};
