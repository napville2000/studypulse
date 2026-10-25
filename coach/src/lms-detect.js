// Work out which learning system a college portal runs, from its login page and redirect chain.

const RULES = [
  { id: 'canvas', name: 'Canvas', url: /instructure\.com|canvas/i, body: /instructure|canvas-lms|canvas_|"canvas"/i, header: /x-canvas-meta/i },
  { id: 'd2l', name: 'D2L Brightspace', url: /brightspace|\/d2l\//i, body: /d2l|brightspace/i },
  { id: 'blackboard', name: 'Blackboard', url: /blackboard|\/ultra\b|\/webapps\/login/i, body: /blackboard learn|bbcswebdav|blackboard/i },
  { id: 'moodle', name: 'Moodle', url: /moodle/i, body: /moodle/i },
  { id: 'schoology', name: 'Schoology', url: /schoology/i, body: /schoology/i },
  { id: 'sakai', name: 'Sakai', url: /sakai|\/portal\/xlogin/i, body: /sakai/i },
];

const SSO = /microsoftonline\.com|okta\.com|\/idp\/|shibboleth|duosecurity|cas\/login|adfs/i;

export const NEXT_STEPS = {
  canvas: 'Canvas: have her create a token (Account > Settings > + New Access Token) and set CANVAS_BASE_URL + CANVAS_TOKEN. If the college disabled tokens, use Calendar > Calendar Feed and set LMS_ICS_URL.',
  d2l: 'Brightspace: open Calendar > Subscribe, copy the feed URL into LMS_ICS_URL. (Grades are not in the feed; we read them from notification emails.)',
  blackboard: 'Blackboard: open Calendar > Settings (gear) > Share Calendar, copy the URL into LMS_ICS_URL. (Grades come from notification emails.)',
  moodle: 'Moodle: open Calendar > Export calendar > Get calendar URL, copy it into LMS_ICS_URL.',
  schoology: 'Schoology: open Calendar > Export, copy the iCal URL into LMS_ICS_URL.',
  sakai: 'Sakai: open Calendar > Subscribe (iCal), copy the URL into LMS_ICS_URL.',
  unknown: 'Could not tell which system this is. Look for a Calendar "subscribe"/"export"/"iCal" option and put that URL in LMS_ICS_URL, and tell Claude the system name.',
};

export function detectLms({ urls = [], headers = {}, body = '' }) {
  const joined = urls.join(' ');
  const headerNames = Object.keys(headers).join(' ');
  for (const r of RULES) {
    if (r.url.test(joined) || (r.header && r.header.test(headerNames))) return { id: r.id, name: r.name, evidence: 'url/header' };
  }
  for (const r of RULES) {
    if (r.body.test(body)) return { id: r.id, name: r.name, evidence: 'page content' };
  }
  const sso = urls.find(u => SSO.test(u));
  return { id: 'unknown', name: 'Unknown', evidence: sso ? `stopped at a single sign-on page (${new URL(sso).host})` : 'no match' };
}

// Follow redirects by hand so we see every hop (the real LMS host often only shows up mid-chain).
export async function fetchPortal(fetchImpl, startUrl, maxHops = 10) {
  const urls = [];
  let url = startUrl;
  let res;
  for (let i = 0; i < maxHops; i++) {
    urls.push(url);
    res = await fetchImpl(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 StudyPulseCoach-probe' } });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) { url = new URL(loc, url).toString(); continue; }
    break;
  }
  const headers = Object.fromEntries(res.headers.entries());
  const body = (await res.text()).slice(0, 200_000);
  return { urls, status: res.status, headers, body };
}
