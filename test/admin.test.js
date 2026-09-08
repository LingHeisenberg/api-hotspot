import test from 'node:test';
import assert from 'node:assert/strict';
import { dateRange } from '../src/admin/dates.js';
import { permissions, roleDefaults } from '../src/admin/permissions.js';

test('RBAC has the six required roles and granular permissions', () => {
  assert.deepEqual(Object.keys(roleDefaults), ['SUPER_ADMIN','ADMIN','FINANCEIRO','OPERADOR','SUPORTE','AUDITOR']);
  assert.ok(roleDefaults.SUPER_ADMIN.includes('mikrotik.manage'));
  assert.ok(roleDefaults.FINANCEIRO.includes('payments.export'));
  assert.ok(!roleDefaults.FINANCEIRO.includes('mikrotik.manage'));
  assert.ok(roleDefaults.AUDITOR.every(permission => permission.endsWith('.view')));
  assert.ok(permissions.includes('vouchers.sync'));
});

test('date ranges are bounded and return a half-open database interval', () => {
  const result = dateRange({ from: '2026-09-01', to: '2026-09-08' });
  assert.equal(result.start, '2026-09-01 00:00:00');
  assert.equal(result.end, '2026-09-09 00:00:00');
  assert.equal(result.timeZone, 'Africa/Maputo');
  assert.throws(() => dateRange({ from: '2026-09-08', to: '2026-09-01' }));
  assert.throws(() => dateRange({ from: '2026-01-01', to: '2027-01-02' }));
});
