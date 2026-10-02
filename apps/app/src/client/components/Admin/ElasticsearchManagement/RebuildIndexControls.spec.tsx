import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import RebuildIndexControls from './RebuildIndexControls';

const defaultProps = {
  isEnabled: true,
  isRebuildingProcessing: false,
  isRebuildingCompleted: false,
  currentCount: 0,
  totalCount: 0,
  progressHeaderProcessing: 'Processing..',
  progressHeaderCompleted: 'Completed',
  buttonLabel: 'Rebuild',
  descriptionLines: [
    'Deletes and rebuilds the index.',
    'This may take a while.',
  ],
  onRebuildingRequested: vi.fn(),
};

describe('RebuildIndexControls', () => {
  it('renders the button label and description lines', () => {
    const { container } = render(<RebuildIndexControls {...defaultProps} />);

    expect(screen.getByRole('button', { name: 'Rebuild' })).toBeInTheDocument();
    expect(container.querySelector('p')).toHaveTextContent(
      'Deletes and rebuilds the index.This may take a while.',
    );
  });

  it('calls onRebuildingRequested when clicked while enabled', async () => {
    const onRebuildingRequested = vi.fn();
    render(
      <RebuildIndexControls
        {...defaultProps}
        onRebuildingRequested={onRebuildingRequested}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Rebuild' }));

    expect(onRebuildingRequested).toHaveBeenCalledOnce();
  });

  it('disables the button when isEnabled is false', () => {
    render(<RebuildIndexControls {...defaultProps} isEnabled={false} />);

    expect(screen.getByRole('button', { name: 'Rebuild' })).toBeDisabled();
  });

  it('hides the progress bar when neither processing nor completed', () => {
    render(<RebuildIndexControls {...defaultProps} />);

    expect(screen.queryByText('Processing..')).not.toBeInTheDocument();
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();
  });

  it('shows the processing header and counts while rebuilding', () => {
    render(
      <RebuildIndexControls
        {...defaultProps}
        isRebuildingProcessing
        currentCount={3}
        totalCount={10}
      />,
    );

    expect(screen.getByText('Processing..')).toBeInTheDocument();
    expect(screen.getByText('3 / 10')).toBeInTheDocument();
  });

  it('shows the completed header once rebuilding has finished', () => {
    render(
      <RebuildIndexControls
        {...defaultProps}
        isRebuildingCompleted
        currentCount={10}
        totalCount={10}
      />,
    );

    expect(screen.getByText('Completed')).toBeInTheDocument();
  });
});
