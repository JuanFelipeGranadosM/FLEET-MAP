import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { FinanceView } from './finance/FinanceView';
import './styles.css';

const qc = new QueryClient({ defaultOptions: { queries: { retry: 2, refetchOnWindowFocus: false } } });

// #facturacion abre el tablero de facturación; cualquier otro hash, el mapa.
function Root() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => { const on = () => setHash(location.hash); addEventListener('hashchange', on); return () => removeEventListener('hashchange', on); }, []);
  return hash === '#facturacion' ? <FinanceView /> : <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}><Root /></QueryClientProvider>
  </StrictMode>,
);
