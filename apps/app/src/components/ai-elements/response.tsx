'use client';

import type React from 'react';
import { type ComponentProps, memo } from 'react';
import { Streamdown } from 'streamdown';

import { cn } from '~/utils/shadcn-ui';

type ResponseProps = ComponentProps<typeof Streamdown>;

export const Response: React.NamedExoticComponent<ResponseProps> = memo(
  ({ className, ...props }: ResponseProps): JSX.Element => (
    <Streamdown
      className={cn(
        'tw:size-full tw:[&>*:first-child]:mt-0 tw:[&>*:last-child]:mb-0',
        className,
      )}
      {...props}
    />
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children,
);

Response.displayName = 'Response';
