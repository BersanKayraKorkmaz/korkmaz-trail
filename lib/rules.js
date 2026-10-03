// What a tool call was: a command, a file change, an outbound call, a risky action.
// Heuristic signals, not a sandbox: they flag actions worth a human look.
// Pure functions, no imports: shared by the mod and the Node tests.

const cp = (code) => String.fromCodePoint(code);

// Control characters, zero-width marks and bidirectional overrides, built from code
// points so none of them has to appear in this file.
const INVISIBLE = new RegExp(
  `[${[[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x202a, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff]]
    .map(([from, to]) => `${cp(from)}-${cp(to)}`)
    .join('')}]`,
  'g',
);

/** Everything korkmaz-trail shows from a tool call passes through here. */
export function sanitize(text, max = 32) {
  const clean = String(text).replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

const SHELL_RULES = [
  // Recursive delete aimed at /, ~, $HOME, * or .. (relative build dirs are fine)
  { sev: 'high', re: /(?<!git\s)\brm(?=[^;&|\n]*\s-[a-zA-Z]*[rR][a-zA-Z]*(?=\s|$)|[^;&|\n]*\s--recursive\b)(?=[^;&|\n]*\s["']?(?:\/\*?|~\/?\*?|\$HOME\/?\*?|\*|\.\.?\/?\*?)["']?(?=\s|$|[;&|)]))[^;&|\n]*/ },
  { sev: 'high', re: /\b(?:Remove-Item|ri|rd|rmdir|del)\b(?=[^;|\n]*(?:-Recurse|\/s)\b)(?=[^;|\n]*\s["']?(?:[A-Za-z]:\\?\*?|~[\\/]?\*?|\$HOME[\\/]?\*?|\$env:USERPROFILE[\\/]?\*?|\\\*?)["']?(?=\s|$|[;|)]))[^;|\n]*/i },
  { sev: 'high', re: /\bgit\s+push\b[^;&|\n]*?\s(?:--force(?!-with-lease)|-f)\b[^;&|\n]*/ },
  { sev: 'high', re: /\b(?:curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^;\n]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|dash|python3?|node|perl|ruby|iex|Invoke-Expression)\b/i },
  { sev: 'high', re: /\b(?:iex|Invoke-Expression)\b[^;\n]*\b(?:irm|iwr|Invoke-RestMethod|Invoke-WebRequest|DownloadString)\b[^;\n]*/i },
  { sev: 'high', re: /\b(?:ba|z)?sh\s+<\(\s*(?:curl|wget)\b[^)\n]*\)?/ },
  { sev: 'high', re: /\b(?:mkfs(?:\.\w+)?|diskpart|wipefs)\b[^;&|\n]*|\bformat\s+[A-Za-z]:[^;&|\n]*|\bdd\b[^;\n]*\bof=\/dev\/(?:sd|nvme|disk|hd)\w*/i },
  { sev: 'high', re: /\b(?:DROP\s+(?:TABLE|DATABASE|SCHEMA)|TRUNCATE\s+TABLE)\b[^;\n"']*/i },
  { sev: 'high', re: /\b(?:terraform\s+destroy|pulumi\s+destroy|kubectl\s+delete|helm\s+(?:uninstall|delete)|aws\s+s3\s+rm\b[^;\n]*--recursive|aws\s+s3\s+rb\b)[^;&|\n]*/i },
  { sev: 'high', secret: true, re: /\b(?:sk-ant-[\w-]{16,}|sk-(?:proj-)?[A-Za-z0-9_-]{32,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_\w{40,}|(?:AKIA|ASIA)[0-9A-Z]{16}|xox[abposr]-[\w-]{10,}|AIza[\w-]{35}|glpat-[\w-]{20,})/ },
  { sev: 'medium', re: /\bgit\s+(?:reset\s+--hard|clean\s+-[a-zA-Z]*f[a-zA-Z]*|checkout\s+(?:--\s+)?\.(?=\s|$)|restore\s+(?:--\S+\s+)*\.(?=\s|$)|stash\s+(?:drop|clear)|branch\s+-D)[^;&|\n]*/ },
  { sev: 'medium', re: /\bgit\s+(?:commit|push|merge|rebase)\b[^;&|\n]*\s--no-verify\b[^;&|\n]*/ },
  { sev: 'medium', re: /\bchmod\s+(?:-R\s+)?0?777\b[^;&|\n]*|\bicacls\b[^;&|\n]*\bEveryone:\(?F\)?/i },
  { sev: 'medium', re: /(?:^|(?<=[\s;&|(]))sudo\s+[^;&|\n]*/ },
  { sev: 'medium', re: /\b(?:npm|pnpm|yarn)\s+publish\b[^;&|\n]*|\btwine\s+upload\b[^;&|\n]*|\bcargo\s+publish\b|\bgh\s+release\s+create\b[^;&|\n]*|\bdocker\s+push\b[^;&|\n]*|\bgem\s+push\b[^;&|\n]*|\bvsce\s+publish\b/ },
  { sev: 'medium', re: /\bSet-ExecutionPolicy\s+(?:Unrestricted|Bypass)\b[^;|\n]*|\breg(?:\.exe)?\s+(?:add|delete)\s+HK(?:LM|EY_LOCAL_MACHINE)\b[^;&|\n]*|\bschtasks\s+\/create\b[^;&|\n]*|\bcrontab\s+-r\b|\bsystemctl\s+(?:disable|mask)\b[^;&|\n]*|\bnetsh\s+advfirewall\b[^;&|\n]*|\bSet-MpPreference\b[^;|\n]*|\bufw\s+disable\b|\bsetenforce\s+0\b/i },
  { sev: 'medium', re: /\b(?:shutdown(?:\.exe)?\s+[-/][rsh]\b|Restart-Computer|Stop-Computer|reboot)\b[^;&|\n]*/i },
  { sev: 'medium', secret: true, re: /\b[A-Z0-9_]*(?:API_?KEY|SECRET|TOKEN|PASSWORD|PASSWD)[A-Z0-9_]*\s*=\s*["']?[^\s"'$]{12,}/ },
];

// Files whose contents should not end up in a model's context.
const SENSITIVE = [
  { sev: 'high', re: /(?:^|[\\/\s"'=])(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?![\w.-])/ },
  { sev: 'high', re: /[\w.-]+\.(?:key|p12|pfx|jks|keystore|ppk|kdbx)(?![\w.-])/i },
  { sev: 'high', re: /\.aws[\\/](?:credentials|config)\b|\.azure[\\/]|application_default_credentials\.json|\.kube[\\/]config\b|\.docker[\\/]config\.json|\.git-credentials\b|(?:^|[\\/\s"'])\.(?:netrc|npmrc|pypirc)\b|\.claude[\\/]\.credentials\.json|\.ssh[\\/](?!known_hosts\b|config\b|authorized_keys\b)(?![\w.-]*\.pub\b)[\w.-]+/i },
  { sev: 'medium', re: /[\w.-]+\.pem(?![\w.-])/i }, // often a private key, sometimes just a certificate
  { sev: 'medium', re: /(?:^|[\\/\s"'=])\.env(?:\.(?!example\b|sample\b|template\b|dist\b|defaults?\b)[\w.-]+)?(?![\w.-])/ },
  { sev: 'medium', re: /(?:^|[\\/\s"'=])(?:secrets?|credentials?)\.(?:json|ya?ml|toml|ini|txt|env)(?![\w.-])/i },
];

// Commands that read a file's contents (so its secrets reach the model's context).
const READERS = /^(?:cat|type|Get-Content|gc|less|more|head|tail|bat|cp|copy|Copy-Item|scp|base64|xxd|strings|source|\.|grep|rg|findstr|Select-String|sed|awk|openssl)$/i;
const NET_CMD = /\b(?:curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm|ssh|scp|sftp|rsync|ftp|telnet|ncat)\b|\bgit\s+(?:push|pull|fetch|clone|ls-remote)\b|\b(?:npm|pnpm|yarn|bun)\s+(?:i|install|add|ci|publish|update|upgrade)\b|\bnpx\s|\bpip3?\s+install\b|\b(?:gh|aws|az|gcloud)\s|\bdocker\s+(?:push|pull|login)\b/i;
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'NotebookRead']);

const isShellTool = (name) => SHELL_TOOLS.has(name) || /(?:^|__)(?:run_in_terminal|run_command|execute_command)$/.test(name);
const baseName = (p) => String(p).replace(/["']/g, '').split(/[\\/]/).filter(Boolean).pop() || String(p);

export function isRemoteUrl(u) {
  if (typeof u !== 'string' || !u.trim()) return false;
  let url;
  try { url = new URL(/^[a-z][\w+.-]*:\/\//i.test(u) ? u : `https://${u}`); } catch { return false; }
  if (!/^(?:https?|wss?|ftp):$/.test(url.protocol)) return false;
  const h = url.hostname.replace(/^\[|\]$/g, '');
  return !(h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.test') || h === '::1' || h === '0.0.0.0' || /^127\./.test(h));
}

function isNetCommand(cmd) {
  const urls = cmd.match(/\b(?:https?|wss?|ftp):\/\/[^\s"'<>)\]]+/gi) || [];
  if (urls.some(isRemoteUrl)) return true;
  if (urls.length) return false; // only local URLs: a dev server, not egress
  return NET_CMD.test(cmd);
}

/** Heredoc and PowerShell here-string bodies are file contents, not commands. */
export function stripHeredocs(cmd) {
  return cmd
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n[\t ]*\2[\t ]*(?=\n|$)/g, '<<heredoc')
    .replace(/@'[\s\S]*?'@|@"[\s\S]*?"@/g, "''");
}

function sensitivity(text) {
  for (const rule of SENSITIVE) if (rule.re.test(text)) return rule.sev;
  return null;
}

/** A shell segment that starts with a reader verb and names a concrete secret file. */
function shellSecretRead(command) {
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const words = segment.trim().split(/\s+/).filter(Boolean);
    while (words.length && /^(?:sudo|env|[A-Za-z_]\w*=\S*)$/.test(words[0])) words.shift();
    if (!words.length || !READERS.test(words[0])) continue;
    for (const word of words.slice(1)) {
      const t = word.replace(/^["']+|["']+$/g, '');
      if (!t || t.startsWith('-') || /[*?]/.test(t)) continue; // flags and globs are not files
      const sev = sensitivity(t);
      if (sev) return { sev, file: baseName(t) };
    }
  }
  return null;
}

/**
 * Classify one tool call. `name` is the tool, `input` its arguments, such as
 * `{ command }` for Bash or `{ file_path }` for Edit.
 */
export function classifyToolUse({ name, input } = {}) {
  const tool = String(name || '');
  const args = input && typeof input === 'object' ? input : {};
  const out = { cmd: false, edit: null, net: false, risk: null };
  const flag = (sev, kind, arg = '') => {
    if (!out.risk || (sev === 'high' && out.risk.sev !== 'high')) out.risk = { sev, kind, arg: sanitize(arg, 48) };
  };

  if (isShellTool(tool)) {
    out.cmd = true;
    const command = stripHeredocs(String(args.command ?? ''));
    for (const rule of SHELL_RULES) {
      const m = command.match(rule.re);
      if (m) flag(rule.sev, rule.secret ? 'secret' : 'cmd', rule.secret ? '' : m[0]);
    }
    out.net = isNetCommand(command);
    const read = shellSecretRead(command);
    if (read) flag(read.sev, 'read', read.file);
  } else if (EDIT_TOOLS.has(tool)) {
    const p = String(args.file_path || args.notebook_path || '');
    if (p) {
      out.edit = p;
      const sev = sensitivity(p);
      if (sev) flag(sev, 'edited', baseName(p));
    }
  } else if (READ_TOOLS.has(tool)) {
    const p = String(args.file_path || args.notebook_path || '');
    const sev = p && sensitivity(p);
    if (sev) flag(sev, 'read', baseName(p));
  }
  if (tool === 'WebSearch' || isRemoteUrl(args.url) || isRemoteUrl(args.uri)) out.net = true;
  return out;
}
