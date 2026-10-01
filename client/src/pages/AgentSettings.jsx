import { useEffect, useState } from 'react';
import { api } from '../api.js';

// section: "info" (Thông tin của bạn) | "guidance" (Hướng dẫn) | "settings" (Cài đặt)
export default function AgentSettings({ section = 'settings' }) {
  const [s, setS] = useState(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    api('/admin/settings')
      .then((d) => setS({ ...d, handoffKeywords: d.handoffKeywords.join(', ') }))
      .catch((e) => setStatus(e.message));
  }, []);

  async function save(e) {
    e.preventDefault();
    setStatus('Đang lưu...');
    // botEnabled do công tắc ở header quản lý, không gửi lại giá trị cũ từ form
    const { botEnabled: _ignored, ...rest } = s;
    try {
      await api('/admin/settings', {
        method: 'PUT',
        body: {
          ...rest,
          shippingFee: Number(s.shippingFee),
          freeShippingThreshold: Number(s.freeShippingThreshold),
          temperature: Number(s.temperature),
          handoffKeywords: s.handoffKeywords.split(',').map((k) => k.trim()).filter(Boolean),
        },
      });
      setStatus('Đã lưu ✓');
    } catch (err) {
      setStatus(err.message);
    }
  }

  if (!s) return <p className="muted">{status || 'Đang tải...'}</p>;

  const input = (key, label, props = {}) => (
    <label>
      {label}
      <input value={s[key] ?? ''} onChange={(e) => setS({ ...s, [key]: e.target.value })} {...props} />
    </label>
  );
  const area = (key, label, hint, rows = 3) => (
    <label className="span-2">
      {label}
      {hint && <small className="muted">{hint}</small>}
      <textarea rows={rows} value={s[key] ?? ''} onChange={(e) => setS({ ...s, [key]: e.target.value })} />
    </label>
  );

  return (
    <form className="settings" onSubmit={save}>
      {section === 'info' && (
        <section className="mba-card form-grid">
          <div className="span-2">
            <h3>Thông tin doanh nghiệp</h3>
            <p className="mba-sub">AI dùng những thông tin này để trả lời khách. Chi tiết hơn hãy thêm vào Câu hỏi thường gặp bên dưới.</p>
          </div>
          {input('businessName', 'Tên doanh nghiệp')}
          {input('botName', 'Tên trợ lý AI')}
          {area('businessInfo', 'Giới thiệu doanh nghiệp', 'Sản phẩm chủ lực, cam kết, địa chỉ cửa hàng, giờ mở cửa...')}
          {area('policies', 'Chính sách', 'Giao hàng, đổi trả, thanh toán, bảo hành...')}
          {input('shippingFee', 'Phí giao hàng (đ)', { type: 'number', min: 0 })}
          {input('freeShippingThreshold', 'Miễn phí ship cho đơn từ (đ, 0 = không áp dụng)', { type: 'number', min: 0 })}
        </section>
      )}

      {section === 'guidance' && (
        <>
          <section className="mba-card form-grid">
            <div className="span-2">
              <h3>Giọng điệu & cách trả lời</h3>
              <p className="mba-sub">Hướng dẫn AI cách xưng hô, phong cách và những điều cần lưu ý khi tư vấn.</p>
            </div>
            {area('greeting', 'Lời chào', 'Hiển thị khi khách mở khung chat trên website', 2)}
            {area('tone', 'Giọng điệu', 'Cách xưng hô, độ dài câu trả lời...', 2)}
            {area('customInstructions', 'Hướng dẫn bổ sung', 'Vd: luôn gợi ý mua kèm phân hữu cơ; không tư vấn thuốc BVTV...')}
          </section>
          <section className="mba-card form-grid">
            <div className="span-2">
              <h3>Chuyển cho nhân viên</h3>
              <p className="mba-sub">Khi nào AI dừng lại và chuyển cuộc trò chuyện cho đội ngũ của bạn.</p>
            </div>
            {area('handoffRules', 'Tình huống AI tự chuyển cho nhân viên')}
            <label className="span-2">
              Từ khoá chuyển ngay (phân cách bằng dấu phẩy)
              <input value={s.handoffKeywords} onChange={(e) => setS({ ...s, handoffKeywords: e.target.value })} />
            </label>
            {area('handoffMessage', 'Tin nhắn gửi khách khi chuyển', null, 2)}
          </section>
        </>
      )}

      {section === 'settings' && (
        <section className="mba-card form-grid">
          <div className="span-2">
            <h3>Mô hình OpenAI</h3>
            <p className="mba-sub">Bật/tắt AI ở công tắc góc trên bên phải.</p>
          </div>
          {input('model', 'Model (để trống = dùng OPENAI_MODEL trong .env)', { placeholder: 'vd: gpt-4.1-mini' })}
          {input('temperature', 'Temperature (0–1.5, thấp = ổn định hơn)', { type: 'number', step: 0.1, min: 0, max: 1.5 })}
        </section>
      )}

      <div className="form-actions">
        <span className="muted">{status}</span>
        <button className="btn">Lưu</button>
      </div>
    </form>
  );
}
