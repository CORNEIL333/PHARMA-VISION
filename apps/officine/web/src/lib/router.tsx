import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/** Routeur minimal (History API) : aucune dépendance de plus que la liste autorisée. */
interface RouterValue {
  path: string;
  params: URLSearchParams;
  navigate: (to: string, opts?: { replace?: boolean }) => void;
}

const Ctx = createContext<RouterValue>({ path: '/', params: new URLSearchParams(), navigate: () => undefined });

const current = () => ({ path: window.location.pathname, search: window.location.search });

export function RouterProvider({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState(current);
  useEffect(() => {
    const on = () => setLoc(current());
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    if (opts?.replace) window.history.replaceState(null, '', to);
    else if (to !== window.location.pathname + window.location.search) window.history.pushState(null, '', to);
    setLoc(current());
  }, []);
  const value = useMemo(() => ({ path: loc.path, params: new URLSearchParams(loc.search), navigate }), [loc, navigate]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useRouter = () => useContext(Ctx);

export function Link({ to, className, children, ...rest }: { to: string; className?: string; children: ReactNode } & Record<string, unknown>) {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
