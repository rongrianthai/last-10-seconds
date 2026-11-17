// LAST FLOOR V17.3 — Node relay command validation.
// Keep game names and scoring on the browser; this module only validates chat events.
export const ALLOWED_COMMANDS = new Set([
  'เล่น', '1', '2', 'ทีม', 'คะแนน', 'อันดับ', 'เชียร์', 'เต้น', 'ท่าเต้น', 'โบกมือ'
]);

const TEAM_CHEER = /^(?:เชียร์\s*|CHEER\s+)(?:A|B|C|D|แดง|น้ำเงิน|เขียว|เหลือง)$/i;
export function allowedGameCommand(text) {
  return typeof text === 'string' &&
    (ALLOWED_COMMANDS.has(text) || TEAM_CHEER.test(text));
}
export function parseLiveComment(raw, source = 'live') {
  if (!raw || typeof raw !== 'object') return null;
  const user = raw.user ?? {};
  const userId = String(user.uniqueId || user.userId || raw.userId || '')
    .trim().replace(/^@/, '').slice(0, 60);
  const name = String(user.nickname || raw.name || userId).trim().slice(0, 50);
  const text = String(raw.comment ?? raw.text ?? '').trim().replace(/\s+/g, ' ').slice(0, 44);
  if (!userId || !name || !allowedGameCommand(text)) return null;
  return { userId, name, text, source: source === 'test' ? 'test' : 'live', ts: Date.now() };
}
export function validToken(given, expected, timingSafeEqual) {
  if (typeof given !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
export function makeRingBuffer(max = 5000) {
  let cursor = 0;
  const events = [];
  return {
    push(comment) {
      const next = { ...comment, seq: ++cursor };
      events.push(next);
      if (events.length > max) events.splice(0, events.length - max);
      return next;
    },
    after(last, limit = 500) {
      const newer = events.filter((ev) => ev.seq > last).slice(0, limit);
      return { comments: newer, cursor: newer.length ? newer.at(-1).seq : cursor };
    },
    currentCursor() { return cursor; }
  };
}
