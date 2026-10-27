// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';

// Render i18n keys verbatim: the assertions are about which message the component
// chooses for a given error, not about the wording of the translation.
vi.mock('next-i18next', () => ({
  useTranslation: () => ({
    t: (key) => key,
    i18n: { language: 'en_US' },
  }),
}));

import ApiErrorMessage from './ApiErrorMessage';

describe('ApiErrorMessage', () => {
  it('explains a missing revision and offers to load the latest', () => {
    render(
      <ApiErrorMessage
        errorCode="invalid_body"
        errorMessage="revision_id must be a mongoId"
      />,
    );

    expect(screen.getByText('page_api_error.invalid_body')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Load latest/ }),
    ).toBeInTheDocument();
  });

  it("shows the server's message for a code it does not know", () => {
    render(
      <ApiErrorMessage
        errorCode="exceeded_maximum_number"
        errorMessage="The maximum number of pages you can select is 20."
      />,
    );

    expect(
      screen.getByText('The maximum number of pages you can select is 20.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Unknown error occured/)).not.toBeInTheDocument();
  });

  it('falls back to the generic text when an unknown code carries no message', () => {
    render(<ApiErrorMessage errorCode="some_code_without_message" />);

    expect(screen.getByText(/Unknown error occured/)).toBeInTheDocument();
  });

  it('keeps rendering the message of a code it knows', () => {
    render(
      <ApiErrorMessage
        errorCode="outdated"
        errorMessage="Someone could update this page, so couldn't delete."
      />,
    );

    expect(screen.getByText('page_api_error.outdated')).toBeInTheDocument();
    expect(
      screen.queryByText("Someone could update this page, so couldn't delete."),
    ).not.toBeInTheDocument();
  });
});
