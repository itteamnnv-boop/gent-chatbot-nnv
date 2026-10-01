import { Knowledge } from './models/Knowledge.js';
import { Product } from './models/Product.js';
import { Settings } from './models/Settings.js';

// DỮ LIỆU MẪU (giả lập) — thay bằng catalog/chính sách thật của bạn trong trang Admin
export const sampleProducts = [
  {
    sku: 'NPK-16168',
    name: 'Phân NPK 16-16-8+TE',
    category: 'Phân NPK',
    description: 'Phân hỗn hợp cân đối đạm-lân-kali, bổ sung trung vi lượng. Phù hợp bón thúc cho lúa, rau màu, cây ăn trái giai đoạn sinh trưởng.',
    usage: 'Tham khảo: lúa 150–200 kg/ha mỗi lần bón thúc; rau màu 20–30 kg/1000 m². Bón khi đất đủ ẩm, tránh bón lúc trời nắng gắt.',
    price: 420000,
    salePrice: 399000,
    unit: 'bao 25kg',
    stock: 200,
    tags: ['lúa', 'rau', 'cây ăn trái', 'bón thúc', 'npk'],
  },
  {
    sku: 'NPK-201515',
    name: 'Phân NPK 20-20-15',
    category: 'Phân NPK',
    description: 'Hàm lượng dinh dưỡng cao, giúp cây phát triển mạnh, tăng năng suất. Dùng cho cà phê, tiêu, sầu riêng, cây công nghiệp.',
    usage: 'Tham khảo: cà phê 0,4–0,6 kg/gốc/lần, 3–4 lần/năm mùa mưa.',
    price: 520000,
    unit: 'bao 25kg',
    stock: 150,
    tags: ['cà phê', 'tiêu', 'sầu riêng', 'cây công nghiệp', 'npk'],
  },
  {
    sku: 'URE-46',
    name: 'Phân Urê 46% đạm',
    category: 'Phân đơn',
    description: 'Phân đạm hàm lượng 46% N, giúp cây xanh lá, đẻ nhánh, phát triển thân lá nhanh.',
    usage: 'Tham khảo: lúa 80–120 kg/ha chia 2–3 lần. Không bón quá nhiều đạm giai đoạn cây ra hoa.',
    price: 650000,
    unit: 'bao 50kg',
    stock: 120,
    tags: ['đạm', 'ure', 'urea', 'lúa', 'ngô'],
  },
  {
    sku: 'DAP-1846',
    name: 'Phân DAP 18-46',
    category: 'Phân đơn',
    description: 'Phân lân-đạm hàm lượng cao, kích thích ra rễ, phát triển bộ rễ khoẻ, dùng bón lót rất tốt.',
    usage: 'Tham khảo: bón lót 100–150 kg/ha trước khi gieo trồng.',
    price: 1050000,
    unit: 'bao 50kg',
    stock: 80,
    tags: ['lân', 'dap', 'bón lót', 'ra rễ'],
  },
  {
    sku: 'KALI-60',
    name: 'Phân Kali clorua (KCl 60%)',
    category: 'Phân đơn',
    description: 'Kali giúp cây cứng cây, tăng khả năng chống chịu, tăng chất lượng và độ ngọt của trái, chắc hạt.',
    usage: 'Tham khảo: lúa 60–100 kg/ha giai đoạn đón đòng; cây ăn trái bón giai đoạn nuôi trái.',
    price: 600000,
    unit: 'bao 50kg',
    stock: 100,
    tags: ['kali', 'nuôi trái', 'chắc hạt', 'ngọt trái'],
  },
  {
    sku: 'HC-VS25',
    name: 'Phân hữu cơ vi sinh',
    category: 'Phân hữu cơ',
    description: 'Cải tạo đất, tăng độ tơi xốp, bổ sung vi sinh vật có ích, giúp cây hấp thu dinh dưỡng tốt hơn. An toàn cho rau sạch.',
    usage: 'Tham khảo: rau 100–150 kg/1000 m²; cây ăn trái 3–5 kg/gốc/năm.',
    price: 180000,
    salePrice: 165000,
    unit: 'bao 25kg',
    stock: 300,
    tags: ['hữu cơ', 'vi sinh', 'cải tạo đất', 'rau sạch', 'organic'],
  },
  {
    sku: 'LA-HOA500',
    name: 'Phân bón lá kích ra hoa, đậu trái',
    category: 'Phân bón lá',
    description: 'Giúp cây phân hoá mầm hoa, ra hoa đồng loạt, hạn chế rụng hoa và trái non.',
    usage: 'Pha 20–25 ml/bình 16 lít, phun ướt đều tán lá, 7–10 ngày/lần.',
    price: 85000,
    unit: 'chai 500ml',
    stock: 500,
    tags: ['ra hoa', 'đậu trái', 'rụng trái', 'phun lá', 'xoài', 'sầu riêng'],
  },
  {
    sku: 'LA-RE1L',
    name: 'Phân bón lá kích rễ cực mạnh',
    category: 'Phân bón lá',
    description: 'Kích thích ra rễ non nhanh, phục hồi cây suy yếu, dùng khi trồng mới hoặc sau ngập úng.',
    usage: 'Pha 30 ml/bình 16 lít, tưới gốc hoặc phun, 7 ngày/lần.',
    price: 120000,
    unit: 'chai 1 lít',
    stock: 400,
    tags: ['ra rễ', 'kích rễ', 'phục hồi', 'ngập úng', 'trồng mới'],
  },
  {
    sku: 'CA-BO1KG',
    name: 'Canxi Bo (Ca-B)',
    category: 'Trung vi lượng',
    description: 'Chống nứt trái, thối trái, giúp vỏ trái dày và bóng đẹp, tăng thời gian bảo quản.',
    usage: 'Pha 20–30 g/bình 16 lít, phun giai đoạn trái non và nuôi trái.',
    price: 95000,
    unit: 'gói 1kg',
    stock: 250,
    tags: ['canxi', 'bo', 'nứt trái', 'thối trái', 'vi lượng'],
  },
];

export const sampleKnowledge = [
  {
    title: 'Chính sách giao hàng',
    content: 'Giao toàn quốc qua đơn vị vận chuyển, 1–2 ngày nội tỉnh, 2–5 ngày liên tỉnh. Phí ship 30.000đ/đơn, miễn phí cho đơn từ 2.000.000đ. Được kiểm tra hàng trước khi nhận.',
    tags: ['ship', 'giao hàng', 'vận chuyển', 'phí ship', 'bao lâu'],
  },
  {
    title: 'Hình thức thanh toán',
    content: 'Thanh toán khi nhận hàng (COD) hoặc chuyển khoản trước. Shop không yêu cầu khách chuyển khoản qua chat cho người lạ — chỉ dùng tài khoản công ty in trên hoá đơn.',
    tags: ['thanh toán', 'cod', 'chuyển khoản', 'trả tiền'],
  },
  {
    title: 'Chính sách đổi trả',
    content: 'Đổi trả trong 7 ngày nếu bao bì còn nguyên vẹn, sản phẩm lỗi do nhà sản xuất hoặc giao sai hàng. Shop chịu phí vận chuyển nếu lỗi từ phía shop.',
    tags: ['đổi trả', 'hoàn hàng', 'lỗi', 'bảo hành'],
  },
  {
    title: 'Mua sỉ / đại lý',
    content: 'Đơn từ 50 bao trở lên hoặc muốn làm đại lý sẽ có giá sỉ riêng; nhân viên kinh doanh sẽ liên hệ báo giá.',
    tags: ['sỉ', 'đại lý', 'số lượng lớn', 'chiết khấu', 'giá sỉ'],
  },
  {
    title: 'Giờ làm việc',
    content: 'Trợ lý AI hỗ trợ 24/7. Nhân viên làm việc 7:30–17:30 từ thứ Hai đến thứ Bảy.',
    tags: ['giờ làm việc', 'mở cửa', 'liên hệ'],
  },
  {
    title: 'Lưu ý chung khi bón phân',
    content: 'Liều lượng chỉ mang tính tham khảo, cần điều chỉnh theo loại đất, giống cây và giai đoạn sinh trưởng. Đọc kỹ hướng dẫn trên bao bì; nên hỏi cán bộ kỹ thuật địa phương với trường hợp đặc thù.',
    tags: ['liều lượng', 'cách bón', 'hướng dẫn', 'kỹ thuật'],
  },
];

export const sampleSettings = {
  botName: 'Trợ lý Nông nghiệp',
  businessName: 'Cửa hàng Phân bón (demo)',
  greeting: 'Xin chào anh/chị! Em là trợ lý tư vấn phân bón. Anh/chị đang canh tác cây gì để em tư vấn sản phẩm phù hợp ạ?',
  businessInfo: 'Chuyên cung cấp phân bón NPK, phân đơn, phân hữu cơ vi sinh, phân bón lá và trung vi lượng cho bà con nông dân. Hàng chính hãng, có hoá đơn.',
  policies: 'Giao toàn quốc, COD. Đổi trả 7 ngày nếu bao bì nguyên vẹn. Đơn từ 50 bao có giá sỉ (chuyển nhân viên).',
  shippingFee: 30000,
  freeShippingThreshold: 2000000,
};

export async function seedDatabase({ reset = false } = {}) {
  if (reset) await Promise.all([Product.deleteMany({}), Knowledge.deleteMany({})]);
  await Product.create(sampleProducts); // create() để chạy hook tạo searchText
  await Knowledge.create(sampleKnowledge);
  const settings = await Settings.get();
  settings.set(sampleSettings);
  await settings.save();
}
