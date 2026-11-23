/** Secrets never reach the screen: mask key=value secrets, bearer tokens, long tokens and URLs with passwords. */
const PATTERNS: [RegExp, string][] = [
  [/(\b[A-Za-z0-9_.-]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|KEY_ID|PRIVATE_KEY|CREDENTIAL)[A-Za-z0-9_.-]*\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi, "$1***"],
  [/(\b(?:BACKUP_S3_KEY|BACKUP_S3_SECRET|BACKUP_PASSWORD|ALERT_TELEGRAM_TOKEN|ANTHROPIC_API_KEY)\b\s*[=:]\s*)\S+/g, "$1***"],
  [/(authorization:\s*bearer\s+)\S+/gi, "$1***"],
  [/(bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, "$1***"],
  [/(:\/\/[^:/\s@]+:)[^@\s/]+(@)/g, "$1***$2"],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, "sk-***"],
  [/\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g, "***telegram-token***"],
  [/("(?:password|secret|token|api_?key)"\s*:\s*)"[^"]*"/gi, '$1"***"'],
];
export function maskSecrets(text: string): string {
  let out = text;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}
