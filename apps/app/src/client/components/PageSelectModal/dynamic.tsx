import type { JSX } from 'react';
import type { FallbackProps } from 'react-error-boundary';
import { ErrorBoundary } from 'react-error-boundary';

import { useLazyLoader } from '~/components/utils/use-lazy-loader';
import { usePageSelectModalStatus } from '~/states/ui/modal/page-select';
import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:components:PageSelectModal:dynamic');

type PageSelectModalProps = Record<string, unknown>;

/**
 * Fallback rendered when the PageSelectModal subtree throws.
 *
 * Rendering `null` (instead of letting the exception propagate) is intentional:
 * the modal is mounted near the app root (BasicLayout) and is NOT wrapped by any
 * ancestor Error Boundary. Without this boundary, a throw anywhere inside the
 * modal (its large lazily-mounted `@headless-tree` component tree) unmounts the
 * whole React app, which then leaves the screen blank — see issue #11422. By
 * containing the error here the rest of the application (editor, sidebar, …)
 * stays mounted and usable.
 */
const PageSelectModalFallback = (_props: FallbackProps): JSX.Element | null => {
  return null;
};

export const PageSelectModalLazyLoaded = (): JSX.Element => {
  const status = usePageSelectModalStatus();
  const isOpened = status?.isOpened ?? false;

  const PageSelectModal = useLazyLoader<PageSelectModalProps>(
    'page-select-modal',
    () =>
      import('./PageSelectModal').then((mod) => ({
        default: mod.PageSelectModal,
      })),
    isOpened,
  );

  return (
    <ErrorBoundary
      FallbackComponent={PageSelectModalFallback}
      onError={(error, info) => {
        logger.error({ error, info }, 'Failed to render PageSelectModal');
      }}
      // Reset the boundary each time the modal is (re)opened so a previous
      // failure does not permanently disable the modal.
      resetKeys={[isOpened]}
    >
      {PageSelectModal ? <PageSelectModal /> : null}
    </ErrorBoundary>
  );
};
