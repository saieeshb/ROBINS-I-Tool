#!/usr/bin/env node
// Stand-in for the Claude Code CLI in tests. Behaviour is chosen with FAKE_CLAUDE_MODE:
// ok | limit | auth | apikey | hang | badjson | loggedout. It records what it was given in the run directory.
import { writeFileSync } from 'node:fs';

const mode = process.env.FAKE_CLAUDE_MODE ?? 'ok';
const args = process.argv.slice(2);
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');

if (args[0] === '--version') {
  console.log('2.1.312 (Claude Code)');
  process.exit(0);
}
if (args[0] === 'auth' && args[1] === 'status') {
  console.log(JSON.stringify({ loggedIn: mode !== 'loggedout', authMethod: 'oauth_token', apiProvider: 'firstParty' }));
  process.exit(0);
}
if (args[0] === '--help') {
  console.log(
    [
      '--tools <tools...>',
      '--json-schema <schema>',
      '--system-prompt-file <file>',
      '--permission-prompts <mode>',
      '--disable-slash-commands',
      '--setting-sources <sources>',
      '--no-session-persistence',
      '--include-partial-messages',
      '--strict-mcp-config'
    ].join('\n')
  );
  process.exit(0);
}

let stdin = '';
process.stdin.on('data', (d) => (stdin += d));
process.stdin.on('end', () => {
  writeFileSync('fake-received.json', JSON.stringify({ args, promptLength: stdin.length, hasApiKey: !!process.env.ANTHROPIC_API_KEY, bare: !!process.env.CLAUDE_CODE_SIMPLE }));
  const text = (t) => out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: t } } });
  out({ type: 'system', subtype: 'init', model: 'fake-model', apiKeySource: mode === 'apikey' ? 'ANTHROPIC_API_KEY' : 'none', tools: [] });
  if (mode === 'apikey') return setTimeout(() => process.exit(0), 10_000);
  text('Looking at the methods section… ');
  if (mode === 'hang') {
    text('Partial draft');
    return setInterval(() => {}, 1000);
  }
  if (mode === 'limit') {
    out({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: 1900000000 } });
    out({ type: 'result', subtype: 'error_during_execution', is_error: true, result: "You've hit your usage limit" });
    process.exit(1);
  }
  if (mode === 'auth') {
    out({ type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key · Please run /login', api_error_status: 401 });
    process.exit(1);
  }
  const structured =
    mode === 'badjson'
      ? { unexpected: true }
      : {
          items: [{ quote: 'Smoking history and surgeon experience were not available in the database', page: 1, questionIds: ['Q1.1'], interpretation: 'Key confounders were not measured.' }],
          notFound: [{ questionId: 'Q5.2', searchedFor: ['blinded', 'assessor'], note: 'No statement about assessor blinding.' }]
        };
  out({ type: 'result', subtype: 'success', is_error: false, result: 'Done.', structured_output: structured, total_cost_usd: 0 });
  process.exit(0);
});
