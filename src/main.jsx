import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import MangaApp from './manga/MangaApp.jsx';
import './styles.css';

function AppRoute() {
  const [isMangaRoute, setIsMangaRoute] = useState(() => window.location.hash === '#/manga');

  useEffect(() => {
    const updateRoute = () => setIsMangaRoute(window.location.hash === '#/manga');
    window.addEventListener('hashchange', updateRoute);
    return () => window.removeEventListener('hashchange', updateRoute);
  }, []);

  return isMangaRoute ? <MangaApp /> : <App />;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppRoute />
  </StrictMode>
);
