import RevenueLeakageScreen from '@/features/intelligence/components/RevenueLeakageScreen';

// /leakage — Revenue Leakage (DentaCFO gap module). Gated finance.view both in
// the nav (lib/permissions ROUTE_PERMISSION) and server-side on the route.
export default function LeakagePage() {
  return <RevenueLeakageScreen />;
}
