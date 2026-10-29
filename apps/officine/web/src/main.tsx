import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import { App } from './App';
import './styles/app.css';

/** Notifications au thème de l'application (classe dark/light sur <html>), contraste AA. */
function ThemedToaster() {
  const read = () => (document.documentElement.classList.contains('light') ? 'light' : 'dark');
  const [theme, setTheme] = useState<'light' | 'dark'>(read);
  useEffect(() => {
    const o = new MutationObserver(() => setTheme(read()));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => o.disconnect();
  }, []);
  return <Toaster position="bottom-right" theme={theme} closeButton />;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 },
    mutations: { retry: false },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipPrimitive.Provider>
        <App />
        <ThemedToaster />
      </TooltipPrimitive.Provider>
    </QueryClientProvider>
  </StrictMode>,
);
