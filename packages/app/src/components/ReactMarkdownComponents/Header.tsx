import { useCallback, useEffect, useState } from 'react';

import EventEmitter from 'events';

import { useRouter } from 'next/router';
import { Element } from 'react-markdown/lib/rehype-filter';

import { NextLink } from './NextLink';


import styles from './Header.module.scss';


declare global {
  // eslint-disable-next-line vars-on-top, no-var
  var globalEmitter: EventEmitter;
}


function setCaretLine(line?: number): void {
  if (line != null) {
    globalEmitter.emit('setCaretLine', line);
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
        <i className="icon-note"></i>
      </a>
    </span>
  );
};


type HeaderProps = {
  children: React.ReactNode,
  node: Element,
  level: number,
  id?: string,
}

export const Header = (props: HeaderProps): JSX.Element => {
  const {
    node, id, children, level,
  } = props;

  const router = useRouter();

  const [isActive, setActive] = useState(false);

  const CustomTag = `h${level}` as keyof JSX.IntrinsicElements;

  const activateByHash = useCallback((url: string) => {
    const hash = (new URL(url, 'https://example.com')).hash.slice(1);
    setActive(hash === id);
  }, [id]);

  // init
  useEffect(() => {
    activateByHash(window.location.href);
  }, [activateByHash]);

  // update isActive when hash is changed
  useEffect(() => {
    router.events.on('hashChangeComplete', activateByHash);

    return () => {
      router.events.off('hashChangeComplete', activateByHash);
    };
  }, [activateByHash, router.events]);

  return (
    <CustomTag id={id} className={`revision-head ${styles['revision-head']} ${isActive ? 'blink' : ''}`}>
      {children}
      <NextLink href={`#${id}`} className="revision-head-link">
        <span className="icon-link"></span>
      </NextLink>
      <EditLink line={node.position?.start.line} />
    </CustomTag>
  );
};
