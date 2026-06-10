import { rehypePlugin } from './refs';

type RefTagName = 'ref' | 'refimg' | 'refs' | 'refsimg' | 'gallery';

const createTree = (
  tagName: RefTagName,
  properties: Record<string, unknown> = {},
) => ({
  type: 'root',
  children: [
    {
      type: 'element',
      tagName,
      properties,
      children: [],
    },
  ],
});

const runRehype = (
  tree: ReturnType<typeof createTree>,
  options: { pagePath?: string; isSharedPage?: boolean },
): void => {
  // WHY: unified's `Plugin` type is not directly callable; narrow it to the
  // (options) => (tree) => void shape this factory plugin actually has.
  (rehypePlugin as (opts: typeof options) => (tree: unknown) => void)(options)(
    tree,
  );
};

const getProperties = (
  tree: ReturnType<typeof createTree>,
): Record<string, unknown> =>
  (tree.children[0] as { properties: Record<string, unknown> }).properties;

const tags: RefTagName[] = ['ref', 'refimg', 'refs', 'refsimg', 'gallery'];

describe('refs rehypePlugin - isSharedPage injection', () => {
  it.each(
    tags,
  )('injects isSharedPage=true into <%s> when the option is set', (tagName) => {
    const tree = createTree(tagName);
    runRehype(tree, { pagePath: '/foo', isSharedPage: true });
    expect(getProperties(tree).isSharedPage).toBe(true);
  });

  it.each(
    tags,
  )('leaves isSharedPage undefined on <%s> when the option is omitted', (tagName) => {
    const tree = createTree(tagName);
    runRehype(tree, { pagePath: '/foo' });
    expect(getProperties(tree).isSharedPage).toBeUndefined();
  });

  it('does not override an isSharedPage already present on the element', () => {
    const tree = createTree('refs', { isSharedPage: false });
    runRehype(tree, { pagePath: '/foo', isSharedPage: true });
    expect(getProperties(tree).isSharedPage).toBe(false);
  });
});
