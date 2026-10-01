const TOKEN_KEY = 'admin_token';

const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // trình duyệt chặn storage: bỏ qua
    }
  },
};

export const auth = {
  get token() {
    return storage.get(TOKEN_KEY);
  },
  set(token) {
    storage.set(TOKEN_KEY, token);
  },
  clear() {
    storage.set(TOKEN_KEY, null);
  },
};

export function getChatSessionId() {
  let id = storage.get('chat_session_id');
  if (!id) {
    id = crypto.randomUUID();
    storage.set('chat_session_id', id);
  }
  return id;
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  const res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path.startsWith('/admin')) {
    auth.clear();
    window.location.assign('/admin/login');
  }
  if (!res.ok) throw new Error(data.error || `Lỗi ${res.status}`);
  return data;
}
