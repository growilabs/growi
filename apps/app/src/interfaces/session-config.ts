export interface SessionConfig {
  rolling: boolean;
  secret: string;
  resave: boolean;
  saveUninitialized: boolean;
  cookie: {
    maxAge: number;
  };
  genid: (req: { path: string }) => string;
  name?: string;
  store?: unknown;
}
