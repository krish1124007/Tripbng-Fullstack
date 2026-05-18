'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Sidebar } from '@/components/sidebar';
import { TopBar } from '@/components/topbar';
import { ProductTabs } from '@/components/product-tabs';
import { MobileBottomNav } from '@/components/mobile-bottom-nav';
import { Logo } from '@/components/logo';
import { useAuthStore } from '@/lib/auth-store';
import { useCartHydration } from '@/lib/cart';
import { usePaxBookHydration } from '@/lib/pax-book';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthStore((s) => s.hydrated);

  // Hydrate cross-cutting stores once at the layout level; cheap no-op after first run.
  useCartHydration();
  usePaxBookHydration();

  useEffect(() => {
    if (hydrated && !user) router.replace('/login');
  }, [user, hydrated, router]);

  if (!hydrated || !user) {
    return (
      <div className="grid min-h-screen place-items-center bg-surface-0">
        <div className="flex animate-fade-in flex-col items-center gap-4">
          <Logo variant="full" className="h-8" />
          <Loader2 className="h-4 w-4 animate-spin text-brand-500" strokeWidth={2} />
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-screen bg-surface-0">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <ProductTabs />
          <main
            id="main"
            className="mx-auto w-full max-w-[1440px] flex-1 animate-fade-in-up px-6 py-8 lg:px-8"
          >
            {children}
          </main>
          <MobileBottomNav />
        </div>
      </div>
    </TooltipProvider>
  );
}
