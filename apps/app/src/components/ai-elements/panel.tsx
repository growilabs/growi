import { cn } from "~/lib/utils";
import { Panel as PanelPrimitive } from "@xyflow/react";
import type { ComponentProps } from "react";

type PanelProps = ComponentProps<typeof PanelPrimitive>;

export const Panel = ({ className, ...props }: PanelProps) => (
  <PanelPrimitive
    className={cn(
      "tw:m-4 tw:overflow-hidden tw:rounded-md tw:border tw:bg-card tw:p-1",
      className
    )}
    {...props}
  />
);
