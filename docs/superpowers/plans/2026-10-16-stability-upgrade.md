# Stability Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Repair cooldown-contact merging and make the existing game and eight-tier asset QA reproducibly verifiable before submitting an upstream PR.

**Architecture:** Keep the browser game and its vendored physics engine. Track only contacts deferred by cooldown, verify geometry at expiry independently of sleeping events, and feed eligible pairs into the existing merge queue. Test real game code in a small Node VM host; run image integration checks separately with sharp.

**Tech Stack:** Vanilla JavaScript, vendored Matter.js 0.19.0, Node built-in test runner, sharp 0.33.5, GitHub Actions.

## Global Constraints

- Pure static deployment and `node serve.js 5173` remain supported.
- Do not change spawn weights, scoring, drop line, collider sizes, artwork, or styling.
- Base rule tests require no dependency installation and no AI models.
- Inputs missing from image QA must fail with a named path and nonzero exit code.
- No deployment or automatic merge; submit a PR against `LVEG16/nailong-merge:main`.

## Task 1: Rule regression and cooldown repair

**Files:** Create `tests/helpers/game.cjs`, `tests/game.test.cjs`; modify `www/game.js`, `package.json`.

**Interfaces:** The test host returns `{ game, Matter, elements, frame, advance }`, where `game` is the existing `NAIWA` interface. Use `game.mk(x,y,tier)` and real `Matter.World.add` to construct boundary scenes; use `game.step(n,dt)` to advance them. No test-only production API additions.

- [x] Create a Node VM host with minimal DOM/canvas/storage/event surfaces and a controllable clock; load the vendored engine, colliders and game as actual scripts.
- [x] Write a real-physics failing case: add tier-0 bodies at `(180,560)` and `(180,489)`; advance 600 frames of 16.7 ms; assert `game.stat().pieces === 1`, tier 1, score 5. Include a pre-expiry assertion and a sleeping-contact variant.
- [x] Run `node --test tests/game.test.cjs`; verify only the cooldown-dependent expectations fail on the original code. Record the failure.
- [x] Add a map keyed by sorted root body IDs. On contact start, retain matching non-top pairs blocked by cooldown. At expiry, remove the candidate, validate current world membership and tier/liveness, then use `Matter.Query.collides(a,[b])` to confirm current geometry before queueing. Recheck until due even if collision events stop; clear map on reset and discard dead/removed pairs promptly.
- [x] Keep merge deduplication in `processMerges`. Cover separation/recontact, removed partners, multi-contact, compound bodies, terminal tiers, normal drops, reset and unavailable storage. Run the same assertions through the scheduled frame callback as well as debug stepping.
- [x] Rename `SIM_SPEED` to `PHYSICS_SUBSTEPS`, value 4; retain total simulated duration `dt`. Add `"test": "node --test tests/*.test.cjs"` and `"start": "node serve.js"` scripts.
- [x] Run `npm test` and commit the passing deliverable.

## Task 2: Executable eight-tier asset QA

**Files:** Modify `scripts/preview.js`; create `tests/preview.integration.cjs`; add `test:preview` and `preview` package scripts.

**Interfaces:** `node scripts/preview.js [inputDir] [outputDir]`, default input `www/assets`, default output project root. Input paths resolve from project root (absolute paths also accepted); output filenames remain `preview_magenta.png`, `preview_checker.png`, `preview_dark.png`.

- [x] Install only sharp 0.33.5 into a task-owned temporary tool directory, leaving the application lockfile and AI dependencies unchanged. Use `NODE_PATH` for this local check.
- [x] Write an integration test invoking the existing CLI in a temporary working/output directory. Assert three PNG outputs each contain a 4-column by 2-row arrangement of all eight actual game sprites; decode output pixels to confirm visible content in every cell and alternating checkerboard tiles. Also assert missing-directory/file error paths and nonzero exit.
- [x] Run `node --test tests/preview.integration.cjs`; verify the original script fails on stale names/output behavior.
- [x] Align all eight names with `scripts/build.js`; use `sharp(...).composite([{input: tile, tile:true}])` for checkerboard repetition; validate all inputs before producing files; create output directory only after validation. Preserve magenta/dark backgrounds and bounded 420-pixel cells.
- [x] Run image integration checks and generate all three previews for visual inspection. Add scripts `preview`, `test:preview` with the exact CLI/test commands above. Commit once passing.

## Task 3: Documentation and continuous verification

**Files:** Modify `README.md`; create `.github/workflows/checks.yml`; complete this plan's checkboxes.

- [x] Document zero-install runtime/rule tests, optional sharp-only preview setup, AI-build prerequisites, collider generation and asset-copy steps, and examples using actual output names.
- [x] Correct parameter descriptions: four time subdivisions, five spawn weights `[0.30,0.26,0.20,0.14,0.10]`, `COL_K=1.0`, hybrid hull geometry. Distinguish a prepared local runtime from browser caching/PWA offline installation.
- [x] Add push/PR checks on Ubuntu and Windows using Node 24, `actions/checkout@v4`, `actions/setup-node@v4`, `permissions: contents: read`, and `npm test`. Add an image QA job that installs only `sharp@0.33.5` under the runner's temporary directory, exports `NODE_PATH`, and runs `npm run test:preview`. Do not run install hooks for AI packages or deploy.
- [x] Run `npm test`, `npm run test:preview`, `git diff --check`; inspect generated preview images and final diff. Attempt browser verification via the supported Tabbit CLI; if unavailable, record exact limitation without claiming browser validation.
- [x] Request an independent code-review subagent with the approved spec, baseline SHA `635f7b437ad2972051c34e53b394c4b36593203f`, final SHA, repository path and test results. Address substantive findings and rerun affected checks.
- [ ] Commit final documentation/checks. Fetch upstream, verify the final branch diff and clean working tree; push to `han-yi-1212/nailong-merge:feat/stability-upgrade` and open a PR targeting upstream `main` using a UTF-8 body file. Verify PR URL, base/head and check results; report any genuinely pending CI or browser checks.

## Plan self-review

The approved spec's nine acceptance criteria map to Task 1 (rules, sleeping and reset), Task 2 (three eight-tier previews), and Task 3 (CI, documentation, delivery and browser limitation). Tasks preserve runtime dependencies and gameplay values. The user has already approved implementation and PR delivery; execute inline without another execution-choice gate.
