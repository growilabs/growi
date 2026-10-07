import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';

import { GrowiArchiveImportOption } from '~/models/admin/growi-archive-import-option';

import ImportCollectionItem from './ImportCollectionItem';

/**
 * reactstrap's real Dropdown/DropdownMenu compose react-popper for positioning and
 * hide unopened content behind `aria-hidden`, neither of which is relevant to this
 * component's contract under test here (which import methods it offers). Reduced to
 * pass-through elements, same technique as CopyDropdown.spec.tsx. `DropdownMenu` gets
 * an explicit `role="menu"` wrapper so a test can scope its query to one collection's
 * card without also matching that card's toggle button (which repeats the current
 * mode's label).
 */
vi.mock('reactstrap', () => ({
  UncontrolledDropdown: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownToggle: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  DropdownMenu: ({ children }: { children: ReactNode }) => (
    <div role="menu">{children}</div>
  ),
  DropdownItem: ({
    children,
    onClick,
  }: {
    children?: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Progress: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

// `ImportCollectionItem` is a plain-JS class component (PropTypes, no TS generics),
// so there is no prop type to check overrides against here.
// WHY: no TS type exists for this component's props (see essential-test-patterns,
// Tier 3 -- untyped JS module).
const renderItem = (props: Record<string, unknown>) => {
  const collectionName = (props.collectionName as string) ?? 'usergroups';
  const merged = {
    collectionName,
    isSelected: false,
    isImporting: false,
    isImported: false,
    option: new GrowiArchiveImportOption(collectionName, 'insert'),
    onChange: vi.fn(),
    onOptionChange: vi.fn(),
    onConfigButtonClicked: vi.fn(),
    ...props,
  };
  return render(<ImportCollectionItem {...merged} />);
};

const menuOf = () => screen.getByRole('menu');

describe('ImportCollectionItem', () => {
  describe('when allowedModes is not given (the manual zip import screen, ImportForm.jsx)', () => {
    it('offers all three import methods for a collection with no built-in restriction', () => {
      // Regression guarded: the G2G-only narrowing (allowedModes) must not leak into
      // the default path ImportForm.jsx relies on.
      renderItem({ collectionName: 'usergroups' });

      const menu = within(menuOf());
      expect(menu.getByText('Insert')).toBeInTheDocument();
      expect(menu.getByText('Upsert')).toBeInTheDocument();
      expect(menu.getByText('Flush and Insert')).toBeInTheDocument();
    });

    it('keeps the existing restriction for a collection the component already restricts', () => {
      renderItem({ collectionName: 'configs' });

      const menu = within(menuOf());
      expect(menu.getByText('Flush and Insert')).toBeInTheDocument();
      expect(menu.queryByText('Insert')).not.toBeInTheDocument();
      expect(menu.queryByText('Upsert')).not.toBeInTheDocument();
    });
  });

  describe('when allowedModes is given (the G2G screen only)', () => {
    it('offers only the given modes, even for a collection the component would not otherwise restrict', () => {
      renderItem({
        collectionName: 'usergroups',
        allowedModes: ['insert', 'upsert'],
      });

      const menu = within(menuOf());
      expect(menu.getByText('Insert')).toBeInTheDocument();
      expect(menu.getByText('Upsert')).toBeInTheDocument();
      expect(menu.queryByText('Flush and Insert')).not.toBeInTheDocument();
    });
  });
});
