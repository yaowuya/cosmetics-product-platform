import assert from 'node:assert/strict';
import { test } from 'node:test';
import { landing } from '../admin/src/session.ts';

test('首次改密优先于账号治理，未登录不进入工作区', () => {
  assert.equal(landing(null), 'login');
  assert.equal(landing({ must_change_password: true, can_manage: true }), 'change-password');
  assert.equal(landing({ must_change_password: false, can_manage: true }), 'desk');
});
