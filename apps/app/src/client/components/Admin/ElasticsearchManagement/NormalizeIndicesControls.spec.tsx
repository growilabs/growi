import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import NormalizeIndicesControls from './NormalizeIndicesControls';

const defaultProps = {
  isEnabled: true,
  isProcessing: false,
  buttonLabel: 'Normalize',
  description: 'Repairs broken indices.',
  onNormalizingRequested: vi.fn(),
};

describe('NormalizeIndicesControls', () => {
  it('renders the button label and description', () => {
    render(<NormalizeIndicesControls {...defaultProps} />);

    expect(
      screen.getByRole('button', { name: 'Normalize' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Repairs broken indices.')).toBeInTheDocument();
  });

  it('calls onNormalizingRequested when clicked while enabled', async () => {
    const onNormalizingRequested = vi.fn();
    render(
      <NormalizeIndicesControls
        {...defaultProps}
        onNormalizingRequested={onNormalizingRequested}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Normalize' }));

    expect(onNormalizingRequested).toHaveBeenCalledOnce();
  });

  it('disables the button when isEnabled is false', () => {
    render(<NormalizeIndicesControls {...defaultProps} isEnabled={false} />);

    expect(screen.getByRole('button', { name: 'Normalize' })).toBeDisabled();
  });

  it('shows a spinner while processing', () => {
    render(<NormalizeIndicesControls {...defaultProps} isProcessing />);

    expect(
      screen
        .getByRole('button', { name: 'Normalize' })
        .querySelector('.spinner-border'),
    ).not.toBeNull();
  });
});
