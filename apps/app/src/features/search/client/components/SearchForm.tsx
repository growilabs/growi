import React, {
  type JSX,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';

import type { GetInputProps } from '../interfaces/downshift';

type Props = {
  searchKeyword: string;
  onChange?: (text: string) => void;
  onSubmit?: () => void;
  getInputProps: GetInputProps;
};

export const SearchForm = (props: Props): JSX.Element => {
  const { searchKeyword, onChange, onSubmit, getInputProps } = props;

  const inputRef = useRef<HTMLInputElement>(null);

  const changeSearchTextHandler = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange?.(e.target.value);
    },
    [onChange],
  );

  const submitHandler = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();

      const isEmptyKeyword = searchKeyword.trim().length === 0;
      if (isEmptyKeyword) {
        return;
      }

      onSubmit?.();
    },
    [searchKeyword, onSubmit],
  );

  // Prevent Downshift from intercepting Home/End keys so they move
  // the cursor within the input field instead of navigating the list
  const keyDownHandler = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Home' || e.key === 'End') {
        e.nativeEvent.preventDownshiftDefault = true;
      }
    },
    [],
  );

  const inputOptions = useMemo(() => {
    return getInputProps({
      type: 'text',
      placeholder: 'Search...',
      className: 'form-control',
      ref: inputRef,
      value: searchKeyword,
      onChange: changeSearchTextHandler,
      onKeyDown: keyDownHandler,
    });
  }, [getInputProps, searchKeyword, changeSearchTextHandler, keyDownHandler]);

  useEffect(() => {
    if (inputRef.current != null) {
      inputRef.current.focus();
    }
  });

  return (
    <form
      className="w-100 position-relative"
      onSubmit={submitHandler}
      data-testid="search-form"
    >
      <input {...inputOptions} />
      <button
        type="button"
        className="btn btn-neutral-secondary text-muted position-absolute bottom-0 end-0 w-auto h-100 border-0"
        onClick={() => {
          onChange?.('');
        }}
      >
        <span className="material-symbols-outlined p-0">cancel</span>
      </button>
    </form>
  );
};
