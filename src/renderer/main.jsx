import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Overlay from './Overlay.jsx';
import './App.module.scss';

const view = new URLSearchParams(location.search).get('view');
if (view === 'capture') {
  import('./capture.js');
} else {
  document.body.dataset.view = view === 'overlay' ? 'overlay' : 'hub';
  createRoot(document.getElementById('root')).render(view === 'overlay' ? <Overlay /> : <App />);
}
