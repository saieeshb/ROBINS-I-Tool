import { spawn, type ChildProcess } from 'node:child_process';
import { runProcess } from '../parsing/service.js';

export interface ClaudeStatus {
  installed: boolean;
  path: string;
  version: string | null;
  loggedIn: boolean | null;
  authMethod: string | null;
  apiProvider: string | null;
  /** True when Claude Code would bill an API key rather than use the subscription sign-in. */
  usesApiKey: boolean;
  capabilities: ClaudeCapabilities;
  problems: string[];
  checkedAt: string;
}

export interface ClaudeCapabilities {
  tools: boolean;
  jsonSchema: boolean;
  systemPromptFile: boolean;
  permissionPrompts: boolean;
  disableSlashCommands: boolean;
  settingSources: boolean;
  noSessionPersistence: boolean;
  includePartialMessages: boolean;
  strictMcpConfig: boolean;
}

const NONE: ClaudeCapabilities = {
  tools: false,
  jsonSchema: false,
  systemPromptFile: false,
  permissionPrompts: false,
  disableSlashCommands: false,
  settingSources: false,
  noSessionPersistence: false,
  includePartialMessages: false,
  strictMcpConfig: false
};

/** Environment for the Claude Code child: API keys are removed unless the reviewer explicitly allowed API billing. */
export function childEnv(allowApiBilling: boolean, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  if (!allowApiBilling) {
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.CLAUDE_CODE_USE_BEDROCK;
    delete env.CLAUDE_CODE_USE_VERTEX;
  }
  // Never run in --bare-style API-only mode; subscription sign-in needs the normal client.
  delete env.CLAUDE_CODE_SIMPLE;
  return env;
}

/** Resolves how to launch the CLI on this platform (Windows npm installs are .cmd shims that need a shell). */
async function resolveCommand(cmd: string): Promise<{ command: string; shell: boolean }> {
  if (process.platform !== 'win32') return { command: cmd, shell: false };
  const where = await runProcess('where', [cmd], 5000);
  const first = where.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  if (!first) return { command: cmd, shell: false };
  return { command: first, shell: /\.(cmd|bat)$/i.test(first) };
}

/** Quotes an argument for cmd.exe + CommandLineToArgvW (used only for .cmd shims on Windows). */
export function quoteWindowsArg(arg: string): string {
  if (arg === '') return '""';
  if (!/[\s"^&|<>()%!]/.test(arg)) return arg;
  let out = '"';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === '\\') {
      backslashes++;
      continue;
    }
    if (ch === '"') {
      out += '\\'.repeat(backslashes * 2 + 1) + '"';
    } else {
      out += '\\'.repeat(backslashes) + (ch === '%' ? '"%"' : ch);
    }
    backslashes = 0;
  }
  out += '\\'.repeat(backslashes * 2) + '"';
  return out;
}

export class ClaudeCli {
  private cache: ClaudeStatus | null = null;
  private resolved: { command: string; shell: boolean } | null = null;

  constructor(private readonly path: string) {}

  private async command(): Promise<{ command: string; shell: boolean }> {
    this.resolved ??= await resolveCommand(this.path);
    return this.resolved;
  }

  private async exec(args: string[], timeoutMs: number) {
    const { command, shell } = await this.command();
    if (!shell) return runProcess(command, args, timeoutMs);
    return runProcess(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', [quoteWindowsArg(command), ...args.map(quoteWindowsArg)].join(' ')], timeoutMs);
  }

  /** Checks installation, sign-in state and supported flags without using any subscription quota. */
  async status(refresh = false): Promise<ClaudeStatus> {
    if (this.cache && !refresh && Date.now() - Date.parse(this.cache.checkedAt) < 60_000) return this.cache;
    const problems: string[] = [];
    const v = await this.exec(['--version'], 15_000);
    if (v.code !== 0) {
      this.cache = {
        installed: false,
        path: this.path,
        version: null,
        loggedIn: null,
        authMethod: null,
        apiProvider: null,
        usesApiKey: false,
        capabilities: NONE,
        problems: ['Claude Code was not found. Install it from https://code.claude.com and sign in, then refresh.'],
        checkedAt: new Date().toISOString()
      };
      return this.cache;
    }
    const version = v.stdout.trim().split(/\s+/)[0] ?? null;
    let loggedIn: boolean | null = null;
    let authMethod: string | null = null;
    let apiProvider: string | null = null;
    const auth = await this.exec(['auth', 'status', '--json'], 15_000);
    try {
      const parsed = JSON.parse(auth.stdout) as { loggedIn?: boolean; authMethod?: string; apiProvider?: string };
      loggedIn = !!parsed.loggedIn;
      authMethod = parsed.authMethod ?? null;
      apiProvider = parsed.apiProvider ?? null;
    } catch {
      problems.push('Could not read the Claude Code sign-in status; runs will report sign-in problems if they occur.');
    }
    if (loggedIn === false) problems.push('Claude Code is not signed in. Run "claude" in a terminal and sign in with your Claude account.');
    const usesApiKey = !!authMethod && /api[_-]?key|apikeyhelper/i.test(authMethod);
    if (usesApiKey) problems.push('Claude Code is set up with an API key, which is billed per use. ROBer COP will not use it unless you allow API billing in Settings.');
    if (apiProvider && apiProvider !== 'firstParty') problems.push(`Claude Code is configured for ${apiProvider}; usage is billed by that provider.`);

    const help = await this.exec(['--help'], 15_000);
    const h = help.stdout;
    const capabilities: ClaudeCapabilities = {
      tools: /--tools\b/.test(h),
      jsonSchema: /--json-schema\b/.test(h),
      systemPromptFile: /--system-prompt-file\b|--system-prompt\[-file\]/.test(h),
      permissionPrompts: /--permission-prompts\b/.test(h),
      disableSlashCommands: /--disable-slash-commands\b/.test(h),
      settingSources: /--setting-sources\b/.test(h),
      noSessionPersistence: /--no-session-persistence\b/.test(h),
      includePartialMessages: /--include-partial-messages\b/.test(h),
      strictMcpConfig: /--strict-mcp-config\b/.test(h)
    };
    if (!capabilities.strictMcpConfig) problems.push('This Claude Code version is too old for isolated assistant runs; please update it.');
    this.cache = { installed: true, path: this.path, version, loggedIn, authMethod, apiProvider, usesApiKey, capabilities, problems, checkedAt: new Date().toISOString() };
    return this.cache;
  }

  async spawn(args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }): Promise<ChildProcess> {
    const { command, shell } = await this.command();
    if (!shell) return spawn(command, args, { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const line = [quoteWindowsArg(command), ...args.map(quoteWindowsArg)].join(' ');
    return spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', line], {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: true
    });
  }
}

/** Classifies a failure message from Claude Code. */
export function classifyFailure(text: string, apiStatus?: number | null): 'usage_limited' | 'auth_required' | 'failed' {
  if (apiStatus === 429 || /usage limit|rate limit|hit your limit|limit reached|quota|too many requests/i.test(text)) return 'usage_limited';
  if (apiStatus === 401 || apiStatus === 403 || /not logged in|please run \/login|log ?in again|invalid api key|authentication|unauthori[sz]ed|oauth token|credentials/i.test(text)) {
    return 'auth_required';
  }
  return 'failed';
}
