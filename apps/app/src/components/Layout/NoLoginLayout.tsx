import type { JSX, ReactNode } from 'react';
import Image from 'next/image';

import { useAppTitle } from '~/states/global';

import GrowiLogo from '../Common/GrowiLogo';
import { RawLayout } from './RawLayout';

import commonStyles from './NoLoginLayout.module.scss';

type Props = {
  className?: string;
  children?: ReactNode;
};

export const NoLoginLayout = ({ children, className }: Props): JSX.Element => {
  const appTitle = useAppTitle();

  const classNames: string[] = [''];
  if (className != null) {
    classNames.push(className);
  }

  return (
    <RawLayout className={`nologin ${commonStyles.nologin} ${classNames}`}>
      <div className="d-flex align-items-center vh-100 mt-0 flex-row">
        <div className="main container-fluid">
          <div className="row">
            <div className="col-md-12 position-relative">
              <div className="nologin-header mx-auto rounded-4 rounded-bottom-0">
                <div className="d-flex justify-content-center align-items-center">
                  <GrowiLogo />
                  <Image
                    width={128.48}
                    height={28}
                    src="/images/growi-brand-logo-login.svg"
                    alt="GROWI"
                    className="growi-logo-type my-3"
                  />
                </div>
                {appTitle !== 'GROWI' ? (
                  <h2 className="fs-4 text-center text-white">{appTitle}</h2>
                ) : null}
                <div className="noLogin-form-errors px-3"></div>
              </div>
              {children}
            </div>
          </div>
        </div>
      </div>
    </RawLayout>
  );
};
