import { expect, type Locator, type Page, test } from '@playwright/test';

import {
  type CreatedPage,
  createPage,
  deletePagesCompletely,
} from '../utils/api/create-page';

const swimlane = `swimlane-beta LR
  subgraph sales [Sales team]
    lead[Qualify lead]
    quote[Prepare quote]
  end
  subgraph finance [Finance team]
    review[Review terms]
    approve[Approve quote]
  end
  lead --> quote --> review --> approve`;
const flowchart =
  'flowchart TD\nstart[Ordinary start] --> finish[Ordinary finish]';
const sequence = 'sequenceDiagram\nAlice->>Bob: Hello';
const markdown = (...diagrams: string[]): string =>
  diagrams.map((source) => `\`\`\`mermaid\n${source}\n\`\`\``).join('\n\n');
const preview = (page: Page): Locator =>
  page.getByTestId('page-editor-preview-body');
const diagrams = (page: Page): Locator =>
  preview(page).locator('svg[aria-roledescription]');
const edit = async (page: Page, ...sources: string[]): Promise<void> => {
  await page.locator('.cm-content').fill(markdown(...sources));
};
const expectLanes = async (svg: Locator): Promise<void> => {
  await expect(svg.locator('.swimlane-body')).toHaveCount(2);
  await expect(svg).toContainText('Sales team');
  await expect(svg).toContainText('Finance team');
};

let created: CreatedPage | undefined;
test.beforeEach(async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => localStorage.setItem('theme', 'system'));
  created = await createPage(page.request, {
    path: `/Sandbox/mermaid-${testInfo.testId}-${testInfo.retry}`,
    body: markdown(swimlane),
  });
  await page.goto(`/${created.pageId}`);
  await page.getByTestId('editor-button').click();
  // Warm the actual Mermaid module before triggering more than one effect.
  await expectLanes(diagrams(page).first());
});

test.afterEach(async ({ page }) => {
  if (created) await deletePagesCompletely(page.request, [created]);
  created = undefined;
});

test('renders two warmed identical swimlanes with distinct SVG IDs', async ({
  page,
}) => {
  const changed = `${swimlane}\n%% update both viewer effects`;
  await edit(page, changed, changed);
  await expect(diagrams(page)).toHaveCount(2);
  await expectLanes(diagrams(page).nth(0));
  await expectLanes(diagrams(page).nth(1));
  const ids = await preview(page)
    .locator('svg[id], marker[id]')
    .evaluateAll((elements) => elements.map((element) => element.id));
  expect(new Set(ids).size).toBe(ids.length);
});

test('keeps swimlane, flowchart and sequence layouts independent', async ({
  page,
}) => {
  await edit(page, `${swimlane}\n%% mixed types`, flowchart, sequence);
  await expect(diagrams(page)).toHaveCount(3);
  await expectLanes(diagrams(page).nth(0));
  await expect(diagrams(page).nth(1)).toContainText('Ordinary start');
  await expect(diagrams(page).nth(1).locator('.swimlane-body')).toHaveCount(0);
  await expect(diagrams(page).nth(2)).toContainText('Hello');
});

test('rerenders the same container when the system theme changes', async ({
  page,
}) => {
  const host = preview(page).locator('[data-growi-is-content-rendering]');
  await expect(host).toHaveAttribute(
    'data-growi-is-content-rendering',
    'false',
  );
  await host.evaluate((element) =>
    element.setAttribute('data-theme-probe', 'original'),
  );
  const node = diagrams(page).first().locator('.node rect').first();
  const lightFill = await node.evaluate(
    (element) => getComputedStyle(element).fill,
  );
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect
    .poll(() => node.evaluate((element) => getComputedStyle(element).fill))
    .not.toBe(lightFill);
  await expectLanes(diagrams(page).first());
  await expect(host).toHaveAttribute('data-theme-probe', 'original');
  await expect(host).toHaveAttribute(
    'data-growi-is-content-rendering',
    'false',
  );
  await page.emulateMedia({ colorScheme: 'light' });
  await expect
    .poll(() => node.evaluate((element) => getComputedStyle(element).fill))
    .toBe(lightFill);
  await expectLanes(diagrams(page).first());
});

test('publishes the latest edit without leaving a rendering marker pending', async ({
  page,
}) => {
  await edit(page, swimlane.replace('Qualify lead', 'Intermediate'));
  await edit(
    page,
    swimlane.replace('Qualify lead', 'Latest source'),
    flowchart,
  );
  await expect(diagrams(page)).toHaveCount(2);
  await expectLanes(diagrams(page).first());
  await expect(diagrams(page).first()).toContainText('Latest source');
  await expect(diagrams(page).first()).not.toContainText('Intermediate');
  await expect(
    preview(page).locator('[data-growi-is-content-rendering="true"]'),
  ).toHaveCount(0);
});

test('recovers from invalid syntax and still renders other diagrams', async ({
  page,
}) => {
  await edit(page, 'flowchart TD\nA[', `${swimlane}\n%% after error`);
  await expect(preview(page)).toContainText('Syntax error');
  await expectLanes(
    preview(page)
      .locator('svg')
      .filter({ has: page.locator('.swimlane-body') }),
  );
  await edit(page, `${swimlane}\n%% recovered`, flowchart);
  await expect(diagrams(page)).toHaveCount(2);
  await expectLanes(diagrams(page).first());
  await expect(diagrams(page).nth(1)).toContainText('Ordinary finish');
  await expect(preview(page)).not.toContainText('Syntax error');
});

test('renders warmed swimlanes and a flowchart together in dark mode', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await edit(page, `${swimlane}\n%% dark first`, swimlane, flowchart);
  await expect(diagrams(page)).toHaveCount(3);
  await expectLanes(diagrams(page).nth(0));
  await expectLanes(diagrams(page).nth(1));
  await expect(diagrams(page).nth(2)).toContainText('Ordinary start');
  await expect(
    preview(page).locator('[data-growi-is-content-rendering="true"]'),
  ).toHaveCount(0);
});

test('keeps frontmatter valid while its diagram follows the color scheme', async ({
  page,
}) => {
  await edit(page, `---\ntitle: Swimlane with frontmatter\n---\n${swimlane}`);
  await expectLanes(diagrams(page).first());
  const node = diagrams(page).first().locator('.node rect').first();
  const lightFill = await node.evaluate(
    (element) => getComputedStyle(element).fill,
  );
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect
    .poll(() => node.evaluate((element) => getComputedStyle(element).fill))
    .not.toBe(lightFill);
  await expectLanes(diagrams(page).first());
  await page.emulateMedia({ colorScheme: 'light' });
  await expect
    .poll(() => node.evaluate((element) => getComputedStyle(element).fill))
    .toBe(lightFill);
  await expectLanes(diagrams(page).first());
});

for (const [name, header] of [
  ['frontmatter theme', '---\nconfig:\n  theme: forest\n---\n'],
  ['inline frontmatter theme', '---\nconfig: {theme: forest}\n---\n'],
  ['user directive', '%%{init: {"theme": "forest"}}%%\n'],
  [
    'user directive after frontmatter',
    '---\ntitle: User theme\n---\n%%{init: {"theme": "forest"}}%%\n',
  ],
]) {
  test(`preserves ${name} without leaking into the next diagram`, async ({
    page,
  }) => {
    await edit(page, header + flowchart, flowchart);
    await expect(diagrams(page)).toHaveCount(2);
    const themed = diagrams(page).nth(0).locator('.node rect').first();
    const plain = diagrams(page).nth(1).locator('.node rect').first();
    const forestFill = await themed.evaluate(
      (element) => getComputedStyle(element).fill,
    );
    const lightFill = await plain.evaluate(
      (element) => getComputedStyle(element).fill,
    );
    expect(forestFill).not.toBe(lightFill);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect
      .poll(() => plain.evaluate((element) => getComputedStyle(element).fill))
      .not.toBe(lightFill);
    await expect(
      preview(page).locator('[data-growi-is-content-rendering="true"]'),
    ).toHaveCount(0);
    expect(
      await themed.evaluate((element) => getComputedStyle(element).fill),
    ).toBe(forestFill);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect
      .poll(() => plain.evaluate((element) => getComputedStyle(element).fill))
      .toBe(lightFill);
    await expect(
      preview(page).locator('[data-growi-is-content-rendering="true"]'),
    ).toHaveCount(0);
    expect(
      await themed.evaluate((element) => getComputedStyle(element).fill),
    ).toBe(forestFill);
  });
}
