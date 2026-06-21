import { reshapeContentsBody } from './reshape-contents-body';

describe('reshapeContentsBody', () => {
  describe('Markdown only', () => {
    test('Return the same input', () => {
      const input = `
      # Title\u0020\u0020
      ## Section\u0020\u0020
      I tested this code at 12:00 AM.\u0020\u0020
      **bold** text
      some texts`;

      expect(reshapeContentsBody(input)).toBe(input);
    });
  });

  describe('Contains time but no headers', () => {
    test('Return the same input', () => {
      const input = `
12:23
some messages...
12:23
some messages...
12:23`;

      expect(reshapeContentsBody(input)).toBe(input);
    });
  });

  describe('Copied from Slack only', () => {
    test('Reshape', () => {
      const input = `
taichi-m  12:23 PM
some messages...
some messages...
some messages...
12:23
some messages...
12:23
some messages...`;

      const output = `
<div class="grw-keep">

## **taichi-m**<span class="grw-keep-time">  12:23 PM</span>
\u0020\u0020
some messages...\u0020\u0020
some messages...\u0020\u0020
some messages...\u0020\u0020
--12:23--\u0020\u0020
some messages...\u0020\u0020
--12:23--\u0020\u0020
some messages...\u0020\u0020
</div>\u0020\u0020
`;

      expect(reshapeContentsBody(input)).toBe(output);
    });
  });

  describe('Copied from Slack only (24 hours format)', () => {
    test('Reshape', () => {
      const input = `
taichi-m  12:23
some messages...
some messages...
some messages...
12:23
some messages...
12:23
some messages...`;

      const output = `
<div class="grw-keep">

## **taichi-m**<span class="grw-keep-time">  12:23</span>
\u0020\u0020
some messages...\u0020\u0020
some messages...\u0020\u0020
some messages...\u0020\u0020
--12:23--\u0020\u0020
some messages...\u0020\u0020
--12:23--\u0020\u0020
some messages...\u0020\u0020
</div>\u0020\u0020
`;

      expect(reshapeContentsBody(input)).toBe(output);
    });
  });

  describe('Markdown and copied from Slack', () => {
    test('Reshape only after the first header', () => {
      const input = `
some messages...

taichi-m  12:23 PM
some messages...`;

      const output = `some messages...
<div class="grw-keep">

## **taichi-m**<span class="grw-keep-time">  12:23 PM</span>
\u0020\u0020
some messages...\u0020\u0020
</div>\u0020\u0020
`;

      expect(reshapeContentsBody(input)).toBe(output);
    });
  });
});
