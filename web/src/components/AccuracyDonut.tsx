// SVG accuracy donut. Color-grades by score so the ring instantly conveys
// "good game / mediocre / rough" without the user reading the number.
//
//   95-100  → teal-brilliant  (#1baca6)  band: "Master"
//    85-94  → green-best      (#81b64c)  band: "Strong"
//    70-84  → mustard         (#f7c045)  band: "Decent"
//    50-69  → orange          (#ffa459)  band: "Weak"
//     0-49  → red             (#fa412d)  band: "Poor"

interface Props {
  /** Accuracy 0..100. */
  value: number | null | undefined;
  /** Outer SVG size in pixels. Default 96 — chess.com's donut. */
  size?: number;
  /** Optional micro-label above the donut. */
  label?: string;
  /** When true, render the skill band ("Master" / "Strong" / ...) below. */
  showBand?: boolean;
  /** Stroke width — defaults to 12 (chess.com is thick). */
  strokeWidth?: number;
}

interface AccuracyBand { color: string; nameEn: string; nameBg: string }

function bandFor(v: number): AccuracyBand {
  if (v >= 95) return { color: '#1baca6', nameEn: 'Master',  nameBg: 'Майстор' };
  if (v >= 85) return { color: '#81b64c', nameEn: 'Strong',  nameBg: 'Силен' };
  if (v >= 70) return { color: '#f7c045', nameEn: 'Decent',  nameBg: 'Прилично' };
  if (v >= 50) return { color: '#ffa459', nameEn: 'Weak',    nameBg: 'Слабо' };
  return         { color: '#fa412d', nameEn: 'Poor',    nameBg: 'Зле' };
}

export default function AccuracyDonut({ value, size = 96, label, showBand, strokeWidth = 12 }: Props) {
  const v = value == null || !Number.isFinite(value) ? null : Math.max(0, Math.min(100, value));
  const band = v == null ? { color: '#a09a93', nameEn: '—', nameBg: '—' } : bandFor(v);
  const r = (size - strokeWidth - 2) / 2;
  const c = 2 * Math.PI * r;
  const filled = v == null ? 0 : (v / 100) * c;
  // Integer + decimal split for chess.com-style display ("88" big, ".4" small)
  const intPart = v == null ? '—' : Math.floor(v);
  const decPart = v == null ? '' : `.${Math.round((v - Math.floor(v)) * 10)}`;

  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label ?? `Accuracy ${v ?? '—'}%`}>
        {/* Track */}
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(160,154,147,0.25)" strokeWidth={strokeWidth} fill="none" />
        {/* Filled arc */}
        <circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={band.color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${filled} ${c - filled}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        {/* Big integer part */}
        <text
          x="50%" y="50%"
          textAnchor="middle" dominantBaseline="central"
          fontSize={size * 0.32}
          fontWeight={700}
          fontFamily='"Roboto Mono", ui-monospace, monospace'
          fill="currentColor"
          dx={v == null ? 0 : -size * 0.05}
        >
          {intPart}
        </text>
        {/* Smaller decimal subscript — only when we have a numeric value */}
        {v != null && (
          <text
            x="50%" y="50%"
            textAnchor="start" dominantBaseline="central"
            fontSize={size * 0.14}
            fontWeight={600}
            fontFamily='"Roboto Mono", ui-monospace, monospace'
            fill="currentColor"
            dx={size * 0.10}
            dy={size * 0.06}
          >
            {decPart}
          </text>
        )}
      </svg>
      {label && <div className="mt-1 text-[10px] uppercase tracking-wide text-chesscom-500">{label}</div>}
      {showBand && v != null && (
        <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: band.color }}>
          {band.nameEn}
        </div>
      )}
    </div>
  );
}
