import { expect, test } from '@playwright/test';

import { collapseSidebar } from '../utils';

test.describe('Access to sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await collapseSidebar(page, false);
  });

  test('Successfully show sidebar', async ({ page }) => {
    await expect(page.getByTestId('grw-sidebar-contents')).toBeVisible();
  });

  test('Successfully access to page tree', async ({ page }) => {
    await page.getByTestId('grw-sidebar-nav-primary-page-tree').click();
    await expect(page.getByTestId('grw-sidebar-contents')).toBeVisible();
    await expect(
      page.getByTestId('grw-pagetree-item-container').first(),
    ).toBeVisible();
  });

  test('Successfully access to recent changes', async ({ page }) => {
    await page.getByTestId('grw-sidebar-nav-primary-recent-changes').click();
    await expect(page.getByTestId('grw-recent-changes')).toBeVisible();
    await expect(page.locator('.list-group-item').first()).toBeVisible();
  });

  test('Successfully access to custom sidebar', async ({ page }) => {
    await page.getByTestId('grw-sidebar-nav-primary-custom-sidebar').click();
    await expect(page.getByTestId('grw-sidebar-contents')).toBeVisible();
    await expect(
      page.locator('.grw-sidebar-content-header > h3').locator('a'),
    ).toBeVisible();
  });

  test('Successfully access to GROWI Docs page', async ({ page }) => {
    const linkElement = page.locator(
      '.grw-sidebar-nav-secondary-container a[href*="https://docs.growi.org"]',
    );
    const docsUrl = await linkElement.getAttribute('href');
    if (docsUrl == null) {
      throw new Error('url is null');
    }
    const response = await page.request.get(docsUrl);
    const body = await response.text();
    expect(body).toContain('</html>');
  });

  test('Successfully access to trash page', async ({ page }) => {
    await page
      .locator('.grw-sidebar-nav-secondary-container a[href*="/trash"]')
      .click();
    await expect(page.getByTestId('trash-page-list')).toBeVisible();
  });

  //
  // Deactivate: An error occurs that cannot be reproduced in the development environment. -- Yuki Takei 2024.05.10
  //

  // it('Successfully click Add to Bookmarks button', () => {
  //   cy.waitUntil(() => {
  //     // do
  //     cy.getByTestid('grw-sidebar-contents').within(() => {
  //       cy.getByTestid('grw-pagetree-item-container').eq(1).within(() => { // against the second element
  //         cy.get('li').realHover();
  //         cy.getByTestid('open-page-item-control-btn').find('button').first().realClick();
  //       });
  //     });
  //     // wait until
  //     return cy.get('.dropdown-menu.show').then($elem => $elem.is(':visible'));
  //   });

  //   cy.get('.dropdown-menu.show').should('be.visible').within(() => {
  //     // take a screenshot for dropdown menu
  //     cy.screenshot(`${ssPrefix}page-tree-2-before-adding-bookmark`)
  //     // click add remove bookmark btn
  //     cy.getByTestid('add-bookmark-btn').click();
  //   })

  //   // show dropdown again
  //   cy.waitUntil(() => {
  //     // do
  //     cy.getByTestid('grw-sidebar-contents').within(() => {
  //       cy.getByTestid('grw-pagetree-item-container').eq(1).within(() => { // against the second element
  //         cy.get('li').realHover();
  //         cy.getByTestid('open-page-item-control-btn').find('button').first().realClick();
  //       });
  //     });
  //     // wait until
  //     return cy.get('.dropdown-menu.show').then($elem => $elem.is(':visible'));
  //   });

  //   cy.get('.dropdown-menu.show').should('be.visible').within(() => {
  //     // expect to be visible
  //     cy.getByTestid('remove-bookmark-btn').should('be.visible');
  //     // take a screenshot for dropdown menu
  //     cy.screenshot(`${ssPrefix}page-tree-2-after-adding-bookmark`);
  //   });
  // });

  // it('Successfully show duplicate page modal', () => {
  //   cy.waitUntil(() => {
  //     // do
  //     cy.getByTestid('grw-sidebar-contents').within(() => {
  //       cy.getByTestid('grw-pagetree-item-container').eq(1).within(() => { // against the second element
  //         cy.get('li').realHover();
  //         cy.getByTestid('open-page-item-control-btn').find('button').first().realClick();
  //       });
  //     });
  //     // wait until
  //     return cy.get('.dropdown-menu.show').then($elem => $elem.is(':visible'));
  //   });

  //   cy.get('.dropdown-menu.show').should('be.visible').within(() => {
  //     cy.getByTestid('open-page-duplicate-modal-btn').click();
  //   })

  //   cy.getByTestid('page-duplicate-modal').should('be.visible').within(() => {
  //     cy.get('.form-control').type('_test');

  //     cy.screenshot(`${ssPrefix}page-tree-5-duplicate-page-modal`, { blackout: blackoutOverride });

  //     cy.get('.modal-header > button').click();
  //   });
  // });

  // it('Successfully rename page', () => {
  //   cy.waitUntil(() => {
  //     // do
  //     cy.getByTestid('grw-sidebar-contents').within(() => {
  //       cy.getByTestid('grw-pagetree-item-container').eq(1).within(() => { // against the second element
  //         cy.get('li').realHover();
  //         cy.getByTestid('open-page-item-control-btn').find('button').first().realClick();
  //       });
  //     });
  //     // wait until
  //     return cy.get('.dropdown-menu.show').then($elem => $elem.is(':visible'));
  //   });

  //   cy.get('.dropdown-menu.show').should('be.visible').within(() => {
  //     cy.getByTestid('rename-page-btn').click();
  //   })

  //   cy.getByTestid('grw-sidebar-contents').within(() => {
  //     cy.getByTestid('autosize-submittable-input').type('_newname');
  //   })

  //   cy.screenshot(`${ssPrefix}page-tree-6-rename-page`, { blackout: blackoutOverride });
  // });

  // it('Successfully show delete page modal', () => {
  //   cy.waitUntil(() => {
  //     // do
  //     cy.getByTestid('grw-sidebar-contents').within(() => {
  //       cy.getByTestid('grw-pagetree-item-container').eq(1).within(() => { // against the second element
  //         cy.get('li').realHover();
  //         cy.getByTestid('open-page-item-control-btn').find('button').first().realClick();
  //       });
  //     });
  //     // wait until
  //     return cy.get('.dropdown-menu.show').then($elem => $elem.is(':visible'));
  //   });

  //   cy.get('.dropdown-menu.show').should('be.visible').within(() => {
  //     cy.getByTestid('open-page-delete-modal-btn').click();
  //   })

  //   cy.getByTestid('page-delete-modal').should('be.visible').within(() => {
  //     cy.screenshot(`${ssPrefix}page-tree-7-delete-page-modal`, { blackout: blackoutOverride });
  //     cy.get('.modal-header > button').click();
  //   });
  // });
});
