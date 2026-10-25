// Small fetch helpers that keep the status and the API's own error message.

export class HttpError extends Error {
  constructor(status, body, url) {
    super(`HTTP ${status} from ${new URL(url).host}: ${apiMessage(body) || 'request failed'}`);
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

// Google: {error:{message,status,details}} · OAuth: {error,error_description} · Canvas: {errors:[{message}]}
export function apiMessage(body) {
  if (!body) return '';
  if (typeof body === 'string') return body.slice(0, 200);
  if (body.error?.message) return body.error.message;
  if (body.error_description) return `${body.error}: ${body.error_description}`;
  if (typeof body.error === 'string') return body.error;
  if (Array.isArray(body.errors) && body.errors[0]?.message) return body.errors[0].message;
  return '';
}

// Google puts machine-readable reasons in a few places; collect them all.
export function apiReasons(body) {
  const e = body?.error;
  if (!e || typeof e !== 'object') return typeof e === 'string' ? [e] : [];
  const reasons = [e.status, ...(e.errors || []).map(x => x.reason), ...(e.details || []).map(d => d.reason)];
  return reasons.filter(Boolean);
}

async function readBody(r) {
  const text = await r.text();
  try { return JSON.parse(text); } catch { return text; }
}

export async function getJson(fetchImpl, url, headers = {}) {
  const r = await fetchImpl(url, { headers });
  const body = await readBody(r);
  if (!r.ok) throw new HttpError(r.status, body, url);
  return body;
}

export async function postForm(fetchImpl, url, form) {
  const r = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  const body = await readBody(r);
  if (!r.ok) throw new HttpError(r.status, body, url);
  return body;
}

export async function getText(fetchImpl, url, headers = {}) {
  const r = await fetchImpl(url, { headers });
  const text = await r.text();
  if (!r.ok) throw new HttpError(r.status, text, url);
  return text;
}
