import { PlatformSidebar } from '@/components/platform/PlatformSidebar';
import { PlatformTopBar } from '@/components/platform/PlatformTopBar';
import { MustChangePasswordGuard } from '@/components/platform/MustChangePasswordGuard';

// Platform (SaaS-owner) shell. Same shape as the tenant app shell
// (components/layout) — sidebar + topbar + main — restyled to the app's
// brand theme. The cross-tenant safety signal is carried by the danger pill
// in PlatformSidebar and the accent strip in PlatformTopBar, not a full-width
// red banner.
export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex bg-bg">
      <MustChangePasswordGuard />
      <PlatformSidebar />
      <div className="flex-1 flex flex-col">
        <PlatformTopBar />
        <main className="flex-1 p-6 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
