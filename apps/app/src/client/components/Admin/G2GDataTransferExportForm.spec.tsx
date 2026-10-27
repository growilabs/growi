import { type ReactNode, useState } from 'react';
import { render, screen, within } from '@testing-library/react';

import G2GDataTransferExportForm from './G2GDataTransferExportForm';

vi.mock('next-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

/**
 * reactstrap's real Dropdown/DropdownMenu compose react-popper for positioning and
 * hide unopened content behind `aria-hidden`, neither of which is relevant to this
 * component's contract under test here (which import methods it offers per
 * collection). Reduced to pass-through elements, same technique as
 * CopyDropdown.spec.tsx and ImportCollectionItem.spec.tsx. `DropdownMenu` gets an
 * explicit `role="menu"` wrapper so a test can scope its query to one collection's
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

/**
 * Mirrors how G2GDataTransfer.tsx owns this state for the real component: this
 * screen's own state, not a prop the test controls directly, is what the
 * component under test relies on to have populated `optionsMap` by mount time
 * (its own `useEffect` does that).
 */
const Harness = ({ allCollectionNames }: { allCollectionNames: string[] }) => {
  const [selectedCollections, setSelectedCollections] = useState(
    new Set(allCollectionNames),
  );
  // biome-ignore lint/suspicious/noExplicitAny: mirrors the `any` the real parent
  // (G2GDataTransfer.tsx) uses for this state.
  const [optionsMap, setOptionsMap] = useState<any>({});

  return (
    <G2GDataTransferExportForm
      allCollectionNames={allCollectionNames}
      selectedCollections={selectedCollections}
      updateSelectedCollections={setSelectedCollections}
      optionsMap={optionsMap}
      updateOptionsMap={setOptionsMap}
    />
  );
};

/** The card rendered for one collection, found via its checkbox's accessible label. */
const cardFor = (collectionName: string): HTMLElement => {
  const checkbox = screen.getByLabelText(collectionName);
  const card = checkbox.closest('.card');
  if (card == null) {
    throw new Error(`Expected a .card ancestor for ${collectionName}`);
  }
  return card as HTMLElement;
};

const menuIn = (card: HTMLElement) => within(within(card).getByRole('menu'));

describe('G2GDataTransferExportForm', () => {
  it('does not offer "Flush and Insert" for a collection subject to the coherence judgement', () => {
    // Requirement 1.4: `usergroups` is not in COLLECTIONS_EXCLUDED_FROM_COHERENCE, so
    // replacing it while other collections are appended would build the mixed
    // assignment the receiving side's coherence guard (task 9.1) refuses.
    render(<Harness allCollectionNames={['usergroups']} />);

    const menu = menuIn(cardFor('usergroups'));
    expect(menu.getByText('Insert')).toBeInTheDocument();
    expect(menu.getByText('Upsert')).toBeInTheDocument();
    expect(menu.queryByText('Flush and Insert')).not.toBeInTheDocument();
  });

  it('keeps "configs" replace-only, unchanged by the narrowing', () => {
    // configs is in COLLECTIONS_EXCLUDED_FROM_COHERENCE -- the receiving side forces
    // its method regardless, so its choices must stay exactly as before.
    render(<Harness allCollectionNames={['configs']} />);

    const menu = menuIn(cardFor('configs'));
    expect(menu.getByText('Flush and Insert')).toBeInTheDocument();
    expect(menu.queryByText('Insert')).not.toBeInTheDocument();
    expect(menu.queryByText('Upsert')).not.toBeInTheDocument();
  });

  it('keeps "pages" at its existing upsert/replace choice, unchanged by the narrowing', () => {
    // pages is also in COLLECTIONS_EXCLUDED_FROM_COHERENCE (it cannot be a plain
    // insert), so "Flush and Insert" staying offered here is correct, not a miss.
    render(<Harness allCollectionNames={['pages']} />);

    const menu = menuIn(cardFor('pages'));
    expect(menu.getByText('Upsert')).toBeInTheDocument();
    expect(menu.getByText('Flush and Insert')).toBeInTheDocument();
    expect(menu.queryByText('Insert')).not.toBeInTheDocument();
  });
});
