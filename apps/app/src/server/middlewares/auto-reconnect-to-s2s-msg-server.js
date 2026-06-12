export const setup = (crowi) => {
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
