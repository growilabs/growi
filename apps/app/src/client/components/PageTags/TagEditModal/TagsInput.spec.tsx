import { render } from '@testing-library/react';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('~/stores/tag', () => ({
  useSWRxTagsSearch: () => ({ data: undefined, error: null }),
}));

import { TagsInput } from './TagsInput';

const renderTagsInput = (tags: string[]) =>
  render(<TagsInput tags={tags} autoFocus={false} onTagsUpdated={vi.fn()} />);

describe('TagsInput', () => {
  it('renders the given tags as tokens', () => {
    const { getByText } = renderTagsInput(['alpha', 'beta']);

    expect(getByText('alpha')).toBeInTheDocument();
    expect(getByText('beta')).toBeInTheDocument();
  });

  // Contract that the tag-edit-on-redirect reset (TagEditModal re-seeding `tags`)
  // and a filter chips-bar clear both rely on: an external change to `tags` must
  // be reflected in the displayed tokens. The previous uncontrolled
  // `defaultSelected` ignored post-mount prop changes, so this would have failed.
  it('reflects an external tags change into the rendered tokens', () => {
    const { getByText, queryByText, rerender } = renderTagsInput([
      'alpha',
      'beta',
    ]);
    expect(getByText('alpha')).toBeInTheDocument();

    rerender(
      <TagsInput tags={['gamma']} autoFocus={false} onTagsUpdated={vi.fn()} />,
    );

    expect(getByText('gamma')).toBeInTheDocument();
    expect(queryByText('alpha')).not.toBeInTheDocument();
    expect(queryByText('beta')).not.toBeInTheDocument();
  });

  // Mirrors removing a single chip from the filter bar (remove one, keep the
  // rest) — a distinct path from the full-replace and clear-all cases.
  it('removes only the deselected tag on a partial change', () => {
    const { getByText, queryByText, rerender } = renderTagsInput([
      'alpha',
      'beta',
    ]);
    expect(getByText('alpha')).toBeInTheDocument();
    expect(getByText('beta')).toBeInTheDocument();

    rerender(
      <TagsInput tags={['beta']} autoFocus={false} onTagsUpdated={vi.fn()} />,
    );

    expect(queryByText('alpha')).not.toBeInTheDocument();
    expect(getByText('beta')).toBeInTheDocument();
  });

  it('clears all tokens when tags is reset to empty', () => {
    const { getByText, queryByText, rerender } = renderTagsInput(['alpha']);
    expect(getByText('alpha')).toBeInTheDocument();

    rerender(<TagsInput tags={[]} autoFocus={false} onTagsUpdated={vi.fn()} />);

    expect(queryByText('alpha')).not.toBeInTheDocument();
  });
});
