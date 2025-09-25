import Link from 'next/link';
import { useTranslation } from 'react-i18next';

import { removeGlobPath } from '../../../../utils/remove-glob-path';

import { ThreadList } from './ThreadList';

type Props = {
  description: string,
  pagePathPatterns: string[],
}

export const AiAssistantChatInitialView: React.FC<Props> = ({ description, pagePathPatterns }: Props): JSX.Element => {
  const { t } = useTranslation();

  return (
    <>
      {description.length !== 0 && (
        <p className="text-body-secondary mb-0">
          {description}
        </p>
      )}

      <div>
        <p className="text-body-secondary mb-1">
          {t('sidebar_ai_assistant.reference_pages_label')}
        </p>
        <div className="d-flex flex-column gap-1">
          { pagePathPatterns.map(pagePathPattern => (
            <Link
              key={pagePathPattern}
              href={removeGlobPath([pagePathPattern])[0]}
              className="text-body-secondary text-decoration-underline link-underline-secondary"
            >
              {pagePathPattern}
            </Link>
          ))}
        </div>
      </div>

      <div>
        <p className="text-body-secondary mb-1">
          {t('sidebar_ai_assistant.recent_chat')}
        </p>
        <ThreadList />
      </div>
    </>
  );
};
