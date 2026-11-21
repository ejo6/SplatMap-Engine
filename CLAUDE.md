# Hack Western Project

## Context
This is a **36-hour hackathon** project. The goal is a **working MVP**, not a polished product. Favor speed and a demoable end-to-end flow over perfection. If something works well enough to demo, move on.

The product requirements live in the **PRD** — refer to it before starting any task and when in doubt about scope. If a task isn't supported by the PRD, check with the user before building it.

PRD: [docs/prd.md](docs/prd.md). Read it before every task and follow its §16 (agent working rules + repo layout). Ticket briefs and setup guide: [docs/JIRA.md](docs/JIRA.md).

## Repo layout (PRD §16)
- `extension/` MV3 extension · `web/` Vite + TS + three.js + Spark (people code in `web/src/people/`) · `server/` FastAPI + GPU worker · `pipeline/` stage scripts `s0_ingest.py`…`s9_package.py`, runner `run.py`, conda specs `envs/*.yml` · `config/` `gemini.yaml`, pipeline defaults · `docs/` world format, GPU setup/ledger, clips, demo worlds.
- `work/` (repo root) is git-ignored pipeline output. `worlds/` holds packaged demo worlds and **is committed** (no `.ply`; `worlds/test/` is regenerated). Never commit `.env`, keys, cookies, model weights or SMPL/SMPL-X files.
- Copy `.env.example` to `.env` and fill only the keys your area needs.

## Project Management (Jira)
- Use the **Jira MCP** for all project management. Jira is the source of truth for what needs doing.
- You are responsible for **your user's tasks**. Tasks may be assigned to other team members, but they are primarily scoped and figured out by agents — so keep tickets clear and current.
- Before starting work, find or create the relevant Jira ticket and move it to In Progress. Update status and add comments as you go (decisions, blockers, links to branches/PRs). Move it to Done when merged.
- Don't work on tickets assigned to other users unless asked. If you discover new work, create a ticket for it rather than silently expanding scope.

Jira project key: `KAN` — board: https://ericjoneil6.atlassian.net/jira/software/projects/KAN/boards/2

## Coding Rules
- **Do not bloat the codebase.** Make only the necessary additions. No speculative features, abstractions, or "nice to have" helpers.
- **Keep error handling minimal.** Avoid overcomplicated error handling, retries, and fallbacks — we are gunning for an MVP. Handle only what would break the demo.
- Prefer simple, readable code over clever or generic code. Reuse what exists before adding something new.
- **Suggest pivots in technology** when something is absolutely not feasible (blocked API, unworkable library, time sink). Flag it to the user early with a concrete alternative rather than grinding on it.

## Git & Collaboration
- Use proper branching: never commit directly to `main`. Create a feature branch per Jira ticket (include the ticket key in the branch name, e.g. `KAN-12-add-auth`).
- Keep commits small and focused with clear messages. Open a PR to `main` for review/merge; keep PRs scoped to one ticket.
- Pull/rebase from `main` frequently to avoid painful conflicts — multiple people and agents are working in parallel.
- **Commit as the user, not Claude.** Do not add Claude as author or co-author unless the user specifically asks.

## Documentation (`docs/`)
- Write and maintain documentation in `docs/`, and **read it before diving into the code**.
- Focus on recording context that helps other agents: architecture decisions, how components fit together, key files/endpoints, data models, env/setup, gotchas. The goal is that an agent can understand the system **without reading all the code**.
- Update docs in the same PR as the change they describe. Keep them short and factual — no filler.
