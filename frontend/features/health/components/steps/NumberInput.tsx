export function NumberInput({
  label,
  helper,
  value,
  onChange,
  placeholder,
  prefix,
  required,
}: any) {
  return (
    <div>
      <label className="text-xs font-semibold">
        {label} {required && <span className="text-danger">*</span>}
      </label>
      {helper && <div className="text-[11px] text-ink-muted mb-1.5">{helper}</div>}
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">{prefix}</span>
        )}
        <input
          type="number"
          value={value ?? ''}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          placeholder={placeholder}
          className={`input w-full ${prefix ? 'pl-7' : ''}`}
        />
      </div>
    </div>
  );
}
