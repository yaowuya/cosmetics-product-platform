import { readResponse, sameOriginApiPath } from '../../shared/contracts.ts';

export type AdminMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** 管理调用的防伪值由当前会话显式传入，不写入 URL 或浏览器持久层。 */
export interface AdminOptions {
  body?: unknown;
  csrfToken?: string;
  signal?: AbortSignal;
}

/** 解析同源管理路由；拒绝外域地址和公开 API。 */
export function adminPath(path: string): string {
  return sameOriginApiPath(path, '/api/admin/');
}

/** 写入必须携带当前防伪值；表单上传由浏览器添加 multipart 边界。 */
export function adminRequestOptions(method: AdminMethod, options: AdminOptions = {}): RequestInit {
  const headers = new Headers();
  const request: RequestInit = { method, credentials: 'same-origin', redirect: 'error', headers };
  if (options.signal) request.signal = options.signal;
  if (method !== 'GET') {
    if (!options.csrfToken) throw new TypeError('Missing CSRF token');
    headers.set('X-CSRF-Token', options.csrfToken);
  }
  if (options.body !== undefined) {
    if (method === 'GET') throw new TypeError('GET cannot have a request body');
    if (options.body instanceof FormData) {
      request.body = options.body;
    } else {
      headers.set('Content-Type', 'application/json');
      request.body = JSON.stringify(options.body);
    }
  }
  return request;
}

/** 请求本企业管理 API，为调用方保留失败状态和字段问题。 */
export async function adminRequest<T>(path: string, method: AdminMethod, options?: AdminOptions): Promise<T | undefined> {
  return readResponse<T>(await fetch(adminPath(path), adminRequestOptions(method, options)));
}
