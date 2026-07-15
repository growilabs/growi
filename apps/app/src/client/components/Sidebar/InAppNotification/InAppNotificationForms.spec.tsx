import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { InAppNotificationForms } from './InAppNotificationForms';

describe('InAppNotificationForms', () => {
  const defaultProps = {
    isUnopendNotificationsVisible: false,
    onChangeUnopendNotificationsVisible: vi.fn(),
    activeFilter: 'all' as const,
    onChangeFilter: vi.fn(),
    onMarkAllRead: vi.fn(),
    isMarkAllReadDisabled: false,
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

  describe('mark-all-as-read button', () => {
    test('should render the mark-all-as-read button', () => {
      render(<InAppNotificationForms {...defaultProps} />);
      expect(
        screen.getByText('in_app_notification.mark_all_as_read'),
      ).toBeTruthy();
    });

    test('should call onMarkAllRead when clicked', () => {
      const onMarkAllRead = vi.fn();
      render(
        <InAppNotificationForms
          {...defaultProps}
          onMarkAllRead={onMarkAllRead}
        />,
      );
      fireEvent.click(screen.getByText('in_app_notification.mark_all_as_read'));
      expect(onMarkAllRead).toHaveBeenCalled();
    });

    test('should be disabled when isMarkAllReadDisabled is true', () => {
      render(
        <InAppNotificationForms
          {...defaultProps}
          isMarkAllReadDisabled={true}
        />,
      );
      const button = screen
        .getByText('in_app_notification.mark_all_as_read')
        .closest('button');
      expect((button as HTMLButtonElement).disabled).toBe(true);
    });

    test('should not call onMarkAllRead when disabled and clicked', () => {
      const onMarkAllRead = vi.fn();
      render(
        <InAppNotificationForms
          {...defaultProps}
          onMarkAllRead={onMarkAllRead}
          isMarkAllReadDisabled={true}
        />,
      );
      fireEvent.click(screen.getByText('in_app_notification.mark_all_as_read'));
      expect(onMarkAllRead).not.toHaveBeenCalled();
    });
  });
});
