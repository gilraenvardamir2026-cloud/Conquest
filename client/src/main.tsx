import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Home } from './Home';
import { connect } from './net';
import { ROUTE } from './route';
import './styles.css';

if (ROUTE.page === 'room') connect(ROUTE.code);

createRoot(document.getElementById('root')!).render(
  <StrictMode>{ROUTE.page === 'home' ? <Home error={ROUTE.error} /> : <App />}</StrictMode>,
);
