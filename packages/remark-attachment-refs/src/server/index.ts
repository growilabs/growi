import { routesFactory } from './routes/refs';

// biome-ignore lint/suspicious/noExplicitAny: ignore
const middleware = (crowi: any, app: any): void => {
  const refs = routesFactory(crowi);

  app.use('/_api/attachment-refs', refs);
};

export default middleware;
