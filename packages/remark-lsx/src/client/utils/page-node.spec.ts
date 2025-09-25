import type { IPageHasId } from '@growi/core';
import { OptionParser } from '@growi/core/dist/remark-plugins';
import { mock } from 'vitest-mock-extended';

import type { PageNode } from '../../interfaces/page-node';

import { generatePageNodeTree } from './page-node';

function omitPageData(pageNode: PageNode): Omit<PageNode, 'page'> {
  // Destructure to omit 'page', and recursively process children
  // biome-ignore lint/correctness/noUnusedVariables: ignore
  const { page, children, ...rest } = pageNode;
  return {
    ...rest,
    children: children.map((child) => omitPageData(child)),
  };
}

describe('generatePageNodeTree()', () => {
  it("returns when the rootPagePath is '/'", () => {
    // setup
    const pages: IPageHasId[] = ['/', '/Sandbox'].map((path) =>
      mock<IPageHasId>({ path }),
    );

    // when
    const result = generatePageNodeTree('/', pages);
    const resultWithoutPageData = result.map((pageNode) =>
      omitPageData(pageNode),
    );

    // then
    expect(resultWithoutPageData).toStrictEqual([
      {
        pagePath: '/Sandbox',
        children: [],
      },
    ]);
  });

  it('returns when the pages are not empty', () => {
    // setup
    const pages: IPageHasId[] = [
      '/Sandbox',
      '/Sandbox/level2',
      '/Sandbox/level2/level3-1',
      '/Sandbox/level2/level3-2',
      '/Sandbox/level2/level3-3',
    ].map((path) => mock<IPageHasId>({ path }));

    // when
    const result = generatePageNodeTree('/Sandbox', pages);
    const resultWithoutPageData = result.map((pageNode) =>
      omitPageData(pageNode),
    );

    // then
    expect(resultWithoutPageData).toStrictEqual([
      {
        pagePath: '/Sandbox/level2',
        children: [
          {
            pagePath: '/Sandbox/level2/level3-1',
            children: [],
          },
          {
            pagePath: '/Sandbox/level2/level3-2',
            children: [],
          },
          {
            pagePath: '/Sandbox/level2/level3-3',
            children: [],
          },
        ],
      },
    ]);
  });

  it('returns when the pages include some empty pages', () => {
    // setup
    const pages: IPageHasId[] = [
      '/',
      '/user/foo',
      '/user/bar',
      '/user/bar/memo/2023/06/01',
      '/user/bar/memo/2023/06/02/memo-test',
    ].map((path) => mock<IPageHasId>({ path }));

    // when
    const result = generatePageNodeTree('/', pages);
    const resultWithoutPageData = result.map((pageNode) =>
      omitPageData(pageNode),
    );

    // then
    expect(resultWithoutPageData).toStrictEqual([
      {
        pagePath: '/user',
        children: [
          {
            pagePath: '/user/foo',
            children: [],
          },
          {
            pagePath: '/user/bar',
            children: [
              {
                pagePath: '/user/bar/memo',
                children: [
                  {
                    pagePath: '/user/bar/memo/2023',
                    children: [
                      {
                        pagePath: '/user/bar/memo/2023/06',
                        children: [
                          {
                            pagePath: '/user/bar/memo/2023/06/01',
                            children: [],
                          },
                          {
                            pagePath: '/user/bar/memo/2023/06/02',
                            children: [
                              {
                                pagePath: '/user/bar/memo/2023/06/02/memo-test',
                                children: [],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("returns with 'depth=1:2'", () => {
    // setup
    const pages: IPageHasId[] = [
      '/Sandbox',
      '/Sandbox/level2-1',
      '/Sandbox/level2-2',
      '/user',
      '/user/foo',
      '/user/bar',
    ].map((path) => mock<IPageHasId>({ path }));

    // when
    const depthRange = OptionParser.parseRange('1:2');
    const result = generatePageNodeTree('/', pages, depthRange);
    const resultWithoutPageData = result.map((pageNode) =>
      omitPageData(pageNode),
    );

    // then
    expect(resultWithoutPageData).toStrictEqual([
      {
        pagePath: '/Sandbox',
        children: [
          {
            pagePath: '/Sandbox/level2-1',
            children: [],
          },
          {
            pagePath: '/Sandbox/level2-2',
            children: [],
          },
        ],
      },
      {
        pagePath: '/user',
        children: [
          {
            pagePath: '/user/foo',
            children: [],
          },
          {
            pagePath: '/user/bar',
            children: [],
          },
        ],
      },
    ]);
  });

  it("returns with 'depth=2:3'", () => {
    // setup
    const pages: IPageHasId[] = [
      '/foo/level2',
      '/foo/level2',
      '/foo/level2/level3-1',
      '/foo/level2/level3-2',
    ].map((path) => mock<IPageHasId>({ path }));

    // when
    const depthRange = OptionParser.parseRange('2:3');
    const result = generatePageNodeTree('/', pages, depthRange);
    const resultWithoutPageData = result.map((pageNode) =>
      omitPageData(pageNode),
    );

    // then
    expect(resultWithoutPageData).toStrictEqual([
      {
        pagePath: '/foo/level2',
        children: [
          {
            pagePath: '/foo/level2/level3-1',
            children: [],
          },
          {
            pagePath: '/foo/level2/level3-2',
            children: [],
          },
        ],
      },
    ]);
  });
});
