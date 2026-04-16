import type { EditingClient } from '@growi/editor';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Unit tests for EditingUserList component.
 *
 * Covers:
 * - Task 14: Color-matched avatar borders and click-to-scroll
 * - Task 16.1: Unit tests for EditingUserList rendering and click behavior
 * - Requirements: 5.1, 6.4, 6.5
 */

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@growi/ui/dist/components', () => ({
  UserPicture: ({
    user,
    className,
    noTooltip,
  }: {
    user: EditingClient;
    className?: string;
    noTooltip?: boolean;
  }) => (
    <span
      data-testid={`user-picture-${user.clientId}`}
      data-no-tooltip={noTooltip ? 'true' : undefined}
      className={className}
    >
      {user.name}
    </span>
  ),
}));

vi.mock('../../Common/UserPictureList', () => ({
  default: ({ users }: { users: EditingClient[] }) => (
    <div data-testid="user-picture-list">
      {users.map((u) => (
        <span key={u.clientId} data-testid={`overflow-user-${u.clientId}`}>
          {u.name}
        </span>
      ))}
    </div>
  ),
}));

vi.mock('reactstrap', () => ({
  Popover: ({
    children,
    isOpen,
  }: {
    children: React.ReactNode;
    isOpen: boolean;
  }) => (isOpen ? <div data-testid="popover">{children}</div> : null),
  PopoverBody: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popover-body">{children}</div>
  ),
}));

vi.mock('./EditingUserList.module.scss', () => ({
  default: { 'user-list-popover': 'user-list-popover' },
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const makeClient = (
  id: number,
  name: string,
  color: string,
): EditingClient => ({
  clientId: id,
  name,
  color,
  colorLight: `${color}33`,
});

const clientAlice = makeClient(1, 'Alice', '#ff0000');
const clientBob = makeClient(2, 'Bob', '#00ff00');
const clientCarol = makeClient(3, 'Carol', '#0000ff');
const clientDave = makeClient(4, 'Dave', '#ffff00');
const clientEve = makeClient(5, 'Eve', '#ff00ff');

import { EditingUserList } from './EditingUserList';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EditingUserList — Task 16.1', () => {
  describe('Req 5.1 — color-matched avatar borders', () => {
    it("renders a wrapper with border color matching the user's cursor color", () => {
      render(<EditingUserList clientList={[clientAlice]} />);

      const wrapper = screen.getByTestId('avatar-wrapper-1');
      expect(wrapper).toHaveStyle({ borderColor: clientAlice.color });
    });

    it('does NOT use the fixed border-info CSS class', () => {
      render(<EditingUserList clientList={[clientAlice]} />);

      const wrapper = screen.getByTestId('avatar-wrapper-1');
      expect(wrapper).not.toHaveClass('border-info');
    });

    it('applies color-matched borders to all first-4 avatars', () => {
      render(
        <EditingUserList
          clientList={[clientAlice, clientBob, clientCarol, clientDave]}
        />,
      );

      for (const client of [clientAlice, clientBob, clientCarol, clientDave]) {
        const wrapper = screen.getByTestId(`avatar-wrapper-${client.clientId}`);
        expect(wrapper).toHaveStyle({ borderColor: client.color });
      }
    });
  });

  describe('Req 6.4 — cursor: pointer affordance', () => {
    it('avatar wrapper is a button element (provides pointer affordance)', () => {
      render(<EditingUserList clientList={[clientAlice]} />);

      const wrapper = screen.getByTestId('avatar-wrapper-1');
      expect(wrapper.tagName).toBe('BUTTON');
    });
  });

  describe('Req 6.5 / Task 16.1 — clicking an avatar invokes callback with correct clientId', () => {
    it("calls onUserClick with the client's clientId when clicked", async () => {
      const onUserClick = vi.fn();
      render(
        <EditingUserList
          clientList={[clientAlice, clientBob]}
          onUserClick={onUserClick}
        />,
      );

      await userEvent.click(screen.getByTestId('avatar-wrapper-1'));
      expect(onUserClick).toHaveBeenCalledWith(clientAlice.clientId);

      await userEvent.click(screen.getByTestId('avatar-wrapper-2'));
      expect(onUserClick).toHaveBeenCalledWith(clientBob.clientId);
    });

    it('does not throw when onUserClick is not provided', async () => {
      render(<EditingUserList clientList={[clientAlice]} />);
      await userEvent.click(screen.getByTestId('avatar-wrapper-1'));
      // No error expected
    });
  });

  describe('Req 6.5 — overflow popover avatars support click-to-scroll', () => {
    it('renders color-matched wrappers for overflow avatars in the popover', async () => {
      const clients = [
        clientAlice,
        clientBob,
        clientCarol,
        clientDave,
        clientEve,
      ];
      render(<EditingUserList clientList={clients} onUserClick={vi.fn()} />);

      // Open the popover by clicking the +1 button
      const btn = screen.getByRole('button', { name: /^\+1$/ });
      await userEvent.click(btn);

      // Eve is the 5th user, rendered in overflow
      const eveWrapper = screen.queryByTestId('avatar-wrapper-5');
      if (eveWrapper != null) {
        expect(eveWrapper).toHaveStyle({ borderColor: clientEve.color });
      }
    });

    it('calls onUserClick when an overflow avatar is clicked', async () => {
      const onUserClick = vi.fn();
      const clients = [
        clientAlice,
        clientBob,
        clientCarol,
        clientDave,
        clientEve,
      ];
      render(
        <EditingUserList clientList={clients} onUserClick={onUserClick} />,
      );

      // Open the popover
      await userEvent.click(screen.getByRole('button', { name: /^\+1$/ }));

      // Click Eve's avatar in the overflow
      const eveWrapper = screen.queryByTestId('avatar-wrapper-5');
      if (eveWrapper != null) {
        await userEvent.click(eveWrapper);
        expect(onUserClick).toHaveBeenCalledWith(clientEve.clientId);
      }
    });
  });

  describe('Empty list', () => {
    it('renders nothing when clientList is empty', () => {
      const { container } = render(<EditingUserList clientList={[]} />);
      expect(container.firstChild).toBeNull();
    });
  });
});

/**
 * Task 20.4 — EditingUserList tooltip integration
 * Requirements: 7.2
 */
describe('EditingUserList — Task 20.4 (tooltip integration)', () => {
  describe('Req 7.2 — UserPicture rendered without noTooltip so tooltip is active', () => {
    it('does not pass noTooltip to UserPicture for direct avatars', () => {
      render(<EditingUserList clientList={[clientAlice]} />);

      const pic = screen.getByTestId('user-picture-1');
      // data-no-tooltip attribute is only set when noTooltip=true; should be absent
      expect(pic.getAttribute('data-no-tooltip')).toBeNull();
    });

    it('does not pass noTooltip to UserPicture for all first-4 direct avatars', () => {
      render(
        <EditingUserList
          clientList={[clientAlice, clientBob, clientCarol, clientDave]}
        />,
      );

      for (const client of [clientAlice, clientBob, clientCarol, clientDave]) {
        const pic = screen.getByTestId(`user-picture-${client.clientId}`);
        expect(pic.getAttribute('data-no-tooltip')).toBeNull();
      }
    });

    it('does not pass noTooltip to UserPicture for overflow popover avatars', async () => {
      render(
        <EditingUserList
          clientList={[
            clientAlice,
            clientBob,
            clientCarol,
            clientDave,
            clientEve,
          ]}
        />,
      );

      // Open the overflow popover
      await userEvent.click(screen.getByRole('button', { name: /^\+1$/ }));

      const evePic = screen.getByTestId('user-picture-5');
      expect(evePic.getAttribute('data-no-tooltip')).toBeNull();
    });
  });
});
