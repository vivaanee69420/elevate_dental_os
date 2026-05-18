export function NavButtons({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <div className="flex justify-between gap-3">
      <button onClick={onBack} className="btn-ghost">← Back</button>
      <button onClick={onNext} className="btn-primary">Continue →</button>
    </div>
  );
}
