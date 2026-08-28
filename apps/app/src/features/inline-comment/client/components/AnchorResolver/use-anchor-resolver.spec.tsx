import type { RefObject } from 'react';
import { GROWI_IS_CONTENT_RENDERING_ATTR } from '@growi/core/dist/consts';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { InlineCommentAnchor } from '../../../interfaces';
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
    // flipped to false) mutations must be observed as two separate batches —
    // batching them into one synchronous script (with no await between) lets
    // the observer's MutationObserver callback see only the already-settled
    // final state and skip firing, since it was already settled before.
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
    // observer's MutationObserver callback sees the intermediate "still
    // rendering" state instead of only the batched final one (see the same
    // note in the not_found test above).
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
