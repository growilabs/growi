import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { InAppNotificationForms } from './InAppNotificationSubstance';

describe('InAppNotificationForms', () => {
  const defaultProps = {
    isUnopendNotificationsVisible: false,
    onChangeUnopendNotificationsVisible: vi.fn(),
    activeFilter: 'all' as const,
    onChangeFilter: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('should render three filter buttons', () => {
    render(<InAppNotificationForms {...defaultProps} />);
    expect(screen.getByText('in_app_notification.filter_all')).toBeTruthy();
    expect(screen.getByText('in_app_notification.notifications')).toBeTruthy();
    expect(screen.getByText('in_app_notification.news')).toBeTruthy();
  });

  test('should call onChangeFilter with "news" when news button clicked', () => {
    const onChangeFilter = vi.fn();
    render(
      <InAppNotificationForms
        {...defaultProps}
        onChangeFilter={onChangeFilter}
      />,
    );
    fireEvent.click(screen.getByText('in_app_notification.news'));
    expect(onChangeFilter).toHaveBeenCalledWith('news');
  });

  test('should call onChangeFilter with "notifications" when notifications button clicked', () => {
    const onChangeFilter = vi.fn();
    render(
      <InAppNotificationForms
        {...defaultProps}
        onChangeFilter={onChangeFilter}
      />,
    );
    fireEvent.click(screen.getByText('in_app_notification.notifications'));
    expect(onChangeFilter).toHaveBeenCalledWith('notifications');
  });

  test('should call onChangeFilter with "all" when all button clicked', () => {
    const onChangeFilter = vi.fn();
    render(
      <InAppNotificationForms
        {...defaultProps}
        activeFilter="news"
        onChangeFilter={onChangeFilter}
      />,
    );
    fireEvent.click(screen.getByText('in_app_notification.filter_all'));
    expect(onChangeFilter).toHaveBeenCalledWith('all');
  });

  test('should render unread toggle', () => {
    render(<InAppNotificationForms {...defaultProps} />);
    const toggle = screen.getByRole('switch');
    expect(toggle).toBeTruthy();
  });

  test('should call onChangeUnopendNotificationsVisible when toggle changes', () => {
    const onChange = vi.fn();
    render(
      <InAppNotificationForms
        {...defaultProps}
        onChangeUnopendNotificationsVisible={onChange}
      />,
    );
    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalled();
  });

  test('active filter button should have btn-primary class', () => {
    render(<InAppNotificationForms {...defaultProps} activeFilter="news" />);
    const newsBtn = screen
      .getByText('in_app_notification.news')
      .closest('button');
    expect(newsBtn?.classList.contains('btn-primary')).toBe(true);
    const allBtn = screen
      .getByText('in_app_notification.filter_all')
      .closest('button');
    expect(allBtn?.classList.contains('btn-outline-secondary')).toBe(true);
  });
});
