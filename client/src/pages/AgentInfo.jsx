import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { api } from '../api.js';
import Icon from '../components/Icons.jsx';
import Modal from '../components/Modal.jsx';
import Playground from '../components/Playground.jsx';
import { FIELD_LABEL, PRICE_LIST_TEMPLATE, parseCSV, rowsToProducts } from '../csv.js';
import { timeAgo } from '../format.js';
import { can } from '../permissions.js';

const readFileText = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Không đọc được tệp'));
    reader.readAsText(file, 'utf-8');
  });

// ---------- Hộp thoại: câu hỏi thường gặp ----------
function FaqModal({ item, onClose, onSaved }) {
  const [form, setForm] = useState({ title: item?.title || '', content: item?.content || '', tags: (item?.tags || []).join(', ') });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const body = { ...form, tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean) };
    try {
      if (item) await api(`/admin/knowledge/${item._id}`, { method: 'PUT', body });
      else await api('/admin/knowledge', { method: 'POST', body });
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Xoá "${item.title}"?`)) return;
    await api(`/admin/knowledge/${item._id}`, { method: 'DELETE' });
    onSaved();
  }

  return (
    <Modal title={item ? 'Sửa thông tin' : 'Thêm thông tin'} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <p className="mba-sub span-2">Thêm câu hỏi khách hay hỏi và câu trả lời bạn muốn AI dùng.</p>
        <label className="span-2">
          Câu hỏi hoặc chủ đề
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="VD: Sản phẩm X dùng để làm gì và cách sử dụng?" required />
        </label>
        <label className="span-2">
          Câu trả lời
          <textarea rows={6} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} required />
        </label>
        <label className="span-2">
          Từ khoá (không bắt buộc, phân cách bằng dấu phẩy)
          <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="VD: cách dùng, liều lượng" />
        </label>
        {error && <p className="error span-2">{error}</p>}
        <div className="span-2 form-actions">
          {item && <button type="button" className="btn-ghost danger" onClick={remove}>Xoá</button>}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn-ghost" onClick={onClose}>Huỷ</button>
          <button className="btn" disabled={busy}>Lưu</button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- Hộp thoại: các mục thông tin doanh nghiệp ----------
const SECTIONS = {
  basic: {
    title: 'Thông tin cơ bản',
    fields: [
      ['businessName', 'Tên doanh nghiệp', 'input'],
      ['botName', 'Tên trợ lý AI', 'input'],
      ['hotline', 'Số điện thoại / hotline', 'input'],
      ['openingHours', 'Giờ làm việc', 'input', 'VD: 7:30–17:30, thứ Hai đến thứ Bảy'],
      ['address', 'Địa chỉ cửa hàng', 'input'],
      ['businessInfo', 'Giới thiệu doanh nghiệp', 'textarea', 'Sản phẩm chủ lực, thế mạnh, cam kết...'],
    ],
  },
  shipping: {
    title: 'Mua hàng và vận chuyển',
    fields: [
      ['policies', 'Chính sách mua hàng, giao hàng, đổi trả', 'textarea', 'VD: Giao toàn quốc 2–5 ngày, được kiểm hàng, đổi trả trong 7 ngày nếu bao bì nguyên vẹn...'],
      ['shippingFee', 'Phí giao hàng (đ)', 'number'],
      ['freeShippingThreshold', 'Miễn phí ship cho đơn từ (đ, 0 = không áp dụng)', 'number'],
    ],
  },
  payment: {
    title: 'Thanh toán',
    fields: [['paymentInfo', 'Hình thức thanh toán', 'textarea', 'VD: COD toàn quốc; chuyển khoản trước qua tài khoản công ty (ghi rõ ngân hàng, số tài khoản, tên chủ tài khoản)...']],
  },
};

function SectionModal({ sectionKey, settings, onClose, onSaved }) {
  const section = SECTIONS[sectionKey];
  const [form, setForm] = useState(() => Object.fromEntries(section.fields.map(([k]) => [k, settings[k] ?? ''])));
  const [error, setError] = useState('');

  async function save(e) {
    e.preventDefault();
    const body = Object.fromEntries(section.fields.map(([k, , type]) => [k, type === 'number' ? Number(form[k] || 0) : form[k]]));
    try {
      await api('/admin/settings', { method: 'PUT', body });
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Modal title={section.title} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        {section.fields.map(([k, label, type, placeholder]) => (
          <label key={k} className={type === 'textarea' ? 'span-2' : ''}>
            {label}
            {type === 'textarea' ? (
              <textarea rows={5} value={form[k]} placeholder={placeholder} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            ) : (
              <input type={type === 'number' ? 'number' : 'text'} min={0} value={form[k]} placeholder={placeholder} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            )}
          </label>
        ))}
        {error && <p className="error span-2">{error}</p>}
        <div className="span-2 form-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>Huỷ</button>
          <button className="btn">Lưu</button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- Hộp thoại: nhập bảng giá ----------
function PriceListModal({ onClose, onSaved }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const parsed = text.trim() ? rowsToProducts(parseCSV(text)) : null;
  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(`﻿${PRICE_LIST_TEMPLATE}`)}`;

  async function pickFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (/\.xlsx?$/i.test(file.name)) {
      setError('Hãy lưu file Excel dưới dạng CSV UTF-8 (File > Save As) rồi chọn lại.');
      return;
    }
    setError('');
    setResult(null);
    setText(await readFileText(file));
  }

  async function submit() {
    if (!parsed?.columns.includes('sku')) {
      setError('Không thấy cột Mã SKU. Dòng đầu tiên phải là tiêu đề cột.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      setResult(await api('/admin/products/import', { method: 'POST', body: { rows: parsed.items } }));
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Thêm bảng giá" onClose={onClose}>
      <div className="form-grid">
        <p className="mba-sub span-2">
          Tải lên file CSV (Excel → Lưu thành CSV UTF-8) hoặc dán bảng giá. Sản phẩm trùng Mã SKU sẽ được cập nhật, SKU mới sẽ được tạo.{' '}
          <a href={templateHref} download="bang-gia-mau.csv">Tải file mẫu</a>
        </p>
        <label className="span-2 file-pick">
          <Icon name="upload" size={18} /> Chọn file CSV
          <input type="file" accept=".csv,.tsv,.txt,text/csv" onChange={pickFile} />
        </label>
        <label className="span-2">
          Hoặc dán nội dung
          <textarea rows={6} value={text} onChange={(e) => { setText(e.target.value); setResult(null); }} placeholder={PRICE_LIST_TEMPLATE} />
        </label>
        {parsed && (
          <div className="span-2 import-preview">
            <strong>{parsed.items.length} dòng</strong> · Cột nhận diện: {parsed.columns.map((c) => FIELD_LABEL[c]).join(', ') || 'không có'}
            {parsed.unknown.length > 0 && <div className="muted">Bỏ qua cột: {parsed.unknown.join(', ')}</div>}
          </div>
        )}
        {result && (
          <div className="span-2 import-result">
            <Icon name="checkCircle" size={18} /> Tạo mới {result.created} · Cập nhật {result.updated}
            {result.errorCount > 0 && <span className="error"> · {result.errorCount} dòng lỗi</span>}
            {result.errors.length > 0 && (
              <ul>{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>
            )}
          </div>
        )}
        {error && <p className="error span-2">{error}</p>}
        <div className="span-2 form-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>{result ? 'Đóng' : 'Huỷ'}</button>
          <button type="button" className="btn" disabled={!parsed?.items.length || busy} onClick={submit}>
            {busy ? 'Đang nhập...' : 'Nhập bảng giá'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Hộp thoại: tải tài liệu (Nguồn) ----------
function SourceModal({ onClose, onSaved }) {
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function upload() {
    setBusy(true);
    setError('');
    try {
      const text = await readFileText(file);
      await api('/admin/sources', { method: 'POST', body: { fileName: file.name, text } });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Thêm nguồn" onClose={onClose}>
      <div className="form-grid">
        <p className="mba-sub span-2">
          Tải lên tài liệu văn bản (.txt, .md, .csv): catalog, hướng dẫn kỹ thuật, chính sách... AI sẽ đọc và dùng để trả lời.
          Tải lại tệp cùng tên sẽ thay thế nội dung cũ. Với file Word/PDF, hãy lưu thành .txt trước.
        </p>
        <label className="span-2 file-pick">
          <Icon name="upload" size={18} /> {file ? file.name : 'Chọn tài liệu'}
          <input type="file" accept=".txt,.md,.csv,text/plain,text/markdown" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>
        {error && <p className="error span-2">{error}</p>}
        <div className="span-2 form-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>Huỷ</button>
          <button type="button" className="btn" disabled={!file || busy} onClick={upload}>{busy ? 'Đang xử lý...' : 'Tải lên'}</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Trang ----------
function InfoRow({ icon, label, right, onClick }) {
  return (
    <button type="button" className="info-row" onClick={onClick}>
      <Icon name={icon} size={18} />
      <span className="info-row-label">{label}</span>
      <span className="info-row-right">{right}</span>
    </button>
  );
}

const Setup = () => <span className="btn-outline sm">Thiết lập</span>;
const Warn = ({ children }) => (
  <span className="warn-badge"><Icon name="warning" size={13} /> {children}</span>
);
const Ago = ({ date }) => (date ? <span className="muted small">{timeAgo(date)}</span> : null);

export default function AgentInfo() {
  const { me } = useOutletContext();
  const navigate = useNavigate();
  const [settings, setSettings] = useState(null);
  const [products, setProducts] = useState([]);
  const [faqs, setFaqs] = useState([]);
  const [sources, setSources] = useState([]);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    Promise.all([api('/admin/settings'), api('/admin/products'), api('/admin/knowledge'), api('/admin/sources')])
      .then(([s, p, k, src]) => {
        setSettings(s);
        setProducts(p);
        setFaqs(k);
        setSources(src);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function removeSource(name) {
    if (!window.confirm(`Gỡ nguồn "${name}"? AI sẽ không dùng nội dung tài liệu này nữa.`)) return;
    await api(`/admin/sources/${encodeURIComponent(name)}`, { method: 'DELETE' }).catch((e) => setError(e.message));
    load();
  }

  const closeAndReload = () => {
    setModal(null);
    load();
  };

  if (!settings) return <p className="muted">{error || 'Đang tải...'}</p>;

  const up = settings.sectionUpdatedAt || {};
  const active = products.filter((p) => p.active);
  const incomplete = active.filter((p) => !p.description || p.stock === 0).length;
  const latestProduct = active.reduce((d, p) => (p.updatedAt > d ? p.updatedAt : d), '');

  const productRows = [
    {
      key: 'products',
      icon: 'bag',
      label: 'Sản phẩm',
      onClick: () => navigate('/admin/products'),
      right: active.length === 0 ? <Warn>Thêm thông tin</Warn> : incomplete ? <Warn>{incomplete} sản phẩm cần bổ sung</Warn> : <Ago date={latestProduct} />,
    },
    { key: 'pricelist', icon: 'receipt', label: 'Bảng giá', onClick: () => setModal({ type: 'pricelist' }), right: up.priceList ? <Ago date={up.priceList} /> : <Setup /> },
  ];
  const businessRows = [
    { key: 'basic', icon: 'briefcase', label: 'Thông tin cơ bản', filled: settings.businessInfo || settings.hotline, date: up.basic },
    { key: 'shipping', icon: 'doc', label: 'Mua hàng và vận chuyển', filled: settings.policies, date: up.shipping },
    { key: 'payment', icon: 'wallet', label: 'Thanh toán', filled: settings.paymentInfo, date: up.payment },
  ].map((r) => ({
    ...r,
    onClick: () => setModal({ type: 'section', key: r.key }),
    right: r.filled ? <Ago date={r.date || settings.updatedAt} /> : <Setup />,
  }));

  const q = search.trim().toLowerCase();
  const match = (...texts) => !q || texts.some((t) => String(t || '').toLowerCase().includes(q));
  const visibleProducts = productRows.filter((r) => match(r.label));
  const visibleBusiness = businessRows.filter((r) => match(r.label));
  const visibleFaqs = faqs.filter((k) => match(k.title, k.content));

  return (
    <div className="mba-home">
      <div className="mba-col">
        <section className="mba-card">
          <h3>Thêm thông tin</h3>
          <p className="mba-sub">Dạy AI cách phản hồi câu hỏi của khách hàng.</p>
          <div className="add-box">
            <button className="btn-outline" onClick={() => setModal({ type: 'faq' })}>
              <Icon name="addCircle" size={16} /> Thêm thông tin
            </button>
            <button className="btn-outline" onClick={() => setModal({ type: 'pricelist' })}>
              <Icon name="receipt" size={16} /> Thêm bảng giá
            </button>
          </div>
        </section>

        <section className="mba-card">
          <div className="card-title-row">
            <h3>Nguồn</h3>
            <button className="btn-outline sm" onClick={() => setModal({ type: 'source' })}>
              <Icon name="upload" size={14} /> Thêm nguồn
            </button>
          </div>
          <ul className="source-list">
            <li>
              <Icon name="box" size={18} />
              <span className="source-name">Danh mục sản phẩm <span className="muted small">· {active.length} sản phẩm đang bán</span></span>
              <span className="ok-badge"><Icon name="checkCircle" size={13} /> Đã kết nối</span>
            </li>
            {sources.map((s) => (
              <li key={s.name}>
                <Icon name="doc" size={18} />
                <span className="source-name">{s.name} <span className="muted small">· {s.chunks} đoạn · {timeAgo(s.updatedAt)}</span></span>
                <span className="ok-badge"><Icon name="checkCircle" size={13} /> Đã kết nối</span>
                <button className="mba-round sm" onClick={() => removeSource(s.name)} aria-label={`Gỡ nguồn ${s.name}`} title="Gỡ nguồn">
                  <Icon name="trash" size={16} />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="mba-card">
          <h3>
            Quản lý thông tin{' '}
            <span className="mba-hint" title="Mọi thông tin AI dùng để trả lời khách"><Icon name="info" size={14} /></span>
          </h3>
          <p className="mba-sub">
            AI sẽ dùng thông tin này về doanh nghiệp của bạn để phản hồi khách hàng. Hãy <Link to="/admin/playground">thử chat</Link> với AI để xem cách AI phản hồi.
          </p>
          <label className="info-search">
            <Icon name="search" size={18} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm kiếm thông tin" aria-label="Tìm kiếm thông tin" />
          </label>

          {visibleProducts.length > 0 && <h4 className="info-group">Thông tin về sản phẩm</h4>}
          {visibleProducts.map((r) => <InfoRow key={r.key} {...r} />)}

          {visibleBusiness.length > 0 && <h4 className="info-group">Thông tin doanh nghiệp</h4>}
          {visibleBusiness.map((r) => <InfoRow key={r.key} {...r} />)}

          <h4 className="info-group">Thông tin khác</h4>
          {visibleFaqs.length === 0 && (
            <p className="muted small">{q ? 'Không tìm thấy thông tin phù hợp.' : 'Chưa có. Bấm “Thêm thông tin” để thêm câu hỏi thường gặp.'}</p>
          )}
          {visibleFaqs.map((k) => (
            <InfoRow key={k._id} icon="info" label={k.title} right={<Ago date={k.updatedAt} />} onClick={() => setModal({ type: 'faq', item: k })} />
          ))}
          {error && <p className="error">{error}</p>}
        </section>
      </div>

      <aside className="mba-side">
        {can(me, 'playground.use') && <Playground />}
      </aside>

      {modal?.type === 'faq' && <FaqModal item={modal.item} onClose={() => setModal(null)} onSaved={closeAndReload} />}
      {modal?.type === 'section' && <SectionModal sectionKey={modal.key} settings={settings} onClose={() => setModal(null)} onSaved={closeAndReload} />}
      {modal?.type === 'pricelist' && <PriceListModal onClose={() => { setModal(null); load(); }} onSaved={load} />}
      {modal?.type === 'source' && <SourceModal onClose={() => setModal(null)} onSaved={load} />}
    </div>
  );
}
