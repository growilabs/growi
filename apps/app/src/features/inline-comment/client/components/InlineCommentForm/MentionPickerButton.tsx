/**
 * Explicit mention-target picker for `InlineCommentForm` (design.md's
 * `MentionPickerButton` component; Requirement 3.1-3.3). This is a standalone
 * component, not yet wired into `InlineCommentForm.tsx` — that wiring is a
 * later task (3.2) per this task's boundary.
 *
 * On press it fetches candidates via `fetchMentionUsers('')` (an empty query,
 * per design.md's Responsibilities) and shows them in a `reactstrap`
 * `Dropdown`. Selecting a candidate calls `onInsert(username)` exactly once;
 * incremental in-list filtering is explicitly out of scope (see design.md's
 * Non-Goals).
 */

import type { JSX } from 'react';
import { useCallback, useState } from 'react';
import {
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownToggle,
} from 'reactstrap';

import { fetchMentionUsers } from '../../services/fetch-mention-users';

type MentionCandidate = {
  username: string;
  name: string;
};

type MentionPickerButtonProps = {
  onInsert: (username: string) => void;
};

export const MentionPickerButton = (
  props: MentionPickerButtonProps,
): JSX.Element => {
  const { onInsert } = props;

  const [isOpen, setIsOpen] = useState(false);
  const [candidates, setCandidates] = useState<MentionCandidate[]>([]);

  const toggle = useCallback(() => {
    // Fire-and-forget: the Invariant (design.md) says the button must not
    // disable itself while fetching is in progress. This must stay outside
    // the setIsOpen updater below -- updater functions must be pure (React
    // may invoke them more than once, e.g. under StrictMode), so a fetch
    // triggered from inside one can fire twice per press.
    if (!isOpen) {
      fetchMentionUsers('').then(setCandidates);
    }
    setIsOpen(!isOpen);
  }, [isOpen]);

  const selectCandidate = useCallback(
    (username: string) => {
      onInsert(username);
    },
    [onInsert],
  );

  return (
    <Dropdown isOpen={isOpen} toggle={toggle}>
      <DropdownToggle type="button" data-testid="mention-picker-button" caret>
        @
      </DropdownToggle>
      <DropdownMenu>
        {candidates.length === 0 ? (
          <DropdownItem header>No candidates</DropdownItem>
        ) : (
          candidates.map((candidate) => (
            <DropdownItem
              key={candidate.username}
              onClick={() => selectCandidate(candidate.username)}
            >
              <span>{candidate.username}</span>
              <span className="text-secondary ms-1">{candidate.name}</span>
            </DropdownItem>
          ))
        )}
      </DropdownMenu>
    </Dropdown>
  );
};
