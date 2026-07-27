import { type FC, useState } from 'react';
import { Nav, NavItem, NavLink, TabContent, TabPane } from 'reactstrap';

import type { IActivityHasId } from '~/interfaces/activity';

import { RawSnapshotDetail } from './RawSnapshotDetail';
import { snapshotDetailRenderers } from './snapshot-detail-renderers';

type ActivitySnapshotDetailProps = {
  activity: IActivityHasId;
};

type SnapshotDetailTab = 'info' | 'raw';

// Tab captions are intentionally plain strings: the i18n contract of this spec
// scopes the admin.json keys to the snapshot field labels, and locale files are
// owned by the integration task. Swap for t() keys once those keys exist.
const TABS: { id: SnapshotDetailTab; caption: string }[] = [
  { id: 'info', caption: 'Info' },
  { id: 'raw', caption: 'Raw' },
];

/**
 * Dispatcher for an activity's snapshot detail. Picks the FIRST registry entry
 * whose guard accepts the activity (`action` is the sole discriminant — this
 * component never branches on the snapshot's contents):
 * - match    → tabbed view: "Info" (default) + "Raw". The raw tab always
 *              renders RawSnapshotDetail with the full snapshot, so formatting
 *              augments the raw view and never replaces it.
 * - no match → RawSnapshotDetail alone, without any tab chrome.
 *
 * Always returns a valid element and never throws: a missing snapshot is
 * handled by RawSnapshotDetail's placeholder.
 */
export const ActivitySnapshotDetail: FC<ActivitySnapshotDetailProps> = (
  props,
) => {
  const { activity } = props;

  const [activeTab, setActiveTab] = useState<SnapshotDetailTab>('info');

  const renderer = snapshotDetailRenderers.find((r) => r.canRender(activity));

  if (renderer == null) {
    return <RawSnapshotDetail snapshot={activity.snapshot} />;
  }

  return (
    <div>
      <Nav tabs role="tablist" className="mb-2">
        {TABS.map((tab) => (
          <NavItem key={tab.id}>
            <NavLink
              tag="button"
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              active={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.caption}
            </NavLink>
          </NavItem>
        ))}
      </Nav>
      <TabContent activeTab={activeTab}>
        {/* Mount only the active pane; the inactive pane is unmounted on switch */}
        <TabPane tabId="info" role="tabpanel">
          {activeTab === 'info' && <renderer.Component activity={activity} />}
        </TabPane>
        <TabPane tabId="raw" role="tabpanel">
          {activeTab === 'raw' && (
            <RawSnapshotDetail snapshot={activity.snapshot} />
          )}
        </TabPane>
      </TabContent>
    </div>
  );
};
