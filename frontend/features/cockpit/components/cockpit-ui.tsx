// Moved to @/components/ui/SectionKit — these primitives are now shared with
// Ad Performance. This shim keeps every existing cockpit import path working;
// prefer importing from '@/components/ui' in new code.
export {
  cx,
  SecHead,
  SectionCard,
  Kpi,
  DetailPanel,
  cockpitStyles,
} from '@/components/ui/SectionKit';
