import { faker } from '@faker-js/faker';
import type { IPagePopulatedToShowRevision } from '@growi/core';
import {
  fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { mock } from 'vitest-mock-extended';


import { EditorMode } from '~/stores-universal/ui';

import { PageTitleHeader } from './PageTitleHeader';

const mocks = vi.hoisted(() => ({
  useIsUntitledPageMock: vi.fn(),
  useEditorModeMock: vi.fn(() => ({ data: EditorMode.Editor })),
}));

vi.mock('~/stores/ui', () => ({
  useIsUntitledPage: mocks.useIsUntitledPageMock,
}));
vi.mock('~/stores-universal/ui', async importOriginal => ({
  ...await importOriginal(),
  useEditorMode: mocks.useEditorModeMock,
}));

describe('PageTitleHeader Component with untitled page', () => {

  beforeAll(() => {
    mocks.useIsUntitledPageMock.mockImplementation(() => ({ data: true }));
  });

  it('should render the textbox correctly', async() => {
    // arrange
    const currentPage = mock<IPagePopulatedToShowRevision>({
      _id: faker.database.mongodbObjectId(),
      path: '/path/to/page/Untitled-1',
    });

    // act
    render(<PageTitleHeader currentPage={currentPage} />);

    // assert
    // header should be rendered
    const headerElement = screen.getByText('Untitled-1');
    const inputElement = screen.getByRole('textbox');
    const inputElementByPlaceholder = screen.getByPlaceholderText('Input page name');
    await waitFor(() => {
      expect(inputElement).toBeInTheDocument();
      expect(inputElement).toStrictEqual(inputElementByPlaceholder);
      expect(inputElement).toHaveValue(''); // empty
      expect(headerElement).toHaveClass('invisible');
    });
  });

});


describe('PageTitleHeader Component', () => {

  beforeAll(() => {
    mocks.useIsUntitledPageMock.mockImplementation(() => ({ data: false }));
  });

  it('should render the title correctly', async() => {
    // arrange
    const pageTitle = faker.lorem.slug();
    const currentPage = mock<IPagePopulatedToShowRevision>({
      _id: faker.database.mongodbObjectId(),
      path: `/path/to/page/${pageTitle}`,
    });

    // act
    render(<PageTitleHeader currentPage={currentPage} />);

    // assert
    // header should be rendered
    const headerElement = screen.getByText(pageTitle);
    await waitFor(() => {
      expect(headerElement).toBeInTheDocument();
      expect(headerElement).not.toHaveClass('invisible');
    });
    // textbox should not be rendered
    const inputElement = screen.queryByRole('textbox');
    expect(inputElement).not.toBeInTheDocument();
  });

  it('should render text input after clicking', async() => {
    // arrange
    const pageTitle = faker.lorem.slug();
    const currentPage = mock<IPagePopulatedToShowRevision>({
      _id: faker.database.mongodbObjectId(),
      path: `/path/to/page/${pageTitle}`,
    });

    // act
    render(<PageTitleHeader currentPage={currentPage} />);

    const headerElement = screen.getByText(pageTitle);
    await waitFor(() => expect(headerElement).toBeInTheDocument());

    // click
    fireEvent.click(headerElement);

    // assert
    const inputElement = screen.getByRole('textbox');
    await waitFor(() => {
      expect(inputElement).toBeInTheDocument();
      expect(inputElement).toHaveValue(pageTitle);
      expect(headerElement).toHaveClass('invisible');
    });
  });

});
