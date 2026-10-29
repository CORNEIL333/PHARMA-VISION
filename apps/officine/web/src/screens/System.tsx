import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DatabaseBackup, FileDown, KeyRound, RotateCcw, ShieldCheck, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Alert } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardBody, CardHeader } from '../components/ui/card';
import { Dialog } from '../components/ui/dialog';
import { Input, Select } from '../components/ui/input';
import { Field } from '../components/ui/label';
import { PageHeader, QueryState } from '../components/ui/misc';
import { Table, Td, Th, Tr } from '../components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { fr } from '../i18n/fr';
import { api, errorMessage } from '../lib/api';
import { dateTime, int } from '../lib/format';
import { useSession } from '../lib/session';
import { download } from './Orders';

const t = fr.system;

interface Info { node_id: string; kid: string; ca_fingerprint: string | null; version: string; schema: number }
interface Verify { ok: boolean; events?: number; checkpoints?: number; seq?: number | null; defect?: string; detail?: string }
interface Backups { items: { file: string; size: number; created_at: string; last_seq: number }[]; last: { at: string; file: string; mirror: string } | null; mirror_dir: string | null }
type Settings = Record<string, string | number | boolean | null>;

function LedgerTab() {
  const { can } = useSession();
  const info = useQuery({ queryKey: ['system-info'], queryFn: () => api<Info>('/system/info') });
  const queue = useQuery({ queryKey: ['queue'], queryFn: () => api<{ pending: number; oldest_seq: number | null; head_seq: number }>('/system/queue') });
  const verify = useMutation({ mutationFn: () => api<Verify>('/system/verify-ledger', { method: 'POST' }) });
  const exportQueue = async () => {
    try {
      download(new Blob([await api<string>('/system/ledger-export', { method: 'POST', as: 'text' })], { type: 'application/x-ndjson' }), `vp-journal-${new Date().toISOString().slice(0, 10)}.jsonl`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader title={t.tabs.ledger} actions={<Button onClick={() => verify.mutate()} disabled={verify.isPending}><ShieldCheck /> {t.verify}</Button>} />
        <CardBody className="flex flex-col gap-2 text-sm">
          <QueryState q={info}>
            {(i) => (
              <dl className="grid grid-cols-[180px_1fr] gap-y-1">
                <dt className="text-muted">{t.nodeId}</dt><dd className="break-all font-mono">{i.node_id}</dd>
                <dt className="text-muted">{t.kid}</dt><dd className="font-mono">{i.kid}</dd>
                <dt className="text-muted">{t.fingerprint}</dt><dd className="break-all font-mono" data-testid="system-fingerprint">{i.ca_fingerprint ?? '—'}</dd>
                <dt className="text-muted">{t.version}</dt><dd>{i.version} · schéma {i.schema}</dd>
              </dl>
            )}
          </QueryState>
          {verify.data ? (
            verify.data.ok ? (
              <Alert tone="success" title={t.verifyOk}>{t.events} : {int(verify.data.events)} · {t.checkpoints} : {int(verify.data.checkpoints)}</Alert>
            ) : (
              <Alert tone="block" title={t.verifyKo}>seq {verify.data.seq ?? '?'} · {verify.data.defect} · {verify.data.detail}</Alert>
            )
          ) : null}
          {verify.error ? <Alert tone="block">{errorMessage(verify.error)}</Alert> : null}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t.queue} actions={can('ledger.export') ? <Button variant="secondary" onClick={() => void exportQueue()}><FileDown /> {t.export}</Button> : null} />
        <CardBody>
          <QueryState q={queue}>{(q) => <p>{t.pending} : <strong className="tabular">{int(q.pending)}</strong> (seq {q.oldest_seq ?? '—'} → {q.head_seq})</p>}</QueryState>
        </CardBody>
      </Card>
    </div>
  );
}

function BackupsTab() {
  const { can } = useSession();
  const qc = useQueryClient();
  const [restore, setRestore] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['backups'], queryFn: () => api<Backups>('/system/backups') });
  const now = useMutation({
    mutationFn: () => api<{ file: string; mirror: string }>('/system/backups', { method: 'POST' }),
    onSuccess: (r) => {
      toast.success(`${r.file}${r.mirror === 'absent' || r.mirror === 'error' ? ` — ${t.mirror} : ${r.mirror}` : ''}`);
      void qc.invalidateQueries({ queryKey: ['backups'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const run = useMutation({
    mutationFn: (file: string) => api('/system/restore', { method: 'POST', body: { file } }),
    onSuccess: () => { setRestore(null); toast.success(t.restoreStarted); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card>
      <CardHeader title={t.tabs.backups} actions={<Button onClick={() => now.mutate()} disabled={now.isPending}><DatabaseBackup /> {t.backupNow}</Button>} />
      <QueryState q={q}>
        {(b) => (
          <>
            <CardBody className="text-sm">
              {t.lastBackup} : {b.last ? `${dateTime(b.last.at)} · ${b.last.file}` : '—'} · {t.mirror} : {b.mirror_dir ?? '—'}
              {b.last && (b.last.mirror === 'absent' || b.last.mirror === 'error') ? <Alert tone="warn" className="mt-2">{t.mirror} : {b.last.mirror}</Alert> : null}
            </CardBody>
            <Table>
              <thead><tr><Th>Fichier</Th><Th>{fr.common.date}</Th><Th className="text-right">seq</Th><Th className="text-right">Ko</Th><Th /></tr></thead>
              <tbody>
                {b.items.map((x) => (
                  <Tr key={x.file}><Td className="font-mono text-xs">{x.file}</Td><Td>{dateTime(x.created_at)}</Td><Td className="text-right tabular">{x.last_seq}</Td><Td className="text-right tabular">{int(Math.round(x.size / 1024))}</Td>
                    <Td className="text-right">{can('backup.restore') ? <Button size="sm" variant="ghost" onClick={() => setRestore(x.file)}><RotateCcw /> {t.restore}</Button> : null}</Td></Tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </QueryState>
      <Dialog open={restore !== null} onOpenChange={(o) => !o && setRestore(null)} title={t.restore} description={restore ?? ''}
        footer={<><Button variant="ghost" onClick={() => setRestore(null)}>{fr.common.cancel}</Button><Button variant="danger" disabled={run.isPending} onClick={() => restore && run.mutate(restore)}>{t.restore}</Button></>}>
        <Alert tone="warn">{t.restoreConfirm}</Alert>
      </Dialog>
    </Card>
  );
}

function SettingsTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') });
  const [draft, setDraft] = useState<Settings>({});
  useEffect(() => { if (q.data) setDraft(q.data); }, [q.data]);
  const save = useMutation({
    mutationFn: () => {
      const patch: Settings = {};
      for (const k of Object.keys(t.settings)) if (q.data && draft[k] !== q.data[k]) patch[k] = draft[k] ?? null;
      return api<Settings>('/settings', { method: 'PATCH', body: patch });
    },
    onSuccess: (s) => { toast.success(fr.common.saved); qc.setQueryData(['settings'], s); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const text = (k: string, type = 'text') => (
    <Field id={`st-${k}`} label={t.settings[k]}><Input id={`st-${k}`} type={type} value={String(draft[k] ?? '')} onChange={(e) => setDraft({ ...draft, [k]: type === 'number' ? Number(e.target.value) : e.target.value })} /></Field>
  );
  return (
    <Card>
      <CardHeader title={t.tabs.settings} actions={<Button onClick={() => save.mutate()} disabled={save.isPending}>{fr.common.save}</Button>} />
      <QueryState q={q}>
        {(s) => (
          <CardBody className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {text('pharmacy_name')}{text('pharmacy_address')}{text('pharmacy_phone')}
            <Field id="st-rx" label={t.settings.rx_policy}>
              <Select id="st-rx" value={String(draft.rx_policy ?? '')} onChange={(e) => setDraft({ ...draft, rx_policy: e.target.value })}>
                {Object.entries(t.rxPolicies).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field id="st-regul" label={t.settings.allow_regul_sales} hint={s.regul_sales_auto_until ? `${t.regulAuto} : ${dateTime(String(s.regul_sales_auto_until))}` : undefined}>
              <Select id="st-regul" value={draft.allow_regul_sales === null ? 'auto' : String(draft.allow_regul_sales)} onChange={(e) => setDraft({ ...draft, allow_regul_sales: e.target.value === 'auto' ? null : e.target.value === 'true' })}>
                <option value="auto">{t.regulAuto}</option><option value="true">{fr.common.yes}</option><option value="false">{fr.common.no}</option>
              </Select>
            </Field>
            {text('discount_max_pct', 'number')}{text('prescription_max_age_days', 'number')}{text('fraud_void_threshold', 'number')}
            {text('opening_time', 'time')}{text('closing_time', 'time')}{text('backup_hour', 'number')}
            <Field id="st-mirror" label={t.settings.backup_mirror_dir}><Input id="st-mirror" value={String(draft.backup_mirror_dir ?? '')} onChange={(e) => setDraft({ ...draft, backup_mirror_dir: e.target.value || null })} /></Field>
            <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={draft.allow_browser_clients === true} onChange={(e) => setDraft({ ...draft, allow_browser_clients: e.target.checked })} /> {t.settings.allow_browser_clients}</label>
          </CardBody>
        )}
      </QueryState>
    </Card>
  );
}

function DevicesTab() {
  const { can } = useSession();
  const qc = useQueryClient();
  const [code, setCode] = useState<{ code: string; expires_at: string } | null>(null);
  const list = useQuery({ queryKey: ['devices'], enabled: can('device.manage'), queryFn: () => api<{ id: string; name: string; platform: string; app_version: string | null; paired_at: string; last_seen_at: string | null; revoked_at: string | null }[]>('/devices') });
  const gen = useMutation({ mutationFn: () => api<{ code: string; expires_at: string }>('/devices/pairing-code', { method: 'POST' }), onSuccess: setCode, onError: (e) => toast.error(errorMessage(e)) });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/devices/${id}/revoke`, { method: 'POST' }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['devices'] }), onError: (e) => toast.error(errorMessage(e)) });
  return (
    <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
      <Card>
        <CardHeader title={t.pairing} description={t.pairingHelp} />
        <CardBody className="flex flex-col gap-3">
          {code ? <p className="tabular text-center font-mono text-4xl tracking-[0.3em]" data-testid="pairing-code">{code.code}</p> : null}
          {code ? <p className="text-center text-xs text-muted">→ {dateTime(code.expires_at)}</p> : null}
          <Button onClick={() => gen.mutate()} disabled={gen.isPending}><KeyRound /> {t.newCode}</Button>
        </CardBody>
      </Card>
      {can('device.manage') ? (
        <Card>
          <CardHeader title={t.devices} />
          <QueryState q={list} empty={(d) => d.length === 0}>
            {(d) => (
              <Table>
                <thead><tr><Th>{t.device}</Th><Th>{t.platform}</Th><Th>{t.paired}</Th><Th>{t.lastSeen}</Th><Th /></tr></thead>
                <tbody>
                  {d.map((x) => (
                    <Tr key={x.id}><Td>{x.name} <span className="text-xs text-muted">{x.app_version}</span></Td><Td>{x.platform}</Td><Td>{dateTime(x.paired_at)}</Td><Td>{dateTime(x.last_seen_at)}</Td>
                      <Td className="text-right">{x.revoked_at ? <Badge>révoqué</Badge> : <Button size="sm" variant="ghost" onClick={() => revoke.mutate(x.id)}>{t.revoke}</Button>}</Td></Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </QueryState>
        </Card>
      ) : null}
    </div>
  );
}

function DutyTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['duty'], queryFn: () => api<{ id: string; starts_at: string; ends_at: string }[]>('/duty') });
  const [f, setF] = useState({ start: '', end: '' });
  const toIso = (local: string) => (local ? `${local}:00+01:00` : '');
  const declare = useMutation({
    mutationFn: () => api('/duty', { method: 'POST', body: { starts_at: toIso(f.start), ends_at: toIso(f.end) } }),
    onSuccess: () => { toast.success(fr.common.saved); void qc.invalidateQueries({ queryKey: ['duty'] }); void qc.invalidateQueries({ queryKey: ['health'] }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card>
      <CardHeader title={t.tabs.duty} />
      <CardBody className="flex flex-wrap items-end gap-3">
        <Field id="du-start" label={t.dutyStart}><Input id="du-start" type="datetime-local" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
        <Field id="du-end" label={t.dutyEnd}><Input id="du-end" type="datetime-local" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
        <Button onClick={() => declare.mutate()} disabled={!f.start || !f.end || declare.isPending}>{t.declare}</Button>
      </CardBody>
      <QueryState q={q} empty={(d) => d.length === 0}>
        {(d) => (
          <Table>
            <thead><tr><Th>{t.dutyStart}</Th><Th>{t.dutyEnd}</Th></tr></thead>
            <tbody>{d.map((x) => <Tr key={x.id}><Td>{dateTime(x.starts_at)}</Td><Td>{dateTime(x.ends_at)}</Td></Tr>)}</tbody>
          </Table>
        )}
      </QueryState>
    </Card>
  );
}

interface CloudStatus {
  enabled: boolean;
  configured: boolean;
  enrolled: boolean;
  pharmacy_id: string | null;
  url: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  queue: number;
  referential_version: number;
  recalls: { cloud_id: string; ref_code: string; lot_number: string | null; active: boolean; applied: boolean; acked_at: string | null; received_at: string }[];
}

/** NO-01, NO-05 : configuration, enrôlement et état de la synchronisation avec le serveur central. */
function CloudTab() {
  const { can } = useSession();
  const qc = useQueryClient();
  const c = t.cloud;
  const status = useQuery({ queryKey: ['cloud-status'], queryFn: () => api<CloudStatus>('/cloud/status'), refetchInterval: 30_000 });
  const [cfg, setCfg] = useState<{ url: string; spki: string; enabled: boolean } | null>(null);
  const [token, setToken] = useState('');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['cloud-status'] });
  const loadCfg = useMutation({
    mutationFn: () => api<Settings>('/settings'),
    onSuccess: (st) => setCfg({ url: String(st.cloud_url ?? ''), spki: String(st.cloud_spki_sha256 ?? ''), enabled: st.cloud_sync_enabled === true }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const saveCfg = useMutation({
    mutationFn: () => api('/settings', { method: 'PATCH', body: { cloud_url: cfg?.url.trim() || null, cloud_spki_sha256: cfg?.spki.trim().toLowerCase() || null, cloud_sync_enabled: cfg?.enabled ?? false } }),
    onSuccess: () => {
      toast.success(fr.common.saved);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const enrol = useMutation({
    mutationFn: () => api('/cloud/enrol', { method: 'POST', body: { token: token.trim() } }),
    onSuccess: () => {
      toast.success(c.enrolled);
      setToken('');
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const now = useMutation({
    mutationFn: () => api<{ error: string | null }>('/cloud/sync-now', { method: 'POST' }),
    onSuccess: (r) => {
      if (r.error) toast.error(r.error);
      else toast.success(fr.common.saved);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader
          title={t.tabs.cloud}
          description={c.intro}
          actions={status.data?.enrolled && status.data.enabled ? <Button onClick={() => now.mutate()} disabled={now.isPending}>{c.syncNow}</Button> : null}
        />
        <QueryState q={status}>
          {(st) => (
            <CardBody className="flex flex-col gap-2 text-sm">
              <p className="flex flex-wrap gap-2">
                <Badge tone={st.enabled ? 'success' : 'neutral'}>{st.enabled ? c.enabled : c.off}</Badge>
                <Badge tone={st.enrolled ? 'accent' : 'warning'}>{st.enrolled ? `${c.enrolled} · ${st.pharmacy_id}` : c.notEnrolled}</Badge>
              </p>
              <dl className="grid grid-cols-[220px_1fr] gap-y-1">
                <dt className="text-muted">{c.lastSync}</dt>
                <dd>{dateTime(st.last_sync_at)}</dd>
                <dt className="text-muted">{c.queue}</dt>
                <dd className="tabular">{int(st.queue)}</dd>
                <dt className="text-muted">{c.referential}</dt>
                <dd className="tabular">{st.referential_version}</dd>
              </dl>
              {st.last_error ? <Alert tone="warn" title={c.lastError}>{st.last_error}</Alert> : null}
              {st.recalls.length ? (
                <Table>
                  <thead><tr><Th>{c.recalls}</Th><Th>{fr.common.lot}</Th><Th>{fr.common.status}</Th></tr></thead>
                  <tbody>
                    {st.recalls.map((r) => (
                      <Tr key={r.cloud_id}>
                        <Td className="font-mono">{r.ref_code}</Td>
                        <Td>{r.lot_number ?? 'tous'}</Td>
                        <Td>
                          {r.applied ? <Badge tone="danger">{c.applied}</Badge> : <Badge>{c.pending}</Badge>}{' '}
                          {r.acked_at ? <Badge tone="success">{c.acked}</Badge> : null}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              ) : null}
            </CardBody>
          )}
        </QueryState>
      </Card>
      {can('settings.edit') ? (
        <Card>
          <CardHeader title={fr.system.tabs.settings} actions={cfg ? null : <Button variant="secondary" onClick={() => loadCfg.mutate()}>{fr.common.edit}</Button>} />
          {cfg ? (
            <CardBody className="flex flex-col gap-3">
              <Field id="cl-url" label={c.url}>
                <Input id="cl-url" value={cfg.url} placeholder="https://cloud.visionpharma.cm" onChange={(e) => setCfg({ ...cfg, url: e.target.value })} />
              </Field>
              <Field id="cl-spki" label={c.spki}>
                <Input id="cl-spki" className="font-mono" value={cfg.spki} onChange={(e) => setCfg({ ...cfg, spki: e.target.value })} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} /> {c.enabled}
              </label>
              <div><Button onClick={() => saveCfg.mutate()} disabled={saveCfg.isPending}>{c.saveConfig}</Button></div>
              <Field id="cl-token" label={c.token}>
                <Input id="cl-token" className="font-mono" value={token} onChange={(e) => setToken(e.target.value)} />
              </Field>
              <div><Button variant="secondary" onClick={() => enrol.mutate()} disabled={enrol.isPending || token.trim().length < 20}>{c.enrol}</Button></div>
            </CardBody>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

function CatalogTab() {
  const [report, setReport] = useState<{ inserted: number; updated: number; rejected: number; errors: { line: number; reason: string }[] } | null>(null);
  const run = useMutation({
    mutationFn: async (file: File) => api<NonNullable<typeof report>>('/catalog/import', { method: 'POST', raw: { data: await file.arrayBuffer(), type: 'text/csv', headers: { 'x-filename': file.name.replace(/[^\w.-]/g, '_') } } }),
    onSuccess: (r) => { setReport(r); toast.success(t.importDone); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card>
      <CardHeader title={t.import} />
      <CardBody className="flex flex-col gap-3">
        <label className="inline-flex h-9 w-fit cursor-pointer items-center gap-2 rounded-vp border border-border px-3 text-sm hover:bg-surface-2">
          <Upload className="size-4" /> {t.import}
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) run.mutate(f); }} />
        </label>
        {run.isPending ? <p className="text-muted">{fr.common.loading}</p> : null}
        {report ? (
          <>
            <p>Insérées : <strong>{report.inserted}</strong> · Mises à jour : <strong>{report.updated}</strong> · Rejetées : <strong>{report.rejected}</strong></p>
            {report.errors.length ? (
              <Table><thead><tr><Th>Ligne</Th><Th>{fr.common.reason}</Th></tr></thead><tbody>{report.errors.slice(0, 200).map((e, i) => <Tr key={i}><Td className="tabular">{e.line}</Td><Td>{e.reason}</Td></Tr>)}</tbody></Table>
            ) : null}
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}

/** UI-14 : système (J-04, J-05, B-01 à B-04, W-02, W-09, W-11, G-01, I-04, I-06). */
export default function System() {
  const { can } = useSession();
  const [tab, setTab] = useState(can('ledger.verify') ? 'ledger' : 'backups');
  return (
    <div>
      <PageHeader title={t.title} description={t.description} />
      <div className="p-6">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            {can('ledger.verify') ? <TabsTrigger value="ledger">{t.tabs.ledger}</TabsTrigger> : null}
            {can('backup.create') ? <TabsTrigger value="backups">{t.tabs.backups}</TabsTrigger> : null}
            {can('settings.edit') ? <TabsTrigger value="settings">{t.tabs.settings}</TabsTrigger> : null}
            {can('device.pairing_code') ? <TabsTrigger value="devices">{t.tabs.devices}</TabsTrigger> : null}
            {can('settings.edit') ? <TabsTrigger value="duty">{t.tabs.duty}</TabsTrigger> : null}
            {can('settings.edit') ? <TabsTrigger value="catalog">{t.tabs.catalog}</TabsTrigger> : null}
            {can('ledger.verify') ? <TabsTrigger value="cloud">{t.tabs.cloud}</TabsTrigger> : null}
          </TabsList>
          <TabsContent value="ledger">{tab === 'ledger' ? <LedgerTab /> : null}</TabsContent>
          <TabsContent value="backups">{tab === 'backups' ? <BackupsTab /> : null}</TabsContent>
          <TabsContent value="settings">{tab === 'settings' ? <SettingsTab /> : null}</TabsContent>
          <TabsContent value="devices">{tab === 'devices' ? <DevicesTab /> : null}</TabsContent>
          <TabsContent value="duty">{tab === 'duty' ? <DutyTab /> : null}</TabsContent>
          <TabsContent value="catalog">{tab === 'catalog' ? <CatalogTab /> : null}</TabsContent>
          <TabsContent value="cloud">{tab === 'cloud' ? <CloudTab /> : null}</TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
