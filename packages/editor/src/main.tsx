import React from 'react';
import ReactDOM from 'react-dom/client';
import { ToastContainer } from 'react-toastify';

import { Playground } from './client/components-internal/playground';

import './main.scss';

const rootElem = document.getElementById('root');

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
ReactDOM.createRoot(rootElem!).render(
  <React.StrictMode>
    <Playground />
    <ToastContainer />
  </React.StrictMode>,
);
