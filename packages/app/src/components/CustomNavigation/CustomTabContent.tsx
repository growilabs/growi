import React from 'react';

import {
  TabContent, TabPane,
} from 'reactstrap';

import type { ICustomNavTabMappings } from '~/interfaces/ui';

import { LazyRenderer } from '../Common/LazyRenderer';


type Props = {
  activeTab: string,
  navTabMapping: ICustomNavTabMappings,
  additionalClassNames?: string[],
}

const CustomTabContent = (props: Props): JSX.Element => {

  const { activeTab, navTabMapping, additionalClassNames } = props;

  return (
    <TabContent activeTab={activeTab} className={additionalClassNames != null ? additionalClassNames.join(' ') : ''}>
      {Object.entries(navTabMapping).map(([key, value]) => {

        const { Content } = value;

        return (
          <TabPane key={key} tabId={key}>
            <LazyRenderer shouldRender={key === activeTab}>
              <Content />
            </LazyRenderer>
          </TabPane>
        );
      })}
    </TabContent>
  );

};

export default CustomTabContent;
