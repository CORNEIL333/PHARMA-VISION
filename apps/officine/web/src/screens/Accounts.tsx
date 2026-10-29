import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, LogOut, Plus, UserCheck, UserX } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Dialog } from '../components/ui/dialog';
import { Input, Select } from '../components/ui/input';
import { Field } from '../components/ui/label';
import { PageHeader, QueryState } from '../components/ui/misc';
import { Table, Td, Th, Tr } from '../components/ui/table';
import { fr } from '../i18n/fr';
import { api, errorMessage } from '../lib/api';
import { dateTime } from '../lib/format';
import { useSession, type Role } from '../lib/session';

const t = fr.accounts;

interface User { id: string; username: string; display_name: string; role: Role; active: boolean; totp_enabled: boolean; must_change_pw: boolean; created_at: string }

/** UI-13 : comptes (U-01 à U-03) ; titulaire ré-authentifié. */
export default function Accounts() {
  const qc = useQueryClient();
  const { me } = useSession();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ username: '', display_name: '', role: 'caissier' as Role });
  const [secret, setSecret] = useState<{ user: string; password: string } | null>(null);
  const q = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['users'] });
  const create = useMutation({
    mutationFn: () => api<{ user: User; temporary_password: string }>('/users', { method: 'POST', body: form }),
    onSuccess: (r) => { setCreating(false); setSecret({ user: r.user.username, password: r.temporary_password }); setForm({ username: '', display_name: '', role: 'caissier' }); refresh(); },
  });
  const act = useMutation({
    mutationFn: async (a: { kind: 'role' | 'active' | 'reset' | 'revoke'; user: User; value?: string | boolean }) => {
      if (a.kind === 'role') return api(`/users/${a.user.id}`, { method: 'PATCH', body: { role: a.value } });
      if (a.kind === 'active') return api(`/users/${a.user.id}`, { method: 'PATCH', body: { active: a.value } });
      if (a.kind === 'reset') {
        const r = await api<{ temporary_password: string }>(`/users/${a.user.id}/reset-password`, { method: 'POST' });
        setSecret({ user: a.user.username, password: r.temporary_password });
        return r;
      }
      return api(`/users/${a.user.id}/revoke-sessions`, { method: 'POST' });
    },
    onSuccess: () => { toast.success(fr.common.saved); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div>
      <PageHeader title={t.title} description={t.description} actions={<Button onClick={() => setCreating(true)}><Plus /> {t.create}</Button>} />
      <div className="p-6">
        <Card>
          <QueryState q={q} empty={(d) => d.length === 0}>
            {(d) => (
              <Table>
                <thead><tr><Th>{t.username}</Th><Th>{t.displayName}</Th><Th>{t.role}</Th><Th>{fr.common.status}</Th><Th>{t.totp}</Th><Th>{fr.common.date}</Th><Th>{fr.common.actions}</Th></tr></thead>
                <tbody>
                  {d.map((u) => (
                    <Tr key={u.id}>
                      <Td className="font-mono">{u.username}</Td>
                      <Td>{u.display_name}</Td>
                      <Td>
                        <Select aria-label={`${t.changeRole} ${u.username}`} className="h-8 w-36" value={u.role} disabled={u.id === me?.id} onChange={(e) => act.mutate({ kind: 'role', user: u, value: e.target.value })}>
                          {Object.entries(fr.roles).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </Select>
                      </Td>
                      <Td><Badge tone={u.active ? 'success' : 'neutral'}>{u.active ? t.active : t.disabled}</Badge></Td>
                      <Td>{u.totp_enabled ? <Badge tone="accent">2FA</Badge> : '—'}</Td>
                      <Td className="text-xs">{dateTime(u.created_at)}</Td>
                      <Td>
                        <span className="inline-flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => act.mutate({ kind: 'reset', user: u })}><KeyRound /> {t.reset}</Button>
                          <Button size="sm" variant="ghost" onClick={() => act.mutate({ kind: 'revoke', user: u })}><LogOut /> {t.revoke}</Button>
                          {u.id !== me?.id ? (
                            <Button size="sm" variant="ghost" onClick={() => act.mutate({ kind: 'active', user: u, value: !u.active })}>{u.active ? <><UserX /> {t.disable}</> : <><UserCheck /> {t.enable}</>}</Button>
                          ) : null}
                        </span>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </QueryState>
        </Card>
      </div>
      <Dialog open={creating} onOpenChange={setCreating} title={t.create}
        footer={<><Button variant="ghost" onClick={() => setCreating(false)}>{fr.common.cancel}</Button><Button disabled={form.username.length < 3 || !form.display_name.trim() || create.isPending} onClick={() => create.mutate()}>{fr.common.create}</Button></>}>
        <div className="grid gap-3 md:grid-cols-2">
          <Field id="ac-user" label={t.username}><Input id="ac-user" autoFocus value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
          <Field id="ac-name" label={t.displayName}><Input id="ac-name" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></Field>
          <Field id="ac-role" label={t.role}>
            <Select id="ac-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {Object.entries(fr.roles).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          {create.error ? <Alert tone="block" className="md:col-span-2">{errorMessage(create.error)}</Alert> : null}
        </div>
      </Dialog>
      <Dialog open={secret !== null} onOpenChange={(o) => !o && setSecret(null)} title={t.tempPassword} description={t.tempHelp}
        footer={<Button onClick={() => setSecret(null)}>{fr.common.close}</Button>}>
        <p className="text-muted">{secret?.user}</p>
        <p className="mt-2 select-all break-all rounded-vp border border-border bg-surface-2 p-3 font-mono text-lg" data-testid="temp-password">{secret?.password}</p>
      </Dialog>
    </div>
  );
}
