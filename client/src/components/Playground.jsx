import { Fragment, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { groupMessages } from '../format.js';
import Avatar from './Avatar.jsx';
import Icon from './Icons.jsx';

const DEFAULT_SUGGESTIONS = ['Bạn có chấp nhận đổi trả hàng không?', 'Hãy cho tôi biết về doanh nghiệp của bạn', 'Phí giao hàng là bao nhiêu?'];
const newSessionId = () => `test-${crypto.randomUUID()}`;
const sideOf = (m) => (m.role === 'system' ? 'system' : m.role === 'customer' ? 'me' : 'them');

// "Đoạn chat thử nghiệm": chủ shop đóng vai khách để xem AI phản hồi (kênh test, không tạo đơn thật)
export default function Playground({ large = false }) {
  const [sessionId, setSessionId] = useState(newSessionId);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [cfg, setCfg] = useState(null);
  const [suggestions, setSuggestions] = useState(DEFAULT_SUGGESTIONS);
  const bodyRef = useRef(null);
  const seq = useRef(0);

  useEffect(() => {
    api('/admin/settings').then(setCfg).catch(() => {});
    api('/admin/knowledge')
      .then((list) => {
        const fromKb = list.filter((k) => k.active).slice(0, 3).map((k) => `Cho tôi biết về ${k.title.toLowerCase()}?`);
        if (fromKb.length >= 2) setSuggestions(fromKb);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, pending]);

  async function send(raw) {
    const t = raw.trim();
    if (!t || pending) return;
    setText('');
    setError('');
    seq.current += 1;
    setMessages((m) => [...m, { _id: `local-${seq.current}`, role: 'customer', text: t, createdAt: new Date().toISOString() }]);
    setPending(true);
    try {
      const d = await api('/admin/playground/message', { method: 'POST', body: { sessionId, text: t } });
      const extra = d.replies.length
        ? d.replies
        : [{ _id: `sys-${seq.current}`, role: 'system', text: 'AI đã chuyển cuộc trò chuyện cho nhân viên nên không trả lời nữa. Bấm làm mới để thử lại.', createdAt: new Date().toISOString() }];
      setMessages((m) => [...m, ...extra]);
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  }

  function reset() {
    api(`/admin/playground/${sessionId}`, { method: 'DELETE' }).catch(() => {});
    setSessionId(newSessionId());
    setMessages([]);
    setError('');
  }

  const botName = cfg?.botName || 'AI';
  const rows = groupMessages(messages, sideOf);

  return (
    <section className={`pg${large ? ' pg-large' : ''}`}>
      <div className="pg-top">
        <button className="pg-icon-btn" onClick={reset} title="Bắt đầu lại đoạn chat" aria-label="Làm mới đoạn chat">
          <Icon name="refresh" />
        </button>
      </div>

      <div className="pg-body" ref={bodyRef}>
        {messages.length === 0 ? (
          <div className="pg-intro">
            <Avatar name={cfg?.businessName || botName} size={64} />
            <h3>Đoạn chat thử nghiệm</h3>
            <p>Thử chat với AI như thể bạn là khách hàng. Xem phản hồi và đóng góp ý kiến để góp phần cải thiện AI.</p>
          </div>
        ) : (
          rows.map(({ m, side, first, last }) => (
            <Fragment key={m._id}>
              {side === 'system' ? (
                <div className="msg-system">{m.text}</div>
              ) : (
                <div className={`row row-${side}${first ? ' first' : ''}${last ? ' last' : ''}`}>
                  {side === 'them' && <span className="row-avatar">{last && <Avatar name={cfg?.businessName || botName} size={28} />}</span>}
                  <div className={`bubble b-${side}${first ? ' first' : ''}${last ? ' last' : ''}`}>{m.text}</div>
                </div>
              )}
              {m.toolCalls?.length > 0 && (
                <details className="pg-tools">
                  <summary>Xem AI đã làm gì ({m.toolCalls.length})</summary>
                  {m.toolCalls.map((tc, i) => (
                    <pre key={i}>{`${tc.name}(${JSON.stringify(tc.args)})\n→ ${JSON.stringify(tc.result).slice(0, 300)}`}</pre>
                  ))}
                </details>
              )}
            </Fragment>
          ))
        )}
        {pending && (
          <div className="row row-them first last">
            <span className="row-avatar"><Avatar name={cfg?.businessName || botName} size={28} /></span>
            <div className="bubble b-them typing"><span /><span /><span /></div>
          </div>
        )}
      </div>

      <div className="pg-foot">
        {messages.length === 0 && (
          <>
            <p className="pg-hint">Xem cách AI phản hồi những câu hỏi thường gặp này.</p>
            <div className="pg-chips">
              {suggestions.map((s) => (
                <button key={s} onClick={() => send(s)} title={s}>
                  <Icon name="sparkle" size={14} /> <span>{s}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {error && <p className="error pg-hint">{error}</p>}
        <form
          className="pg-input"
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
        >
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Khách hàng của bạn sẽ hỏi gì?" maxLength={2000} aria-label="Tin nhắn thử" />
          <button className="pg-icon-btn" disabled={!text.trim() || pending} aria-label="Gửi">
            <Icon name="send" size={18} />
          </button>
        </form>
      </div>
    </section>
  );
}
