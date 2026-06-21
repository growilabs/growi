import React from 'react';
import ReactDOM from 'react-dom/client';
import { ToastContainer } from 'react-toastify';

import { Playground } from './client/components-internal/playground';

import './main.scss';

const rootElem = document.getElementById('root');

if (rootElem === null) {
  throw new Error('Failed to find the root element');
}

ReactDOM.createRoot(rootElem).render(
  <React.StrictMode>
    <Playground />
    <ToastContainer />
  </React.StrictMode>,
);
