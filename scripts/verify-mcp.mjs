import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Read the token from stdin so it never appears in command arguments or logs.
let input = '';
for await (const chunk of process.stdin) input += chunk;
const token = input.trim();
assert(token, 'Supply the MCP token through stdin.');
const endpoint = new URL('https://bukku.jusniiljas.com/mcp');
const health = await fetch(new URL('/health', endpoint));
assert.equal(health.status, 200);
assert.equal((await health.json()).ok, true);
console.log('PASS health');

for (const authorization of [null, 'Bearer deliberately-invalid-verification-token']) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  assert.equal(response.status, 401);
}
console.log('PASS missing and invalid credentials rejected');

const client = new Client({ name: 'jiad-deployment-verification', version: '1.0.0' });
try {
  // Secret deployments may still serve the previous value briefly. Retry only 401.
  for (let attempt = 0; ; attempt++) {
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    });
    try {
      await client.connect(transport);
      break;
    } catch (error) {
      await transport.close();
      if (error.code !== 401 || attempt >= 11) throw error;
      console.log('Waiting for secret deployment propagation...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  console.log('PASS MCP initialize and initialized notification');
  await client.ping();
  console.log('PASS MCP ping');
  const names = [];
  let cursor;
  do {
    const page = await client.listTools(cursor ? { cursor } : {});
    names.push(...page.tools.map(tool => tool.name));
    cursor = page.nextCursor;
  } while (cursor);
  assert(names.includes('list-currencies'));
  console.log(`PASS tool discovery: ${names.length} tools`);
  const result = await client.callTool({ name: 'list-currencies', arguments: {} });
  const contacts = await client.callTool({ name: 'list-contacts', arguments: { page_size: 1 } });
  for (const response of [result, contacts]) {
    if (response.isError) console.error(JSON.stringify(response.content).replaceAll(token, '[REDACTED]'));
  }
  assert(!contacts.isError, 'Bukku read-only contact lookup returned an error.');
  console.log('PASS live Bukku read-only call: list-contacts (response data withheld)');
  assert(!result.isError, 'Bukku read-only tool returned an error.');
  assert(result.content?.length > 0, 'Bukku read-only tool returned no content.');
  console.log('PASS live Bukku read-only call: list-currencies (response data withheld)');
} finally {
  await client.close();
}
