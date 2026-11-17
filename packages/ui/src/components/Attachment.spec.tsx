import type { IAttachmentHasId } from '@growi/core';
import { GROWI_DECORATION_ATTR } from '@growi/core/dist/consts';
import { render, screen } from '@testing-library/react';
import { mock } from 'vitest-mock-extended';

import { Attachment } from './Attachment.js';

vi.mock('./UserPicture.js', () => ({
  // biome-ignore lint/performance/noImgElement: stands in for UserPicture, which renders a plain <img>
  UserPicture: () => <img src="/avatar.png" alt="Alice" />,
}));

describe('Attachment', () => {
  it("marks the uploader's picture as decoration, and the file name link as content", () => {
    const attachment = mock<IAttachmentHasId>({
      fileFormat: 'application/pdf',
      originalName: 'report.pdf',
      filePathProxied: '/attachment/a1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    render(<Attachment attachment={attachment} inUse={false} />);

    expect(
      screen
        .getByRole('img', { name: 'Alice' })
        .closest(`[${GROWI_DECORATION_ATTR}]`),
    ).not.toBeNull();
    expect(
      screen
        .getByRole('link', { name: /report\.pdf/ })
        .closest(`[${GROWI_DECORATION_ATTR}]`),
    ).toBeNull();
  });
});
