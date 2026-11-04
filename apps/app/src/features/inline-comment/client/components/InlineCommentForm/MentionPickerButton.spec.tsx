import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchMentionUsers } from '../../services/fetch-mention-users';
import { MentionPickerButton } from './MentionPickerButton';

vi.mock('../../services/fetch-mention-users', () => ({
  fetchMentionUsers: vi.fn(),
}));

const fetchMentionUsersMock = vi.mocked(fetchMentionUsers);

describe('MentionPickerButton', () => {
  beforeEach(() => {
    fetchMentionUsersMock.mockReset();
  });

  it('does not show a user list before the button is pressed', () => {
    fetchMentionUsersMock.mockResolvedValue([
      { username: 'alice', name: 'Alice' },
    ]);
    render(<MentionPickerButton onInsert={vi.fn()} />);

    expect(screen.queryByText('alice')).not.toBeInTheDocument();
    expect(fetchMentionUsersMock).not.toHaveBeenCalled();
  });

  it('fetches candidates with an empty query and shows them when the button is pressed (Requirement 3.1, 3.2)', async () => {
    fetchMentionUsersMock.mockResolvedValue([
      { username: 'alice', name: 'Alice' },
      { username: 'bob', name: 'Bob' },
    ]);
    render(<MentionPickerButton onInsert={vi.fn()} />);

    fireEvent.click(screen.getByTestId('mention-picker-button'));

    expect(fetchMentionUsersMock).toHaveBeenCalledWith('');

    await waitFor(() => {
      expect(screen.getByText('alice')).toBeInTheDocument();
    });
    expect(screen.getByText('bob')).toBeInTheDocument();
    // Guards against a fetch firing more than once per press (e.g. a fetch
    // triggered from inside an impure setState updater, which React may
    // invoke more than once).
    expect(fetchMentionUsersMock).toHaveBeenCalledTimes(1);
  });

  it('calls onInsert exactly once with the selected username when a candidate is chosen (Requirement 3.3)', async () => {
    fetchMentionUsersMock.mockResolvedValue([
      { username: 'alice', name: 'Alice' },
      { username: 'bob', name: 'Bob' },
    ]);
    const onInsert = vi.fn();
    render(<MentionPickerButton onInsert={onInsert} />);

    fireEvent.click(screen.getByTestId('mention-picker-button'));

    await waitFor(() => {
      expect(screen.getByText('bob')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('bob'));

    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert).toHaveBeenCalledWith('bob');
  });

  it('renders the toggle as a theme-following link button, not the default btn-secondary (Requirement 11.1, 11.2)', () => {
    fetchMentionUsersMock.mockResolvedValue([]);
    render(<MentionPickerButton onInsert={vi.fn()} />);

    const toggle = screen.getByTestId('mention-picker-button');
    expect(toggle).toHaveClass('btn', 'btn-link', 'btn-sm');
    expect(toggle).toHaveClass('btn-outline-neutral-secondary');
    // btn-secondary resolves to a fixed dark grey that does not follow the
    // active theme, which is exactly what this component must stop using.
    expect(toggle).not.toHaveClass('btn-secondary');
  });

  it('shows a no-candidates state, without crashing or calling onInsert, when fetchMentionUsers resolves an empty list', async () => {
    fetchMentionUsersMock.mockResolvedValue([]);
    const onInsert = vi.fn();
    render(<MentionPickerButton onInsert={onInsert} />);

    fireEvent.click(screen.getByTestId('mention-picker-button'));

    await waitFor(() => {
      expect(screen.getByText('No candidates')).toBeInTheDocument();
    });
    expect(onInsert).not.toHaveBeenCalled();
  });
});
