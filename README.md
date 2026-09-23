# Paseo worktree status

A [Paseo](https://paseo.sh) plugin that shows, for every task, where its git worktree stands: still
dirty, not merged, merged but `main` not pushed, or done and ready to clean up.

It exists for one failure mode: finishing a task in a worktree, forgetting the last merge or push,
and wondering later why the feature is not live.

## What you get

- **Header icon.** Every workspace header gets a small monochrome icon for its worktree state. Open
  it to see the details, copy the push or cleanup command, or pick the worktree by hand.
- **Worktrees overview.** A sidebar entry lists every repository with its tasks and with worktrees
  that no task claims anymore, most urgent first.

The plugin only reads git. It never commits, merges, pushes or removes anything; commands are
offered for copying.

| Lucide icon           | State                   | Meaning                                                       |
| --------------------- | ----------------------- | ------------------------------------------------------------- |
| `CircleDot`           | Uncommitted changes     | Tracked files are modified or conflicted                      |
| `GitPullRequestArrow` | Not merged              | Commits are in neither the local nor the remote base branch   |
| `CircleArrowUp`       | Merged, main not pushed | The work is in local `main` but not on `origin/main` (tinted) |
| `CircleDashed`        | No commits yet          | The branch never got a commit                                 |
| `CloudOff`            | Committed, no remote    | Everything is committed, but there is no `origin` to push to  |
| `CircleCheck`         | Merged and pushed       | Everything is on `origin/main`; the worktree can be removed   |
| `CheckCheck`          | Cleaned up              | The worktree is gone and its work is merged                   |
| `CircleAlert`         | Folder missing          | The folder was deleted but git still lists the worktree       |

Untracked files alone do not make a worktree dirty; they are shown as a note, because they block
`git worktree remove`.

## How it decides

**Base branch.** Same order as Paseo itself:

1. `origin/HEAD`
2. a local `main` or `master`
3. the branch checked out in the main checkout

Worktrees created by Paseo use the base recorded in their metadata. Every branch is compared with
both the local and the `origin` base.

**Merged.** A commit counts as merged when it is reachable from the base or when `git cherry` finds
an equivalent patch there. Cherry-picked and rebased work is recognized; squash merges are not yet.

**Which worktree belongs to a task.** In this order:

1. A worktree you picked by hand in the header popover
2. The workspace folder, when it is a worktree
3. An agent started inside a worktree
4. Agent activity: `cd` into a worktree, edits below it, or the `git worktree add` that created it.
   Tool output such as `git worktree list` is ignored.
5. The main checkout, when the task lives there

Agent activity is read when a turn ends. Agents that are still open are read once in the
background; closed agents are not, because reading their timeline would resume their session.
Link those tasks by hand if you need them.

## Install

Plugins run unsandboxed on the daemon machine, so Paseo requires **Settings → Plugins → Enable
plugins** first. Then:

```bash
paseo plugin install github:ImAnOwl/paseo-worktree-status
```

Requires Paseo 0.8.0 or later (daemon and app) and git 2.31 or later on the daemon host.

## Develop

```bash
npm install
npm run check       # format, lint, typecheck, tests
paseo plugin install "$PWD"
paseo plugin reload worktree-status
paseo plugin logs worktree-status
```

Formatting and lint rules follow the Paseo repository (oxfmt, oxlint); lefthook runs them before
each commit. Tests use real git repositories in a temporary folder.

Inferred links are cached in `$PASEO_HOME/plugin-data/worktree-status/links.json`; manual links
are stored as plugin settings.

## License

MIT
