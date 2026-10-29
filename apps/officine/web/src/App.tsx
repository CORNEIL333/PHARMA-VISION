import { Component, lazy, Suspense, type ReactNode } from 'react';
import { AppShell, useTheme } from './components/shell/AppShell';
import { allowed, NAV } from './components/shell/nav';
import { Button } from './components/ui/button';
import { ErrorState, LoadingRows } from './components/ui/misc';
import { fr } from './i18n/fr';
import { Link, RouterProvider, useRouter } from './lib/router';
import { SessionProvider, useSession } from './lib/session';
import { Login } from './screens/Login';
import { Setup } from './screens/Setup';

const Cashier = lazy(() => import('./screens/Cashier'));
const Products = lazy(() => import('./screens/Products'));
const Reception = lazy(() => import('./screens/Reception'));
const Orders = lazy(() => import('./screens/Orders'));
const Inventory = lazy(() => import('./screens/Inventory'));
const Recalls = lazy(() => import('./screens/Recalls'));
const Demand = lazy(() => import('./screens/Demand'));
const Reports = lazy(() => import('./screens/Reports'));
const CashClose = lazy(() => import('./screens/CashClose'));
const Accounts = lazy(() => import('./screens/Accounts'));
const System = lazy(() => import('./screens/System'));
const Dossier = lazy(() => import('./screens/Dossier'));

const SCREENS: Record<string, () => ReactNode> = {
  '/caisse': () => <Cashier />,
  '/produits': () => <Products />,
  '/reception': () => <Reception />,
  '/commandes': () => <Orders />,
  '/inventaire': () => <Inventory />,
  '/rappels': () => <Recalls />,
  '/demandes': () => <Demand />,
  '/rapports': () => <Reports />,
  '/cloture': () => <CashClose />,
  '/comptes': () => <Accounts />,
  '/systeme': () => <System />,
  '/dossier': () => <Dossier />,
};

/** UI-16 : une erreur d'écran n'emporte pas toute l'application. */
class ScreenBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean; key: string }> {
  override state = { failed: false, key: this.props.resetKey };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  static getDerivedStateFromProps(p: { resetKey: string }, s: { failed: boolean; key: string }) {
    return p.resetKey !== s.key ? { failed: false, key: p.resetKey } : null;
  }
  override render() {
    if (this.state.failed) return <ErrorState message={fr.states.crash} onRetry={() => this.setState({ failed: false })} />;
    return this.props.children;
  }
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-muted">{body}</p>
      <Button asChild variant="secondary">
        <Link to="/caisse">{fr.states.home}</Link>
      </Button>
    </div>
  );
}

function Routes() {
  const { path } = useRouter();
  const { can } = useSession();
  const target = path === '/' ? '/caisse' : path;
  const item = NAV.find((n) => n.path === target);
  const screen = SCREENS[target];
  let content: ReactNode;
  if (!item || !screen) content = <Message title={fr.states.notFound} body={fr.states.notFoundBody} />;
  else if (!allowed(item, can)) content = <Message title={fr.states.forbidden} body={fr.states.forbiddenBody} />;
  else content = screen();
  return (
    <ScreenBoundary resetKey={target}>
      <Suspense fallback={<LoadingRows rows={8} />}>{content}</Suspense>
    </ScreenBoundary>
  );
}

function Gate() {
  useTheme();
  const { status, me, loading } = useSession();
  if (loading || !status) {
    return (
      <div className="mx-auto max-w-md pt-24">
        <LoadingRows rows={4} />
      </div>
    );
  }
  // I-02 : sans titulaire, tout renvoie vers la configuration initiale.
  if (!status.setup_done) return <Setup />;
  if (!me || me.restriction) return <Login />;
  return (
    <AppShell>
      <Routes />
    </AppShell>
  );
}

export function App() {
  return (
    <RouterProvider>
      <SessionProvider>
        <Gate />
      </SessionProvider>
    </RouterProvider>
  );
}
