import type { RefObject } from 'react';
import { GROWI_IS_CONTENT_RENDERING_ATTR } from '@growi/core/dist/consts';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { InlineCommentAnchor } from '../../../interfaces';
import { matchQuote } from '../../services/quote-matcher';
import type { AnchorResolverInput } from './use-anchor-resolver';
import { useAnchorResolver } from './use-anchor-resolver';

const anchorOf = (
  id: string,
  quote: string,
  approxOffset: number,
): AnchorResolverInput => {
  const anchor: InlineCommentAnchor = {
    quote,
    prefix: '',
    suffix: '',
    approxOffset,
  };
  return { id, anchor };
};

describe('useAnchorResolver', () => {
  let container: HTMLDivElement;
  let containerRef: RefObject<HTMLElement | null>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    containerRef = { current: container };
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  // Real timers throughout: use-container-settle's underlying observer relies
  // on a real MutationObserver + setTimeout race that fake timers break (see
  // the same note in use-container-settle.spec.tsx).

  it('highlights a comment whose quote exactly matches the current text', async () => {
    container.textContent = 'The quick brown fox jumps over the lazy dog.';
    const anchors = [anchorOf('c1', 'quick brown fox', 4)];

    const { result } = renderHook(() =>
      useAnchorResolver(containerRef, anchors),
    );

    await waitFor(() => expect(result.current.get('c1')).toBeDefined());

    const start = 'The '.length;
    expect(result.current.get('c1')).toEqual({
      status: 'exact',
      startOffset: start,
      endOffset: start + 'quick brown fox'.length,
    });
  });

  it('reports not_found once an edit removes any trace of the quote, and drops the highlight', async () => {
    container.textContent = 'The quick brown fox jumps over the lazy dog.';
    const anchors = [anchorOf('c1', 'quick brown fox', 4)];

    const { result } = renderHook(() =>
      useAnchorResolver(containerRef, anchors),
    );

    await waitFor(() =>
      expect(result.current.get('c1')).toMatchObject({ status: 'exact' }),
    );

    // Force a second settle by cycling the rendering-status marker (the same
    // technique use-container-settle.spec.tsx uses), after editing the text
    // to something with no exact or fuzzy relation to the original quote.
    // The "unsettle" (rendering element present) and "resettle" (attribute
    // flipped to false) mutations are deliberately kept as two separate
    // batches, separated by an await: that makes the observer actually see the
    // intermediate "still rendering" state, so this test walks the same
    // present-then-absent path the resolver's mid-render guard depends on. One
    // synchronous batch would settle too — use-container-settle fires whenever
    // a check finds no rendering element, and its mutation-triggered check is
    // coalesced into a requestAnimationFrame that re-evaluates the container
    // after all synchronous mutations (see that module's JSDoc for the
    // mount-synchronous / mutation-rAF-coalesced contract) — but it would not
    // exercise the intermediate state.
    const renderingEl = document.createElement('div');
    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true');
    container.replaceChildren(
      document.createTextNode('Completely unrelated content, nothing matches.'),
      renderingEl,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'false');

    await waitFor(() =>
      expect(result.current.get('c1')).toEqual({ status: 'not_found' }),
    );
  });

  it('recomputes idempotently: two settles over the same DOM state yield equivalent maps', async () => {
    container.textContent = 'alpha needle beta gamma delta needle omega';
    const anchors = [anchorOf('c1', 'needle', 30)];

    const { result } = renderHook(() =>
      useAnchorResolver(containerRef, anchors),
    );

    await waitFor(() => expect(result.current.get('c1')).toBeDefined());
    const firstResolved = new Map(result.current);

    // Trigger a second settle without changing the DOM's text content. The
    // "unsettle" and "resettle" steps are separated by an await so the
    // observer sees the intermediate "still rendering" state rather than only
    // the final one — the same deliberate split as in the not_found test
    // above, where the reasoning is spelled out.
    const renderingEl = document.createElement('div');
    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true');
    container.appendChild(renderingEl);
    await new Promise((resolve) => setTimeout(resolve, 20));

    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'false');

    await waitFor(() => {
      // A fresh Map instance is expected each settle; equality is checked by value below.
      expect(result.current).not.toBe(firstResolved);
    });

    expect(Array.from(result.current.entries())).toEqual(
      Array.from(firstResolved.entries()),
    );
  });

  it('resolves anchors that arrive after mount, with no further DOM settle event', async () => {
    // Reproduces the real-world gap: on a plain markdown page (no lsx/drawio/
    // mermaid widget), useContainerSettle fires exactly once, at mount,
    // before useSWRxInlineComments(pageId) has resolved its list fetch — so
    // the hook is first rendered with `anchors: []`. Because the container
    // never settles again (no rendering element ever appears to re-arm the
    // observer), the real anchors that arrive afterward must be picked up by
    // some other mechanism, not by a second settle event.
    container.textContent = 'The quick brown fox jumps over the lazy dog.';

    const { result, rerender } = renderHook(
      ({ anchors }) => useAnchorResolver(containerRef, anchors),
      { initialProps: { anchors: [] as AnchorResolverInput[] } },
    );

    // The SWR fetch resolves later, handing back the real anchor list. No
    // DOM mutation happens here — the container's rendered text is unchanged
    // — so no settle event fires; only `anchors` itself changes.
    rerender({ anchors: [anchorOf('c1', 'quick brown fox', 4)] });

    await waitFor(() =>
      expect(result.current.get('c1')).toMatchObject({ status: 'exact' }),
    );
  });

  it('defers an anchors change that arrives while the body is still rendering, and resolves it on the following settle', async () => {
    // The comment list can resolve before an asynchronously-rendered widget
    // (KaTeX / Mermaid / PlantUML / draw.io) has finished. Resolving against
    // that mid-render DOM publishes a wrong result — here the only text
    // present is the placeholder, so the quote cannot be found at all.
    const renderingEl = document.createElement('div');
    renderingEl.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true');
    container.replaceChildren(
      document.createTextNode('Rendering…'),
      renderingEl,
    );

    const { result, rerender } = renderHook(
      ({ anchors }) => useAnchorResolver(containerRef, anchors),
      { initialProps: { anchors: [] as AnchorResolverInput[] } },
    );

    // The list fetch resolves while the widget is still rendering.
    rerender({ anchors: [anchorOf('c1', 'quick brown fox', 4)] });

    // Give the (guarded) anchors-change effect a chance to run before
    // asserting that it published nothing.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.get('c1')).toBeUndefined();

    // Rendering finishes: the placeholder and the rendering element are
    // replaced by the real body text. That childList mutation makes
    // use-container-settle re-check the container, find no rendering element
    // and fire — which is what picks up the deferred anchors.
    container.replaceChildren(
      document.createTextNode('The quick brown fox jumps over the lazy dog.'),
    );

    const start = 'The '.length;
    await waitFor(() =>
      expect(result.current.get('c1')).toEqual({
        status: 'exact',
        startOffset: start,
        endOffset: start + 'quick brown fox'.length,
      }),
    );
  });

  it('waits for a draw.io diagram to finish before highlighting text that follows it', async () => {
    // Regression guard for the draw.io path (Requirements 3.2, 3.3). draw.io's
    // viewer already participated correctly in the rendering-status protocol
    // before this amend — `DrawioViewer` renders its wrapper with
    // GROWI_IS_CONTENT_RENDERING_ATTR set to 'true', GraphViewer injects the
    // diagram into the inner `.mxgraph` element, and the viewer's own
    // MutationObserver flips the attribute to 'false' afterwards. This pins
    // that the changed settle detection still resolves such a page correctly,
    // and only after the diagram is done.
    //
    // The diagram matters because its rendered labels are part of the
    // container's text: they shift every offset after the diagram. The page is
    // built so that shift is what decides which of two identical quote
    // occurrences gets highlighted. The distance between the two occurrences
    // is deliberately kept strictly between zero and twice
    // DIAGRAM_LABELS.length, so while the diagram is still empty the *wrong*
    // (second) occurrence is the one closer to the stored approxOffset — yet
    // the two occurrences never coincide with the expected settled offset, so
    // the final assertion below pins one specific occurrence.
    const INTRO = 'Architecture overview. ';
    const DIAGRAM_LABELS = 'Client → API Gateway → Worker';
    const MID = ' shows ';
    const QUOTE = 'the retry path';
    const GAP = ' and then ';
    const TAIL = ' again.';
    const body = MID + QUOTE + GAP + QUOTE + TAIL;

    const settledText = INTRO + DIAGRAM_LABELS + body;
    const midRenderText = INTRO + body;

    const targetStart = settledText.indexOf(QUOTE);
    const midRenderTargetStart = midRenderText.indexOf(QUOTE);
    const midRenderDecoyStart = midRenderText.indexOf(
      QUOTE,
      midRenderTargetStart + 1,
    );

    // The anchor was captured from the fully rendered page, so its
    // approxOffset is the target occurrence's offset *with* the diagram
    // present.
    const anchor = anchorOf('c1', QUOTE, targetStart);

    // Premise of this scenario, asserted rather than assumed: resolving
    // against the mid-render text really would highlight the wrong
    // occurrence. Without this the test could pass with a page where
    // resolving early happens to be harmless, and would prove nothing.
    expect(matchQuote(midRenderText, anchor.anchor)).toEqual({
      status: 'exact',
      startOffset: midRenderDecoyStart,
      endOffset: midRenderDecoyStart + QUOTE.length,
    });
    expect(midRenderDecoyStart).not.toBe(midRenderTargetStart);
    // ...and the mid-render mistake is a different offset from the correct
    // settled one, so the assertion at the end of this test cannot be
    // satisfied by an early resolution that happened to guess right.
    expect(midRenderDecoyStart).not.toBe(targetStart);

    // draw.io's wrapper as `DrawioViewer` renders it: marked as rendering,
    // with an empty `.mxgraph` element waiting for GraphViewer.
    const drawioWrapper = document.createElement('div');
    drawioWrapper.className = 'drawio-viewer';
    drawioWrapper.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'true');
    const mxgraph = document.createElement('div');
    mxgraph.className = 'mxgraph';
    drawioWrapper.appendChild(mxgraph);

    container.replaceChildren(
      document.createTextNode(INTRO),
      drawioWrapper,
      document.createTextNode(body),
    );

    const { result } = renderHook(() =>
      useAnchorResolver(containerRef, [anchor]),
    );

    // Nothing is highlighted while the diagram is still rendering: the
    // mount-time settle check finds the marker and stays quiet, and the
    // anchors trigger defers rather than matching against the half-built DOM.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.get('c1')).toBeUndefined();

    // GraphViewer injects the diagram, whose labels join the container's text.
    // The marker is still 'true' at this point — the real viewer clears it
    // only from its own MutationObserver callback, i.e. in a later batch — so
    // this mutation alone must not make the resolver publish anything.
    mxgraph.textContent = DIAGRAM_LABELS;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.get('c1')).toBeUndefined();

    // The viewer reports completion. Only now may the anchor be highlighted —
    // and at the occurrence that follows the diagram, not the later decoy.
    drawioWrapper.setAttribute(GROWI_IS_CONTENT_RENDERING_ATTR, 'false');

    await waitFor(() =>
      expect(result.current.get('c1')).toEqual({
        status: 'exact',
        startOffset: targetStart,
        endOffset: targetStart + QUOTE.length,
      }),
    );
  });

  it('does not keep recomputing when anchors is replaced by a new array with identical content', async () => {
    // useSWRxInlineComments hands back a new array reference on every
    // revalidation even when the comment list itself hasn't changed. If the
    // hook depended on that reference directly, this would recompute (and
    // produce a new Map) on every single revalidation tick, forever. Guard
    // against that: replacing `anchors` with a content-identical array must
    // not perturb the resolved output.
    container.textContent = 'alpha needle beta gamma delta needle omega';

    const { result, rerender } = renderHook(
      ({ anchors }) => useAnchorResolver(containerRef, anchors),
      { initialProps: { anchors: [anchorOf('c1', 'needle', 30)] } },
    );

    await waitFor(() => expect(result.current.get('c1')).toBeDefined());
    const settledResolved = result.current;

    // Re-render several times with a brand-new array instance carrying the
    // exact same id/anchor content — simulating repeated SWR revalidations.
    for (let i = 0; i < 5; i += 1) {
      rerender({ anchors: [anchorOf('c1', 'needle', 30)] });
    }

    // Give any (incorrect) effect loop a chance to run before asserting.
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Same reference: proves no recompute was triggered by the
    // content-identical-but-reference-different anchors array, i.e. no
    // infinite (or even single extra) recompute loop.
    expect(result.current).toBe(settledResolved);
  });
});
