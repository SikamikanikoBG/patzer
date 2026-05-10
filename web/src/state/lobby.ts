import { create } from 'zustand';
import { api } from '../api';

export interface LobbyUser {
  id: number;
  username: string;
  display_name: string;
  avatar_emoji: string;
  online: boolean;
}

export interface Challenge {
  id: number;
  color: 'white' | 'black' | 'random';
  time_control: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
  game_id: number | null;
  created_at: string;
  from: { id: number; username: string; display_name: string; avatar_emoji: string };
  to:   { id: number; username: string; display_name: string; avatar_emoji: string };
}

type AcceptedNav = { challenge_id: number; game_id: number; your_color: 'white' | 'black'; time_control: string };

interface LobbyState {
  ws: WebSocket | null;
  online: Set<number>;
  users: LobbyUser[];
  incoming: Challenge[];
  outgoing: Challenge[];
  pendingAcceptedNav: AcceptedNav | null;
  consumeAcceptedNav: () => AcceptedNav | null;

  connect: () => void;
  disconnect: () => void;
  refreshUsers: () => Promise<void>;
  refreshChallenges: () => Promise<void>;
}

export const useLobby = create<LobbyState>((set, get) => ({
  ws: null,
  online: new Set(),
  users: [],
  incoming: [],
  outgoing: [],
  pendingAcceptedNav: null,
  consumeAcceptedNav: () => {
    const v = get().pendingAcceptedNav;
    if (v) set({ pendingAcceptedNav: null });
    return v;
  },

  connect: () => {
    if (get().ws) return;
    if (typeof window === 'undefined') return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/lobby`);
    set({ ws });
    ws.onopen = () => {
      void get().refreshUsers();
      void get().refreshChallenges();
    };
    ws.onmessage = (ev) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'presence_update' && Array.isArray(msg.online)) {
        set({ online: new Set(msg.online as number[]) });
        // Update users list with new online flags
        set((s) => ({ users: s.users.map((u) => ({ ...u, online: (msg.online as number[]).includes(u.id) })) }));
      } else if (msg.type === 'challenge_received') {
        set((s) => ({ incoming: [msg.challenge as Challenge, ...s.incoming.filter((c) => c.id !== (msg.challenge as Challenge).id)] }));
      } else if (msg.type === 'challenge_accepted') {
        set({ pendingAcceptedNav: msg as unknown as AcceptedNav });
        set((s) => ({ outgoing: s.outgoing.filter((c) => c.id !== (msg as { challenge_id: number }).challenge_id) }));
      } else if (msg.type === 'challenge_declined') {
        set((s) => ({ outgoing: s.outgoing.filter((c) => c.id !== (msg as { challenge_id: number }).challenge_id) }));
      } else if (msg.type === 'challenge_cancelled') {
        set((s) => ({ incoming: s.incoming.filter((c) => c.id !== (msg as { challenge_id: number }).challenge_id) }));
      }
    };
    ws.onclose = () => {
      set({ ws: null, online: new Set() });
      // Auto-reconnect with backoff
      setTimeout(() => {
        if (!get().ws) get().connect();
      }, 3000);
    };
    ws.onerror = () => { /* swallow; close handler will reconnect */ };
  },

  disconnect: () => {
    const ws = get().ws;
    if (ws) try { ws.close(); } catch { /* ignore */ }
    set({ ws: null, online: new Set() });
  },

  refreshUsers: async () => {
    try {
      const r = await api.get<{ users: LobbyUser[] }>('/api/lobby/users');
      set({ users: r.users });
    } catch { /* ignore */ }
  },

  refreshChallenges: async () => {
    try {
      const [inc, out] = await Promise.all([
        api.get<{ challenges: Challenge[] }>('/api/challenges/incoming'),
        api.get<{ challenges: Challenge[] }>('/api/challenges/outgoing'),
      ]);
      set({ incoming: inc.challenges, outgoing: out.challenges });
    } catch { /* ignore */ }
  },
}));
