import { Pill } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card, CardBody, CardHeader } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Field } from '../components/ui/label';
import { fr } from '../i18n/fr';
import { api, errorMessage, setCsrf } from '../lib/api';
import { useSession } from '../lib/session';
import { groupKey } from './Setup';

const t = fr.login;

function Shell({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  const { status } = useSession();
  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-4 px-4 py-10">
      <div className="flex items-center gap-2 text-accent">
        <Pill aria-hidden className="size-6" />
        <span className="font-semibold">{status?.pharmacy_name ?? fr.app.name}</span>
      </div>
      <Card>
        <CardHeader level={1} title={title} description={description} />
        <CardBody>{children}</CardBody>
      </Card>
      {status?.ca_fingerprint ? (
        <p className="text-xs text-muted">
          {t.fingerprint} : <span className="break-all font-mono" data-testid="ca-fingerprint">{status.ca_fingerprint}</span>
        </p>
      ) : null}
    </main>
  );
}

/** Session limitée : changement de mot de passe imposé (U-01). */
function ChangePassword() {
  const { refresh, logout } = useSession();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Shell title={t.changeTitle} description={t.changeHelp}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          api('/auth/password', { method: 'POST', body: { current_password: cur, new_password: next } })
            .then(() => refresh())
            .catch((err: unknown) => setError(errorMessage(err)));
        }}
      >
        <Field id="cp-cur" label={t.current}><Input id="cp-cur" type="password" autoComplete="current-password" autoFocus value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
        <Field id="cp-next" label={t.next}><Input id="cp-next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        {error ? <Alert tone="block">{error}</Alert> : null}
        <Button type="submit" disabled={!cur || next.length < 12}>{fr.common.save}</Button>
        <Button variant="ghost" onClick={() => void logout()}>{t.logout}</Button>
      </form>
    </Shell>
  );
}

/** Session limitée : enrôlement TOTP imposé au titulaire (QUESTIONS Q-07). */
function EnrollTotp() {
  const { refresh, logout } = useSession();
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ secret: string }>('/auth/totp/enroll', { method: 'POST' }).then((r) => setSecret(r.secret), (e: unknown) => setError(errorMessage(e)));
  }, []);
  return (
    <Shell title={t.enrollTitle} description={t.enrollHelp}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          api('/auth/totp/confirm', { method: 'POST', body: { code } }).then(() => refresh()).catch((err: unknown) => setError(errorMessage(err)));
        }}
      >
        <p className="break-all rounded-vp border border-border bg-surface-2 p-3 font-mono text-base">{secret ? groupKey(secret) : '…'}</p>
        <Field id="en-code" label={t.totpCode}><Input id="en-code" inputMode="numeric" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></Field>
        {error ? <Alert tone="block">{error}</Alert> : null}
        <Button type="submit" disabled={code.length !== 6}>{fr.common.validate}</Button>
        <Button variant="ghost" onClick={() => void logout()}>{t.logout}</Button>
      </form>
    </Shell>
  );
}

/** UI-02 : connexion (A-01), message d'erreur générique, empreinte de l'autorité (I-06). */
export function Login() {
  const { me, refresh } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me?.restriction === 'password_change') return <ChangePassword />;
  if (me?.restriction === 'totp_enrollment') return <EnrollTotp />;

  const done = async (r: { status: string; csrf?: string; challenge?: string }) => {
    if (r.status === 'totp_required' && r.challenge) {
      setChallenge(r.challenge);
      return;
    }
    if (r.csrf) setCsrf(r.csrf);
    await refresh();
  };
  const run = async (fn: () => Promise<{ status: string; csrf?: string; challenge?: string }>) => {
    setBusy(true);
    setError(null);
    try {
      await done(await fn());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (challenge) {
    return (
      <Shell title={t.totpTitle} description={t.totpHelp}>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void run(() => api('/auth/totp', { method: 'POST', body: { challenge, code } })); }}>
          <Field id="l-code" label={t.totpCode}>
            <Input id="l-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          </Field>
          {error ? <Alert tone="block">{error}</Alert> : null}
          <Button type="submit" disabled={busy || code.length !== 6}>{fr.common.validate}</Button>
        </form>
      </Shell>
    );
  }
  return (
    <Shell title={t.title}>
      <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void run(() => api('/auth/login', { method: 'POST', body: { username, password } })); }}>
        <Field id="l-user" label={t.username}><Input id="l-user" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
        <Field id="l-pass" label={t.password}><Input id="l-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {error ? <Alert tone="block">{error}</Alert> : null}
        <Button type="submit" disabled={busy || !username || !password}>{t.submit}</Button>
      </form>
    </Shell>
  );
}
