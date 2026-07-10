import { formatModelLabel, groupModelsByProvider } from './model-display';

describe('groupModelsByProvider', () => {
  it('groups in fixed AI_PROVIDERS slot order and drops providers that own no item', () => {
    const items = [
      { provider: 'anthropic' as const, id: 'claude' },
      { provider: 'openai' as const, id: 'gpt-4o' },
      { provider: 'anthropic' as const, id: 'claude-2' },
    ];

    const groups = groupModelsByProvider(items, (i) => i.provider);

    // openai precedes anthropic (AI_PROVIDERS order), google/azure-openai dropped.
    expect(groups.map((g) => g.provider)).toEqual(['openai', 'anthropic']);
    // within a group, input order is preserved.
    expect(groups[1].entries.map((i) => i.id)).toEqual(['claude', 'claude-2']);
  });

  it('returns an empty array when there are no items', () => {
    expect(
      groupModelsByProvider([], (i: { provider: 'openai' }) => i.provider),
    ).toEqual([]);
  });

  it('supports a wrapper item shape via the accessor (admin selector index-tracking)', () => {
    const wrapped = [
      { model: { provider: 'google' as const }, index: 0 },
      { model: { provider: 'openai' as const }, index: 1 },
    ];

    const groups = groupModelsByProvider(wrapped, (w) => w.model.provider);

    expect(groups.map((g) => g.provider)).toEqual(['openai', 'google']);
    expect(groups[0].entries[0].index).toBe(1);
  });
});

describe('formatModelLabel', () => {
  it('joins the provider display name and modelId with a middle dot', () => {
    expect(formatModelLabel('openai', 'gpt-4o')).toBe('OpenAI · gpt-4o');
  });

  it('uses the provider display name, not the raw provider key', () => {
    expect(formatModelLabel('azure-openai', 'my-deployment')).toBe(
      'Azure OpenAI · my-deployment',
    );
  });
});
