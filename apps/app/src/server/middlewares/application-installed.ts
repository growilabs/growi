/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  const { appService } = crowi;

  // Named function so the route-middleware snapshot tool can identify this
  // handler in the apiv3 auth chain.
  return async function applicationInstalled(req, res, next) {
    const isDBInitialized = await appService.isDBInitialized();

    // when already installed
    if (isDBInitialized) {
      return next();
    }

    // when other server have initialized DB
    const isDBInitializedAfterForceReload =
      await appService.isDBInitialized(true);
    if (isDBInitializedAfterForceReload) {
      await appService.setupAfterInstall();
      return res.safeRedirect(req.originalUrl);
    }

    return res.redirect('/installer');
  };
};
