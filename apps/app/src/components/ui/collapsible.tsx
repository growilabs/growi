'use client';

import type React from 'react';
import * as CollapsiblePrimitive from '@radix-ui/react-collapsible';

function Collapsible({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Root>): JSX.Element {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({
  ...props
}: React.ComponentProps<
  typeof CollapsiblePrimitive.CollapsibleTrigger
>): JSX.Element {
  return (
    <CollapsiblePrimitive.CollapsibleTrigger
      data-slot="collapsible-trigger"
      {...props}
    />
  );
}

function CollapsibleContent({
  ...props
}: React.ComponentProps<
  typeof CollapsiblePrimitive.CollapsibleContent
>): JSX.Element {
  return (
    <CollapsiblePrimitive.CollapsibleContent
      data-slot="collapsible-content"
      {...props}
    />
  );
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
