import { create } from 'zustand';
import i18n from '@/i18n';

export type Locale = 'ar' | 'en';

interface UiState {
  locale: Locale;
  sidebarOpen: boolean;
  setLocale: (locale: Locale) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
}

export function applyDocumentDirection(locale: Locale): void {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
}

export const useUiStore = create<UiState>((set) => ({
  locale: 'ar',
  sidebarOpen: false,
  setLocale: (locale) => {
    void i18n.changeLanguage(locale);
    applyDocumentDirection(locale);
    set({ locale });
  },
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
}));
