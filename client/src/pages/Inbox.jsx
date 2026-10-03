import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import Avatar from '../components/Avatar.jsx';
import Icon from '../components/Icons.jsx';
import { CHANNEL_LABEL, STAGE_LABEL, formatVND, groupMessages, separatorTime, timeAgo } from '../format.js';
import { can } from '../permissions.js';
import { createAdminSocket, INBOX_READ_EVENT } from '../socket.js';

const FILTERS = [
  { key: 'all', label: 'Tất cả', query: {} },
  { key: 'bot', label: 'AI xử lý', query: { mode: 'bot' } },
  { key: 'human', label: 'Nhân viên', query: { mode: 'human' } },
  { key: 'attention', label: 'Cần chú ý', query: { attention: '1' } },
];

const PAGE_PARAM_RE = /^\d{1,32}$/;
const EMPTY_PAGES = { restricted: false, canSeeOther: true, otherUnread: 0, pages: [] };

// Trùng định nghĩa phía server: "Ngoài Fanpage" = không phải test và (không phải Messenger hoặc chưa có pageId)
const isOtherSource = (c) => c.channel !== 'test' && (c.channel !== 'messenger' || !c.pageId);

const matchesPage = (c, page) => !page || (page === 'none' ? isOtherSource(c) : c.channel === 'messenger' && c.pageId === page);

const matchesFilter = (c, key, page) =>
  c.channel !== 'test' &&
  matchesPage(c, page) &&
  (key === 'all' || (key === 'bot' && c.mode === 'bot') || (key === 'human' && c.mode === 'human') || (key === 'attention' && c.needsAttention));

const customerName = (c) => c.customer?.name || c.checkout?.name || `Khách ${CHANNEL_LABEL[c.channel]} ${c.externalId.slice(-4)}`;

// Trong hộp thư của shop: khách ở bên trái, tin của shop (AI + nhân viên) ở bên phải
const sideOf = (m) => (m.role === 'system' ? 'system' : m.role === 'customer' ? 'them' : 'me');

function Thread({ messages, name }) {
  const rows = groupMessages(messages, sideOf);
  return rows.map(({ m, side, first, last, showTime }) => (
    <Fragment key={m._id}>
      {showTime && <div className="time-sep">{separatorTime(m.createdAt)}</div>}
      {side === 'system' ? (
        <div className="msg-system">{m.text}</div>
      ) : (
        <>
          <div className={`row row-${side}${first ? ' first' : ''}${last ? ' last' : ''}`}>
            {side === 'them' && <span className="row-avatar">{last && <Avatar name={name} size={28} />}</span>}
            <div
              className={`bubble b-${side}${m.role === 'agent' ? ' b-agent' : ''}${first ? ' first' : ''}${last ? ' last' : ''}`}
              title={new Date(m.createdAt).toLocaleString('vi-VN')}
            >
              {m.text}
            </div>
          </div>
          {side === 'me' && last && <div className="sent-by">{m.role === 'bot' ? 'Gửi bởi AI Agent' : 'Gửi bởi nhân viên'}</div>}
          {m.toolCalls?.length > 0 && (
            <details className="msg-tools">
              <summary>{m.toolCalls.length} thao tác của AI</summary>
              {m.toolCalls.map((t, i) => (
                <pre key={i}>{`${t.name}(${JSON.stringify(t.args)})\n→ ${JSON.stringify(t.result).slice(0, 400)}`}</pre>
              ))}
            </details>
          )}
        </>
      )}
    </Fragment>
  ));
}

export default function Inbox() {
  const { me } = useOutletContext();
  const canReply = can(me, 'inbox.reply');
  const [searchParams, setSearchParams] = useSearchParams();
  const rawPage = searchParams.get('page') || '';
  const page = rawPage === 'none' || PAGE_PARAM_RE.test(rawPage) ? rawPage : '';
  const [filter, setFilter] = useState('all');
  const [inboxPages, setInboxPages] = useState(EMPTY_PAGES);
  const [search, setSearch] = useState('');
  const [convs, setConvs] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');
  const selectedRef = useRef(null);
  const filterRef = useRef(filter);
  const pageRef = useRef(page);
  const listSeq = useRef(0);
  const pagesTimer = useRef(null);
  const threadBody = useRef(null);
  selectedRef.current = selectedId;
  filterRef.current = filter;
  pageRef.current = page;

  // URL là nguồn sự thật duy nhất của bộ chọn Page; giá trị rác thì xoá khỏi URL
  useEffect(() => {
    if (rawPage !== page) setSearchParams({}, { replace: true });
  }, [rawPage, page, setSearchParams]);

  const changePage = (next) => setSearchParams(next ? { page: next } : {}, { replace: true });

  const loadList = useCallback(() => {
    const params = new URLSearchParams(FILTERS.find((f) => f.key === filter).query);
    if (page) params.set('page', page);
    const qs = params.toString();
    const seq = (listSeq.current += 1);
    // Bỏ phản hồi cũ nếu người dùng đã đổi bộ lọc trong lúc chờ
    api(`/admin/conversations${qs ? `?${qs}` : ''}`)
      .then((list) => {
        if (seq === listSeq.current) setConvs(list);
      })
      .catch((e) => {
        if (seq === listSeq.current) setError(e.message);
      });
  }, [filter, page]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const loadPages = useCallback(() => {
    api('/admin/inbox/pages').then(setInboxPages).catch(() => {});
  }, []);

  useEffect(() => {
    loadPages();
  }, [loadPages]);

  useEffect(() => {
    if (!selectedId) return;
    setDetail(null);
    api(`/admin/conversations/${selectedId}`).then(setDetail).catch((e) => setError(e.message));
    api(`/admin/conversations/${selectedId}/read`, { method: 'POST' }).then(() => { loadPages(); window.dispatchEvent(new Event(INBOX_READ_EVENT)); }).catch(() => {});
    setConvs((list) => list.map((c) => (c._id === selectedId ? { ...c, unreadCount: 0 } : c)));
  }, [selectedId, loadPages]);

  useEffect(() => {
    const el = threadBody.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [detail?.messages?.length]);

  useEffect(() => {
    const socket = createAdminSocket();
    socket.on('message:new', ({ conversationId, message }) => {
      if (conversationId !== selectedRef.current) return;
      setDetail((d) => (d && !d.messages.some((m) => m._id === message._id) ? { ...d, messages: [...d.messages, message] } : d));
    });
    socket.on('conversation:update', (c) => {
      if (!c) return;
      clearTimeout(pagesTimer.current);
      pagesTimer.current = setTimeout(loadPages, 1000);
      const isOpen = c._id === selectedRef.current;
      const view = isOpen ? { ...c, unreadCount: 0 } : c;
      setConvs((list) => {
        const rest = list.filter((x) => x._id !== c._id);
        return matchesFilter(c, filterRef.current, pageRef.current) ? [view, ...rest] : rest;
      });
      if (isOpen) setDetail((d) => (d ? { ...d, conversation: c } : d));
    });
    socket.on('page:bot', ({ pageId, botEnabled }) => {
      const patch = (c) => (c.channel === 'messenger' && c.pageId === pageId ? { ...c, pageBotOff: !botEnabled } : c);
      setConvs((list) => list.map(patch));
      setDetail((d) => (d ? { ...d, conversation: patch(d.conversation) } : d));
      setInboxPages((ip) => ({ ...ip, pages: ip.pages.map((p) => (p.pageId === pageId ? { ...p, botEnabled } : p)) }));
    });
    socket.on('order:new', (o) => {
      if (String(o.conversation) === selectedRef.current) setDetail((d) => (d ? { ...d, orders: [o, ...d.orders] } : d));
    });
    return () => {
      clearTimeout(pagesTimer.current);
      socket.disconnect();
    };
  }, [loadPages]);

  async function sendReply(e) {
    e.preventDefault();
    const text = reply.trim();
    if (!text) return;
    setReply('');
    try {
      await api(`/admin/conversations/${selectedId}/messages`, { method: 'POST', body: { text } });
    } catch (err) {
      setError(err.message);
      setReply(text);
    }
  }

  async function setMode(mode) {
    try {
      await api(`/admin/conversations/${selectedId}/mode`, { method: 'POST', body: { mode } });
    } catch (err) {
      setError(err.message);
    }
  }

  const conv = detail?.conversation;
  const cartTotal = conv?.cart?.reduce((s, i) => s + i.price * i.quantity, 0) || 0;
  const q = search.trim().toLowerCase();
  const pageNameOf = (pageId) => inboxPages.pages.find((p) => p.pageId === pageId)?.name || `Page ${pageId}`;
  const sourceOf = (c) => (c.channel === 'messenger' && c.pageId ? pageNameOf(c.pageId) : CHANNEL_LABEL[c.channel]);
  const channelLine = (c) => (c.channel === 'messenger' && c.pageId ? `Messenger · ${pageNameOf(c.pageId)}` : CHANNEL_LABEL[c.channel]);
  const noPageAssigned = inboxPages.restricted && inboxPages.pages.length === 0 && !inboxPages.canSeeOther;
  const emptyText = noPageAssigned
    ? 'Bạn chưa được giao Page nào. Liên hệ quản trị viên để được phân Page.'
    : page === 'none'
      ? 'Không có hội thoại ngoài Fanpage.'
      : page
        ? 'Không có hội thoại nào của Page này.'
        : 'Chưa có hội thoại.';
  const visible = q ? convs.filter((c) => `${customerName(c)} ${c.lastMessagePreview}`.toLowerCase().includes(q)) : convs;

  return (
    <div className="inbox">
      <aside className="inbox-list">
        <div className="inbox-list-head">
          <h2>Hộp thư</h2>
          <label className="search-pill">
            <Icon name="search" size={16} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm kiếm" aria-label="Tìm hội thoại" />
          </label>
          {(inboxPages.pages.length > 0 || page !== '') && (
            <select className="inbox-page-select" aria-label="Lọc theo Fanpage" value={page} onChange={(e) => changePage(e.target.value)}>
              <option value="">{inboxPages.restricted ? 'Tất cả Page được giao' : 'Tất cả Page và kênh'}</option>
              {inboxPages.pages.map((p) => (
                <option key={p.pageId} value={p.pageId}>
                  {p.name || p.pageId}
                  {!p.connected ? ' (đã ngắt kết nối)' : ''}
                  {p.connected && p.status !== 'active' ? ' (cần kết nối lại)' : ''}
                  {p.botEnabled === false ? ' (bot đang tắt)' : ''}
                  {p.unread > 0 ? ` · ${p.unread} chưa đọc` : ''}
                </option>
              ))}
              {page !== '' && page !== 'none' && !inboxPages.pages.some((p) => p.pageId === page) && (
                <option value={page}>{page} (đã ngắt kết nối)</option>
              )}
              {inboxPages.canSeeOther && (
                <option value="none">
                  Ngoài Fanpage (Website, Instagram, WhatsApp)
                  {inboxPages.otherUnread > 0 ? ` · ${inboxPages.otherUnread} chưa đọc` : ''}
                </option>
              )}
            </select>
          )}
          <div className="tabs">
            {FILTERS.map((f) => (
              <button key={f.key} className={filter === f.key ? 'active' : ''} onClick={() => setFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {visible.length === 0 && <p className="muted pad">{emptyText}</p>}
        {visible.map((c) => {
          const unread = c.unreadCount > 0 && c._id !== selectedId;
          return (
            <button key={c._id} className={`conv-item${c._id === selectedId ? ' active' : ''}${unread ? ' unread' : ''}`} onClick={() => setSelectedId(c._id)}>
              <Avatar name={customerName(c)} size={48} channel={c.channel} />
              <div className="conv-main">
                <div className="conv-name">{customerName(c)}</div>
                <div className="conv-preview">
                  <span className="conv-preview-text">{c.lastMessagePreview}</span>
                  <span> · {timeAgo(c.lastMessageAt)}</span>
                </div>
                <div className="conv-badges">
                  <span className="badge badge-page" title={sourceOf(c)}>{sourceOf(c)}</span>
                  <span className={`badge stage-${c.stage}`}>{STAGE_LABEL[c.stage]}</span>
                  {c.mode === 'human' && <span className="badge badge-warn">Nhân viên</span>}
                  {c.pageBotOff && <span className="badge">Bot Page tắt</span>}
                  {c.needsAttention && <span className="badge badge-danger">Cần chú ý</span>}
                </div>
              </div>
              {unread && <span className="unread-dot" aria-label={`${c.unreadCount} tin chưa đọc`} />}
            </button>
          );
        })}
      </aside>

      <section className="thread">
        {!selectedId && (
          <div className="empty-thread">
            <Icon name="chat" size={48} />
            <p>Chọn một cuộc trò chuyện để bắt đầu</p>
          </div>
        )}
        {selectedId && !detail && <p className="muted pad">Đang tải...</p>}
        {conv && (
          <>
            <header className="thread-head">
              <Avatar name={customerName(conv)} size={40} channel={conv.channel} />
              <div className="thread-title">
                <strong>{customerName(conv)}</strong>
                <span className="muted">{channelLine(conv)} · {STAGE_LABEL[conv.stage]}</span>
                {conv.handoffReason && <span className="handoff-reason">Lý do chuyển: {conv.handoffReason}</span>}
              </div>
              {canReply &&
                (conv.mode === 'bot' ? (
                  <button className="btn-secondary" onClick={() => setMode('human')}>Tiếp quản</button>
                ) : (
                  <button className="btn" onClick={() => setMode('bot')}>Trả lại cho AI</button>
                ))}
            </header>
            <div className="thread-body" ref={threadBody}>
              <Thread messages={detail.messages} name={customerName(conv)} />
            </div>
            {canReply && (
              <form className="composer" onSubmit={sendReply}>
                <input
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder={conv.mode === 'bot' ? 'Trả lời (sẽ tự tiếp quản từ AI)...' : 'Trả lời...'}
                  aria-label="Trả lời"
                />
                <button className="send-btn" disabled={!reply.trim()} aria-label="Gửi"><Icon name="send" /></button>
              </form>
            )}
          </>
        )}
        {error && <p className="error pad">{error}</p>}
      </section>

      {conv && (
        <aside className="inbox-side">
          <div className="side-profile">
            <Avatar name={customerName(conv)} size={72} />
            <strong>{customerName(conv)}</strong>
            <span className="muted">{channelLine(conv)}</span>
          </div>
          <section className="side-card">
            <h4>Thông tin giao hàng</h4>
            <ul className="kv">
              <li><span>Tên</span><strong>{conv.checkout.name || '—'}</strong></li>
              <li><span>SĐT</span><strong>{conv.checkout.phone || '—'}</strong></li>
              <li><span>Địa chỉ</span><strong>{conv.checkout.address || '—'}</strong></li>
            </ul>
          </section>
          <section className="side-card">
            <h4>Giỏ hàng</h4>
            {conv.cart.length === 0 ? (
              <p className="muted">Trống</p>
            ) : (
              <ul className="kv">
                {conv.cart.map((i) => (
                  <li key={i.sku}><span>{i.name} ×{i.quantity}</span><strong>{formatVND(i.price * i.quantity)}</strong></li>
                ))}
                <li><span>Tạm tính</span><strong>{formatVND(cartTotal)}</strong></li>
                {conv.staffDiscount && (
                  <li><span>Ưu đãi NV{conv.staffDiscount.staffName ? ` (${conv.staffDiscount.staffName})` : ''}: {conv.staffDiscountView?.description}{conv.staffDiscountView && !conv.staffDiscountView.applied ? ' — chưa đủ điều kiện' : ''}</span><strong>-{formatVND(conv.staffDiscountView?.amount || 0)}</strong></li>
                )}
              </ul>
            )}
          </section>
          <section className="side-card">
            <h4>Đơn hàng ({detail.orders.length})</h4>
            {detail.orders.length === 0 && <p className="muted">Chưa có</p>}
            {detail.orders.map((o) => (
              <div key={o._id} className="mini-order">
                <strong>{o.code}</strong> · {formatVND(o.total)}
                <div className="muted">{o.items.map((i) => `${i.name} ×${i.quantity}`).join(', ')}</div>
              </div>
            ))}
          </section>
        </aside>
      )}
    </div>
  );
}
