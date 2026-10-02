import OpenAI from 'openai';
import { config } from '../config.js';
import { Product } from '../models/Product.js';
import { activePromotionsFor } from '../services/promotionService.js';
import { buildSystemPrompt } from './prompt.js';
import { executeTool, toolDefinitions } from './tools.js';

const FALLBACK_REPLY = 'Dạ anh/chị cho em xin thêm chút thông tin để em hỗ trợ chính xác hơn ạ.';

let defaultClient = null;
export function getOpenAIClient() {
  if (!config.openai.apiKey) throw new Error('OPENAI_API_KEY chưa được cấu hình');
  defaultClient ??= new OpenAI({ apiKey: config.openai.apiKey });
  return defaultClient;
}

// Model suy luận (o-series, gpt-5) không nhận tham số temperature
const supportsTemperature = (model) => !/^(o\d|gpt-5)/.test(model);

/**
 * Vòng lặp agent: model -> (tool calls -> kết quả) lặp lại -> câu trả lời cuối.
 * @param {object} p
 * @param {Array<{role:'user'|'assistant', content:string}>} p.history lịch sử đã gồm tin nhắn mới nhất
 * @param {OpenAI} p.client cho phép inject client giả khi test
 */
export async function runAgent({ conversation, customer, settings, history, client }) {
  const model = settings.model || config.openai.model;
  const categories = (await Product.distinct('category', { active: true })).filter(Boolean);
  // pageId của Instagram là ID tài khoản IG, không phải Page: chỉ Messenger mới nhận KM riêng của Page
  const promoPageId = conversation.channel === 'messenger' ? conversation.pageId : '';
  const promotions = await activePromotionsFor(promoPageId, new Date());
  const ctx = { conversation, customer, settings, promotions, events: [] };
  const toolLog = [];

  const messages = [{ role: 'system', content: buildSystemPrompt({ settings, conversation, customer, categories, promotions }) }, ...history];

  const call = (extra = {}) =>
    client.chat.completions.create({
      model,
      messages,
      tools: toolDefinitions,
      ...(supportsTemperature(model) ? { temperature: settings.temperature } : {}),
      ...extra,
    });

  for (let step = 0; step < config.agent.maxToolSteps; step += 1) {
    const completion = await call();
    const msg = completion.choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls?.length) {
      return { text: msg.content?.trim() || FALLBACK_REPLY, toolLog, events: ctx.events };
    }

    for (const tc of msg.tool_calls) {
      let args = {};
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        // model trả JSON lỗi -> chạy với args rỗng, handler sẽ báo lỗi
      }
      const result = await executeTool(tc.function.name, args, ctx);
      toolLog.push({ name: tc.function.name, args, result });
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
    }
  }

  // Hết số vòng cho phép: buộc model trả lời bằng văn bản
  const final = await call({ tool_choice: 'none' });
  return { text: final.choices[0].message.content?.trim() || FALLBACK_REPLY, toolLog, events: ctx.events };
}
