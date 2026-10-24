# HumanLayer

HumanLayer runs coding agents (Claude Code, Codex, OpenCode, Pi) on your machines and lets your team steer them from one place: tasks, sessions, plans, and reviews, synced between a desktop app, a web app, and a daemon on each host.

This repo holds all of it. It's a [Turborepo](https://turborepo.com) monorepo that uses [Bun](https://bun.sh).

## What's here

- `apps/riptide-ui`: the app, as a web app and inside the desktop shells
- `apps/riptide-electron`, `apps/riptide-native`: the macOS desktop apps (Electron, Tauri)
- `apps/riptide-daemon`: the daemon that runs agent sessions on a host
- `apps/cli`: the `humanlayer` CLI, which also ships the daemon
- `apps/riptide-api`: the oRPC + Hono API
- `apps/riptide-electric-proxy`: the auth proxy in front of [Electric](https://electric-sql.com), which syncs Postgres to clients
- `apps/riptide-cloud`: the admin web app (organizations, invites, settings, install page)
- `apps/riptide-migrator`, `apps/updater-server`, `apps/stale-daemon-sweeper`, `apps/database-maintenance-function`: AWS Lambda jobs
- `apps/riptide-claude-code-plugin`, `apps/riptide-opencode-plugin`, `apps/riptide-pi-extension`: plugins that mirror Claude Code, OpenCode, and Pi sessions into HumanLayer
- `apps/riptide-humanlayer-claude-plugin`: the built-in HumanLayer skills
- `apps/riptide-rpi-claude-plugin`, `apps/linear-cli`: the Research-Plan-Implement skills and the Linear CLI
- `apps/docs`: the user docs
- `apps/devstack`: runs a full local stack per worktree
- `packages/`: shared libraries (`db`, `schemas`, `ui`, `sync`, `ai`, ...)
- `contracts/`: the oRPC and Effect RPC contracts between the apps

## Get started

You need [Bun](https://bun.sh) and Docker. Building `apps/riptide-native` also needs Rust.

```
bun install
bun --bun run typecheck
bun run test
```

`bun --bun run devstack help` explains how to run the whole stack locally. [CONTRIBUTING.md](CONTRIBUTING.md) lists every check a pull request must pass.

Sentry and PostHog stay off unless you configure them. Starting the application still requires WorkOS and other service configuration.

## Self-hosting

Self-hosting support is incomplete. Subscription billing has been removed, but authentication still requires WorkOS. Local accounts and first-administrator bootstrap are not implemented.

The Docker Compose file starts development infrastructure, not the application services. It uses development credentials and publishes internal service ports. Do not expose it unchanged on the internet.

Object storage uses RustFS with a separate data volume. Existing MinIO volumes are not reused. Devstack refuses to switch an existing MinIO stack automatically. Copy its objects through S3 before switching, and retain the old volume until the copy is verified.

## License

[Apache License 2.0](LICENSE). A few vendored folders keep their MIT licenses; [NOTICE](NOTICE) lists them.
