import { TriangleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { resolveIncompleteReasonKey } from './chat-sidebar-helpers';

type Props = {
  finishReason: string | undefined;
};

/**
 * Inline warning shown beneath an assistant message whose stream ended
 * abnormally (any `finishReason` other than `stop`) — so the reader sees why the
 * answer is cut short. Informational only (no action). Renders nothing for a
 * normal or not-yet-finished message.
 *
 * The notice is reason-aware: each finish reason maps to its own localized
 * message under `ai_sidebar.incomplete.*`.
 */
export const IncompleteResponseNotice = ({
  finishReason,
}: Props): JSX.Element | null => {
  const { t } = useTranslation();

  const reasonKey = resolveIncompleteReasonKey(finishReason);
  if (reasonKey == null) {
    return null;
  }

  return (
    <div
      role="status"
      className="tw:my-2 tw:flex tw:items-start tw:gap-2 tw:rounded-lg tw:border tw:border-warning/40 tw:bg-warning/10 tw:p-3 tw:text-sm tw:text-warning-foreground"
    >
      <TriangleAlertIcon className="tw:mt-0.5 tw:size-4 tw:shrink-0" />
      <span className="tw:break-words">
        {t(`ai_sidebar.incomplete.${reasonKey}`)}
      </span>
    </div>
  );
};
