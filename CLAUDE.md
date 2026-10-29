# CLAUDE.md

Read [AGENTS.md](./AGENTS.md). It's the guide for every harness, covering study sessions (Part 1) and work on this repo (Part 2).

The short version:

- **Helping a student:** start with `imstudium context --json`, prefer the CLI (`imstudium <command> --json`), and never write to Stud.IP or change the workspace unasked. MCP is opt-in (`imstudium setup mcp`); its `imstudium` tool is a read-only door to the same commands.
- **Changing the code:** the SDK talks to Stud.IP (GET only), the CLI registers commands in `packages/cli/src/commands/`, and `packages/cli/src/pipeline.ts` is the one sync pipeline. Tests use synthetic fixtures only, and `bun run validate` must pass.
