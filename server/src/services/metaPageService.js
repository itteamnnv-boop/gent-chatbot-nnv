import crypto from 'node:crypto';
import { config } from '../config.js';
import { MetaPage } from '../models/MetaPage.js';

export const META_OAUTH_SCOPES = 'pages_show_list,pages_messaging,pages_manage_metadata,business_management';
export const SESSION_TTL_MS = 10 * 60 * 1000;

const GRAPH_ORIGIN = 'https://graph.facebook.com';
const graphUrl = (path) => `${GRAPH_ORIGIN}/${config.meta.graphVersion}/${path}`;
const MAX_PAGING = 10;
const NOT_ALLOWED = 'Page không hợp lệ hoặc tài khoản không có quyền nhắn tin';

// Phiên OAuth lưu trong bộ nhớ (hệ thống chạy 1 tiến trình, giống khoá hội thoại)
const states = new Map(); // state -> { userId, expiresAt }
const sessions = new Map(); // sessionId -> { userId, expiresAt, pages: [{ pageId, name, accessToken, tasks }] }

function sweepExpired() {
  const now = Date.now();
  for (const map of [states, sessions]) {
    for (const [key, value] of map) if (value.expiresAt <= now) map.delete(key);
  }
}

export function isOAuthConfigured() {
  return Boolean(config.meta.appId && config.meta.appSecret && config.meta.oauthRedirectUri);
}

export function createOAuthState(userId) {
  sweepExpired();
  const state = crypto.randomBytes(24).toString('hex');
  states.set(state, { userId: String(userId), expiresAt: Date.now() + SESSION_TTL_MS });
  const params = new URLSearchParams({
    client_id: config.meta.appId,
    redirect_uri: config.meta.oauthRedirectUri,
    state,
    scope: META_OAUTH_SCOPES,
    response_type: 'code',
  });
  return `https://www.facebook.com/${config.meta.graphVersion}/dialog/oauth?${params}`;
}

// Gọi Graph cho các bước đổi token; chỉ ghi số bước và status, không log URL/token
async function getGraph(step, url, token) {
  try {
    const res = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
    if (!res.ok) {
      console.error(`[meta-oauth] bước ${step} lỗi HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch {
    console.error(`[meta-oauth] bước ${step} lỗi kết nối`);
    return null;
  }
}

export async function handleOAuthCallback({ code, state, error }) {
  sweepExpired();
  const entry = typeof state === 'string' ? states.get(state) : undefined;
  if (entry) states.delete(state); // state chỉ dùng một lần
  if (error) return { error: 'cancelled' };
  if (!entry || entry.expiresAt <= Date.now() || typeof code !== 'string' || !code) return { error: 'state' };

  const { appId, appSecret, oauthRedirectUri } = config.meta;
  const shortLived = await getGraph(
    3,
    graphUrl(`oauth/access_token?${new URLSearchParams({ client_id: appId, redirect_uri: oauthRedirectUri, client_secret: appSecret, code })}`),
  );
  if (!shortLived?.access_token) return { error: 'exchange' };

  const longLived = await getGraph(
    4,
    graphUrl(
      `oauth/access_token?${new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortLived.access_token,
      })}`,
    ),
  );
  if (!longLived?.access_token) return { error: 'exchange' };

  const pages = [];
  let url = graphUrl('me/accounts?fields=id,name,access_token,tasks&limit=100');
  for (let i = 0; url && i < MAX_PAGING; i += 1) {
    const data = await getGraph(5, url, longLived.access_token);
    if (!data || !Array.isArray(data.data)) return { error: 'exchange' };
    for (const p of data.data) {
      if (typeof p.id === 'string' && typeof p.access_token === 'string') {
        pages.push({ pageId: p.id, name: p.name || '', accessToken: p.access_token, tasks: Array.isArray(p.tasks) ? p.tasks : [] });
      }
    }
    const next = data.paging?.next;
    url = typeof next === 'string' && next.startsWith(`${GRAPH_ORIGIN}/`) ? next : null;
  }
  if (!pages.length) return { error: 'no_pages' };

  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, { userId: entry.userId, expiresAt: Date.now() + SESSION_TTL_MS, pages });
  return { sessionId };
}

function findSession(sessionId, userId) {
  const session = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
  if (!session || session.expiresAt <= Date.now() || session.userId !== String(userId)) return null;
  return session;
}

export async function getOAuthSession(sessionId, userId) {
  const session = findSession(sessionId, userId);
  if (!session) return null;
  const existing = new Set((await MetaPage.find({ pageId: { $in: session.pages.map((p) => p.pageId) } }).select('pageId').lean()).map((p) => p.pageId));
  return {
    pages: session.pages.map((p) => ({
      pageId: p.pageId,
      name: p.name,
      canMessage: p.tasks.includes('MESSAGING'),
      connected: existing.has(p.pageId),
    })),
  };
}

export function pageRow(page) {
  return {
    pageId: page.pageId,
    name: page.name,
    status: page.status,
    lastError: page.lastError,
    tasks: page.tasks,
    connectedBy: page.connectedBy,
    connectedAt: page.connectedAt,
  };
}

export async function connectPages(sessionId, userId, pageIds, username) {
  const session = findSession(sessionId, userId);
  if (!session) return null;
  const connected = [];
  const failed = [];
  for (const pageId of pageIds) {
    const page = session.pages.find((p) => p.pageId === pageId);
    if (!page || !page.tasks.includes('MESSAGING')) {
      failed.push({ pageId, name: page?.name ?? '', error: NOT_ALLOWED });
      continue;
    }
    try {
      const res = await fetch(graphUrl(`${pageId}/subscribed_apps`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${page.accessToken}` },
        body: JSON.stringify({ subscribed_fields: 'messages,messaging_postbacks' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error(`[meta-oauth] đăng ký webhook Page ${pageId} lỗi: ${err.message}`);
      failed.push({ pageId, name: page.name, error: 'Không đăng ký được webhook cho Page' });
      continue;
    }
    const saved = await MetaPage.findOneAndUpdate(
      { pageId },
      { name: page.name, accessToken: page.accessToken, tasks: page.tasks, status: 'active', lastError: '', connectedBy: username, connectedAt: new Date() },
      { upsert: true, returnDocument: 'after' },
    );
    connected.push(pageRow(saved));
  }
  sessions.delete(sessionId);
  return { connected, failed };
}

export async function disconnectPage(pageId) {
  const page = await MetaPage.findOne({ pageId }).select('+accessToken');
  if (!page) return false;
  try {
    await fetch(graphUrl(`${pageId}/subscribed_apps`), { method: 'DELETE', headers: { Authorization: `Bearer ${page.accessToken}` } });
  } catch {
    // best-effort: Facebook lỗi cũng vẫn ngắt kết nối phía mình
  }
  await page.deleteOne();
  return true;
}

export async function resolvePageToken(pageId) {
  if (pageId) {
    const page = await MetaPage.findOne({ pageId, status: 'active' }).select('+accessToken');
    if (page) return { token: page.accessToken, source: 'page' };
  }
  if (config.meta.pageAccessToken) return { token: config.meta.pageAccessToken, source: 'env' };
  return null;
}

export async function markPageInvalid(pageId, message) {
  await MetaPage.updateOne({ pageId }, { status: 'invalid', lastError: String(message).slice(0, 300) });
}

// Chỉ dùng trong test
export function _resetOAuthMemory() {
  states.clear();
  sessions.clear();
}
