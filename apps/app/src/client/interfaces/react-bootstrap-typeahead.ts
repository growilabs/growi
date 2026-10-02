// https://github.com/ericgio/react-bootstrap-typeahead/blob/5.x/docs/API.md
export type TypeaheadProps = {
  dropup?: boolean;
  emptyLabel?: string;
  placeholder?: string;
  autoFocus?: boolean;
  inputProps?: unknown;

  onChange?: (data: unknown[]) => void;
  onBlur?: () => void;
  onFocus?: () => void;
  onSearch?: (text: string) => void;
  onInputChange?: (text: string) => void;
  onKeyDown?: (input: string) => void;
};
