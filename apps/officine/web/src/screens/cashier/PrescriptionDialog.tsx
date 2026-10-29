import { Camera } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Input, Textarea } from '../../components/ui/input';
import { Field } from '../../components/ui/label';
import { fr } from '../../i18n/fr';
import { api, ApiError, errorMessage } from '../../lib/api';
import { today } from '../../lib/format';
import type { Prescription } from '../../lib/types';

const t = fr.prescription;
const MAX = 8 * 1024 * 1024;

function toBase64(buf: ArrayBuffer): string {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Capture par la caméra du poste (getUserMedia) ; l'aperçu est dessiné sur un canvas (CSP : pas de blob:). */
function CameraCapture({ onCapture }: { onCapture: (b64: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  useEffect(() => () => stream?.getTracks().forEach((tr) => tr.stop()), [stream]);
  const start = async () => {
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    setStream(s);
    if (video.current) {
      video.current.srcObject = s;
      await video.current.play();
    }
  };
  const capture = () => {
    const v = video.current;
    const c = canvas.current;
    if (!v || !c) return;
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')?.drawImage(v, 0, 0);
    c.toBlob((b) => {
      if (b) void b.arrayBuffer().then((a) => onCapture(toBase64(a)));
    }, 'image/jpeg', 0.85);
    stream?.getTracks().forEach((tr) => tr.stop());
    setStream(null);
  };
  return (
    <div className="flex flex-col gap-2">
      <video ref={video} className={stream ? 'max-h-60 rounded-vp' : 'hidden'} muted playsInline />
      <canvas ref={canvas} className="max-h-60 max-w-full rounded-vp" />
      {stream ? (
        <Button variant="secondary" onClick={capture}>{t.capture}</Button>
      ) : navigator.mediaDevices ? (
        <Button variant="secondary" onClick={() => void start().catch(() => undefined)}>
          <Camera /> {t.camera}
        </Button>
      ) : null}
    </div>
  );
}

/** UI-05 : ordonnance (O-02 à O-06). Pharmacien : sa session ; sinon contre-signature sur ce poste. */
export function PrescriptionDialog({
  open, onOpenChange, canValidate, sensitive, onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  canValidate: boolean;
  sensitive: boolean;
  onDone: (p: Prescription) => void;
}) {
  const [f, setF] = useState({ prescriber_name: '', prescriber_reg: '', issued_on: today(), patient_ref: '', notes: '', age_override_reason: '' });
  const [validator, setValidator] = useState({ username: '', password: '', code: '' });
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setError(null);
      setStale(false);
      setImage(null);
    }
  }, [open]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX) {
      setError('Image de plus de 8 Mo.');
      return;
    }
    setImage(toBase64(await file.arrayBuffer()));
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    const body = {
      prescriber_name: f.prescriber_name, prescriber_reg: f.prescriber_reg || null, issued_on: f.issued_on,
      patient_ref: f.patient_ref || null, notes: f.notes || null, image_base64: image,
      age_override_reason: f.age_override_reason || null,
    };
    try {
      const p = canValidate
        ? await api<Prescription>('/prescriptions', { method: 'POST', body })
        : await api<Prescription>('/prescriptions/countersigned', {
            method: 'POST',
            body: { ...body, validator: { username: validator.username, password: validator.password, ...(validator.code ? { code: validator.code } : {}) } },
          });
      onDone(p);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'stale_prescription') setStale(true);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const ok = f.prescriber_name.trim() && f.issued_on && (!sensitive || f.prescriber_reg.trim()) && (canValidate || (validator.username && validator.password));
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t.title}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{fr.common.cancel}</Button>
          <Button onClick={() => void submit()} disabled={busy || !ok}>{t.submit}</Button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field id="rx-prescriber" label={t.prescriber}><Input id="rx-prescriber" autoFocus value={f.prescriber_name} onChange={set('prescriber_name')} /></Field>
        <Field id="rx-reg" label={sensitive ? t.regSensitive : t.reg}><Input id="rx-reg" value={f.prescriber_reg} onChange={set('prescriber_reg')} /></Field>
        <Field id="rx-issued" label={t.issued}><Input id="rx-issued" type="date" max={today()} value={f.issued_on} onChange={set('issued_on')} /></Field>
        <Field id="rx-patient" label={t.patient}><Input id="rx-patient" maxLength={40} value={f.patient_ref} onChange={set('patient_ref')} /></Field>
        <Field id="rx-notes" label={t.notes} className="md:col-span-2"><Textarea id="rx-notes" value={f.notes} onChange={set('notes')} /></Field>
        {stale ? (
          <Field id="rx-override" label={t.override} className="md:col-span-2"><Input id="rx-override" value={f.age_override_reason} onChange={set('age_override_reason')} /></Field>
        ) : null}
        <div className="flex flex-col gap-2 md:col-span-2">
          <p className="text-xs text-muted">{t.photo}</p>
          <div className="flex flex-wrap items-start gap-3">
            <CameraCapture onCapture={setImage} />
            <label className="inline-flex h-9 cursor-pointer items-center rounded-vp border border-border px-3 text-sm hover:bg-surface-2">
              {t.file}
              <input type="file" accept="image/jpeg,image/png" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
            </label>
            {image ? <span className="text-xs text-success">✓ {Math.round((image.length * 3) / 4 / 1024)} Ko</span> : null}
          </div>
        </div>
        {!canValidate ? (
          <fieldset className="grid gap-3 rounded-vp border border-border p-3 md:col-span-2 md:grid-cols-3">
            <legend className="px-1 text-xs text-muted">{t.validator} — {t.validatorHelp}</legend>
            <Field id="rx-v-user" label={t.validatorUser}><Input id="rx-v-user" autoComplete="off" value={validator.username} onChange={(e) => setValidator({ ...validator, username: e.target.value })} /></Field>
            <Field id="rx-v-pass" label={t.validatorPass}><Input id="rx-v-pass" type="password" autoComplete="off" value={validator.password} onChange={(e) => setValidator({ ...validator, password: e.target.value })} /></Field>
            <Field id="rx-v-code" label={t.validatorCode}><Input id="rx-v-code" inputMode="numeric" maxLength={6} value={validator.code} onChange={(e) => setValidator({ ...validator, code: e.target.value.replace(/\D/g, '') })} /></Field>
          </fieldset>
        ) : null}
        {stale ? <Alert tone="warn" className="md:col-span-2">{t.stale}</Alert> : null}
        {error ? <Alert tone="block" className="md:col-span-2">{error}</Alert> : null}
      </div>
    </Dialog>
  );
}
