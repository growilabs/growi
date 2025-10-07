import {
  useCallback, useEffect, useState, type JSX,
} from 'react';

import type EventEmitter from 'events';

import type { Element } from 'hast';
import { useRouter } from 'next/router';

import { NextLink } from '~/components/ReactMarkdownComponents/NextLink';
import { useCurrentPageYjsData, useCurrentPageYjsDataLoading } from '~/features/collaborative-editor/states';
import { useIsGuestUser, useIsReadOnlyUser, useIsSharedUser } from '~/states/context';
import { useShareLinkId } from '~/states/page/hooks';
import loggerFactory from '~/utils/logger';


import styles from './Header.module.scss';


const logger = loggerFactory('growi:components:Header');
const moduleClass = styles['revision-head'] ?? '';

declare global {
  // eslint-disable-next-line vars-on-top, no-var
  var globalEmitter: EventEmitter;
}


function setCaretLine(line?: number): void {
  if (line != null) {
    globalEmitter.emit('reservedNextCaretLine', line);
  }
}

type EditLinkProps = {
  line?: number,
}

/**
 * Inner FC to display edit link icon
 */
const EditLink = (props: EditLinkProps): JSX.Element => {
  const isDisabled = props.line == null;

  return (
    <span className="revision-head-edit-button">
      <a href="#edit" aria-disabled={isDisabled} onClick={() => setCaretLine(props.line)}>
        <span className="material-symbols-outlined">edit_square</span>
      </a>
    </span>
  );
};


type HeaderProps = {
  children: React.ReactNode,
  node: Element,
  id?: string,
}

export const Header = (props: HeaderProps): JSX.Element => {
  const {
    node, id, children,
  } = props;

  const isGuestUser = useIsGuestUser();
  const isReadOnlyUser = useIsReadOnlyUser();
  const isSharedUser = useIsSharedUser();
  const shareLinkId = useShareLinkId();
  const currentPageYjsData = useCurrentPageYjsData();
  const isLoadingCurrentPageYjsData = useCurrentPageYjsDataLoading();

  const router = useRouter();

  const [isActive, setActive] = useState(false);

  const CustomTag = node.tagName as keyof JSX.IntrinsicElements;

  const activateByHash = useCallback((url: string) => {
    try {
      const hash = (new URL(url, 'https://example.com')).hash.slice(1);
      setActive(decodeURIComponent(hash) === id);
    }
    catch (err) {
      logger.debug(err);
      setActive(false);
    }
  }, [id]);

  // init
  useEffect(() => {
    activateByHash(window.location.href);
  }, [activateByHash]);

  // update isActive when hash is changed by next router
  useEffect(() => {
    router.events.on('hashChangeComplete', activateByHash);

    return () => {
      router.events.off('hashChangeComplete', activateByHash);
    };
  }, [activateByHash, router.events]);

  // update isActive when hash is changed
  useEffect(() => {
    const activeByHashWrapper = (e: HashChangeEvent) => {
      activateByHash(e.newURL);
    };

    window.addEventListener('hashchange', activeByHashWrapper);

    return () => {
      window.removeEventListener('hashchange', activeByHashWrapper);
    };
  }, [activateByHash, router.events]);

  // TODO: currentPageYjsData?.hasYdocsNewerThanLatestRevision === false make to hide the edit button when a Yjs draft exists
  // This is because the current conditional logic cannot handle cases where the draft is an empty string.
  // It will be possible to address this TODO ySyncAnnotation become available for import.
  // Ref: https://github.com/yjs/y-codemirror.next/pull/30
  const showEditButton = !isGuestUser && !isReadOnlyUser && !isSharedUser && shareLinkId == null
                            && (!isLoadingCurrentPageYjsData && !currentPageYjsData?.hasYdocsNewerThanLatestRevision);

  return (
    <>
      <CustomTag id={id} className={`position-relative ${moduleClass} ${isActive ? styles.blink : ''} `}>
        <NextLink href={`#${id}`} className="d-none d-md-inline revision-head-link position-absolute">
          #
        </NextLink>

        {children}

        { showEditButton && (
          <EditLink line={node.position?.start.line} />
        ) }
      </CustomTag>
    </>
  );
};
