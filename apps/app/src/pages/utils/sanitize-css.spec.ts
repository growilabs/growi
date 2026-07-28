import { sanitizeCustomCss } from './sanitize-css';

describe('sanitizeCustomCss', () => {
  it('passes normal CSS through unchanged', () => {
    const css = 'body { color: red; } h1 { font-size: 2em; }';
    expect(sanitizeCustomCss(css)).toBe(css);
  });

  it('neutralizes </style> breakout', () => {
    expect(sanitizeCustomCss('</style><script>alert(1)</script>')).toBe(
      '<\\/style><script>alert(1)</script>',
    );
  });

  it('handles case variant </Style>', () => {
    expect(sanitizeCustomCss('</Style>')).toBe('<\\/Style>');
  });

  it('handles case variant </STYLE>', () => {
    expect(sanitizeCustomCss('</STYLE>')).toBe('<\\/STYLE>');
  });

  it('handles whitespace variant </style >', () => {
    expect(sanitizeCustomCss('</style >')).toBe('<\\/style >');
  });

  it('handles multiple occurrences', () => {
    expect(sanitizeCustomCss('</style>a</STYLE>b')).toBe(
      '<\\/style>a<\\/STYLE>b',
    );
  });
});
