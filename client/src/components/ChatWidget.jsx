import { Fragment, useEffect, useRef, useState } from 'react';
import { api, getChatSessionId } from '../api.js';
import { groupMessages, separatorTime } from '../format.js';
import { createCustomerSocket } from '../socket.js';
import Avatar from './Avatar.jsx';
import Icon from './Icons.jsx';

const QUICK_REPLIES = ['Tư vấn phân bón cho lúa', 'Phí ship bao nhiêu?', 'Tra cứu đơn hàng của tôi'];

function mergeMessages(list, incoming) {
  const seen = new Set(list.map((m) => m._id));
  const fresh = incoming.filter((m) => m && !seen.has(m._id));
  if (!fresh.length) return list;
  return [...list, ...fresh].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

const sideOf = (m) => (m.role === 'customer' ? 'me' : 'them');

export default function ChatWidget({ defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [sessionId] = useState(getChatSessionId);
  const [cfg, setCfg] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [pendingText, setPendingText] = useState(null);
  const [error, setError] = useState('');
  const bodyRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    api('/chat/config').then(setCfg).catch(() => {});
    api(`/chat/history?sessionId=${sessionId}`)
      .then((d) => setMessages((m) => mergeMessages(m, d.messages)))
      .catch(() => {});
    const socket = createCustomerSocket(sessionId);
    socket.on('message:new', (m) => setMessages((list) => mergeMessages(list, [m])));
    return () => socket.disconnect();
  }, [sessionId]);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, pendingText, open]);

  async function send(raw) {
    const t = raw.trim();
    if (!t || pendingText) return;
    setText('');
    setError('');
    setPendingText(t);
    try {
      const d = await api('/chat/message', { method: 'POST', body: { sessionId, text: t } });
      setMessages((list) => mergeMessages(list, d.messages));
    } catch (err) {
      setError(err.message);
      setText(t);
    } finally {
      setPendingText(null);
      inputRef.current?.focus();
    }
  }

  const botName = cfg?.botName || 'Trợ lý';
  // Tin của khách đã về qua socket thì không hiện bản tạm nữa
  const lastCustomer = [...messages].reverse().find((m) => m.role === 'customer');
  const shown = pendingText && lastCustomer?.text !== pendingText
    ? [...messages, { _id: 'pending', role: 'customer', text: pendingText, createdAt: new Date().toISOString(), pending: true }]
    : messages;
  const rows = groupMessages(shown, sideOf);

  return (
    <div className="cw">
      {open && (
        <section className="cw-panel" aria-label="Chat tư vấn">
          <header className="cw-head">
            <Avatar name={botName} size={32} online />
            <div className="cw-title">
              <strong>{botName}</strong>
              <small>Thường trả lời ngay</small>
            </div>
            <button className="cw-icon" onClick={() => setOpen(false)} aria-label="Thu nhỏ"><Icon name="minus" /></button>
            <button className="cw-icon" onClick={() => setOpen(false)} aria-label="Đóng"><Icon name="close" /></button>
          </header>

          <div className="cw-body" ref={bodyRef}>
            <div className="cw-intro">
              <Avatar name={botName} size={60} />
              <strong>{botName}</strong>
              <span>{cfg?.businessName}</span>
              <small>Thường trả lời ngay lập tức</small>
            </div>

            {cfg?.greeting && (
              <div className="row row-them first last">
                <span className="row-avatar"><Avatar name={botName} size={28} /></span>
                <div className="bubble b-them first last">{cfg.greeting}</div>
              </div>
            )}

            {rows.map(({ m, side, first, last, showTime }) => (
              <Fragment key={m._id}>
                {showTime && <div className="time-sep">{separatorTime(m.createdAt)}</div>}
                <div className={`row row-${side}${first ? ' first' : ''}${last ? ' last' : ''}`}>
                  {side === 'them' && <span className="row-avatar">{last && <Avatar name={botName} size={28} />}</span>}
                  <div className={`bubble b-${side}${first ? ' first' : ''}${last ? ' last' : ''}${m.pending ? ' pending' : ''}`}>
                    {m.text}
                  </div>
                </div>
                {m.role === 'agent' && last && <div className="sent-by">Nhân viên đã trả lời</div>}
              </Fragment>
            ))}

            {pendingText && (
              <div className="row row-them first last">
                <span className="row-avatar"><Avatar name={botName} size={28} /></span>
                <div className="bubble b-them typing" aria-label="Đang soạn tin">
                  <span /><span /><span />
                </div>
              </div>
            )}

            {!messages.length && !pendingText && (
              <div className="cw-quick">
                {QUICK_REPLIES.map((q) => (
                  <button key={q} onClick={() => send(q)}>{q}</button>
                ))}
              </div>
            )}
            {error && <div className="cw-error">{error}</div>}
          </div>

          <form
            className="cw-input"
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
          >
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Aa"
              maxLength={2000}
              aria-label="Tin nhắn"
            />
            {text.trim() ? (
              <button type="submit" className="cw-icon" disabled={!!pendingText} aria-label="Gửi"><Icon name="send" /></button>
            ) : (
              <button type="button" className="cw-icon" disabled={!!pendingText} onClick={() => send('👍')} aria-label="Gửi like">
                <Icon name="like" />
              </button>
            )}
          </form>
        </section>
      )}
      <button className="cw-fab" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Đóng chat' : 'Mở chat'}>
        <Icon name={open ? 'close' : 'chat'} size={28} />
      </button>
    </div>
  );
}
