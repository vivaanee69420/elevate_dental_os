import { Suspense } from 'react';
import { Sidebar } from '@/components/layout/sidebar';
import { TopBar } from '@/components/layout/topbar';
import { SectionTabs } from '@/components/layout/SectionTabs';
import { SidebarProvider } from '@/components/layout/sidebar-context';
import { ScopePeriodProvider } from '@/features/_shared/scope-context';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    // ScopePeriodProvider holds the analytics Scope/Period state (URL-synced).
    // Suspense is required because it reads useSearchParams (Next 14 app router).
    <Suspense fallback={null}>
      <ScopePeriodProvider>
        <SidebarProvider>
          <div className="min-h-screen flex bg-bg">
            <Sidebar />
            <div className="flex-1 flex flex-col min-w-0">
              <TopBar />
              <main className="flex-1 p-6 overflow-y-auto">
                <SectionTabs />
                {children}
              </main>
            </div>
          </div>
        </SidebarProvider>
      </ScopePeriodProvider>
    </Suspense>
  );
}
