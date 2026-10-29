import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { Keyboard, LogOut, Moon, Pill, Search, Sun, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { fr } from '../../i18n/fr';
import { api, connection, errorMessage, setReauthHandler } from '../../lib/api';
import { Link, useRouter } from '../../lib/router';
import { useSession } from '../../lib/session';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { Dialog } from '../ui/dialog';
import { Input } from '../ui/input';
import { Field } from '../ui/label';
import { Kbd, Tip } from '../ui/misc';
import { allowed, NAV } from './nav';

// ---------------------------------------------------------------- thème

export function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('vp.theme') ?? 'dark';
    } catch {
      return 'dark';
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.classList.toggle('light', theme === 'light');
    try {
      localStorage.setItem('vp.theme', theme);
    } catch {
      /* stockage indisponible */
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

// ---------------------------------------------------------------- ré-authentification (A-07)

function ReauthDialog() {
  const [pending, setPending] = useState<{ resolve: (ok: boolean) => void } | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setReauthHandler(
      (purpose) =>
        new Promise<boolean>((resolve) => {
          setPassword('');
          setCode('');
          setError(null);
          setPending({ resolve });
          void purpose;
        }),
    );
    return () => setReauthHandler(null);
  }, []);
  const finish = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };
  const submit = async () => {
    setBusy(true);
    try {
      await api('/auth/reauth', { method: 'POST', body: { password, ...(code ? { code } : {}) }, noReauth: true });
      finish(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(o) => !o && finish(false)}
      title={fr.reauth.title}
      description={fr.reauth.description}
      footer={
        <>
          <Button variant="ghost" onClick={() => finish(false)}>
            {fr.common.cancel}
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !password}>
            {fr.reauth.submit}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field id="reauth-password" label={fr.reauth.password} error={error}>
          <Input id="reauth-password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field id="reauth-code" label={fr.reauth.code}>
          <Input id="reauth-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <button type="submit" className="hidden" />
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------- palette Ctrl/⌘K

interface PaletteAction {
  label: string;
  path: string;
  any: string[];
}

const ACTIONS: PaletteAction[] = [
  { label: fr.palette.newReception, path: '/reception', any: ['stock.receive'] },
  { label: fr.palette.closeRegister, path: '/cloture', any: ['sale.sell'] },
  { label: fr.palette.newRecall, path: '/rappels?nouveau=1', any: ['recall.create'] },
  { label: fr.palette.newInventory, path: '/inventaire', any: ['inventory.count'] },
  { label: fr.palette.verifyLedger, path: '/systeme', any: ['ledger.verify'] },
  { label: fr.palette.backupNow, path: '/systeme', any: ['backup.create'] },
];

function Palette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { can } = useSession();
  const { navigate } = useRouter();
  const [q, setQ] = useState('');
  const products = useQuery({
    queryKey: ['palette-products', q],
    enabled: open && q.trim().length >= 2,
    queryFn: () => api<{ items: { id: string; name: string; strength: string | null; status: string }[] }>('/products', { query: { q, limit: 8 } }),
  });
  const go = (path: string) => {
    onOpenChange(false);
    setQ('');
    navigate(path);
  };
  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label={fr.nav.palette}
      shouldFilter={false}
      overlayClassName="fixed inset-0 z-40 bg-black/50"
      contentClassName="fixed left-1/2 top-[12vh] z-50 w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-vp border border-border bg-surface shadow-2xl"
    >
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search aria-hidden className="size-4 text-muted" />
        <Command.Input value={q} onValueChange={setQ} placeholder={fr.palette.placeholder} className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted" />
      </div>
      <Command.List className="max-h-[60vh] overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-muted">{fr.palette.empty}</Command.Empty>
        <Command.Group heading={fr.palette.screens} className="text-xs text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1">
          {NAV.filter((n) => allowed(n, can) && n.label.toLowerCase().includes(q.toLowerCase())).map((n) => (
            <Command.Item key={n.path} value={n.path} onSelect={() => go(n.path)} className="flex cursor-pointer items-center gap-2 rounded-vp px-2 py-2 text-sm text-fg data-[selected=true]:bg-surface-2">
              <n.icon aria-hidden className="size-4 text-muted" /> {n.label}
            </Command.Item>
          ))}
        </Command.Group>
        <Command.Group heading={fr.palette.actions} className="text-xs text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1">
          {ACTIONS.filter((a) => a.any.some(can) && a.label.toLowerCase().includes(q.toLowerCase())).map((a) => (
            <Command.Item key={a.label} value={a.label} onSelect={() => go(a.path)} className="cursor-pointer rounded-vp px-2 py-2 text-sm text-fg data-[selected=true]:bg-surface-2">
              {a.label}
            </Command.Item>
          ))}
        </Command.Group>
        {products.data?.items.length ? (
          <Command.Group heading={fr.palette.products} className="text-xs text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1">
            {products.data.items.map((p) => (
              <Command.Item key={p.id} value={p.id} onSelect={() => go(`/produits?id=${p.id}`)} className="flex cursor-pointer items-center justify-between rounded-vp px-2 py-2 text-sm text-fg data-[selected=true]:bg-surface-2">
                <span>
                  {p.name} {p.strength ?? ''}
                </span>
                <Badge tone={p.status === 'active' ? 'accent' : 'neutral'}>{p.status}</Badge>
              </Command.Item>
            ))}
          </Command.Group>
        ) : null}
      </Command.List>
    </Command.Dialog>
  );
}

function ShortcutsHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={fr.shortcuts.title}>
      <ul className="flex flex-col gap-2">
        {fr.shortcuts.list.map(([k, v]) => (
          <li key={k} className="flex items-center justify-between gap-4">
            <span>{v}</span>
            <Kbd>{k}</Kbd>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

function OfflineBanner() {
  const [online, setOnline] = useState(true);
  useEffect(() => connection.on(setOnline), []);
  useEffect(() => {
    if (online) return;
    const id = window.setInterval(() => void api('/health').catch(() => undefined), 5000);
    return () => window.clearInterval(id);
  }, [online]);
  if (online) return null;
  return (
    <div role="alert" className="flex items-center gap-2 border-b border-danger/50 bg-danger-bg px-4 py-2 text-sm text-danger">
      <WifiOff aria-hidden className="size-4" /> {fr.states.offline}
    </div>
  );
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

// ---------------------------------------------------------------- coquille

export function AppShell({ children }: { children: ReactNode }) {
  const { me, can, logout, status } = useSession();
  const { path } = useRouter();
  const [theme, toggleTheme] = useTheme();
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const health = useQuery({ queryKey: ['health'], queryFn: () => api<{ on_duty: boolean }>('/health'), refetchInterval: 60_000 });
  const profile = useQuery({
    queryKey: ['profile-status'],
    enabled: can('settings.edit'),
    queryFn: () => api<{ complete: boolean; done: number; total: number }>('/profile/status'),
  });
  const onKey = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      setPalette((o) => !o);
    } else if (e.key === '?' && !isTyping(e)) {
      e.preventDefault();
      setHelp(true);
    }
  }, []);
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);
  return (
    <div className="flex h-full">
      <nav aria-label="Navigation principale" className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border bg-surface py-3">
        <div className="mb-2 flex size-9 items-center justify-center rounded-vp bg-accent text-accent-fg" title={fr.app.name}>
          <Pill aria-hidden className="size-5" />
        </div>
        {NAV.filter((n) => allowed(n, can)).map((n) => {
          const active = path === n.path || path.startsWith(`${n.path}/`);
          return (
            <Tip key={n.path} label={n.label}>
              <Link
                to={n.path}
                aria-label={n.label}
                aria-current={active ? 'page' : undefined}
                className={cn('vp-anim flex size-10 items-center justify-center rounded-vp text-muted hover:bg-surface-2 hover:text-fg', active && 'bg-surface-2 text-accent')}
              >
                <n.icon aria-hidden className="size-5" />
              </Link>
            </Tip>
          );
        })}
        <div className="mt-auto flex flex-col items-center gap-1">
          <Tip label={`${fr.nav.palette} (Ctrl+K)`}>
            <Button variant="ghost" size="icon" aria-label={fr.nav.palette} onClick={() => setPalette(true)}>
              <Search />
            </Button>
          </Tip>
          <Tip label={`${fr.nav.shortcuts} (?)`}>
            <Button variant="ghost" size="icon" aria-label={fr.nav.shortcuts} onClick={() => setHelp(true)}>
              <Keyboard />
            </Button>
          </Tip>
          <Tip label={fr.nav.theme}>
            <Button variant="ghost" size="icon" aria-label={fr.nav.theme} onClick={toggleTheme}>
              {theme === 'dark' ? <Sun /> : <Moon />}
            </Button>
          </Tip>
          <Tip label={fr.nav.logout}>
            <Button variant="ghost" size="icon" aria-label={fr.nav.logout} onClick={() => void logout().then(() => toast.success('Déconnecté'))}>
              <LogOut />
            </Button>
          </Tip>
        </div>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineBanner />
        {profile.data && !profile.data.complete && path !== '/dossier' ? (
          <div role="status" className="flex items-center gap-3 border-b border-warning/50 bg-warning-bg px-4 py-2 text-sm text-warning">
            <span>{fr.dossier.banner} ({profile.data.done}/{profile.data.total})</span>
            <Link to="/dossier" className="font-semibold text-fg underline">{fr.dossier.bannerAction}</Link>
          </div>
        ) : null}
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-4 text-xs text-muted">
          <span className="truncate">{status?.pharmacy_name ?? fr.app.name}</span>
          <span className="flex items-center gap-2">
            {health.data?.on_duty ? <Badge tone="accent">{fr.nav.onDuty}</Badge> : null}
            <span>
              {me?.display_name} · {me ? fr.roles[me.role] : ''}
            </span>
          </span>
        </div>
        <main id="contenu" className="min-h-0 flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
      <Palette open={palette} onOpenChange={setPalette} />
      <ShortcutsHelp open={help} onOpenChange={setHelp} />
      <ReauthDialog />
    </div>
  );
}
