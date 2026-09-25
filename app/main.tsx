import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Home from './page';
import './globals.css';
import './redesign.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode><Home orderPage={/^\/order\/?$/.test(window.location.pathname)} /></StrictMode>,
);
