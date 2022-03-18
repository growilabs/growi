context('Access to legacy private pages directly', () => {
  const ssPrefix = 'access-to-legacy-private-pages-directly-';

  let connectSid: string | undefined;

  before(() => {
    // login
    cy.fixture("user-admin.json").then(user => {
      cy.login(user.username, user.password);
    });
    cy.getCookie('connect.sid').then(cookie => {
      connectSid = cookie?.value;
    });
    // collapse sidebar
    cy.collapseSidebar(true);
  });

  beforeEach(() => {
    if (connectSid != null) {
      cy.setCookie('connect.sid', connectSid);
    }
  });

  it('/_private-legacy-pages is successfully loaded', () => {
    cy.visit('/_private-legacy-pages');

    cy.getByTestid('search-result-base').should('be.visible');

    cy.screenshot(`${ssPrefix}-shown`);
  });

});
