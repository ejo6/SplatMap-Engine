# USplat Engine

## Context
This **was** a **36-hour hackathon** project. The goal **was** a **working MVP**, not a polished product. Now, we're interested in how we can seriously improve the engine. 

The product requirements live in the **PRD**.

PRD: [docs/prd.md](docs/prd.md). This was made with intention of providing a quick start and entering many streams for the hackathon, this is just for reference and is not official anymore. 

## Repo layout (PRD §16)
- `extension/` MV3 extension · `web/` Vite + TS + three.js + Spark (people code in `web/src/people/`) · `server/` FastAPI + GPU worker · `pipeline/` stage scripts `s0_ingest.py`…`s9_package.py`, runner `run.py`, conda specs `envs/*.yml` · `config/` `gemini.yaml`, pipeline defaults · `docs/` world format, GPU setup/ledger, clips, demo worlds.
- `work/` (repo root) is git-ignored pipeline output. `worlds/` holds packaged demo worlds and **is committed** (no `.ply`; `worlds/test/` is regenerated). Never commit `.env`, keys, cookies, model weights or SMPL/SMPL-X files.
- Copy `.env.example` to `.env` and fill only the keys your area needs.


## Coding Rules
- **Do not bloat the codebase.** Make only the necessary additions. No speculative features, abstractions, or "nice to have" helpers.
- Prefer simple, readable code over clever or generic code. Reuse what exists before adding something new.
- **Suggest pivots in technology** when something is absolutely not feasible (blocked API, unworkable library, time sink). Flag it to the user early with a concrete alternative rather than grinding on it.

## Git & Collaboration
- Use proper branching: never commit directly to `main`. Create a feature branch per overarching task, or related subtask
- Keep commits small and focused with clear messages. Open a PR to `main` for review/merge; keep PRs scoped to one ticket.
- Pull/rebase from `main` frequently to avoid painful conflicts - multiple people and agents may be working in parallel.
- **Commit as the user, not Claude.** Do not add Claude as author or co-author unless the user specifically asks.

## Documentation (`docs/`)
- Write and maintain documentation in `docs/`, and **read it before diving into the code**.
- Focus on recording context that helps trace back complicated concepts: architecture decisions, how components fit together, key files/endpoints, data models, env/setup, gotchas. The goal is that a human or agent can understand the system **without reading all the code**.
- Update docs in the same PR as the change they describe. Keep them short and factual, no filler.
