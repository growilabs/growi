context('Access to page', () => {
  const ssPrefix = 'access-to-page-';

  beforeEach(() => {
    // login
    cy.fixture("user-admin.json").then(user => {
      cy.login(user.username, user.password);
    });
    // collapse sidebar
    cy.collapseSidebar(true);
  });

  it('/Sandbox is successfully loaded', () => {
    cy.visit('/Sandbox', {  });
    cy.screenshot(`${ssPrefix}-sandbox`);
  });

  it('/Sandbox with anchor hash is successfully loaded', () => {
    cy.visit('/Sandbox#Headers');
    cy.waitUntilSkeletonDisappear();

    // for check download toc data
    cy.get('.toc-link').should('be.visible');

    // hide fab // disable fab for sticky-events warning
    // cy.getByTestid('grw-fab-container').invoke('attr', 'style', 'display: none');

    // remove animation for screenshot
    // remove 'blink' class because ::after element cannot be operated
    // https://stackoverflow.com/questions/5041494/selecting-and-manipulating-css-pseudo-elements-such-as-before-and-after-usin/21709814#21709814
    cy.get('#mdcont-headers').invoke('removeClass', 'blink');

    cy.screenshot(`${ssPrefix}-sandbox-headers`);
  });

  it('/Sandbox/Math is successfully loaded', () => {
    cy.visit('/Sandbox/Math');
    cy.waitUntilSkeletonDisappear();

    // for check download toc data
    cy.get('.toc-link').should('be.visible');

    cy.screenshot(`${ssPrefix}-sandbox-math`);
  });

  it('/Sandbox with edit is successfully loaded', () => {
    cy.visit('/Sandbox');
    cy.waitUntilSkeletonDisappear();

    cy.get('#grw-subnav-container', { timeout: 30000 }).should('be.visible').within(() => {

      // eslint-disable-next-line cypress/no-unnecessary-waiting
      cy.wait(2000);
      cy.getByTestid('editor-button', { timeout: 30000 }).should('be.visible').click();
    })
    cy.getByTestid('navbar-editor', { timeout: 30000 }).should('be.visible');
    cy.screenshot(`${ssPrefix}-Sandbox-edit-page`);
  })

  it('/user/admin is successfully loaded', () => {
    cy.visit('/user/admin', {  });

    cy.waitUntilSkeletonDisappear();
    // for check download toc data
    cy.get('.toc-link').should('be.visible');

    // eslint-disable-next-line cypress/no-unnecessary-waiting
    cy.wait(2000); // wait for calcViewHeight and rendering

    cy.screenshot(`${ssPrefix}-user-admin`);
  });

});


context('Access to /me page', () => {
  const ssPrefix = 'access-to-me-page-';

  beforeEach(() => {
    // login
    cy.fixture("user-admin.json").then(user => {
      cy.login(user.username, user.password);
    });
    // collapse sidebar
    cy.collapseSidebar(true);
  });

  it('/me is successfully loaded', () => {
    cy.visit('/me', {  });
    // eslint-disable-next-line cypress/no-unnecessary-waiting
    cy.wait(500); // wait loading image
    cy.screenshot(`${ssPrefix}-me`);
  });

  // it('Draft page is successfully shown', () => {
  //   cy.visit('/me/drafts');
  //   cy.screenshot(`${ssPrefix}-draft-page`);
  // });

});



context('Access to special pages', () => {
  const ssPrefix = 'access-to-special-pages-';

  beforeEach(() => {
    // login
    cy.fixture("user-admin.json").then(user => {
      cy.login(user.username, user.password);
    });
    // collapse sidebar
    cy.collapseSidebar(true);
  });

  it('/trash is successfully loaded', () => {
    cy.visit('/trash', {  });
    cy.getByTestid('trash-page-list').should('be.visible');
    cy.screenshot(`${ssPrefix}-trash`);
  });

  it('/tags is successfully loaded', { scrollBehavior: false } ,() => {
    // open sidebar
    // cy.collapseSidebar(false);

    cy.visit('/tags');

    // cy.getByTestid('grw-sidebar-content-tags').within(() => {
    //   cy.getByTestid('grw-tags-list').should('be.visible');
    //   cy.getByTestid('grw-tags-list').contains('You have no tag, You can set tags on pages');
    // })

    cy.getByTestid('tags-page').within(() => {
      cy.getByTestid('grw-tags-list').should('be.visible');
      cy.getByTestid('grw-tags-list').contains('You have no tag, You can set tags on pages');
    });

    cy.screenshot(`${ssPrefix}-tags`);
  });

});

context('Access to Template Editing Mode', () => {
  const ssPrefix = 'access-to-modal-';

  beforeEach(() => {
    // login
    cy.fixture("user-admin.json").then(user => {
      cy.login(user.username, user.password);
    });
    // collapse sidebar
    cy.collapseSidebar(true);
  });

  // TODO: 109057
  // it('Access to Template Editor mode for only child pages successfully', () => {
  //   cy.visit('/Sandbox/Bootstrap4', {  });
  //   cy.waitUntilSkeletonDisappear();

  //   cy.get('#grw-subnav-container').within(() => {
  //     cy.getByTestid('open-page-item-control-btn').should('be.visible');
  //     cy.getByTestid('open-page-item-control-btn').click();
  //     cy.getByTestid('open-page-template-modal-btn').should('be.visible');
  //     cy.getByTestid('open-page-template-modal-btn').click();
  //   });

  //   cy.getByTestid('page-template-modal').should('be.visible');
  //   cy.screenshot(`${ssPrefix}-open-page-template-bootstrap4`);

  // Todo: `@`alias may be changed. This code was made in an attempt to solve the error of element being dettached from the dom which couldn't be solved at this time.
  // Wait for Todo: 109057 is solved and fix or leave the code below for better test code.
  //   cy.getByTestid('template-button-children').as('template-button-children');
  //   cy.get('@template-button-children').should('be.visible').click();
  //   cy.waitUntilSkeletonDisappear();

  //   cy.getByTestid('navbar-editor').should('be.visible').then(()=>{
  //     cy.url().should('include', '/_template#edit');
  //     cy.screenshot();
  //   });
  // });

  // TODO: 109057
  // it('Access to Template Editor mode including decendants successfully', () => {
  //   cy.visit('/Sandbox/Bootstrap4', {  });
  //   cy.waitUntilSkeletonDisappear();

  //   cy.get('#grw-subnav-container').within(() => {
  //     cy.getByTestid('open-page-item-control-btn').should('be.visible');
  //     cy.getByTestid('open-page-item-control-btn').click();
  //     cy.getByTestid('open-page-template-modal-btn').should('be.visible');
  //     cy.getByTestid('open-page-template-modal-btn').click();
  //   });
  //   cy.getByTestid('page-template-modal').should('be.visible');

  // Todo: `@`alias may be changed. This code was made in an attempt to solve the error of element being dettached from the dom which couldn't be solved at this time.
  // Wait for Todo: 109057 is solved and fix or leave the code below for better test code.
  //   cy.getByTestid('template-button-decendants').as('template-button-decendants');
  //   cy.get('@template-button-decendants').should('be.visible').click();
  //   cy.waitUntilSkeletonDisappear();

  //   cy.getByTestid('navbar-editor').should('be.visible').then(()=>{
  //     cy.url().should('include', '/__template#edit');
  //     cy.screenshot();
  //   });
  // });

});

context('Access to /me/all-in-app-notifications', () => {
  const ssPrefix = 'in-app-notifications-';

  beforeEach(() => {
    // login
    cy.fixture("user-admin.json").then(user => {
      cy.login(user.username, user.password);
    });
    // collapse sidebar
    cy.collapseSidebar(true);
  });

  it('All In-App Notification list is successfully loaded', { scrollBehavior: false },() => {
    cy.visit('/');
    cy.get('.notification-wrapper').click();
    cy.get('.notification-wrapper > .dropdown-menu > a').click();

    cy.getByTestid('grw-in-app-notification-page').should('be.visible');
    cy.getByTestid('grw-in-app-notification-page-spinner').should('not.exist');

    cy.screenshot(`${ssPrefix}-see-all`, { capture: 'viewport' });

    cy.get('.grw-custom-nav-tab > div > ul > li:nth-child(2) > a').click();
    cy.getByTestid('grw-in-app-notification-page-spinner').should('not.exist');

    cy.screenshot(`${ssPrefix}-see-unread`, { capture: 'viewport' });
   });

})
