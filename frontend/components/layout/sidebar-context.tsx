'use client';
import { createContext, useContext, useEffect, useState, useCallback } from 'react';

// Shared sidebar collapse state — lets the TopBar render the re-open hamburger
// inline (reserving layout space) while the Sidebar owns the panel itself.
// Persisted to localStorage so the collapsed state survives reloads.

const COLLAPSED_KEY = 'sidebar:collapsed';

type Ctx = { collapsed: boolean; toggle: () => void };

const SidebarContext = createContext<Ctx>({ collapsed: false, toggle: () => {} });

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSED_KEY) === '1');
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1');
      return !c;
    });
  }, []);

  return <SidebarContext.Provider value={{ collapsed, toggle }}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  return useContext(SidebarContext);
}

export function HamburgerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}
