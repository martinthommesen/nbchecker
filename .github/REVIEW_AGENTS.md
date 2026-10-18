# Automated pull request reviews

The four reviewers use repository-specific rules in `AGENTS.md` and `REVIEW.md`.
`CLAUDE.md` imports those rules for Claude, and `.github/copilot-instructions.md`
points Copilot to them. Keep these files short and focused on demonstrated bugs;
types, formatting, and lint belong in CI.

| Reviewer | Configuration | When it runs |
| --- | --- | --- |
| Codex | [Codex repository settings](https://chatgpt.com/settings/code-review), `AGENTS.md` | All PRs, every push; exhaustive code review and accompanying security review |
| Claude | `claude-code-review.yml`, official `code-review` plugin, `CLAUDE.md` | Same-repository non-draft PRs opened, updated, reopened, or marked ready |
| Copilot | Repository Settings → Copilot → Code review; default-branch ruleset; `.github/copilot-instructions.md` | PRs targeting the default branch, including new pushes; drafts excluded; Balanced effort |
| OpenCode | `opencode-pr-review.yml`, `opencode_review.py`, trusted copies of `AGENTS.md` and `REVIEW.md` | Same-repository non-draft PRs opened, updated, reopened, or marked ready |

Codex and Copilot are GitHub integrations; they need no API key in a workflow.
Claude uses the existing `CLAUDE_CODE_OAUTH_TOKEN` secret and a short-lived,
repository-scoped Actions token. `claude.yml` also handles authorized `@claude`
mentions. Both Claude workflows check out the trusted base/default branch, keep
checkout credentials out of Git, and pin actions to full commits.

OpenCode uses OpenCode Go with `opencode-go/deepseek-v4.1-flash` and the `max`
reasoning variant. Its API key is confined to the `opencode-review` environment,
whose deployment policy allows only `main`. It reviews sanitized immutable PR
data with read-only tools; a separate step publishes the result with the Actions
token. The OpenCode GitHub App is not required. Keep project configuration,
plugins, instruction files, and private `.env` files out of the PR snapshot.

The repository's Actions policies allow `pull_request_target` only for the
specific Claude and OpenCode review workflow paths. Keep the base-checkout and
no-PR-execution boundaries if either workflow changes.

Review comments do not approve or merge a PR. CI and the repository's merge
rules remain authoritative. To request another Codex pass, comment
`@codex review` or `@codex security review`. Request another Copilot pass through
the PR's Reviewers menu. Claude and OpenCode run again on the next push; their
workflow runs link to the exact configuration used.

## Official references

- [Codex GitHub reviews](https://learn.chatgpt.com/docs/third-party/github)
- [Claude GitHub Actions](https://code.claude.com/docs/en/github-actions) and
  [the official review plugin](https://github.com/anthropics/claude-code/tree/main/plugins/code-review)
- [Copilot review configuration](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/configure-code-review)
- [OpenCode GitHub integration](https://opencode.ai/docs/github/)
