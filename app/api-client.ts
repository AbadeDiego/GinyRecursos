export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
const pendingKeys = new Map<string, string>();
export async function api(path: string, method = 'GET', data?: unknown, files?: Record<string, File>) {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  const signature = method + path + JSON.stringify(data) + JSON.stringify(Object.entries(files || {}).map(([key,file])=>[key,file.name,file.size,file.lastModified]));
  if (method !== 'GET') {
    if (!pendingKeys.has(signature)) pendingKeys.set(signature, crypto.randomUUID());
    headers['Idempotency-Key'] = pendingKeys.get(signature)!;
  }
  if (files && Object.keys(files).length) {
    const form = new FormData();
    form.set('data', JSON.stringify(data || {}));
    Object.entries(files).forEach(([kind, file]) => form.set(kind, file));
    body = form;
  } else if (data !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(data); }
  const send = () => fetch('/api/' + path, { method, headers, body, credentials: 'same-origin', cache: 'no-store' });
  let response: Response;
  try { response = await send(); } catch { response = await send(); }
  const result = await response.json();
  pendingKeys.delete(signature);
  if (!response.ok) throw new ApiError(result.error || 'Não foi possível concluir a operação.', response.status);
  return result;
}
