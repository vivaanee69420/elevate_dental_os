// Pill badge. `tone` maps to the colour combos already used inline.
const TONES: Record<string, string> = {
  brand: 'bg-brand-50 text-brand',
  neutral: 'bg-bg',
  success: 'bg-green-50 text-success',
};

export function StatusBadge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: keyof typeof TONES | string;
}) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${TONES[tone] || TONES.neutral}`}>
      {children}
    </span>
  );
}
