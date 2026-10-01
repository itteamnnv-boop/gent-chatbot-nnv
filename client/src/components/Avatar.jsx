const COLORS = ['#0866FF', '#E41E3F', '#F7B928', '#31A24C', '#9360F7', '#FF66BF', '#2ABBA7', '#FB724B'];

// Avatar tròn chữ cái đầu (thay ảnh đại diện), có thể gắn chấm kênh / chấm online
export default function Avatar({ name = '?', size = 40, channel, online }) {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  const initials = words.slice(-2).map((w) => w[0]).join('').toUpperCase() || '?';
  const color = COLORS[[...String(name)].reduce((h, c) => h + c.charCodeAt(0), 0) % COLORS.length];
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: color }}>
      {initials}
      {channel && <span className={`avatar-ch ch-${channel}`} title={channel} />}
      {online && <span className="avatar-online" />}
    </span>
  );
}
