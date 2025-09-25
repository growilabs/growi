export type GrowiFacade = {
  markdownRenderer?: {
    optionsGenerators?: {
      // biome-ignore lint/suspicious/noExplicitAny: ignore
      generateViewOptions?: any;
      // biome-ignore lint/suspicious/noExplicitAny: ignore
      customGenerateViewOptions?: any;
      // biome-ignore lint/suspicious/noExplicitAny: ignore
      generatePreviewOptions?: any;
      // biome-ignore lint/suspicious/noExplicitAny: ignore
      customGeneratePreviewOptions?: any;
    };
    // biome-ignore lint/suspicious/noExplicitAny: ignore
    optionsMutators?: any;
  };
  // biome-ignore lint/suspicious/noExplicitAny: ignore
  react?: any;
};
