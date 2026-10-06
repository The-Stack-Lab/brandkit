# ADR 0001: How the brandkit server stores, serves and versions a brand

- **Status:** Proposed (draft for Kyle; nothing here is decided)
- **Ticket:** LAB-1432 ([0.1] in epic LAB-1431)
- **Date:** 2026-10-06
- **Drafted from:** `.claude/CLAUDE.md`, the code at `6be42ea` (v1.8.1), and the three
  epic documents: *Lessons from running Stacklist on UI Rules*, *UI Rules capability
  inventory*, *brandkit 1.8.1 current state*.

Each decision below lists options, consequences, and a **proposed** recommendation. The
recommendations are a starting position for Kyle to accept, change or reject. The planner
(Palette) leans git-backed; that lean is presented as Option A in Decision 1 with its
costs, not as the answer.

## Context

**What exists.** brandkit 1.8.1 is a zero-dependency Node 18 CLI plus a static ES5 page
engine. One `config.json` per guide directory renders the guide and projects into
`brand.json`, `tokens.json` (DTCG), `brand.md` and `AGENTS.md`. There is no server, API,
MCP, rule model or layering. Schema enforcement lands with LAB-1433 (PR #23).

Facts from the code that constrain every option:

1. **Each consumer repo holds a full copy of the engine and the config.** `brandkit init`
   copies `dist/engine.js`, `styles.css`, `index.html`, `changelog.*` into the guide dir
   (`cli/init.js`). `init --update` refreshes engine files and never touches the config
   (`cli/init.js:98`, "kept config.json (--update)"). There is no config migration path
   of any kind today.
2. **The deployed engine reads `config.json` at runtime.** `dist/engine.js:38` does
   `fetch(BASE + '/config.json')`. A repo pinned at 1.1.1 runs a 1.1.1 engine against
   whatever `config.json` sits next to it. Anything that rewrites that file must stay
   readable by the engine version in that repo.
3. **There is no schema version marker.** `config.schema.json` sets
   `"additionalProperties": true` (line 12). At `6be42ea` nothing in `lib/`, `cli/` or
   `bin/` references the schema file, so it is editor-only; LAB-1433 (PR #23) makes
   `build` and `export` validate against it (shape errors fatal, value and unknown-key
   problems warnings).
   `brand.version` is the guide's own revision (0.1 to 1.0), not the schema.
   `brand.json` carries `generatedBy: 'brandkit'` (`lib/export.js:293`) and no package
   or schema version.
4. **Provenance already has a home outside the config.** `generate --from` writes
   `ingest-evidence.json` beside `config.json` and keeps evidence out of the rendered
   source of truth. DTCG tokens carry brandkit data under
   `$extensions["app.stacklist.brandkit"]`. Both are precedents for v2.
5. **The npm package is zero-dependency by rule** (CLAUDE.md, Coding Standards). An MCP
   server with OAuth, a store and rate limiting will not be.
6. **Only one theme exists.** `theme` is one flat map (LAB-1121, LAB-1122). The guardrail
   "dark decisions land in a dark context and never overwrite the light brand" cannot be
   expressed in v1 at all; it depends on the context model in LAB-1435.

**What we are building toward** (LAB-1431 bar, where UI Rules hurt): an open token
namespace, agent-writable brand-level rules, custom components and blocks, asset upload by
API with many logos, scopes changeable in place, real linting, structured provenance on
rules, and dark as its own context.

**Consumers.** 20 repos, pinned from 1.1.1 (serenbe-film-festival) to 1.8.1
(stacklist-brand, quikrete). Freeway is pinned at 1.7.2 and is the export test fixture.

### Where the docs and the code disagree

- The survey doc lists "`init --update` rewrites AGENTS.md (LAB-1231)" as a sharp edge.
  The rewrite is intentional since 1.8.0 (`cli/init.js:111`, and CLAUDE.md: "rewritten by
  `init --update` so an existing guide picks up contract changes"). LAB-1231 is about
  `changelog.js` missing from the do-not-hand-edit list, not about the rewrite.
- LAB-1443 ("git-backed storage gets this free"), LAB-1448 ("git-backed storage gets much
  of this free") and LAB-1453 step 6 ("export the full UI Rules ruleset to the brands
  repo") already assume a git-backed store. They predate this ADR and need rewording
  whichever way Decision 1 goes.
- `brand/config.json` is a committed 0.1 scaffold from `fa4aecc` (v1.4.1). CLAUDE.md says
  the demo lives in `example/` and does not mention `brand/`; it is not in the npm
  `files` list. It is a stray, and it is the obvious accidental "brands repo" seed. It
  should be removed or explained before a brands layout is designed.
- The survey's "633 pass, 1 fails" figure (also in LAB-1433) was re-run and holds: 634
  checks, 1 clock-dependent failure, fixed in PR #23.

## Decision 1: Source of truth

Where the canonical brand lives once there is a server.

### Options

**A. Git-backed (planner's lean).** A brands repo (or one repo per brand) of v2 config
files and assets. The server reads files; every write is a commit or a PR.

- Gains: history, blame and diff for free; PR review as an approval gate; trivial backup
  and exit; fits per-repo ownership and Kyle's existing review habits; the CLI can work on
  a clone with no server at all.
- Costs, concretely:
  - **Write latency and merge model.** A preview/confirm write (LAB-1444) becomes a
    GitHub API commit, roughly 1 to 2 seconds per write. A batch of 30 agent rule edits is
    either 30 commits on main, or one PR that someone has to merge before agents can read
    the result. If writes go through PRs, "write then read back" in the same agent session
    sees stale data unless the server reads from the PR branch.
  - **Confirm codes map to compare-and-swap.** UI Rules rejects a confirm when "the stored
    value moved since the preview". In git that is a check on the blob or commit SHA. It
    works, but concurrent writers on one file (two agents editing one brand) will collide
    on the whole-file SHA unless the brand is split into many files.
  - **Binary assets.** LAB-1438 wants logo sets, 15 Stacky states, fonts and icons uploaded
    by API with stable public URLs. Git needs LFS or an object store with URLs in config;
    either way assets are not in git in any useful sense.
  - **Not free from git:** Trash with nested children, locks enforced for every writer,
    serving pins per project, per-key rate limits and usage metering (LAB-1448, LAB-1441).
    Git gives commit history and diff; everything else in LAB-1448 is still built.
  - **Tenancy.** GitHub permissions are per repo. A single brands monorepo still needs a
    server-side ACL per brand; one repo per brand multiplies webhooks, tokens and deploy
    wiring by 20.
  - **Read path.** Stateless functions cannot hold a clone; reads go through the GitHub
    Contents API with an ETag or webhook-invalidated cache, which adds a dependency on
    GitHub availability and rate limits on the read path.

**B. Database (UI Rules model).** Postgres holds brands, projects, tokens, rules, assets
metadata; an object store holds binaries. Every write is a transaction plus an
append-only revision row (actor, tool, diff).

- Gains: millisecond writes; row-level compare-and-swap for confirm codes; per-brand ACLs
  and row-level security; Trash, locks, pins and activity log are ordinary tables;
  concurrent agents do not collide unless they touch the same record.
- Costs: history, diff, restore and backup are all built (LAB-1448 is fully on us); no PR
  review gate unless built; lock-in to our own store; the offline CLI needs an export
  format anyway.

**C. Hybrid: database canonical, git export.** B, plus a one-way export of each brand
(v2 config, assets manifest, generated exports) to a brands repo on every revision or on a
schedule.

- Gains: B's write path and tenancy, plus a human-readable, diffable history and an exit.
  The export is also exactly what `brandkit pull` writes (Decision 4).
- Costs: two representations to keep in step; a PR opened against the export repo does
  nothing unless a two-way sync is built (and two-way sync is where hybrids go wrong).

**D. Staged.** Ship Phase 2 read tools (LAB-1440) off a git repo, move to B or C when
writes (LAB-1444) land.

- Gains: fastest path to read parity with UI Rules, which is the cutover gate in the
  lessons doc.
- Costs: a storage migration in the middle of the epic, and LAB-1444/LAB-1448 designed
  twice.

### Consequences

- The choice decides how much of LAB-1448 is built: under A, versions and diff are git and
  pins become "serve commit X"; under B/C, everything is tables.
- The dark guardrail is enforceable in every option only after LAB-1435 adds contexts.
  Under B/C it can be a write-path rule (a token write must name its context; a base or
  light write never touches dark values). Under A it is a lint on the PR.
- Asset storage (object store with stable URLs) is needed in every option.

### Recommendation (proposed, for Kyle)

**C, with a one-way export.** The write patterns the epic asks for (agent writes with
preview/confirm at brand level, many agents per brand, asset upload by API, scopes and
pins per project) are database-shaped, and UI Rules' worst moments were all write-path
and permission problems. The export repo keeps what git is good at (readable history, a
second copy, an exit) without putting GitHub on the write path. If Kyle values PR review
as the gate more than write latency, A is coherent, but then LAB-1444's confirm step
should become "open a PR" and the latency and staleness costs above should be accepted
explicitly, not discovered.

## Decision 2: Multi-tenancy and access

### Options

- **One server, many brands.** Organization (Stacklab) owns brands; each brand has
  projects (surfaces, LAB-1437). Keys and sessions are scoped to one brand or one project.
- **One deployment per client.** Separate URL, store and keys per client.
- **One server, with dedicated deployments on request.** The default is shared; a client
  with residency or contractual needs gets its own instance of the same code.

### Consequences

- Shared: one URL to connect every agent to (lessons doc, point 1), one upgrade, one set
  of ops; isolation must be proven by tests (LAB-1443 requires cross-brand reads to fail).
- Per client: isolation by construction, but 20 deployments recreate the version drift
  the server exists to end, and the factory default (AGENT-1456) would need a URL per
  client.
- Roles to cover: Stacklab staff and agents (write across client brands they work on),
  client staff (read, possibly write their own brand), and anonymous readers of public
  guides (read only, published data only).

### Recommendation (proposed, for Kyle)

**One server, dedicated deployments only on request.** Access model:

- Roles per brand: owner, editor, viewer. Stacklab staff are members of the Stacklab
  organization and are granted per brand, not globally, so an agent key for one client
  cannot read another.
- Keys scoped to a brand or a project, with scopes in groups (read, sessions, authoring)
  that can be raised or lowered in place (LAB-1441). A scope error names the scope and the
  exact path to get it.
- Brand id on every query plus Postgres row-level security as a second wall (if B/C).
- Published guide data (what `brand.json` exposes today) stays publicly readable per brand
  when the brand owner marks it public, so existing static consumers do not need keys.

## Decision 3: Hosting

The MCP transport is streamable HTTP and stateless (POST only, 405 on GET, as UI Rules).

### Options

- **Vercel functions** (Node runtime), with managed Postgres (Neon or Supabase via the
  Marketplace) and Vercel Blob for assets.
- **Railway**: a long-running Node service, Railway Postgres, a volume or bucket.
- **Other** (Cloudflare Workers plus D1/R2, Fly.io). Workers would force non-Node
  runtimes on code we want to reuse.

### Consequences

- A stateless MCP endpoint fits functions well. In-memory state does not: per-key rate
  limits (120 a minute in UI Rules) and usage metering need a shared store under either
  host.
- Option A (git-backed) favours Railway: a persistent checkout avoids a GitHub API call per
  read. Options B/C are host-neutral.
- Heavy jobs do not belong on the request path: `generate --from --render` uses Playwright
  (`lib/ingest/render.js`), and the drift check (LAB-1447) and repo linting (LAB-1446) are
  scheduled, long-running work. Those want a worker (Railway service, or Vercel cron plus
  queues with care around time limits).
- Reuse: `lib/export.js`, `lib/formats.js`, `lib/template.js` and `lib/ingest/` are plain
  Node and run unchanged on either host's Node runtime.
- Both hosts are already in use at Stacklab, so neither is an unfamiliar operational
  bet. Cost was not modelled for this draft.

### Recommendation (proposed, for Kyle)

**Vercel functions for the request path (MCP endpoint, REST, guide site), with Postgres
and Blob; a separate worker for Playwright, drift and lint jobs** whose host is an open
question. If Kyle picks git-backed storage in Decision 1, revisit this and prefer Railway.

## Decision 4: The npm CLI's role afterwards

### Options

- **Unchanged CLI, server separate.** No coupling.
- **CLI as a thin client.** Adds `login`, `pull`, `push` (and later `lint`, `setup`).
- **CLI absorbs the server.** One package that can also run the server.

### Consequences

- The zero-dependency rule (CLAUDE.md) survives only if the server lives in a separate
  package. Node 18 builtin `fetch` is enough for `login`/`pull`/`push`; the device-code
  flow (LAB-1441) needs no browser library.
- Credentials: builtins have no keychain access. A file under the user config dir with
  mode 0600 is the zero-dependency option; it must never land in a repo (LAB-1452).
- `pull` output must stay readable by the engine pinned in that repo (Context, fact 2).

### Recommendation (proposed, for Kyle)

**Thin client; server in a separate package** (for example
`@stacklist-app/brandkit-server`, same repo or not: open question). The CLI:

- keeps every current command working offline, per repo, with no login, exactly as today;
- gains `login` (device code), `pull` (writes the guide dir: config, logos, exports, at
  the schema the installed engine reads; see Decision 5), and `push` (sends local changes
  as a preview, shows the diff, writes only on confirm, the same contract as the MCP
  write tools);
- later gains `lint` (LAB-1446) and `setup` (LAB-1452);
- shares the pure transforms (`lib/export.js`, `lib/formats.js`, contrast) with the
  server, so the guide, the exports and the MCP answers cannot disagree.

## Decision 5: Schema versioning and migration from v1

### Options

- **Version by shape only** (as today): detect v2 by its keys.
- **Explicit marker:** a top-level `schemaVersion` in the config, absent means v1.
- **Separate v2 file name** (for example `brand.config.json`) so old engines never see v2.

### Consequences

- `brand.version` is already taken by the guide revision, so the marker must be a new
  key. `additionalProperties: true` means v1 engines ignore unknown keys, but they cannot
  render rules, contexts or v2 token shapes, and they break if a v1 key they need
  (`theme`, `colors.*.items`) changes shape.
- Scaffold detection (`isStillScaffold`, `copyKey`) compares against starter copy back to
  1.6.0 (`test/fixtures/starter-1.6.0.json`). Migration must run that detection first, or
  brandkit placeholder copy becomes "authored" v2 rules in client brands.
- v1 prose lists (`voice.do/dont`, `gradientUsage`, `logoUsage.dont`) become rules
  (LAB-1434). v1 `theme` becomes the base (light) context; nothing is written to a dark
  context during migration, which keeps the guardrail true from day one.

### Recommendation (proposed, for Kyle)

- Add **`schemaVersion: 2`** at the top level of v2 configs; absence means v1. Mirror it in
  `brand.json` and under `$extensions["app.stacklist.brandkit"]` in `tokens.json`, and add
  the package version beside `generatedBy`.
- Ship v2 as **brandkit 2.0.0**, with schema validation enforced in `build`/`export`
  (LAB-1433 first).
- **`migrate(v1) -> v2` is a pure, idempotent function in `lib/`**, run by the server on
  import and by the CLI on demand. It writes a migration report beside the config (the
  `ingest-evidence.json` pattern): what mapped, what became rules, what was scaffold and
  dropped, what did not map. It never rewrites client prose, only moves it.
- **`toV1(v2)` projection** for `pull` into repos whose installed engine is below 2.0, so
  pinned repos keep rendering. It is lossy (rules, extra contexts, custom nodes) and says
  so in its output.
- The 2.0 engine reads v1 and v2. The server stores v2 only.
- Order: Stacklist, Freeway (the fixture), then client repos by activity (LAB-1452).
  Compatibility window for v1 static exports: open question.

## Decision 6: Where people author rules

### Options

- **MCP write tools** with preview/confirm (LAB-1444). This is how Stacklist rules were
  actually written in UI Rules (Palette for design, Scribe for copy).
- **PRs** against config files. Natural under Decision 1 A; under C, only if two-way sync
  exists.
- **A web editor**, the UI Rules model.
- **The guide site in edit mode.** People edit on the page they already read.

### Consequences

- No ticket in LAB-1434 to LAB-1453 builds a web editor or an edit mode. LAB-1444 is agent
  writes; LAB-1450 is a read-only guide v2. Choosing either human surface is a new ticket.
- Kyle's rulings ("define rules first, root out conflicts after") need to be recordable
  with `ruled by` and `ruled on` (LAB-1434 provenance) from whichever surface is chosen.
- A web editor is the largest build and duplicates the guide's rendering of the same data.

### Recommendation (proposed, for Kyle)

- **Primary: agents through MCP** with preview/confirm, at brand or project level, each
  write logged with actor and diff and carrying structured sources.
- **Secondary for people: the guide site in edit mode**, reusing LAB-1450's views,
  scheduled after cutover (new ticket, Phase 4).
- **No separate web editor** for now. **PRs** only if Decision 1 lands on A.
- `brandkit push` covers the person who prefers editing a local file.

## Open questions for Kyle

1. Source of truth: C (database plus one-way git export), A (git-backed, PR as the gate),
   or D (staged)?
2. Under C: is a one-way export enough, or must a PR on the export repo flow back in?
3. Do client staff get logins and write access to their own brand, or only Stacklab?
4. Do brand-level writes on client brands need an approval step beyond preview/confirm?
5. Request path on Vercel, and where do Playwright, drift and lint jobs run?
6. Server package: in this repo (monorepo) or a separate repo? And the production domain?
7. Human editing surface: guide edit mode as a new Phase 4 ticket, a web editor, or
   neither for now?
8. How long do v1 static exports stay supported, and may any of the 20 consumers stay on
   v1 indefinitely?
9. What happens to the stray `brand/config.json` in this repo?

## Tickets this affects

In the table, D1 to D6 mean Decisions 1 to 6 above.

| Ticket | Constrained by | How |
| -- | -- | -- |
| LAB-1433 [0.2] baseline | D5 | Schema enforcement lands before v2 so `schemaVersion` validation has a base |
| LAB-1434 [1.1] rules | D1, D5, D6 | Storage shape of rules; v1 prose lists migrate via `migrate()`; `ruled by`/`ruled on` set by every write surface |
| LAB-1435 [1.2] open tokens and themes | D1, D5 | v1 `theme` becomes base context; dark-context write rule enforced in the write path (C) or by lint (A) |
| LAB-1436 [1.3] token categories | D5 | New categories exist only in v2; `toV1()` drops them with a warning |
| LAB-1437 [1.4] brands, projects, overrides | D1, D2 | Org, brand, project tenancy model; effective view resolved in the store |
| LAB-1438 [1.5] assets v2 | D1, D3 | Object store with stable URLs in every option; not git |
| LAB-1439 [1.6] component library config | D5 | New v2 field |
| LAB-1440 [2.1] read tools | D1, D3 | Read path (DB vs GitHub API with cache); D staged option ships this first |
| LAB-1441 [2.2] auth | D2, D4 | Per-brand roles and keys; device code for `brandkit login`; shared store for rate limits |
| LAB-1442 [2.4] session tools | D1 | Notes and usage reports are DB rows in every option (not git) |
| LAB-1443 [2.5] hosting and ops | D1, D2, D3 | Reword "git-backed storage gets this free"; backups depend on D1 |
| LAB-1444 [2.3] write tools | D1, D6 | Confirm code = row CAS (C) or SHA CAS plus commit or PR (A) |
| LAB-1445 [3.1] emitters | D4 | Emitters live in shared `lib/` used by CLI and server |
| LAB-1446 [3.2] linter | D3, D4 | Runs in CLI and worker; `brandkit lint` stays zero-dependency |
| LAB-1447 [3.3] drift check | D3 | Scheduled worker host |
| LAB-1448 [4.1] history | D1 | Built in full under B/C; partly git under A; reword "git-backed gets much of this free" |
| LAB-1449 [4.2] baseline corpus | D2 | Template pack stored per organization, opt-in per brand |
| LAB-1450 [4.3] guide site v2 | D3, D5, D6 | 2.0 engine reads v1 and v2; SSR from the server; candidate home for edit mode |
| LAB-1451 [4.4] importers | D5 | UI Rules and Figma imports produce v2 through the same validation as `migrate()` |
| LAB-1452 [4.5] rollout | D4, D5 | `pull` with `toV1()` for pinned repos; credentials never in repos; upgrade order |
| LAB-1453 [4.6] Stacklist cutover | D1 | Reword "export to the brands repo" to match D1 |
| New ticket (if chosen) | D6 | Guide edit mode or web editor; none exists today |
