// Phạm vi Page của người dùng cho Hộp thư và Đơn hàng. Chỉ chứa hàm thuần, không import model
// để realtime.js dùng được mà không bị vòng lặp import.

/** null = không giới hạn; ngược lại { pageIds: Set<string>, other: boolean } */
export function inboxScopeOf(user) {
  if (!user || user.role === 'admin' || user.inboxScope !== 'pages') return null;
  return { pageIds: new Set(user.pageIds || []), other: user.inboxOther === true };
}

/** Điều kiện Mongo cho Conversation hoặc Order: {} nếu không giới hạn; không có gì được phép thì { _id: null } */
export function scopeFilter(scope) {
  if (!scope) return {};
  const branches = [];
  if (scope.pageIds.size) branches.push({ channel: 'messenger', pageId: { $in: [...scope.pageIds] } });
  if (scope.other) {
    branches.push({ channel: { $nin: ['messenger', 'test'] } });
    branches.push({ channel: 'messenger', pageId: '' });
  }
  return branches.length ? { $or: branches } : { _id: null };
}

/** source = { channel, pageId } của hội thoại hoặc đơn */
export function canSee(scope, source) {
  if (!scope) return true;
  const channel = source?.channel;
  const pageId = source?.pageId || '';
  if (channel === 'messenger' && pageId) return scope.pageIds.has(pageId);
  return channel !== 'test' && scope.other;
}
