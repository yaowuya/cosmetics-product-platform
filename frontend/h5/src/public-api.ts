import { readResponse, sameOriginApiPath } from '../../shared/contracts.ts';

/** 解析公开展示入口，只接收 public 路由族。 */
export function publicPath(path: string): string {
  return sameOriginApiPath(path, '/api/public/');
}

/** 公开读取即使发生在已登录浏览器里也不携带管理会话。 */
export function publicRequestOptions(signal?: AbortSignal): RequestInit {
  return { method: 'GET', credentials: 'omit', redirect: 'error', ...(signal && { signal }) };
}

/** 向当前站点读取公开投影；不接受预览数据源或调用方自定义请求方法。 */
export async function publicGet<T>(path: string, signal?: AbortSignal): Promise<T | undefined> {
  return readResponse<T>(await fetch(publicPath(path), publicRequestOptions(signal)));
}
