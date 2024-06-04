function openEditor() {
  cy.get('#grw-page-editor-mode-manager').as('pageEditorModeManager').should('be.visible');
  cy.waitUntil(() => {
    // do
    cy.get('@pageEditorModeManager').within(() => {
      cy.get('button:nth-child(2)').click();
    });
    // until
    return cy.get('.layout-root').then($elem => $elem.hasClass('editing'));
  });
  cy.get('.CodeMirror').should('be.visible');
}

context('Access to page', () => {
  const ssPrefix = 'access-to-page-';

  beforeEach(() => {
    // login
    cy.fixture("user-admin.json").then(user => {
      cy.login(user.username, user.password);
    });
  });

  // TODO: https://redmine.weseek.co.jp/issues/109939
  it('/Sandbox with anchor hash is successfully loaded', () => {
    cy.visit('/Sandbox#headers');
    cy.collapseSidebar(true);

    // for check download toc data
    // https://redmine.weseek.co.jp/issues/111384
    // cy.get('.toc-link').should('be.visible');

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

    cy.getByTestid('navbar-editor').should('be.visible');
    cy.get('.grw-editor-navbar-bottom').should('be.visible');
    cy.getByTestid('save-page-btn').should('be.visible');
    cy.get('.grw-grant-selector').should('be.visible');

    cy.waitUntilSkeletonDisappear();
    cy.screenshot(`${ssPrefix}-Sandbox-edit-page`);
  })

  const body1 = 'hello';
  const body2 = ' world!';
  it('Edit and save with save-page-btn', () => {
    cy.visit('/Sandbox/testForUseEditingMarkdown');

    openEditor();

    // check edited contents after save
    cy.appendTextToEditorUntilContains(body1);
    cy.get('.page-editor-preview-body').should('contain.text', body1);
    cy.getByTestid('page-editor').should('be.visible');
    cy.getByTestid('save-page-btn').click();
    cy.get('.wiki').should('be.visible');
    cy.get('.wiki').children().first().should('have.text', body1);
    cy.screenshot(`${ssPrefix}-edit-and-save-with-save-page-btn`);
  })

  it('Edit and save with shortcut key', () => {
    const savePageShortcutKey = '{ctrl+s}';

    cy.visit('/Sandbox/testForUseEditingMarkdown');

    openEditor();

    // check editing contents with shortcut key
    cy.appendTextToEditorUntilContains(body2);
    cy.get('.page-editor-preview-body').should('contain.text', body1+body2);
    cy.get('.CodeMirror').click().type(savePageShortcutKey);
    cy.get('.CodeMirror-code').should('contain.text', body1+body2);
    cy.get('.page-editor-preview-body').should('contain.text', body1+body2);
    cy.screenshot(`${ssPrefix}-edit-and-save-with-shortcut-key`);
  })

  it('/user/admin is successfully loaded', () => {
    cy.visit('/user/admin');
    cy.collapseSidebar(true);

    // for check download toc data
    // https://redmine.weseek.co.jp/issues/111384
    // cy.get('.toc-link').should('be.visible');

    // eslint-disable-next-line cypress/no-unnecessary-waiting
    cy.wait(2000); // wait for calcViewHeight and rendering
    cy.waitUntilSkeletonDisappear();
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
  });

  it('/me is successfully loaded', () => {
    cy.visit('/me');

    cy.getByTestid('grw-user-settings').should('be.visible');

    cy.collapseSidebar(true);
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
  });

  it('/trash is successfully loaded', () => {
    cy.visit('/trash');

    cy.getByTestid('trash-page-list').should('contain.text', 'There are no pages under this page.');

    cy.collapseSidebar(true);
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
      cy.getByTestid('grw-tags-list').should('contain.text', 'You have no tag, You can set tags on pages');
    });

    cy.collapseSidebar(true);
    cy.screenshot(`${ssPrefix}-tags`);
  });

});

context('Access to Template Editing Mode', () => {
  const ssPrefix = 'access-to-template-page-';
  const templateBody1 = 'Template for children';
  const templateBody2 = 'Template for descendants';

  const createPageFromPageTreeTest = (newPagePath: string, parentPagePath: string, expectedBody: string) => {
    cy.visit('/');
    cy.waitUntilSkeletonDisappear();

    // Open sidebar
    cy.collapseSidebar(false);
    cy.getByTestid('grw-sidebar-contents').should('be.visible');
    cy.waitUntilSkeletonDisappear();

    // If PageTree is not active when the sidebar is opened, make it active
    cy.getByTestid('grw-sidebar-nav-primary-page-tree').should('be.visible')
      .then($elem => {
        if (!$elem.hasClass('active')) {
          cy.getByTestid('grw-sidebar-nav-primary-page-tree').click();
        }
      });

    // Create page (/{parentPath}}/{newPagePath}) from PageTree
    cy.getByTestid('grw-sidebar-contents').within(() => {
      cy.get('.grw-pagetree-item-children').first().as('pagetreeItem').within(() => {
        cy.get('#page-create-button-in-page-tree').first().click({force: true})
      });
    });
    cy.get('@pagetreeItem').within(() => {
      cy.getByTestid('autosize-submittable-input').type(newPagePath).type('{enter}');
    })

    cy.visit(`/${parentPagePath}/${newPagePath}`);
    cy.collapseSidebar(true);

    cy.getByTestid('grw-contextual-sub-nav').should('be.visible');
    cy.waitUntilSkeletonDisappear();

    // Check if the template is applied
    cy.getByTestid('search-result-base').within(() => {
      cy.get('.wiki').should('be.visible');
      cy.get('.wiki').children().first().should('have.text', expectedBody);
    })

    cy.screenshot(`${ssPrefix}-page(${newPagePath})-to-which-template-is-applied`)
  }

  beforeEach(() => {
    // login
    cy.fixture("user-admin.json").then(user => {
      cy.login(user.username, user.password);
    });
  });

  it("Successfully created template for children", () => {
    cy.visit('/Sandbox');
    cy.waitUntilSkeletonDisappear();

    cy.waitUntil(() => {
      // do
      cy.getByTestid('grw-contextual-sub-nav').within(() => {
        cy.getByTestid('open-page-item-control-btn').find('button').click({force: true});
      });
      // wait until
      return cy.getByTestid('page-item-control-menu').then($elem => $elem.is(':visible'))
    });

    cy.getByTestid('open-page-template-modal-btn').filter(':visible').click({force: true});
    cy.getByTestid('page-template-modal').should('be.visible');
    cy.screenshot(`${ssPrefix}-open-page-template-modal`);

    cy.getByTestid('template-button-children').click(({force: true}))
    cy.waitUntilSkeletonDisappear();

    cy.getByTestid('navbar-editor').should('be.visible').then(()=>{
      cy.url().should('include', '/_template#edit');
      cy.screenshot(`${ssPrefix}-open-template-page-for-children-in-editor-mode`);
    });

    cy.appendTextToEditorUntilContains(templateBody1);
    cy.get('.page-editor-preview-body').should('contain.text', templateBody1);
    cy.getByTestid('page-editor').should('be.visible');
    cy.getByTestid('save-page-btn').click();
  });

  it('Template is applied to pages created from PageTree (template for children 1)', () => {
    createPageFromPageTreeTest('template-test-page1', '/Sandbox' ,templateBody1);
  });

  it('Successfully created template for descendants', () => {
    cy.visit('/Sandbox');
    cy.waitUntilSkeletonDisappear();

    cy.waitUntil(() => {
      // do
      cy.getByTestid('grw-contextual-sub-nav').within(() => {
        cy.getByTestid('open-page-item-control-btn').find('button').click({force: true});
      });
      // Wait until
      return cy.getByTestid('page-item-control-menu').then($elem => $elem.is(':visible'))
    });

    cy.getByTestid('open-page-template-modal-btn').filter(':visible').click({force: true});
    cy.getByTestid('page-template-modal').should('be.visible');

    cy.getByTestid('template-button-descendants').click(({force: true}))
    cy.waitUntilSkeletonDisappear();

    cy.getByTestid('navbar-editor').should('be.visible').then(()=>{
      cy.url().should('include', '/__template#edit');
      cy.screenshot(`${ssPrefix}-open-template-page-for-descendants-in-editor-mode`);
    })

    cy.appendTextToEditorUntilContains(templateBody2);
    cy.get('.page-editor-preview-body').should('contain.text', templateBody2);
    cy.getByTestid('page-editor').should('be.visible');
    cy.getByTestid('save-page-btn').click();
  });

  it('Template is applied to pages created from PageTree (template for children 2)', () => {
    createPageFromPageTreeTest('template-test-page2','Sandbox',templateBody1);
  });

  it('Template is applied to pages created from PageTree (template for descendants)', () => {
    // delete /Sandbox/_template
    cy.visit('/Sandbox/_template');

    cy.waitUntil(() => {
      //do
      cy.getByTestid('grw-contextual-sub-nav').within(() => {
        cy.getByTestid('open-page-item-control-btn').find('button').click({force: true});
      });
      // wait until
      return cy.getByTestid('page-item-control-menu').then($elem => $elem.is(':visible'))
    });

    cy.getByTestid('open-page-delete-modal-btn').filter(':visible').click({force: true});

    cy.getByTestid('page-delete-modal').should('be.visible').within(() => {
      cy.intercept('POST', '/_api/pages.remove').as('remove');
      cy.getByTestid('delete-page-button').click();
      cy.wait('@remove')
    });

    createPageFromPageTreeTest('template-test-page3','Sandbox',`${templateBody1}\n${templateBody2}`);
  })
});

context('Access to /me/all-in-app-notifications', () => {
  const ssPrefix = 'in-app-notifications-';

  beforeEach(() => {
    // login
    cy.fixture("user-admin.json").then(user => {
      cy.login(user.username, user.password);
    });
  });

  it('All In-App Notification list is successfully loaded', { scrollBehavior: false },() => {
    cy.visit('/');
    cy.get('.notification-wrapper').click();
    cy.get('.notification-wrapper > .dropdown-menu > a').click();

    cy.getByTestid('grw-in-app-notification-page').should('be.visible');
    cy.getByTestid('grw-in-app-notification-page-spinner').should('not.exist');

    cy.collapseSidebar(true);
    cy.screenshot(`${ssPrefix}-see-all`);

    cy.get('.grw-custom-nav-tab > div > ul > li:nth-child(2) > a').click();
    cy.getByTestid('grw-in-app-notification-page-spinner').should('not.exist');

    cy.collapseSidebar(true);
    cy.screenshot(`${ssPrefix}-see-unread`);
   });

})
