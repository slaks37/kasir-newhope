# Neon agent tooling — verified 22 October 2026

Official entry point fetched: https://neon.com/.well-known/agent-skills/neon/SKILL.md

SHA-256: `0a90876a53bac24f337aa7555b12e96b59e8f75bc7e485d26e95929965361c61`.
The fetched copy is retained privately in ignored `build/full-neon/neon-official-SKILL.md`.

- Existing Neon plugin version 2.1.0 already exposes eight accessible skills: neon, neon-auth, neon-postgres, neon-object-storage, neon-postgres-branches, neon-functions, neon-ai-gateway, neon-postgres-egress-optimizer. Reuse these; do not install duplicate copies or overwrite the plugin cache. Optional Realtime tooling is outside this release.
- Existing Neon MCP connector successfully read project `steep-sea-66546931`. It is provided through the connected plugin; its absence from user `config.toml` is not evidence that it is missing. No second MCP connection, API key, global configuration overwrite or permission expansion was introduced for this setup.
- Official CLI version 8.10.3 is available through `npx neonctl@latest`. Reused the authorized `newhope-clean-launch` profile stored in macOS Keychain. Preserve the separate existing DEFAULT profile; pass `--profile newhope-clean-launch` explicitly.
- Linked this Full Neon worktree to existing project `steep-sea-66546931`, branch `migration-neon-auth` (`br-morning-darkness-azwfti4c`). The local `.neon` contains resource identifiers only and is excluded by an appended `.gitignore` entry. No new project/branch was created.
- Link used `--no-env-pull --no-config`: existing environment files, restricted runtime connection strings and infrastructure configuration were retained. The Auth DB is `neondb`, while the isolated business DB is `newhope_full_neon_staging`; **do not run a default env pull** that would replace that reviewed split.

Reproduce the safe context setup, from this worktree:

```sh
npx neonctl@latest link --profile newhope-clean-launch \
  --project-id steep-sea-66546931 --branch br-morning-darkness-azwfti4c \
  --no-env-pull --no-config -y
```

This tooling setup does not provision production business schema, deploy an app, change payment flags, or establish production readiness. Existing staging, Auth and launch acceptance gates remain in the release runbook.
