# From CLI to product — the migration plan

This is the plan for turning Claude Studio into a hosted product, written down so it does
not have to be re-derived later. It is **not a to-do list for now**. `CLAUDE.md`'s "Path to
a SaaS" section is the short version and the reasoning; this file is the actionable expansion
— what to build, in what order, and what is already prepared so it stays a short job.

Read this when the trigger below has fired. Until then, the standing guidance holds: **make
videos, not product surface.**

---

## 0. Don't build this yet — the trigger

The compositions in `src/` are the product's actual value, and they are identical in a CLI
and in a service. So the CLI phase is where the real work happens, and a web layer built
before the workflows are known is shell around an unknown core.

Build only when one of these is true, not before:

- **Someone other than the owner needs to use it.** That is the web-layer trigger. A single
  user has a CLI; a second user needs a UI.
- **The same friction has bitten three times.** A feature earns its place by repeating, not
  by being anticipated.
- **Headless operation is needed** — CI, cron, or a render someone kicks off without Claude
  Code present. That is the narrower trigger for the agent binary (see §6), not the whole product.

If none has fired, close this file and go record. Ten to twenty of the owner's own shorts
will decide what actually deserves a UI.

---

## 1. The one architectural fact that shapes everything

A render is **headless Chrome + ffmpeg running for minutes**. That single fact splits the
product into two pieces with different homes:

| Piece | What it does | Where it runs | Serverless? |
|---|---|---|---|
| **UI + API** | upload, pick flags, show progress, return the file | Vercel / Next.js | Yes — normal functions |
| **Render** | Chrome + ffmpeg, minutes per video | Remotion Lambda (AWS) or Cloud Run (GCP) | Yes, but a *specialised* kind — never a plain Vercel/Netlify function |

A plain serverless function times out and has no place to run headless Chrome. "Serverless
render" exists, but it means `@remotion/lambda` (scales to zero, pay per render) — not a
Vercel Function. Do not try to render in the API layer; the API's job is to *enqueue* a
render and report on it.

---

## 2. The minimal stack

```
Next.js on Vercel     UI + API + auth
@remotion/lambda      render on AWS — scales to zero, pay per render
AssemblyAI            transcription (already integrated)
S3 (or Vercel Blob)   store uploads and finished renders
```

Recommended render host: **Remotion Lambda**, because it is the path Remotion officially
supports, it scales to zero (no idle cost while nobody renders), and the compositions run on
it unchanged. Cloud Run is the alternative when a long-lived container or non-AWS is wanted;
a single always-on VPS with a job queue is simplest to reason about but pays 24/7 and has to
be babysat. Start with Lambda.

---

## 3. The seams already in place

Nothing in the current tree has to move when the web layer arrives — it is additive, an
`app/` alongside the existing `src/` and `scripts/`:

- **`scripts/lib/` returns values, never prints.** `transcribeToCaptions`, `applyCorrections`,
  `parseArgs`, and the rest take arguments and return data — an HTTP handler imports them as-is.
  The `.mts` shells at the top of `scripts/` are the only CLI-coupled code, and the web layer
  simply does not import them.
- **Compositions read inputs through props and `calculateMetadata`, not hardcoded paths.**
  Per-user data is already the shape they expect: `public/captions.json` → a value passed as
  a prop. Point `calculateMetadata` at a URL instead of `staticFile` and the same composition
  renders per-user data.
- **`src/lib/` is pure and DOM-free** — the cut and the framing already back both the CLI and
  the composition, so a service can call them without untangling.

The one boundary to respect while building: `scripts` may import `src/lib/*`, never the other
way. The web layer follows the same rule.

---

## 4. Migration phases, cheapest first

Each phase is shippable and reversible. Do not start the next until the current one is used.

**Phase 1 — Render off the local box.** Deploy the composition bundle to Remotion Lambda.
Keep the CLI as the front end: a flag that renders on Lambda instead of locally. This proves
the compositions run on Lambda and the fonts/assets resolve, with zero UI work. It is also
the whole win for the owner alone — long renders stop pinning the laptop.

**Phase 2 — An API around the render.** A Next.js route that accepts an uploaded file, calls
AssemblyAI, writes captions to S3/Blob, and triggers the Lambda render. Returns a job id;
a second route polls status. Still no UI — `curl` or Claude Code drives it. This is where
`scripts/lib/` gets imported by a handler for the first time.

**Phase 3 — A UI.** Upload form, the flag surface as controls (crop, caption position, colour,
hook, handle), a progress bar, a download link. This is the first phase that needs a *second
user* to justify it.

**Phase 4 — Accounts and limits.** Auth, per-user storage, and a cap on minutes — because
AssemblyAI and Lambda both bill per use, an open endpoint is an open wallet. Only when there
are users to have accounts.

**Phase 5 — Billing.** Last. Do not add Stripe before there is something worth paying for and
someone asking to.

Stop after any phase that is enough. Phase 1 alone may be the entire product the owner needs.

---

## 5. Check these BEFORE investing months, not after

- **Remotion licensing.** Free for individuals and teams up to 3. A commercial product built
  on Remotion needs a company license — [remotion.pro](https://remotion.pro). Confirm the
  terms before writing product code, not after.
- **AssemblyAI bills per hour of audio.** Negligible for one person, a real line item with
  users. Phase 4's minute-cap exists because of this.
- **Render cost on Lambda.** Pay per render, driven by memory and duration; a 1080x1920 short
  with video behind the captions is minutes of Lambda time because `OffthreadVideo` extracts
  every frame. Estimate a real short with Remotion's own Lambda cost calculator before pricing
  anything — do not guess.

---

## 6. Deferred, with the ground prepared

- **Standalone agent binary on the Anthropic SDK.** Buys headless operation (CI, cron, someone
  else running it) and nothing else right now. Claude Code plus the `short-subtitulado` skill
  covers it while the owner is present. The `scripts/lib/` split is what makes this a short job
  when the need is real. Do not build it speculatively.
- **Transitions, auto b-roll, style templates.** Composition features. Each should come from a
  repeated need in the owner's real videos, not from a roadmap.

---

## What does not change

The migration is purely additive. `src/` compositions, `src/lib/` pure logic, `scripts/lib/`
domain functions, and the caption/cut/framing design all stay exactly as they are. The web
layer calls the same functions the CLI calls. If a phase requires editing `src/lib/` or
`src/compositions/`, that is a signal the abstraction was wrong — stop and reconsider before
proceeding.
