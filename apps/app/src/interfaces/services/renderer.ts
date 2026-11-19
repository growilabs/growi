import type { PlantumlHttpMethod } from '~/features/plantuml/interfaces/http-method';

import type { RehypeSanitizeConfiguration } from './rehype-sanitize';

export type RendererConfig = {
  isSharedPage?: boolean;
  isEnabledLinebreaks: boolean;
  isEnabledLinebreaksInComments: boolean;
  adminPreferredIndentSize: number;
  isIndentSizeForced: boolean;
  highlightJsStyleBorder: boolean;
  isEnabledMarp: boolean;

  drawioUri: string;
  plantumlUri: string;
  plantumlHttpMethod: PlantumlHttpMethod;
} & RehypeSanitizeConfiguration;

export type RendererConfigExt = RendererConfig & {
  isDarkMode?: boolean;
};
