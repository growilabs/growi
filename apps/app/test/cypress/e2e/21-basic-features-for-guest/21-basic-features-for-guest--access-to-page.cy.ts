context('Access to page by guest', () => {
  const ssPrefix = 'access-to-page-by-guest-';

  it('/Sandbox is successfully loaded', () => {
    cy.visit('/Sandbox');
    cy.waitUntilSkeletonDisappear();

    cy.collapseSidebar(true, true);
    cy.screenshot(`${ssPrefix}-sandbox`);
  });

  // TODO: https://redmine.weseek.co.jp/issues/109939
  it('/Sandbox with anchor hash is successfully loaded', () => {
    cy.visit('/Sandbox#headers');
    cy.collapseSidebar(true);

    // hide fab
    cy.getByTestid('grw-fab-container').invoke('attr', 'style', 'display: none');

    // assert the element is in viewport
    cy.get('#headers').should('be.inViewport');

    // remove animation for screenshot
    // remove 'blink' class because ::after element cannot be operated
    // https://stackoverflow.com/questions/5041494/selecting-and-manipulating-css-pseudo-elements-such-as-before-and-after-usin/21709814#21709814
    cy.get('#headers').invoke('removeClass', 'blink');

    cy.waitUntilSkeletonDisappear();
    cy.screenshot(`${ssPrefix}-sandbox-headers`);
  });

  it('/Sandbox/Math is successfully loaded', () => {
    cy.visit('/Sandbox/Math');
    cy.collapseSidebar(true);

    // for check download toc data
    // https://redmine.weseek.co.jp/issues/111384
    // cy.get('.toc-link').should('be.visible');

    cy.get('.math').should('be.visible');

    cy.waitUntilSkeletonDisappear();
    cy.screenshot(`${ssPrefix}-sandbox-math`);
  });

  it('/Sandbox with edit is successfully loaded', () => {
    cy.visit('/Sandbox#edit');
    cy.collapseSidebar(true);

    cy.waitUntilSkeletonDisappear();
    cy.screenshot(`${ssPrefix}-sandbox-with-edit-hash`);
  })

});


context('Access to /me page', () => {
  const ssPrefix = 'access-to-me-page-by-guest-';

  it('/me should be redirected to /login', () => {
    cy.visit('/me');
    cy.getByTestid('login-form').should('be.visible');
    cy.screenshot(`${ssPrefix}-me`);
  });

});


context('Access to special pages by guest', () => {
  const ssPrefix = 'access-to-special-pages-by-guest-';

  it('/trash is successfully loaded', () => {
    cy.visit('/trash', {  });
    cy.getByTestid('trash-page-list').should('be.visible');
    cy.collapseSidebar(true);
    cy.screenshot(`${ssPrefix}-trash`);
  });

  it('/tags is successfully loaded', () => {
    cy.visit('/tags');

    // open sidebar
    cy.collapseSidebar(false);
    // select tags
    cy.getByTestid('grw-sidebar-nav-primary-tags').click();
    cy.getByTestid('grw-sidebar-content-tags').should('be.visible');
    cy.getByTestid('grw-tags-list').should('be.visible');
    cy.getByTestid('grw-tags-list').contains('You have no tag, You can set tags on pages');

    cy.getByTestid('tags-page').should('be.visible');
    cy.screenshot(`${ssPrefix}-tags`);
  });

});
