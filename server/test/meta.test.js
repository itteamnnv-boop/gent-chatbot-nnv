import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import { parseMetaWebhook, verifyMetaSignature } from '../src/channels/meta.js';
import { chunkText, isValidPhone, normalize, tokenize } from '../src/utils/text.js';

describe('Meta webhook', () => {
  it('parse Messenger, bỏ qua echo', () => {
    const body = {
      object: 'page',
      entry: [
        {
          id: 'PAGE1',
          messaging: [
            { sender: { id: '111' }, message: { mid: 'm1', text: 'Xin chào' } },
            { sender: { id: 'PAGE' }, message: { mid: 'm2', text: 'echo', is_echo: true } },
            { sender: { id: '111' }, postback: { title: 'Bắt đầu', payload: 'GET_STARTED', mid: 'm3' } },
          ],
        },
      ],
    };
    assert.deepEqual(parseMetaWebhook(body), [
      { channel: 'messenger', externalId: '111', text: 'Xin chào', externalMessageId: 'm1', pageId: 'PAGE1' },
      { channel: 'messenger', externalId: '111', text: 'Bắt đầu', externalMessageId: 'm3', pageId: 'PAGE1' },
    ]);
  });

  it('entry không có id thì không có khoá pageId', () => {
    const body = { object: 'page', entry: [{ messaging: [{ sender: { id: '111' }, message: { mid: 'm1', text: 'Xin chào' } }] }] };
    const [msg] = parseMetaWebhook(body);
    assert.equal('pageId' in msg, false);
  });

  it('parse WhatsApp Cloud API kèm tên', () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: {
        contacts: [{ wa_id: '84901234567', profile: { name: 'Lan' } }],
        messages: [{ from: '84901234567', id: 'wamid.1', type: 'text', text: { body: 'Giá bao nhiêu?' } }],
      } }] }],
    };
    assert.deepEqual(parseMetaWebhook(body), [
      { channel: 'whatsapp', externalId: '84901234567', text: 'Giá bao nhiêu?', externalMessageId: 'wamid.1', profileName: 'Lan' },
    ]);
  });

  it('xác thực chữ ký X-Hub-Signature-256', () => {
    const raw = Buffer.from('{"a":1}');
    const sig = `sha256=${crypto.createHmac('sha256', 'secret').update(raw).digest('hex')}`;
    assert.equal(verifyMetaSignature(raw, sig, 'secret'), true);
    assert.equal(verifyMetaSignature(raw, sig, 'wrong'), false);
    assert.equal(verifyMetaSignature(raw, undefined, 'secret'), false);
  });
});

describe('Tiện ích văn bản', () => {
  it('bỏ dấu tiếng Việt', () => {
    assert.equal(normalize('Phân Bón ĐẠM Urê'), 'phan bon dam ure');
    assert.deepEqual(tokenize('cho tôi mua phân cho lúa'), ['phan', 'lua']);
  });
  it('kiểm tra SĐT', () => {
    assert.equal(isValidPhone('+84 901 234 567'), true);
    assert.equal(isValidPhone('0901.234.567'), true);
    assert.equal(isValidPhone('12345'), false);
  });
  it('chia tin nhắn dài', () => {
    const parts = chunkText('a '.repeat(3000), 1900);
    assert.ok(parts.every((p) => p.length <= 1900));
  });
});
