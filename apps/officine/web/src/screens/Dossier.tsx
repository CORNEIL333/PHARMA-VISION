import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, FileText, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Alert } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardBody, CardHeader } from '../components/ui/card';
import { cn } from '../components/ui/cn';
import { Input, Select } from '../components/ui/input';
import { Field } from '../components/ui/label';
import { LoadingRows, PageHeader, QueryState } from '../components/ui/misc';
import { Table, Td, Th, Tr } from '../components/ui/table';
import { fr } from '../i18n/fr';
import { api, errorMessage } from '../lib/api';
import { Link } from '../lib/router';
import type { Supplier } from '../lib/types';

const t = fr.dossier;
const REGIONS = ['Adamaoua', 'Centre', 'Est', 'Extrême-Nord', 'Littoral', 'Nord', 'Nord-Ouest', 'Ouest', 'Sud', 'Sud-Ouest'];
const DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

type Kind = 'text' | 'enum' | 'date' | 'bool' | 'phone' | 'email' | 'coord';
interface FieldDef { name: string; kind: Kind; required?: boolean; options?: string[]; placeholder?: string }
type Data = Record<string, unknown>;
interface Section { id: string; data: Data | null; complete: boolean; missing: string[]; updated_at: string | null }

/** Rubriques simples : même liste que server/src/domain/profile.ts (le serveur valide toujours). */
const FORMS: Record<string, FieldDef[]> = {
  identite: [
    { name: 'enseigne', kind: 'text', required: true }, { name: 'raison_sociale', kind: 'text' },
    { name: 'forme_juridique', kind: 'enum', required: true, options: ['entreprise_individuelle', 'sarl', 'selarl', 'autre'] },
    { name: 'date_ouverture', kind: 'date' },
  ],
  autorisation: [
    { name: 'numero_autorisation', kind: 'text', required: true }, { name: 'date_autorisation', kind: 'date', required: true },
    { name: 'autorite', kind: 'text', required: true, placeholder: 'Ministre de la Santé publique' }, { name: 'reference_localisation', kind: 'text' },
  ],
  titulaire: [
    { name: 'nom', kind: 'text', required: true }, { name: 'numero_onpc', kind: 'text', required: true }, { name: 'section_onpc', kind: 'text' },
    { name: 'date_inscription_onpc', kind: 'date' }, { name: 'telephone', kind: 'phone' }, { name: 'email', kind: 'email' },
  ],
  localisation: [
    { name: 'region', kind: 'enum', required: true, options: REGIONS }, { name: 'departement', kind: 'text', required: true },
    { name: 'arrondissement', kind: 'text', required: true }, { name: 'ville', kind: 'text', required: true },
    { name: 'quartier', kind: 'text', required: true }, { name: 'repere', kind: 'text' }, { name: 'boite_postale', kind: 'text' },
    { name: 'district_sante', kind: 'text', required: true }, { name: 'aire_sante', kind: 'text' },
    { name: 'latitude', kind: 'coord', placeholder: '4.0511' }, { name: 'longitude', kind: 'coord', placeholder: '9.7679' },
  ],
  contacts: [
    { name: 'telephone', kind: 'phone', required: true, placeholder: '233 42 11 00' }, { name: 'mobile', kind: 'phone' },
    { name: 'whatsapp', kind: 'phone' }, { name: 'email', kind: 'email' },
  ],
  fiscal: [
    { name: 'niu', kind: 'text', required: true }, { name: 'rccm', kind: 'text', placeholder: 'RC/DLA/2019/A/1234' },
    { name: 'regime', kind: 'enum', required: true, options: ['reel', 'simplifie', 'impot_liberatoire', 'autre'] },
    { name: 'centre_impots', kind: 'text', required: true }, { name: 'assujetti_tva', kind: 'bool' }, { name: 'numero_cnps', kind: 'text' },
  ],
  donnees: [
    { name: 'responsable_nom', kind: 'text', required: true }, { name: 'responsable_contact', kind: 'text', required: true },
    { name: 'dpo_designe', kind: 'bool' }, { name: 'numero_autorisation_apdp', kind: 'text' }, { name: 'date_autorisation_apdp', kind: 'date' },
  ],
};

const ORDER = ['identite', 'autorisation', 'titulaire', 'localisation', 'contacts', 'fiscal', 'horaires', 'personnel', 'donnees'];

function useSave(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Data) => api<Section>(`/profile/${id}`, { method: 'PUT', body }),
    onSuccess: () => {
      toast.success(t.saved);
      void qc.invalidateQueries({ queryKey: ['profile'] });
      void qc.invalidateQueries({ queryKey: ['profile-status'] });
      void qc.invalidateQueries({ queryKey: ['setup-status'] });
    },
  });
}

function SimpleForm({ id, initial }: { id: string; initial: Data | null }) {
  const defs = FORMS[id] ?? [];
  const [d, setD] = useState<Data>(initial ?? {});
  useEffect(() => setD(initial ?? {}), [initial]);
  const save = useSave(id);
  const submit = () => {
    const body: Data = {};
    for (const f of defs) {
      const v = d[f.name];
      if (f.kind === 'bool') body[f.name] = v === true;
      else if (f.kind === 'coord') body[f.name] = v === '' || v === undefined || v === null ? null : Number(String(v).replace(',', '.'));
      else body[f.name] = typeof v === 'string' && v.trim() ? v.trim() : null;
    }
    save.mutate(body);
  };
  return (
    <form className="grid gap-3 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {defs.map((f) => {
        const id2 = `pf-${id}-${f.name}`;
        const label = `${t.fields[f.name] ?? f.name}${f.required ? ' *' : ''}`;
        const v = d[f.name];
        if (f.kind === 'bool') {
          return (
            <label key={f.name} className="flex items-center gap-2 self-end text-sm">
              <input type="checkbox" checked={v === true} onChange={(e) => setD({ ...d, [f.name]: e.target.checked })} /> {label}
            </label>
          );
        }
        return (
          <Field key={f.name} id={id2} label={label} error={save.error && (save.error as { problem?: { field?: string } }).problem?.field === f.name ? errorMessage(save.error) : null}>
            {f.kind === 'enum' ? (
              <Select id={id2} value={String(v ?? '')} onChange={(e) => setD({ ...d, [f.name]: e.target.value })}>
                <option value="">—</option>
                {f.options?.map((o) => <option key={o} value={o}>{t.options[o] ?? o}</option>)}
              </Select>
            ) : (
              <Input id={id2} type={f.kind === 'date' ? 'date' : f.kind === 'email' ? 'email' : 'text'} inputMode={f.kind === 'phone' || f.kind === 'coord' ? 'decimal' : undefined}
                placeholder={f.placeholder} value={String(v ?? '')} onChange={(e) => setD({ ...d, [f.name]: e.target.value })} />
            )}
          </Field>
        );
      })}
      {save.error ? <Alert tone="block" className="md:col-span-2">{errorMessage(save.error)}</Alert> : null}
      <div className="md:col-span-2"><Button type="submit" disabled={save.isPending}>{fr.common.save}</Button></div>
    </form>
  );
}

function HoursForm({ initial }: { initial: Data | null }) {
  type Day = { ouvert: boolean; ouverture: string; fermeture: string };
  const start = (): Record<string, Day> => Object.fromEntries(DAYS.map((d) => {
    const x = (initial?.jours as Record<string, { ouvert: boolean; ouverture: string | null; fermeture: string | null }> | undefined)?.[d];
    return [d, { ouvert: x?.ouvert ?? d !== 'dimanche', ouverture: x?.ouverture ?? '07:30', fermeture: x?.fermeture ?? '21:00' }];
  }));
  const [days, setDays] = useState(start);
  const [zone, setZone] = useState(String(initial?.zone_garde ?? ''));
  const save = useSave('horaires');
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate({ jours: days, zone_garde: zone.trim() || null }); }}>
      {DAYS.map((d) => (
        <div key={d} className="grid grid-cols-[110px_90px_1fr_1fr] items-center gap-3">
          <span>{t.days[d]}</span>
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={days[d]!.ouvert} onChange={(e) => setDays({ ...days, [d]: { ...days[d]!, ouvert: e.target.checked } })} /> {t.open}</label>
          <Input aria-label={`${t.days[d]} ouverture`} type="time" disabled={!days[d]!.ouvert} value={days[d]!.ouverture} onChange={(e) => setDays({ ...days, [d]: { ...days[d]!, ouverture: e.target.value } })} />
          <Input aria-label={`${t.days[d]} fermeture`} type="time" disabled={!days[d]!.ouvert} value={days[d]!.fermeture} onChange={(e) => setDays({ ...days, [d]: { ...days[d]!, fermeture: e.target.value } })} />
        </div>
      ))}
      <Field id="pf-zone" label={t.fields.zone_garde} className="mt-2"><Input id="pf-zone" value={zone} onChange={(e) => setZone(e.target.value)} /></Field>
      {save.error ? <Alert tone="block">{errorMessage(save.error)}</Alert> : null}
      <div><Button type="submit" disabled={save.isPending}>{fr.common.save}</Button></div>
    </form>
  );
}

function StaffForm({ initial }: { initial: Data | null }) {
  type M = { nom: string; fonction: string; numero_onpc: string };
  const [list, setList] = useState<M[]>(((initial?.membres as M[] | undefined) ?? []).map((m) => ({ ...m, numero_onpc: m.numero_onpc ?? '' })));
  const save = useSave('personnel');
  const upd = (i: number, p: Partial<M>) => setList(list.map((m, j) => (j === i ? { ...m, ...p } : m)));
  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate({ membres: list.map((m) => ({ nom: m.nom, fonction: m.fonction, numero_onpc: m.numero_onpc || null })) }); }}>
      {list.map((m, i) => (
        <div key={i} className="grid grid-cols-[1fr_190px_180px_auto] items-end gap-2">
          <Field id={`pm-n-${i}`} label={`${t.fields.nom} *`}><Input id={`pm-n-${i}`} value={m.nom} onChange={(e) => upd(i, { nom: e.target.value })} /></Field>
          <Field id={`pm-f-${i}`} label={`${t.fields.fonction} *`}>
            <Select id={`pm-f-${i}`} value={m.fonction} onChange={(e) => upd(i, { fonction: e.target.value })}>
              {['pharmacien_assistant', 'preparateur', 'caissier', 'autre'].map((o) => <option key={o} value={o}>{t.options[o]}</option>)}
            </Select>
          </Field>
          <Field id={`pm-o-${i}`} label={t.fields.numero_onpc}><Input id={`pm-o-${i}`} value={m.numero_onpc} onChange={(e) => upd(i, { numero_onpc: e.target.value })} /></Field>
          <Button variant="ghost" size="icon" aria-label={fr.common.remove} onClick={() => setList(list.filter((_, j) => j !== i))}><Trash2 /></Button>
        </div>
      ))}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => setList([...list, { nom: '', fonction: 'preparateur', numero_onpc: '' }])}><Plus /> {t.addMember}</Button>
        <Button type="submit" disabled={save.isPending}>{fr.common.save}</Button>
      </div>
      {save.error ? <Alert tone="block">{errorMessage(save.error)}</Alert> : null}
    </form>
  );
}

interface Payer { id: string; name: string; kind: string; code: string | null; convention_ref: string | null; default_coverage_pct: number | null; active: boolean }

function Payers() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['payers-all'], queryFn: () => api<Payer[]>('/payers', { query: { all: 'true' } }) });
  const [f, setF] = useState({ name: '', kind: 'assurance', code: '', convention_ref: '', pct: '' });
  const add = useMutation({
    mutationFn: () => api('/payers', { method: 'POST', body: { name: f.name, kind: f.kind, code: f.code || null, convention_ref: f.convention_ref || null, default_coverage_pct: f.pct === '' ? null : Number(f.pct) } }),
    onSuccess: () => { setF({ name: '', kind: 'assurance', code: '', convention_ref: '', pct: '' }); void qc.invalidateQueries({ queryKey: ['payers-all'] }); },
  });
  const toggle = useMutation({
    mutationFn: (p: Payer) => api(`/payers/${p.id}`, { method: 'PUT', body: { name: p.name, kind: p.kind, code: p.code, convention_ref: p.convention_ref, default_coverage_pct: p.default_coverage_pct, active: !p.active } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['payers-all'] }),
  });
  return (
    <div className="flex flex-col gap-3">
      <QueryState q={q} empty={(d) => d.length === 0} emptyTitle={fr.common.none}>
        {(d) => (
          <Table>
            <thead><tr><Th>{t.fields.nom}</Th><Th>Type</Th><Th>{t.code}</Th><Th>{t.convention}</Th><Th className="text-right">%</Th><Th /></tr></thead>
            <tbody>{d.map((p) => (
              <Tr key={p.id}><Td>{p.name}</Td><Td>{t.options[p.kind] ?? p.kind}</Td><Td>{p.code ?? '—'}</Td><Td>{p.convention_ref ?? '—'}</Td><Td className="text-right tabular">{p.default_coverage_pct ?? '—'}</Td>
                <Td className="text-right"><Button size="sm" variant="ghost" onClick={() => toggle.mutate(p)}>{p.active ? fr.accounts.disable : fr.accounts.enable}</Button></Td></Tr>
            ))}</tbody>
          </Table>
        )}
      </QueryState>
      <form className="grid gap-2 md:grid-cols-[1fr_150px_110px_1fr_90px_auto] md:items-end" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <Field id="py-n" label={`${t.fields.nom} *`}><Input id="py-n" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field id="py-k" label="Type"><Select id="py-k" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{['assurance', 'mutuelle', 'employeur', 'etat', 'autre'].map((k) => <option key={k} value={k}>{t.options[k]}</option>)}</Select></Field>
        <Field id="py-c" label={t.code}><Input id="py-c" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
        <Field id="py-r" label={t.convention}><Input id="py-r" value={f.convention_ref} onChange={(e) => setF({ ...f, convention_ref: e.target.value })} /></Field>
        <Field id="py-p" label="%"><Input id="py-p" inputMode="numeric" value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value.replace(/\D/g, '').slice(0, 3) })} /></Field>
        <Button type="submit" disabled={!f.name.trim() || add.isPending}><Plus /> {t.addPayer}</Button>
      </form>
      {add.error ? <Alert tone="block">{errorMessage(add.error)}</Alert> : null}
    </div>
  );
}

/** Grossistes-répartiteurs et centrales présents au Cameroun (docs/11 §3) : ajout en un clic. */
const KNOWN_SUPPLIERS = ['Laborex Cameroun', 'Ubipharm Cameroun', 'CENAME', 'FRPS / CAPR de la région'];

function Suppliers() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['suppliers', true], queryFn: () => api<Supplier[]>('/suppliers', { query: { include_inactive: 'true' } }) });
  const add = useMutation({
    mutationFn: (name: string) => api('/suppliers', { method: 'POST', body: { name, lead_days: 2 } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['suppliers'] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const existing = new Set((q.data ?? []).map((s) => s.name.toLowerCase()));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">{(q.data ?? []).map((s) => <Badge key={s.id} tone={s.active ? 'accent' : 'neutral'}>{s.name}</Badge>)}</div>
      <p className="text-xs text-muted">{t.knownSuppliers}</p>
      <div className="flex flex-wrap gap-2">
        {KNOWN_SUPPLIERS.filter((n) => !existing.has(n.toLowerCase())).map((n) => (
          <Button key={n} size="sm" variant="secondary" onClick={() => add.mutate(n)}><Plus /> {n}</Button>
        ))}
      </div>
      <Link to="/commandes" className="text-sm text-accent underline-offset-2 hover:underline">{t.suppliersLink}</Link>
    </div>
  );
}

/** Dossier d'installation : collecte des données réglementaires, administratives et fiscales. */
export default function Dossier() {
  const q = useQuery({ queryKey: ['profile'], queryFn: () => api<Section[]>('/profile') });
  const [current, setCurrent] = useState('identite');
  if (q.isLoading) return <LoadingRows rows={8} />;
  const sections = q.data ?? [];
  const done = sections.filter((s) => s.complete).length;
  const sec = sections.find((s) => s.id === current);
  const nav = [...ORDER, 'payers', 'suppliers'];
  return (
    <div>
      <PageHeader title={t.title} description={t.description} actions={<Badge tone={done === ORDER.length ? 'success' : 'warning'}>{done}/{ORDER.length} {t.progress}</Badge>} />
      <div className="grid gap-4 p-6 xl:grid-cols-[260px_1fr_280px]">
        <nav aria-label={t.title}>
          <ol className="flex flex-col gap-1">
            {nav.map((id) => {
              const s = sections.find((x) => x.id === id);
              return (
                <li key={id}>
                  <button type="button" onClick={() => setCurrent(id)} aria-current={id === current ? 'step' : undefined}
                    className={cn('flex w-full items-center gap-2 rounded-vp px-3 py-2 text-left text-sm hover:bg-surface-2', id === current && 'bg-surface-2 text-accent')}>
                    {s ? (s.complete ? <CheckCircle2 aria-label={t.complete} className="size-4 text-success" /> : <Circle aria-label={t.incomplete} className="size-4 text-muted" />) : <span className="size-4" />}
                    {t.sections[id]}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
        <Card>
          <CardHeader title={t.sections[current]} description={t.help[current]}
            actions={sec ? <Badge tone={sec.complete ? 'success' : 'warning'}>{sec.complete ? t.complete : t.incomplete}</Badge> : null} />
          <CardBody>
            {current === 'horaires' ? <HoursForm key="h" initial={sec?.data ?? null} />
              : current === 'personnel' ? <StaffForm key="p" initial={sec?.data ?? null} />
              : current === 'payers' ? <Payers />
              : current === 'suppliers' ? <Suppliers />
              : <SimpleForm key={current} id={current} initial={sec?.data ?? null} />}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t.documents} />
          <CardBody className="flex flex-col gap-2 text-sm">
            <ul className="flex flex-col gap-2">
              {t.documentList.map((d) => <li key={d} className="flex gap-2"><FileText aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" /> {d}</li>)}
            </ul>
            <p className="mt-2 text-xs text-muted">{t.toConfirm}</p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
