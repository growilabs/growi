import type { Parent, Root } from 'mdast';
import { useEffect, useState } from 'react';
import type { Processor } from 'unified';

type ParseResult = {
  marp: boolean | undefined;
  slide: boolean | undefined;
};

const parseSlideFrontmatter = (frontmatter: string): ParseResult => {
  let marp: boolean | undefined;
  let slide: boolean | undefined;

  const lines = frontmatter.split('\n');

  for (const line of lines) {
    const [key, value] = line.split(':').map((part) => part.trim());
    if (key === 'marp' && value === 'true') {
      marp = true;
    }
    if (key === 'slide' && value === 'true') {
      slide = true;
    }
  }

  return { marp, slide };
};

type ProcessorOpts = {
  onParsed?: (result: ParseResult) => void;
  onSkipped?: () => void;
};

const generateFrontmatterProcessor = async (opts?: ProcessorOpts) => {
  const remarkFrontmatter = (await import('remark-frontmatter')).default;
  const remarkParse = (await import('remark-parse')).default;
  const remarkStringify = (await import('remark-stringify')).default;
  const unified = (await import('unified')).unified;

  return unified()
    .use(remarkParse)
    .use(remarkStringify)
    .use(remarkFrontmatter, ['yaml'])
    .use(() => (obj: Parent) => {
      if (obj.children[0]?.type === 'yaml') {
        const result = parseSlideFrontmatter(obj.children[0]?.value);
        opts?.onParsed?.(result);
      } else {
        opts?.onSkipped?.();
      }
    });
};

export type UseSlide = {
  marp?: boolean;
};

/**
 * Frontmatter parser for slide
 * @param markdown Markdwon document
 * @returns An UseSlide instance. If the markdown does not contain neither "marp" or "slide" attribute in frontmatter, it returns undefined.
 */
export const useSlidesByFrontmatter = (
  markdown?: string,
  isEnabledMarp?: boolean,
): UseSlide | undefined => {
  const [processor, setProcessor] = useState<
    Processor<Root, undefined, undefined, Root, string> | undefined
  >();
  const [parseResult, setParseResult] = useState<UseSlide | undefined>();

  useEffect(() => {
    if (processor != null) {
      return;
    }

    (async () => {
      const p = await generateFrontmatterProcessor({
        onParsed: (result) =>
          setParseResult(result.marp || result.slide ? result : undefined),
        onSkipped: () => setParseResult(undefined),
      });
      setProcessor(p);
    })();
  }, [processor]);

  useEffect(() => {
    if (markdown == null || processor == null) {
      return;
    }

    processor.process(markdown);
  }, [markdown, processor]);

  return parseResult != null
    ? { marp: isEnabledMarp && parseResult?.marp }
    : undefined;
};
