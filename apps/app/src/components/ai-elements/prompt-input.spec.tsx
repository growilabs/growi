// @vitest-environment happy-dom

import { render, screen, within } from '@testing-library/react';

import {
  PromptInputModelSelect,
  PromptInputModelSelectContent,
  PromptInputModelSelectGroup,
  PromptInputModelSelectItem,
  PromptInputModelSelectLabel,
  PromptInputModelSelectTrigger,
  PromptInputModelSelectValue,
} from './prompt-input';

/**
 * Resolve the Radix `role="group"` container that owns the given provider
 * heading. Scoping item queries to this element avoids the hidden native
 * <select> mirror Radix renders for form submission (whose <option>s duplicate
 * the item text but carry no role="group").
 */
const groupOf = (headingText: string): HTMLElement => {
  const group = screen
    .getByText(headingText)
    .closest<HTMLElement>('[role="group"]');
  if (group == null) {
    throw new Error(`group for heading "${headingText}" not found`);
  }
  return group;
};

describe('PromptInput model select — provider grouping (Req 4.2)', () => {
  // Renders the selector open (defaultOpen) so the portal content is present on
  // initial render; happy-dom cannot reliably *drive* the open interaction, but
  // it renders defaultOpen content deterministically.
  const renderGroupedOpen = () =>
    render(
      <PromptInputModelSelect defaultOpen>
        <PromptInputModelSelectTrigger>
          <PromptInputModelSelectValue placeholder="Select a model" />
        </PromptInputModelSelectTrigger>
        <PromptInputModelSelectContent>
          <PromptInputModelSelectGroup>
            <PromptInputModelSelectLabel>OpenAI</PromptInputModelSelectLabel>
            <PromptInputModelSelectItem value="openai/gpt-4o">
              gpt-4o
            </PromptInputModelSelectItem>
            <PromptInputModelSelectItem value="openai/gpt-4o-mini">
              gpt-4o-mini
            </PromptInputModelSelectItem>
          </PromptInputModelSelectGroup>
          <PromptInputModelSelectGroup>
            <PromptInputModelSelectLabel>Anthropic</PromptInputModelSelectLabel>
            <PromptInputModelSelectItem value="anthropic/claude-sonnet">
              claude-sonnet
            </PromptInputModelSelectItem>
          </PromptInputModelSelectGroup>
        </PromptInputModelSelectContent>
      </PromptInputModelSelect>,
    );

  it('renders one group per provider, each headed by its provider label', () => {
    renderGroupedOpen();

    // Provider headings are visible (they are not mirrored into the hidden
    // native <select>, so they are unambiguous).
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getByText('Anthropic')).toBeInTheDocument();

    // Exactly one group container per provider.
    expect(screen.getAllByRole('group')).toHaveLength(2);
  });

  it('groups each model under its owning provider so options are distinguishable by provider', () => {
    renderGroupedOpen();

    const openaiGroup = groupOf('OpenAI');
    const anthropicGroup = groupOf('Anthropic');

    // OpenAI's models live under the OpenAI heading — and only there.
    expect(within(openaiGroup).getByText('gpt-4o')).toBeInTheDocument();
    expect(within(openaiGroup).getByText('gpt-4o-mini')).toBeInTheDocument();
    expect(within(openaiGroup).queryByText('claude-sonnet')).toBeNull();

    // Anthropic's model lives under the Anthropic heading — and only there.
    expect(
      within(anthropicGroup).getByText('claude-sonnet'),
    ).toBeInTheDocument();
    expect(within(anthropicGroup).queryByText('gpt-4o')).toBeNull();
  });
});

describe('PromptInput model select — group/label wrappers forward their contract', () => {
  // The group + label wrappers render standalone (no Select root required), so
  // this locks the thin-wrapper pass-through contract without the portal.
  it('renders the label heading and passes className/children through to the group container', () => {
    render(
      <PromptInputModelSelectGroup
        className="custom-group-class"
        data-testid="provider-group"
      >
        <PromptInputModelSelectLabel className="custom-label-class">
          OpenAI
        </PromptInputModelSelectLabel>
        <div>arbitrary-child</div>
      </PromptInputModelSelectGroup>,
    );

    const group = screen.getByTestId('provider-group');
    expect(group).toHaveAttribute('role', 'group');
    expect(group).toHaveClass('custom-group-class');

    // Label renders its provider heading text and forwards its className.
    expect(screen.getByText('OpenAI')).toHaveClass('custom-label-class');

    // Arbitrary children pass through untouched.
    expect(screen.getByText('arbitrary-child')).toBeInTheDocument();
  });
});
