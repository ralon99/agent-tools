# github — gh/git cheat-sheet

Issues:
  gh issue list -R owner/repo --json number,title,state,labels [-s open|closed] [-L N]
  gh issue view N -R owner/repo --json title,body,state,comments
  gh issue create -R owner/repo -t "title" -b "body"
  gh issue comment N -R owner/repo -b "text"

Repo browsing:
  gh api repos/owner/repo/contents/path -q .content | base64 -d   # file content
  gh api repos/owner/repo/contents/path -q '.[].name'             # dir listing
  gh search code "query" --repo owner/repo --json path,repository
  git ls-remote --heads origin                                    # branches
  gh api repos/owner/repo/commits -q '.[].sha,.[].commit.message' # commits

Push/PR (in a local clone):
  git checkout -b branch-name
  git add -A && git commit -m "message"
  git push -u origin branch-name
  gh pr create -R owner/repo -B base -H branch-name -t "title" -b "body"

Not covered here — still needs the MCP or a manual `gh api` call: PR review threads /
inline diff comments, teams, releases, milestones, sub-issues.
