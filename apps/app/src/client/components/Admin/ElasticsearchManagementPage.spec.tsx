import { render } from '@testing-library/react';

import { ElasticsearchManagementPage } from './ElasticsearchManagementPage';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('./AuditLogIndexManagement', () => ({
  AuditLogIndexManagement: () => <div data-testid="audit-log-section" />,
}));

vi.mock('./ElasticsearchManagement/ElasticsearchManagement', () => ({
  default: () => <div data-testid="page-data-section" />,
}));

describe('ElasticsearchManagementPage', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('scrolls to the element matching the URL hash after mount', () => {
    window.location.hash = '#audit-log-index-management';
    const scrollIntoViewSpy = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoViewSpy;

    render(<ElasticsearchManagementPage />);

    expect(scrollIntoViewSpy).toHaveBeenCalledOnce();
  });

  it('does not scroll when there is no URL hash', () => {
    window.location.hash = '';
    const scrollIntoViewSpy = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoViewSpy;

    render(<ElasticsearchManagementPage />);

    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });
});
