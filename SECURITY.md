# Security policy

## Supported versions

Security fixes go into the latest release only. Update with `claude plugin update
limits-statusline@sealoop` when you installed from GitHub; a copy from Anthropic's directory is
updated for you once the fixed version is published there.

## Report a vulnerability

Please do not open a public issue for a security problem. Email **lukakozlowski@outlook.com** with
the subject `limits-statusline security`, and include:

- what an attacker could do, and what they need for it;
- the steps or a file that reproduces it;
- the plugin version (`claude plugin list`), the Claude Code version (`claude --version`) and your
  operating system with its version (macOS, Windows or Linux).

You will get a reply within 7 days. Once the problem is confirmed, a fix is released as soon as it
is ready, and the advisory credits you unless you would rather not be named.

## Scope

The plugin runs locally: it makes no network requests and reads no credentials. Relevant problems
include code execution through the status line command, the setup command or the SessionStart
hook; writes outside `~/.claude` (or `CLAUDE_CONFIG_DIR`); and damage to `settings.json`.
