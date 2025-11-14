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

  const inputOptions = useMemo(() => {
    return getInputProps({
      type: 'text',
      placeholder: 'Search...',
      className: 'form-control',
      ref: inputRef,
      value: searchKeyword,
      onChange: changeSearchTextHandler,
    });
  }, [getInputProps, searchKeyword, changeSearchTextHandler]);

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
