// Hình minh hoạ tự vẽ (SVG) cho các thẻ mẹo ở Trang chủ agent
const W = 216;
const H = 144;

function Frame({ id, from, to, children }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="tip-art" role="img" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <rect width={W} height={H} rx="6" fill={`url(#${id})`} />
      {children}
    </svg>
  );
}

export function OrdersArt() {
  return (
    <Frame id="g-orders" from="#c7d7ff" to="#e6d6ff">
      <rect x="48" y="22" width="150" height="104" rx="8" fill="#fff" />
      <rect x="48" y="22" width="150" height="20" rx="8" fill="#0064e0" />
      {[0, 1, 2].map((r) => (
        <g key={r}>
          <rect x="62" y={54 + r * 22} width="70" height="8" rx="4" fill="#d9e2ef" />
          <rect x="150" y={54 + r * 22} width="34" height="8" rx="4" fill="#9fc0ff" />
        </g>
      ))}
      <path d="M18 70h52l-6 50H24z" fill="#f7b928" />
      <path d="M30 70c0-14 28-14 28 0" stroke="#c98a00" strokeWidth="5" fill="none" />
      <circle cx="44" cy="96" r="9" fill="#fff" opacity=".7" />
    </Frame>
  );
}

export function TeachArt() {
  return (
    <Frame id="g-teach" from="#bcd3ff" to="#8fb5ff">
      <rect x="18" y="30" width="120" height="44" rx="22" fill="#fff" />
      <rect x="34" y="44" width="80" height="6" rx="3" fill="#0064e0" />
      <rect x="34" y="56" width="56" height="6" rx="3" fill="#9fc0ff" />
      <rect x="70" y="84" width="110" height="38" rx="19" fill="#0064e0" />
      <rect x="86" y="97" width="74" height="6" rx="3" fill="#fff" opacity=".9" />
      <circle cx="176" cy="44" r="22" fill="#ffe08a" />
      <path d="M170 56h12v6h-12z" fill="#c98a00" />
      <path d="M176 30a10 10 0 0 0-6 18h12a10 10 0 0 0-6-18z" fill="#fff" opacity=".8" />
    </Frame>
  );
}

export function HandoffArt() {
  return (
    <Frame id="g-handoff" from="#ffd6e6" to="#dccfff">
      <circle cx="58" cy="62" r="26" fill="#fff" />
      <circle cx="58" cy="54" r="9" fill="#9360f7" />
      <path d="M40 78c4-12 32-12 36 0" fill="#9360f7" />
      <circle cx="158" cy="62" r="26" fill="#fff" />
      <circle cx="158" cy="54" r="9" fill="#0064e0" />
      <path d="M140 78c4-12 32-12 36 0" fill="#0064e0" />
      <path d="M92 62h30" stroke="#1c2b33" strokeWidth="4" strokeLinecap="round" />
      <path d="M116 54l8 8-8 8" stroke="#1c2b33" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="40" y="104" width="136" height="16" rx="8" fill="#fff" opacity=".8" />
    </Frame>
  );
}

export function ChannelsArt() {
  return (
    <Frame id="g-channels" from="#cff3df" to="#cfe1ff">
      <rect x="38" y="26" width="140" height="92" rx="12" fill="#fff" />
      {[
        ['#0866ff', 70],
        ['#ee2a7b', 108],
        ['#25d366', 146],
      ].map(([c, x]) => (
        <g key={x}>
          <circle cx={x} cy="62" r="16" fill={c} />
          <path d={`M${x - 7} ${56}h14v9h-9l-5 4z`} fill="#fff" />
        </g>
      ))}
      <rect x="58" y="94" width="100" height="8" rx="4" fill="#d9e2ef" />
    </Frame>
  );
}
