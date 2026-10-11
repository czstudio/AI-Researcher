// In-process pub/sub for live task progress (feeds GET /api/chat/ SSE).

const channels = new Map();

export function subscribe(sessionId, fn) {
  if (!channels.has(sessionId)) channels.set(sessionId, new Set());
  channels.get(sessionId).add(fn);
  return () => channels.get(sessionId)?.delete(fn);
}

export function publish(sessionId, event) {
  const set = channels.get(sessionId);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(event);
    } catch {
      /* a dead client must not break the run */
    }
  }
}

export function subscriberCount(sessionId) {
  return channels.get(sessionId)?.size || 0;
}
