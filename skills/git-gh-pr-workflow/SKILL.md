---
name: git-gh-pr-workflow
description: Safe git and GitHub PR workflow for self-modification. Use when making code changes to MaxBot that need to be committed, pushed, and reviewed.
---

# git-gh-pr-workflow

use this skill when you're making code changes to maxbot itself and need to use git and gh safely.

## goals
- keep the repo in a clean, predictable state after automated edits
- never push directly to main
- leave a clear trail with branch, commit, push, and pr

## required workflow
1. start from main when possible. if you're on a feature branch after earlier work, switch back to main first.
2. pull the latest main before starting new work.
3. create a fresh branch named `maxbot/<short-description>`.
4. make the requested changes.
5. review the diff and stage only the intended files.
6. commit with a short, lowercase, descriptive message.
7. if the new work belongs on an already open bot-created branch or pr, update that existing branch instead of creating a second pr for the same file or follow-up tweak.
8. push with `git push -u origin HEAD` for a new branch, or `git push` when updating an existing tracked branch.
9. open a pull request with `gh pr create` only when there is not already an appropriate open pr to extend.
10. after opening or updating the pr, switch the local checkout back to `main` so later work does not accidentally continue on the feature branch.

## safety rules
- never push directly to `main`
- never force-push unless the user explicitly asks
- do not stage unrelated files like `.claude/` or local scratch files
- if a previous branch is still checked out, mention it and correct it
- if a relevant bot-created pr is already open, prefer adding the follow-up commit there instead of opening a sibling pr
- if the working tree is dirty in a way that blocks switching branches, say what is blocking and stop

## useful commands
- current branch: `git branch --show-current`
- status: `git status --short --branch`
- update main: `git checkout main && git pull --ff-only`
- new branch: `git checkout -b maxbot/<name>`
- push branch: `git push -u origin HEAD`
- update existing branch: `git push`
- open pr: `gh pr create`
- return to main: `git checkout main`

## reporting
when you finish, report the branch name and pr url. if you updated an existing pr, say which one. if you also switched back to main, say that plainly.
