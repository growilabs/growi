# self-hosted draw.io adaptation

Everything needed to make draw.io's `viewer-static.min.js` work when `DRAWIO_URI` points
at an instance the organisation runs itself, instead of `embed.diagrams.net`.

The bundle is built for draw.io's own hosting: it hard-codes `viewer.diagrams.net` as the
place its assets live. None of that is configurable through a supported API, so the
adaptation is a set of deliberate pokes at draw.io's globals. They are collected here so
the rest of the codebase never has to know about them.

## The two entry points, and why there are two

```
prepareSelfHostedDrawio(drawioUri)   // before <Script> inserts viewer-static.min.js
adoptSelfHostedDrawio(drawioUri)     // in onLoad, before the first diagram renders
```

Every global the bundle bakes a location into is initialised as

```js
window.X = window.X || "https://viewer.diagrams.net/..."
```

so a value written **before** the bundle evaluates is the value it keeps. That is the
whole mechanism, and it is why `prepareSelfHostedDrawio` cannot be deferred: by the time
the bundle has loaded, the values have already been read and used to build derived state.

`adoptSelfHostedDrawio` exists for the one thing that genuinely cannot be decided up
front — see MathJax below.

## What each file handles

### `rebase-asset-paths.ts` — stencils, shapes, styles, images

Two separate problems, which is why the destinations differ.

**Wrong location.** `mxStencilRegistry.libraries` is built out of `STENCIL_PATH` and
`SHAPES_PATH` while the bundle evaluates. Rewriting those library entries afterwards is
too late *and* incomplete: `mxStencilRegistry.getStencil()` also falls back to reading
`STENCIL_PATH` directly, and a stencil that arrives through the fallback keeps going to
`viewer.diagrams.net` however the library entries were rewritten. Setting the globals up
front fixes both routes at once.

**Same-origin rule.** Stencils and shapes are read with `XMLHttpRequest`. A self-hosted
draw.io answers without an `Access-Control-Allow-Origin` header — `viewer.diagrams.net`
sends `*`, which is why nobody hits this until `DRAWIO_URI` moves — so the browser refuses
every cross-origin read. Those three subtrees therefore go through GROWI's own origin, via
the proxy route in `features/drawio/server/routes/drawio-assets.ts`. Images are loaded as
`<img>`, are not subject to the rule, and point straight at the instance.

refs: https://github.com/growilabs/growi/issues/10726

### `adopt-mathjax.ts` — MathJax

`Editor.initMath()` runs at the bottom of `viewer-static.min.js` and appends a `<script>`
for the baked-in MathJax location. **Removing that element afterwards does not stop it**: a
dynamically inserted classic script runs once its fetch completes, whether or not it is
still in the document. When the baked-in location is genuinely reachable — and
`https://viewer.diagrams.net/math4/es5`, what draw.io v29+ bakes in, still is — MathJax
boots twice, the second boot leaves the first half-initialised, and typesetting dies with
`Input Jax "tex" is not defined`.

So instead of removing anything: define `window.MathJax` up front, which turns the
load-time `initMath()` into a no-op because it only acts while that global is undefined.
Nothing is appended for the baked-in location at all. Then in `onLoad`, put the corrected
location in `DRAW_MATH_URL` and run `initMath()` again. One boot, from the right place.

The location has to be read from the value the bundle baked in, because draw.io moved the
directory from `math/es5` to `math4/es5` in v29 and the instance only ships one of them.
Reusing the baked path means the draw.io version never has to be detected.

`initMath()` also installs the listeners that ask for typesetting, which is why
`adoptSelfHostedDrawio` must run before the first diagram is rendered.

refs: https://github.com/growilabs/growi/issues/9774

### Why touching `window.MathJax` is safe here

It reads like a global with a big blast radius, so: GROWI's own page math is
`remark-math` + `rehype-katex`, and KaTeX never looks at `window.MathJax` — the app has no
MathJax dependency at all. The only MathJax on a GROWI page is the one draw.io loads for
diagram labels.

`viewer-static.min.js` is loaded on every page view, not only on pages holding a diagram,
so **draw.io already sets `window.MathJax` on every page today** — this code does not
introduce the global, it decides what goes in it. Once `adoptSelfHostedDrawio` has run, the
value is draw.io's own configuration object, exactly as before.

The one thing to keep in mind: between the two entry points the global holds a placeholder
`{}`. Anything that treats `typeof window.MathJax !== 'undefined'` as "MathJax is present"
would be misled during that window — a custom script or plugin loading its own MathJax is
the realistic case. `adoptMathJax` therefore always clears the placeholder, including on the
path where it cannot relocate anything, so the window closes as soon as `onLoad` runs.

## What the proxy route adds on top

Older draw.io images ship **no `stencils/` or `shapes/` directory at all** — absent on
`28.2.9`, present on `31.1.5`. On such an instance the library exists only on draw.io's own
host, so the proxy falls back to reading it from there when the instance answers 404. The
browser still only ever talks to GROWI's origin; the outbound request, if any, is the
server's. On a network with no route out that fallback fails and the shape renders empty,
which is the same outcome as before and is a limitation of that draw.io version rather than
of this code — upgrading the instance fixes it.

### When it is in play, and when it is not

The route answers only while `DRAWIO_URI` names a self-hosted instance — the same condition
the client rebases on, via the shared `isSelfHostedDrawio`. On a default deployment (or one
whose `DRAWIO_URI` holds nothing usable) it is a 404 and makes no outbound request, because
`viewer.diagrams.net` sends `Access-Control-Allow-Origin: *` and the browser can read the
libraries directly.

It is only needed because a **cross-origin** self-hosted instance sends no such header. Two
deployment choices remove that need, and both are better than proxying if they are available:
serve draw.io from GROWI's own origin behind a reverse proxy, or configure the instance to
send `Access-Control-Allow-Origin`. Neither is something GROWI can arrange on its own, which
is why the route exists.

## Known remaining gap

`PROXY_URL` (draw.io's own fetcher for images referenced from inside a diagram) is left
alone. The self-hosted image does not ship that servlet — `/proxy` answers 404 — so there
is nothing to point it at. It is not used on the viewer path.

## Verifying a change here

Neither problem shows up against `embed.diagrams.net`, and the MathJax one only appears on
machines that *can* reach the internet, so it cannot be caught by unit tests alone. Run a
real instance and check both draw.io generations, because the two failures are mirror
images of each other:

```bash
docker run -d --name drawio-31 -p 8080:8080 jgraph/drawio:latest      # bakes math4/es5
docker run -d --name drawio-28 -p 8081:8080 jgraph/drawio:28.2.9      # bakes math/es5
```

Then set `DRAWIO_URI` to one of them and view a page holding a diagram that has
Mathematical Typesetting enabled and uses an AWS shape. What to look for:

- every `stencils/` and `shapes/` request goes to GROWI's origin, and none to
  `viewer.diagrams.net`
- `startup.js` is fetched exactly once, from the configured instance
- `document.querySelectorAll('mjx-container').length` is greater than zero

The v28 instance is the useful one for the stencil and location work, because its baked-in
MathJax path 404s upstream. The v31 instance is the one that catches the double-boot,
because its baked-in path does not.
