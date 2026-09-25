import assert from 'node:assert/strict';
import test from 'node:test';
import { redactSession, redactText } from '../src/redact/redact.mjs';

test('credential-shaped values are masked', () => {
  const cases = [
    ['key sk-ant-api03-abcdefghijklmnopqrstu here', 'key [REDACTED] here'],
    ['use tk_live_0123456789abcdef', 'use [REDACTED]'],
    ['ghp_abcdefghijklmnopqrstuvwxyz0123', '[REDACTED]'],
    ['AKIAABCDEFGHIJKLMNOP', '[REDACTED]'],
    ['Authorization: Bearer eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.c2lnbmF0dXJlXzEyMw', 'Authorization: Bearer [REDACTED]'],
    ['curl -H "Authorization: Bearer abcdef0123456789xyz"', 'curl -H "Authorization: Bearer [REDACTED]"'],
    ['DB_PASSWORD=hunter2hunter2', 'DB_PASSWORD=[REDACTED]'],
    ['{"api_key": "a1b2c3d4e5f6g7"}', '{"api_key": "[REDACTED]"}'],
    ['-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----', '[REDACTED]'],
  ];
  for (const [input, expected] of cases) assert.equal(redactText(input).text, expected, input);
});

test('ordinary prose and env references are left alone', () => {
  for (const text of ['password: see the vault', 'the token expired yesterday', 'API_KEY=${API_KEY}', 'sk-short', 'task-12345 done']) {
    assert.deepEqual(redactText(text), { text, count: 0 });
  }
});

test('session redaction walks text, tool inputs and outputs and counts', () => {
  const session = {
    title: 'fix',
    turns: [{ role: 'assistant', parts: [
      { kind: 'text', text: 'set SECRET_TOKEN=abc123def456' },
      { kind: 'tool', name: 'Bash', summary: 'export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123', input: { command: 'export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123' }, output: 'ok' },
    ] }],
  };
  assert.equal(redactSession(session), 3);
  assert.ok(!JSON.stringify(session).includes('ghp_'));
  assert.ok(!JSON.stringify(session).includes('abc123def456'));
});