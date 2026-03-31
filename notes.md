# Repo Notes

## Current State

- Repo path: `/Users/adityasudhakar/adityasudhakar.github.io`
- Canonical branch: `main`
- Current published branch on GitHub Pages: `main`
- Remote: `origin = https://github.com/adityasudhakar/adityasudhakar.github.io.git`
- Current `main` tip: `b02b547` (`Update GitHub contributions data`)

At the moment there is only one remaining worktree:

- `/Users/adityasudhakar/adityasudhakar.github.io` on branch `main`

Old temporary worktrees and branches were cleaned up:

- removed worktree `/Users/adityasudhakar/agentA`
- removed worktree `/Users/adityasudhakar/agentB-home-screen`
- deleted local branches `github-page` and `home-screen`
- deleted temporary integration branch `combine-home-screen-github-page-20260330` locally and on `origin`
- removed worktree `/Users/adityasudhakar/home-page`
- deleted local branch `home-page`
- removed worktree `/Users/adityasudhakar/theslyllama`
- deleted local branch `theslyllama`

## Story So Far

Two separate worktrees were used for parallel work:

- `agentB-home-screen` on branch `home-screen`
- `agentA` on branch `github-page`

Each worktree started from the same base commit and had uncommitted local changes. Those changes were committed independently:

- `a097f46` `Update home screen content`
- `8a7d682` `Refine GitHub page presentation`

Those two branches were then combined safely by:

1. creating a temporary integration branch from `main`
2. merging `home-screen` into the integration branch
3. merging `github-page` into the integration branch
4. reviewing the combined result locally
5. merging the integration branch into `main`
6. pushing `main` to `origin`

The public site now reflects both sets of work.

Later work also merged:

- `0495690` `Refine homepage copy`
- `c2bbde2` `Migrate The Sly Llama pages`
- `51aeb4a` `Remove unused The Sly Llama asset`
- `569082d` `Rename The Sly Llama route`
- `7fddfac` `Automate GitHub contributions refresh`
- `b02b547` `Update GitHub contributions data`

## What Changed

Homepage (`/`):

- updated intro copy
- replaced the older reveal-stack content with inline expandable details
- changed the links list, including a podcast link

GitHub page (`/github/`):

- simplified page structure
- changed the back link to `← Back`
- removed the older detail list and footnote section
- adjusted chart initialization and anchor behavior
- updated inline link styling

The Sly Llama:

- The Sly Llama pages were migrated into this repo and merged to `main`
- the original route `/theslyllama/` behaved inconsistently on public Pages
- a fresh route `/the-sly-llama/` was created and worked immediately
- current public route should be treated as `/the-sly-llama/`

## Design Direction

The current site direction is intentionally borrowing from the feel of `benji.org`.

That does not mean copying it literally. It means future agents should preserve the broad stylistic cues that motivated the current work:

- sparse, deliberate layout
- editorial/minimal presentation
- restrained typography and spacing
- simple navigation and page structure
- personal-site tone rather than generic startup-marketing tone

When making new changes, agents should treat this as the current aesthetic reference unless given a newer design direction.

## GitHub Pages Notes

The site is currently deployed on GitHub Pages and is now configured with a custom domain:

- canonical public domain: `https://adityasudhakar.com/`
- backing GitHub Pages domain: `https://adityasudhakar.github.io/`
- `www.adityasudhakar.com` redirects to `https://adityasudhakar.com/`
- the repo contains a tracked `CNAME` file

DNS shape:

- apex domain uses GitHub Pages `A` records
- `www` is configured as a `CNAME` to `adityasudhakar.github.io`

If the browser appears to redirect `adityasudhakar.github.io` to `adityasudhakar.com`, that appears to be stale cache behavior, not current repo configuration.

Observed behavior:

- `https://adityasudhakar.github.io/` returned HTTP 200 when checked directly
- incognito loaded the correct site
- `/?v=2` bypassed the stale cached redirect
- `/theslyllama/` served an old July 23, 2022 Wix HTML artifact even though `main` and the GitHub contents API had the correct new file
- GitHub Pages rebuilt successfully for commit `fe3e71c`, but `/theslyllama/` still served the old artifact
- renaming the route to `/the-sly-llama/` fixed the issue immediately

## GitHub Automation

This repo now includes a GitHub Action that refreshes the GitHub contributions data used by the `/github/` page.

Files:

- `.github/workflows/update-github-contributions.yml`
- `scripts/update_github_contributions.py`

Behavior:

- runs daily on a schedule
- can also be triggered manually with `workflow_dispatch`
- updates `github/data/contributions.json`
- commits and pushes only if the generated data changed

This keeps the GitHub contributions counter and liveline from going stale.

## Working Agreement For Future Agents

If you are a new agent working in this repo:

1. read this file first
2. assume `main` in `/Users/adityasudhakar/adityasudhakar.github.io` is the source of truth
3. do not edit directly on `main` if the goal is parallel work
4. create a new branch from `main`
5. create a dedicated worktree for that branch
6. keep your scope narrow and avoid overlapping file ownership with other agents
7. commit your work in your own branch
8. do not delete or rewrite other agents' branches or worktrees
9. do not force-push unless explicitly instructed
10. when combining work, prefer merging into a temporary integration branch first if multiple agents changed different areas

## Recommended Parallel Workflow

For each new parallel task:

1. create a branch from `main`
2. create a worktree for that branch in `/Users/adityasudhakar/<task-name>`
3. do the work only in that worktree
4. commit with a focused message
5. return the branch name, worktree path, and commit SHA

Suggested naming:

- branch: short task-focused name such as `hero-copy-refresh` or `github-chart-tuning`
- worktree path: `/Users/adityasudhakar/<matching-task-name>`

## Local Preview

To preview the current site from the main worktree:

```bash
cd /Users/adityasudhakar/adityasudhakar.github.io
python3 -m http.server 8000
```

Then open:

- `http://127.0.0.1:8000/`
- `http://127.0.0.1:8000/github/`
- `http://127.0.0.1:8000/the-sly-llama/`

## Coordination Notes

- Different pages can still be part of one combined site. For example, `/` and `/github/` are separate routes but one repo and one deployment.
- Browser caching can mislead local verification. If something looks wrong after deployment, test with a hard refresh, incognito, or a cache-busting query string.
- Some public path issues may be path-specific rather than repo-wide. `/theslyllama/` was one such case; `/the-sly-llama/` worked while the old slug kept serving stale content.
- If you need to understand hosting quickly later, start from the live domain and then inspect DNS, `CNAME`, GitHub Pages settings, `.github/workflows`, and this file.
- If multiple agents are active, each should state clearly which files they own before editing.
- If changes need to be integrated from multiple worktrees, the safest pattern is:
  merge individual branches into a temporary integration branch, review there, then merge to `main`.
