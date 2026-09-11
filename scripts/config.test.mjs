import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companySubdomain } from '../src/config.ts';

test('accepts company slug and normalizes login URLs', () => {
  for (const value of ['example-co', ' Example-Co ', 'https://example-co.bukku.my/', 'example-co.bukku.my']) {
    assert.equal(companySubdomain(value), 'example-co');
  }
});
test('rejects malformed configuration rather than sending invalid upstream headers', () => {
  for (const value of ['', '$token', 'npx wrangler secret put MCP_AUTH_TOKEN', 'https://example.org', 'example.bukku.my.evil.org', 'https://user:password@example.bukku.my', 'Bearer token']) {
    assert.throws(() => companySubdomain(value));
  }
});
