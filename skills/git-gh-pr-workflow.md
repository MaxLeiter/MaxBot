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
7. push with `git push -u origin HEAD`.
8. open a pull request with `gh pr create`.
9. after opening the pr, switch the local checkout back to `main` so later work does not accidentally continue on the feature branch.

## safety rules
- never push directly to `main`
- never force-push unless the user explicitly asks
- do not stage unrelated files like `.claude/` or local scratch files
- if a previous branch is still checked out, mention it and correct it
- if the working tree is dirty in a way that blocks switching branches, say what is blocking and stop

## reporting
when you finish, report the branch name and pr url. if you also switched back to main, say that plainly.
