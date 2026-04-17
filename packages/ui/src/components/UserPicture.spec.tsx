import { render, screen } from '@testing-library/react';

/**
 * Unit tests for the refactored UserPicture component.
 *
 * Task 20.3 — UserPicture tooltip refactoring
 * Requirements: 7.1, 7.3, 7.4, 7.5
 *
 * Key structural invariant:
 *   Before refactor: withTooltip HOC returns a Fragment
 *     → two sibling elements in the container (<span> + <Tooltip>)
 *   After refactor: tooltip is a child of the root <span>
 *     → exactly one child element in the container
 */

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Mock next/dynamic to return a synchronous stub component.
// This makes the dynamically-loaded UncontrolledTooltip testable without
// async chunk loading or portals in the test environment.
vi.mock('next/dynamic', () => ({
  default: (_importFn: () => Promise<unknown>, _opts?: unknown) => {
    // The stub renders its children inline so we can inspect tooltip content.
    const Stub = ({ children }: { children?: React.ReactNode }) => (
      <span data-testid="mock-tooltip">{children}</span>
    );
    return Stub;
  },
}));

vi.mock('next/router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Component under test (imported AFTER mocks are in place)
// ---------------------------------------------------------------------------

import { UserPicture } from './UserPicture';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeUser = (overrides?: object) => ({
  name: 'Alice',
  username: 'alice',
  imageUrlCached: '/avatar.png',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UserPicture — Task 20.3 (tooltip refactoring, req 7.1, 7.3, 7.4)', () => {
  describe('Req 7.3 / 7.4 — single root element (no Fragment)', () => {
    it('renders exactly one child element in the container when noTooltip is not set', () => {
      const { container } = render(<UserPicture user={makeUser()} noLink />);

      // After HOC removal, exactly ONE root child (the <span>).
      // Before the fix two siblings lived at this level (span + tooltip HOC fragment).
      expect(container.children).toHaveLength(1);
      expect(container.firstElementChild?.tagName).toBe('SPAN');
    });

    it('renders exactly one child element in the container when noTooltip is true', () => {
      const { container } = render(
        <UserPicture user={makeUser()} noLink noTooltip />,
      );

      expect(container.children).toHaveLength(1);
      expect(container.firstElementChild?.tagName).toBe('SPAN');
    });
  });

  describe('Req 7.4 — image rendered inside the root span', () => {
    it('renders the avatar image', () => {
      render(<UserPicture user={makeUser()} noLink />);

      // screen.getByRole throws if not found — implicit assertion of presence
      const img = screen.getByRole('img') as HTMLImageElement;
      expect(img.src).toContain('/avatar.png');
    });

    it('the image is nested inside the root span', () => {
      const { container } = render(<UserPicture user={makeUser()} noLink />);

      const rootSpan = container.firstElementChild;
      expect(rootSpan?.querySelector('img')).not.toBeNull();
    });
  });

  describe('Req 7.1 — tooltip renders when noTooltip is absent', () => {
    it('renders the tooltip stub when noTooltip is not set and user has a name', () => {
      render(<UserPicture user={makeUser()} noLink />);

      expect(screen.queryByTestId('mock-tooltip')).not.toBeNull();
    });

    it('does not render the tooltip stub when noTooltip is true', () => {
      render(<UserPicture user={makeUser()} noLink noTooltip />);

      expect(screen.queryByTestId('mock-tooltip')).toBeNull();
    });

    it('includes @username in tooltip content when username is available', () => {
      render(<UserPicture user={makeUser({ username: 'alice' })} noLink />);

      const tooltip = screen.queryByTestId('mock-tooltip');
      expect(tooltip?.textContent).toContain('@alice');
    });

    it('includes the display name in tooltip content', () => {
      render(<UserPicture user={makeUser({ name: 'Alice' })} noLink />);

      const tooltip = screen.queryByTestId('mock-tooltip');
      expect(tooltip?.textContent).toContain('Alice');
    });
  });

  describe('Req 7.3 — tooltip is nested inside root span (portal child, not sibling)', () => {
    it('tooltip stub is a descendant of the root span (not a sibling)', () => {
      const { container } = render(<UserPicture user={makeUser()} noLink />);

      // Single root child; tooltip stub is inside it
      expect(container.children).toHaveLength(1);
      const rootSpan = container.firstElementChild;
      expect(
        rootSpan?.querySelector('[data-testid="mock-tooltip"]'),
      ).not.toBeNull();
    });
  });
});
