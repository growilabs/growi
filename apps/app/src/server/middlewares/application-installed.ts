/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  const { appService } = crowi;

  return async (req, res, next) => {
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
