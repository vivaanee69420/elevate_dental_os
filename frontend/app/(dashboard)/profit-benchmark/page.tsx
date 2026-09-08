// /profit-benchmark — Profit Benchmarking on its own route.
//
// It used to sit stacked underneath /profit, below a full P&L screen, so it was
// reachable only by scrolling past another report and had no nav entry of its
// own. It answers a different question from the P&L above it — "how do my cost
// ratios compare with the UK dental standard" rather than "what did I earn" —
// and carries its own source, practice and period filters, which read as
// belonging to the screen above when the two shared a page.
//
// NOTE: /benchmark is a DIFFERENT screen (growth benchmarking), which is why
// this route is not called that.
export { default } from '@/features/finance/components/ProfitBenchmarkScreen';
