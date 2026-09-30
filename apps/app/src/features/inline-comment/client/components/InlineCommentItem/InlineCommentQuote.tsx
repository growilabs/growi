import type { JSX } from 'react';

type InlineCommentQuoteProps = {
  quote: string;
  onClick: () => void;
  /** Clamps the quote to a few lines; used by the collapsed display only. */
  clamped?: boolean;
};

export const InlineCommentQuote = (
  props: InlineCommentQuoteProps,
): JSX.Element => {
  const { quote, onClick, clamped = false } = props;

  // Both class names are `:global(...)` in the CSS module, so they are
  // referenced as plain strings -- `styles[...]` would be undefined. A real
  // <button> (not a div with role="button") wraps the quote for default
  // keyboard accessibility, reset to plain-text styling so it still reads as
  // the quote.
  //
  // The clamp (overflow: hidden) lives on an inner element: on the padded
  // blockquote itself, the padding would show a sliver of the line after the
  // last visible one.
  return (
    <button
      type="button"
      className="btn p-0 border-0 bg-transparent text-start w-100"
      onClick={onClick}
    >
      <blockquote className="inline-comment-quote bg-body-tertiary rounded-end small text-body-secondary my-2 p-2">
        {clamped ? (
          <div className="inline-comment-quote-clamped">{quote}</div>
        ) : (
          quote
        )}
      </blockquote>
    </button>
  );
};
