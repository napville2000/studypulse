// Fake fetch: routes are [RegExp | string-prefix, (url, opts) => {status?, json?, text?, headers?}]
export function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, opts });
    const hit = routes.find(([m]) => (m instanceof RegExp ? m.test(url) : url.startsWith(m)));
    if (!hit) throw new Error(`unexpected fetch ${url}`);
    const r = await hit[1](url, opts);
    const status = r.status ?? 200;
    const text = r.text ?? JSON.stringify(r.json ?? {});
    return {
      status, ok: status >= 200 && status < 300,
      headers: new Headers(r.headers || {}),
      text: async () => text,
    };
  };
  fn.calls = calls;
  return fn;
}
