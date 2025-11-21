/** @param {import('~/server/crowi').default} crowi Crowi instance */
module.exports = (crowi) => {
  const { s2sMessagingService } = crowi;

  return (req, res, next) => {
    if (
      s2sMessagingService != null &&
      s2sMessagingService.shouldResubscribe()
    ) {
      s2sMessagingService.subscribe();
    }

    return next();
  };
};
