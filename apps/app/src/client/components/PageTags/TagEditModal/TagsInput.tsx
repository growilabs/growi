import type { FC, KeyboardEvent } from 'react';
import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'next-i18next';
import type { TypeaheadRef } from 'react-bootstrap-typeahead';
import { AsyncTypeahead, Token } from 'react-bootstrap-typeahead';

import { useSWRxTagsSearch } from '~/stores/tag';

import styles from './TagsInput.module.scss';

type Props = {
  tags: string[];
  autoFocus: boolean;
  onTagsUpdated: (tags: string[]) => void;
};

export const TagsInput: FC<Props> = (props: Props) => {
  const { t } = useTranslation();
  const { tags, autoFocus, onTagsUpdated } = props;

  const tagsInputRef = useRef<TypeaheadRef>(null);
  const [resultTags, setResultTags] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  const { data: tagsSearch, error } = useSWRxTagsSearch(searchQuery);

  const isLoading = error == null && tagsSearch === undefined;

  // Mirror the latest SWR result in a ref so searchHandler can read it without
  // depending on it. AsyncTypeahead recreates its internal debounced search
  // callback whenever the `onSearch` prop identity changes (see
  // react-bootstrap-typeahead's useAsync), and its cleanup CANCELS any
  // in-flight debounced call. If searchHandler's identity changed while a
  // just-typed keystroke's search was still pending in the 200ms debounce
  // window, that pending search was silently dropped and the typeahead
  // dropdown never populated (root cause of #11734).
  const tagsSearchRef = useRef(tagsSearch);
  tagsSearchRef.current = tagsSearch;

  const changeHandler = useCallback(
    (selected: string[]) => {
      onTagsUpdated(selected);
    },
    [onTagsUpdated],
  );

  const searchHandler = useCallback((query: string) => {
    const tagsSearchData = tagsSearchRef.current?.tags || [];
    setSearchQuery(query);
    // Build a new array instead of mutating tagsSearchData, which is SWR's
    // cached response object — mutating it would corrupt the cache.
    setResultTags(Array.from(new Set([query, ...tagsSearchData])));
  }, []);

  const keyDownHandler = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.code === 'Space') {
      event.preventDefault();

      // fix: https://redmine.weseek.co.jp/issues/140689
      // "event.isComposing" is not supported
      const isComposing = event.nativeEvent.isComposing;
      if (isComposing) {
        return;
      }

      const initialItem = tagsInputRef?.current?.state?.initialItem;
      const handleMenuItemSelect = tagsInputRef?.current?._handleMenuItemSelect;

      if (initialItem != null && handleMenuItemSelect != null) {
        handleMenuItemSelect(initialItem, event);
      }
    }
  }, []);

  return (
    <div className={`${styles['tags-input']}`}>
      <AsyncTypeahead
        id="tag-typeahead-asynctypeahead"
        ref={tagsInputRef}
        defaultSelected={tags}
        isLoading={isLoading}
        minLength={1}
        multiple
        onChange={changeHandler}
        onSearch={searchHandler}
        onKeyDown={keyDownHandler}
        options={resultTags} // Search result (Some tag names)
        placeholder={t('tag_edit_modal.tags_input.tag_name')}
        autoFocus={autoFocus}
        // option is tag name
        renderToken={(option: string, { onRemove }, idx) => {
          return (
            <Token
              key={idx}
              className="grw-tag badge mw-100 d-inline-flex p-0"
              option={option}
              onRemove={onRemove}
            >
              {option}
            </Token>
          );
        }}
      />
    </div>
  );
};
