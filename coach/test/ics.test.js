import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIcs, parseIcsDate, icsUrl } from '../src/ics.js';

const FEED = [
  'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:1', 'SUMMARY:Lab report: Ionic', ' bonds', 'DTSTART:20261030T235900Z', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:2', 'SUMMARY:Chapter 8 quiz\\, part 1', 'DTSTART;VALUE=DATE:20261102', 'END:VEVENT', 'END:VCALENDAR',
].join('\r\n');

test('parseIcs unfolds lines, unescapes text, reads dates', () => {
  const ev = parseIcs(FEED);
  assert.equal(ev.length, 2);
  assert.equal(ev[0].summary, 'Lab report: Ionicbonds');
  assert.equal(ev[0].when.toISOString(), '2026-10-30T23:59:00.000Z');
  assert.equal(ev[1].summary, 'Chapter 8 quiz, part 1');
  assert.equal(ev[1].when.getDate(), 2);
});

test('parseIcsDate rejects junk; webcal becomes https', () => {
  assert.equal(parseIcsDate('soon'), null);
  assert.equal(icsUrl('webcal://x.edu/feed.ics'), 'https://x.edu/feed.ics');
});
