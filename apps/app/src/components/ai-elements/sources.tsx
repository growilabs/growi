'use client';

import type { ComponentProps } from 'react';
import { BookIcon, ChevronDownIcon } from 'lucide-react';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '~/components/ui/collapsible';
import { cn } from '~/utils/shadcn-ui';

export type SourcesProps = ComponentProps<'div'>;

export const Sources = ({ className, ...props }: SourcesProps): JSX.Element => (
  <Collapsible
    className={cn('tw:not-prose tw:mb-4 tw:text-primary tw:text-xs', className)}
    {...props}
  />
);

export type SourcesTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  count: number;
};

export const SourcesTrigger = ({
  className,
  count,
  children,
  ...props
}: SourcesTriggerProps): JSX.Element => (
  <CollapsibleTrigger
    className={cn('tw:flex tw:items-center tw:gap-2', className)}
    {...props}
  >
    {children ?? (
      <>
        <p className="tw:font-medium">Used {count} sources</p>
        <ChevronDownIcon className="tw:h-4 tw:w-4" />
      </>
    )}
  </CollapsibleTrigger>
);

export type SourcesContentProps = ComponentProps<typeof CollapsibleContent>;

export const SourcesContent = ({
  className,
  ...props
}: SourcesContentProps): JSX.Element => (
  <CollapsibleContent
    className={cn(
      'tw:mt-3 tw:flex tw:w-fit tw:flex-col tw:gap-2',
      // eslint-disable-next-line max-len
      'tw:data-[state=closed]:fade-out-0 tw:data-[state=closed]:slide-out-to-top-2 tw:data-[state=open]:slide-in-from-top-2 tw:outline-none tw:data-[state=closed]:animate-out tw:data-[state=open]:animate-in',
      className,
    )}
    {...props}
  />
);

export type SourceProps = ComponentProps<'a'>;

export const Source = ({
  href,
  title,
  children,
  ...props
}: SourceProps): JSX.Element => (
  <a
    className="tw:flex tw:items-center tw:gap-2"
    href={href}
    rel="noreferrer"
    target="_blank"
    {...props}
  >
    {children ?? (
      <>
        <BookIcon className="tw:h-4 tw:w-4" />
        <span className="tw:block tw:font-medium">{title}</span>
      </>
    )}
  </a>
);
