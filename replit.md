# Acoustic Maze

A browser-based 3D puzzle game in which players use temporary sonar echoes to navigate fifteen pitch-black labyrinths.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/acoustic-maze run dev` — game frontend; use its managed workflow to supply routing and port configuration
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

Fifteen progressively unlocked levels, including the Subterranean Vault, Crystal Cavern, Sunken Catacombs, Neon Cyber-Corridor, and Void Labyrinth. Sonar and footsteps briefly expose geometry; hazards issue proximity warnings. Settings and progress are saved in the browser. English and Hindi interface options, Web Audio soundscapes, and touch/keyboard controls are included.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
