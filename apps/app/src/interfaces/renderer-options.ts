import type { ComponentType } from 'react';
import type {
  Components,
  Options as ReactMarkdownOptions,
} from 'react-markdown';
import type { PluggableList } from 'unified';

export type RendererOptions = Omit<
  ReactMarkdownOptions,
  'remarkPlugins' | 'rehypePlugins' | 'components' | 'children'
> & {
  remarkPlugins: PluggableList;
  rehypePlugins: PluggableList;
  components?:
    | Partial<
        Components & {
          [elem: string]: ComponentType<any>;
        }
      >
    | undefined;
};
