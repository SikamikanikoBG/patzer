import { create } from 'zustand';
import { api } from '../api';

export type Role = 'admin' | 'user';
export type Language = 'en' | 'bg';
export type Audience = 'kid' | 'beginner' | 'intermediate' | 'advanced';
export type CoachBehavior = 'silent' | 'on_demand' | 'always_on_pedagogical';

export type BoardTheme = 'wood' | 'green' | 'blue';
export type SiteTheme = 'light' | 'dark' | 'auto';

export interface Profile {
  user_id: number;
  display_name: string;
  avatar_emoji: string;
  language: Language;
  audience: Audience;
  chesscom_username: string | null;
  coach_behavior: CoachBehavior;
  tts_enabled: number;
  tts_voice: string | null;
  tts_rate: number;
  tts_pitch: number;
  board_theme: BoardTheme;
  piece_set: string;
  site_theme: SiteTheme;
  blunder_warning: number;
  sound_enabled: number;
}

export interface User {
  id: number;
  username: string;
  role: Role;
  created_at: string;
  profile: Profile;
}

interface AuthState {
  loading: boolean;
  setupRequired: boolean | null;
  user: User | null;
  refresh: () => Promise<void>;
  setUser: (u: User | null) => void;
}

export const useAuth = create<AuthState>((set) => ({
  loading: true,
  setupRequired: null,
  user: null,
  refresh: async () => {
    set({ loading: true });
    try {
      const status = await api.get<{ setup_required: boolean }>('/api/setup/status');
      if (status.setup_required) {
        set({ loading: false, setupRequired: true, user: null });
        return;
      }
      const me = await api.get<{ user: User | null }>('/api/auth/me');
      set({ loading: false, setupRequired: false, user: me.user });
    } catch {
      set({ loading: false, setupRequired: null, user: null });
    }
  },
  setUser: (u) => set({ user: u }),
}));
