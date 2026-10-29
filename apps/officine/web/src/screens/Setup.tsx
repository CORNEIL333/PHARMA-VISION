import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card, CardBody, CardHeader } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Field } from '../components/ui/label';
import { fr } from '../i18n/fr';
import { api, errorMessage, setCsrf } from '../lib/api';
import { useSession } from '../lib/session';

const t = fr.setup;

/** Clé TOTP lisible : groupes de 4 caractères. */
export const groupKey = (k: string) => k.match(/.{1,4}/g)?.join(' ') ?? k;

/** UI-01 : configuration initiale (I-02, I-03, I-06). */
export function Setup() {
  const { status, refresh } = useSession();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ pharmacy_name: '', username: 'titulaire', display_name: '', password: '', confirm: '', totp_code: '', recovery_key: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const totp = useQuery({ queryKey: ['setup-totp'], queryFn: () => api<{ secret: string; otpauth_uri: string }>('/setup/totp-secret'), staleTime: Infinity });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const step1Ok = form.pharmacy_name.trim().length >= 2 && form.username.length >= 3 && form.display_name.trim() && form.password.length >= 12 && form.password === form.confirm;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ csrf: string }>('/setup', {
        method: 'POST',
        body: {
          pharmacy_name: form.pharmacy_name.trim(), username: form.username.trim(), display_name: form.display_name.trim(),
          password: form.password, recovery_key: form.recovery_key.trim(), totp_secret: totp.data?.secret, totp_code: form.totp_code,
        },
      });
      setCsrf(r.csrf);
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-full max-w-xl flex-col justify-center gap-4 px-4 py-10">
      <div className="flex items-center gap-2 text-accent">
        <ShieldCheck aria-hidden className="size-6" />
        <span className="font-semibold">{fr.app.name} {fr.app.product}</span>
      </div>
      <Card>
        <CardHeader level={1} title={t.title} description={t.intro} />
        <CardBody className="flex flex-col gap-4">
          {step === 1 ? (
            <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (step1Ok) setStep(2); }}>
              <h2 className="font-medium">{t.step1}</h2>
              <Field id="s-pharmacy" label={t.pharmacy}><Input id="s-pharmacy" autoFocus value={form.pharmacy_name} onChange={set('pharmacy_name')} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field id="s-username" label={t.username}><Input id="s-username" autoComplete="username" value={form.username} onChange={set('username')} /></Field>
                <Field id="s-display" label={t.displayName}><Input id="s-display" value={form.display_name} onChange={set('display_name')} /></Field>
              </div>
              <Field id="s-password" label={t.password}><Input id="s-password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} /></Field>
              <Field id="s-confirm" label={t.passwordConfirm} error={form.confirm && form.confirm !== form.password ? t.mismatch : null}>
                <Input id="s-confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} />
              </Field>
              <Button type="submit" disabled={!step1Ok}>{t.next}</Button>
            </form>
          ) : null}
          {step === 2 ? (
            <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (form.totp_code.length === 6) setStep(3); }}>
              <h2 className="font-medium">{t.step2}</h2>
              <p className="text-muted">{t.totpHelp}</p>
              <div className="rounded-vp border border-border bg-surface-2 p-3">
                <p className="text-xs text-muted">{t.totpKey}</p>
                <p className="mt-1 break-all font-mono text-base tracking-wider" data-testid="totp-secret">{totp.data ? groupKey(totp.data.secret) : '…'}</p>
              </div>
              <Field id="s-code" label={t.totpCode}>
                <Input id="s-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={form.totp_code} onChange={(e) => setForm({ ...form, totp_code: e.target.value.replace(/\D/g, '') })} />
              </Field>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep(1)}>{t.back}</Button>
                <Button type="submit" disabled={form.totp_code.length !== 6}>{t.next}</Button>
              </div>
            </form>
          ) : null}
          {step === 3 ? (
            <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
              <h2 className="font-medium">{t.step3}</h2>
              <p className="text-muted">{t.recoveryHelp}</p>
              <Field id="s-recovery" label={t.recovery}>
                <Input id="s-recovery" autoFocus className="font-mono" spellCheck={false} value={form.recovery_key} onChange={set('recovery_key')} placeholder="XXXX-XXXX-…" />
              </Field>
              {error ? <Alert tone="block">{error}</Alert> : null}
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep(2)}>{t.back}</Button>
                <Button type="submit" disabled={busy || form.recovery_key.trim().length < 40}>{t.submit}</Button>
              </div>
              <p className="text-xs text-muted">{t.afterImport}</p>
            </form>
          ) : null}
        </CardBody>
      </Card>
      {status?.ca_fingerprint ? (
        <p className="text-xs text-muted">
          {t.fingerprint} : <span className="break-all font-mono">{status.ca_fingerprint}</span>
        </p>
      ) : null}
    </main>
  );
}
