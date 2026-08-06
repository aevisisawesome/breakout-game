import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './ui/App.tsx';
import './ui/terminal.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('BREAK//OUT: #root element missing from index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
