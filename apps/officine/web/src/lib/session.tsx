import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { api, sessionLost, setCsrf } from './api';

export type Role = 'titulaire' | 'pharmacien' | 'preparateur' | 'caissier';
export type Grant = 'O' | 'R' | '-';

export interface Me {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  csrf: string;
  restriction: 'password_change' | 'totp_enrollment' | null;
  reauth_valid: boolean;
  permissions: Record<string, Grant>;
}

export interface SetupStatus {
  setup_done: boolean;
  ca_fingerprint: string | null;
  pharmacy_name: string | null;
}

interface SessionValue {
  me: Me | null;
  status: SetupStatus | null;
  loading: boolean;
  /** Vrai si le rôle a l'action (O ou R) : sert à masquer ce qui est interdit (le serveur décide toujours). */
  can: (action: string) => boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['setup-status'], queryFn: () => api<SetupStatus>('/setup/status'), retry: 1 });
  const me = useQuery({
    queryKey: ['me'],
    enabled: status.data?.setup_done === true,
    retry: false,
    queryFn: async () => {
      try {
        const m = await api<Me>('/auth/me', { noReauth: true });
        setCsrf(m.csrf);
        return m;
      } catch {
        setCsrf(null);
        return null;
      }
    },
  });
  useEffect(() => sessionLost.on(() => void qc.setQueryData(['me'], null)), [qc]);
  const value: SessionValue = {
    me: me.data ?? null,
    status: status.data ?? null,
    loading: status.isLoading || (status.data?.setup_done === true && me.isLoading),
    can: (a) => (me.data?.permissions[a] ?? '-') !== '-',
    refresh: async () => {
      await qc.invalidateQueries({ queryKey: ['setup-status'] });
      await qc.invalidateQueries({ queryKey: ['me'] });
    },
    logout: async () => {
      await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
      setCsrf(null);
      qc.clear();
      await qc.invalidateQueries();
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('SessionProvider manquant');
  return v;
}
