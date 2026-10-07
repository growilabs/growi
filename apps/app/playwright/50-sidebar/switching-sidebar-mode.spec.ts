import { test } from '@playwright/test';

import { collapseSidebar } from '../utils';

test('Switch sidebar mode', async ({ page }) => {
  await page.goto('/');
  await collapseSidebar(page, false);
  await collapseSidebar(page, true);
});

// Write tests using VRT
// context('Switch viewport size', () => {
//   const ssPrefix = 'switch-viewport-size-';

//   const sizes = {
//     'xl': [1200, 1024],
//     'lg': [992, 1024],
//     'md': [768, 1024],
//     'sm': [576, 1024],
//     'xs': [575, 1024],
//     'iphone-x': [375, 812],
//   };

//   Object.entries(sizes).forEach(([screenLabel, size]) => {
//     it(`on ${screenLabel} screen`, () => {
//       cy.viewport(size[0], size[1]);

//       // login
//       cy.fixture("user-admin.json").then(user => {
//         cy.login(user.username, user.password);
//       });
//       cy.visit('/');

//       cy.get('.layout-root').should('be.visible');

//       cy.screenshot(`${ssPrefix}-${screenLabel}`, {
//         blackout: blackoutOverride,
//       });
//     });
//   });

// });
