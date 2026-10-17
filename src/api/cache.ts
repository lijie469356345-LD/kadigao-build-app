// 简单前端缓存模块 - 带TTL的内存缓存
const store = new Map<string, { data: any; ts: number }>();
const DEFAULT_TTL = 5 * 60 * 1000; // 5分钟默认

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > DEFAULT_TTL) {
    store.delete(key);
    return null;
  }
  return entry.data as T;
}

export function cacheSet(key: string, data: any, ttl?: number): void {
  store.set(key, { data, ts: Date.now() });
  // 限制缓存大小，防止内存溢出
  if (store.size > 200) {
    const oldest = [...store.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) store.delete(oldest[0]);
  }
}

export function cacheClear(): void {
  store.clear();
}
