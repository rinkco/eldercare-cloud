/**
 * 地址栏查询参数工具。
 *
 * 静态导出（`output: export`）下页面无法用 `useSearchParams` 读取查询串：
 * 预渲染阶段没有 `window`，会触发 Suspense 边界问题，因此沿用现有页面的
 * `window.location.search` 读取 + `history.replaceState` 回写方式。
 */

/** 读取当前地址栏的查询参数，服务端/预渲染阶段返回 null。 */
export function readQueryParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

/**
 * 回写单个查询参数：保留其余参数与 hash，不产生历史记录（地址仍可刷新/分享）。
 * `value` 传 null 时删除该参数。
 */
export function replaceQueryParam(name: string, value: string | null): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (value === null) {
    params.delete(name);
  } else {
    params.set(name, value);
  }
  const search = params.toString();
  const query = search ? `?${search}` : "";
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${query}${window.location.hash}`
  );
}
