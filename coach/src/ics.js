// Minimal iCalendar (.ics) reader: enough to list assignment due dates from an LMS calendar feed.

export function icsUrl(u) {
  return String(u || '').trim().replace(/^webcals?:\/\//i, 'https://');
}

function unescapeText(v) {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

// 20261030 (all-day) · 20261030T235900Z (UTC) · 20261030T235900 (floating/TZID: read as local time)
export function parseIcsDate(v) {
  const m = String(v || '').match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h = '23', mi = '59', s = '00', z] = m;
  const args = [+y, +mo - 1, +d, +h, +mi, +s];
  return z ? new Date(Date.UTC(...args)) : new Date(...args);
}

export function parseIcs(text) {
  // Unfold continuation lines (RFC 5545: a line starting with space or tab continues the previous one)
  const lines = String(text).replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const name = line.slice(0, i).split(';')[0].toUpperCase();
    const value = line.slice(i + 1);
    if (name === 'SUMMARY') cur.summary = unescapeText(value);
    else if (name === 'DESCRIPTION') cur.description = unescapeText(value);
    else if (name === 'UID') cur.uid = value;
    else if (name === 'URL') cur.url = value;
    else if (name === 'DTSTART') cur.start = parseIcsDate(value);
    else if (name === 'DUE') cur.due = parseIcsDate(value);
  }
  return events.map(e => ({ ...e, when: e.due || e.start || null }));
}
