/**
 * Pont avec l'application de bureau Tauri (W-05) : trois commandes seulement, exposées à l'origine
 * appairée. Dans un navigateur, ces fonctions retournent `null` et l'interface utilise l'impression
 * du système (secours prévu par V-06).
 */
interface TauriInternals {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

function tauri(): TauriInternals | null {
  const w = window as unknown as { __TAURI_INTERNALS__?: TauriInternals };
  return w.__TAURI_INTERNALS__ ?? null;
}

export const isDesktop = () => tauri() !== null;

export interface DeviceInfo {
  device_id: string;
  name: string;
  platform: string;
  app_version: string;
  printer: string | null;
}

export async function deviceInfo(): Promise<DeviceInfo | null> {
  const t = tauri();
  return t ? ((await t.invoke('device_info')) as DeviceInfo) : null;
}

export interface ReceiptPayload {
  lines: string[];
  open_drawer: boolean;
}

/** Impression ESC/POS directe (W-06) ; renvoie faux si l'application de bureau n'est pas là. */
export async function printReceipt(p: ReceiptPayload): Promise<boolean> {
  const t = tauri();
  if (!t) return false;
  await t.invoke('print_receipt', { receipt: p });
  return true;
}

export async function openCashDrawer(): Promise<boolean> {
  const t = tauri();
  if (!t) return false;
  await t.invoke('open_cash_drawer');
  return true;
}

/** Nom du poste de caisse : celui de l'application de bureau, sinon mémorisé dans le navigateur. */
export async function registerName(): Promise<string> {
  const info = await deviceInfo().catch(() => null);
  if (info) return info.name;
  try {
    const saved = localStorage.getItem('vp.register');
    if (saved) return saved;
  } catch {
    /* stockage indisponible */
  }
  return 'Navigateur';
}

export function saveRegisterName(name: string): void {
  try {
    localStorage.setItem('vp.register', name);
  } catch {
    /* stockage indisponible */
  }
}
