/**
 * The idea in one picture: the same slide on several phones at once.
 * Inline SVG colored with the app's theme variables, so it follows light and dark mode.
 */

const PHONES = [
  { x: 4, y: 40, tilt: -6 },
  { x: 114, y: 14, tilt: -2 },
  { x: 224, y: 26, tilt: 3 },
  { x: 334, y: 46, tilt: 7 },
];

function Phone({ x, y, tilt, live }: { x: number; y: number; tilt: number; live: boolean }) {
  // Phone: 96 × 184, screen inset 7, slide content scaled inside the screen.
  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt} 48 92)`}>
      <rect x="0" y="0" width="96" height="184" rx="16" fill="var(--surface)" stroke="var(--ink)" strokeWidth="2.5" />
      <rect x="7" y="9" width="82" height="166" rx="10" fill="var(--bg)" />
      <rect x="38" y="13" width="20" height="4" rx="2" fill="var(--ink-3)" />
      {/* the slide: identical on every phone */}
      <rect x="13" y="48" width="70" height="88" rx="6" fill="var(--surface)" stroke="var(--line)" />
      <rect x="20" y="58" width="44" height="7" rx="3.5" fill="var(--accent)" />
      <rect x="20" y="74" width="56" height="4" rx="2" fill="var(--ink-3)" />
      <rect x="20" y="84" width="50" height="4" rx="2" fill="var(--ink-3)" />
      <rect x="20" y="94" width="54" height="4" rx="2" fill="var(--ink-3)" />
      <rect x="20" y="104" width="38" height="4" rx="2" fill="var(--ink-3)" />
      {/* "in sync" dot */}
      <circle cx="48" cy="160" r="4" fill={live ? "var(--ok)" : "var(--ink-3)"} />
    </g>
  );
}

export default function PhonesIllustration({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="-14 -4 468 252"
      role="img"
      aria-label="The same slide showing on four phones at once"
    >
      {PHONES.map((p, i) => (
        <Phone key={i} {...p} live />
      ))}
    </svg>
  );
}
