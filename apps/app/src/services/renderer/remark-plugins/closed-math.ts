import type { Root } from 'mdast';
import type { Plugin } from 'unified';

/** Only accept fenced math with a closing fence in the live preview. */
export const closedMath: Plugin<[], Root> = function () {
  const extensions = this.data().micromarkExtensions ?? [];
  this.data(
    'micromarkExtensions',
    extensions.map((extension) => {
      const flow = extension.flow?.[36];
      if (flow == null) return extension;
      const constructs = Array.isArray(flow) ? flow : [flow];
      return {
        ...extension,
        flow: {
          ...extension.flow,
          36: constructs.map((construct) => {
            if (construct.name !== 'mathFlow') return construct;
            const wrapped: typeof construct = {
              ...construct,
              tokenize(effects, ok, nok) {
                const start = this.events.length;
                return construct.tokenize.call(
                  this,
                  effects,
                  (code) => {
                    // Interrupt probes only read the opening fence. The full parse
                    // must see both fences before committing to math.
                    const fences = this.events
                      .slice(start)
                      .filter(([event, token]) => {
                        const type: string = token.type;
                        return event === 'exit' && type === 'mathFlowFence';
                      });
                    return this.interrupt || fences.length === 2
                      ? ok(code)
                      : nok(code);
                  },
                  nok,
                );
              },
            };
            return wrapped;
          }),
        },
      };
    }),
  );
};
