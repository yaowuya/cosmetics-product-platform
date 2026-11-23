import assert from 'node:assert/strict';
import test from 'node:test';
import { visitorUrl } from '../shared/visitor-origin.ts';

const admin = { protocol: 'https:', hostname: '106.55.249.101', port: '5001' };
const local = { protocol: 'http:', hostname: '127.0.0.1', port: '5173' };
const combined = { protocol: 'https:', hostname: '127.0.0.1', port: '5144' };

test('admin port preview targets the H5 listener', () => {
  assert.equal(visitorUrl('/preview?id=1&revision=2', admin), 'https://106.55.249.101:5000/preview?id=1&revision=2');
  assert.equal(visitorUrl('/', admin), 'https://106.55.249.101:5000/');
  assert.equal(visitorUrl('/catalog', admin), 'https://106.55.249.101:5000/catalog');
});

test('local admin dev server targets the H5 dev server', () => {
  assert.equal(visitorUrl('/preview', local), 'http://127.0.0.1:5174/preview');
});

test('a combined listener keeps a relative visitor path', () => {
  assert.equal(visitorUrl('/preview', combined), '/preview');
});

test('an explicit origin overrides the port map', () => {
  assert.equal(visitorUrl('/contact', admin, 'https://h5.example/'), 'https://h5.example/contact');
});

test('an empty path stays empty', () => {
  assert.equal(visitorUrl('', admin), '');
});
