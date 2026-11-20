import Link from 'next/link';
import { returnPathForURL } from '@growi/core/dist/utils/path-utils';
import { BookIcon, ChevronDownIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  Sources,
  SourcesContent,
  SourcesTrigger,
} from '~/components/ai-elements/sources';

import type { PageSource } from './page-sources';

type PageSourcesProps = {
  sources: PageSource[];
};

/**
 * Renders the pages the assistant opened as a collapsible "sources" list,
 * shown separately from the answer body.
 *
 * Each entry links to the in-app permalink (`/{pageId}`) built locally via
 * `returnPathForURL`, so the link always targets this GROWI origin — the model
 * never produces (and cannot get wrong) the URL.
 */
export const PageSources = ({
  sources,
}: PageSourcesProps): JSX.Element | null => {
  const { t } = useTranslation();

  if (sources.length === 0) {
    return null;
  }

  return (
    <Sources>
      {/* `tw:group` marks the trigger so the chevron can react to the
          data-state Radix sets on it: rotate 180° (down → up) when expanded. */}
      <SourcesTrigger count={sources.length} className="tw:group">
        <p className="tw:font-medium">
          {t('ai_sidebar.sources', { count: sources.length })}
        </p>
        <ChevronDownIcon className="tw:h-4 tw:w-4 tw:transition-transform tw:group-data-[state=open]:rotate-180" />
      </SourcesTrigger>
      <SourcesContent>
        {sources.map((source) => (
          <Link
            key={source.pageId}
            href={returnPathForURL(source.path, source.pageId)}
            // Force the primary color + no underline so the link matches the
            // trigger and the AI-Elements design. `!` (important) is required
            // because Bootstrap's reboot styles `a` unlayered, which otherwise
            // beats the layered Tailwind utility / inherited `text-primary`
            // inside `.tw-root` (there is no `.tw-root a` override).
            className="tw:flex tw:items-center tw:gap-2 tw:text-primary! tw:no-underline! tw:hover:underline!"
          >
            <BookIcon className="tw:h-4 tw:w-4" />
            <span className="tw:block tw:font-medium">{source.path}</span>
          </Link>
        ))}
      </SourcesContent>
    </Sources>
  );
};
