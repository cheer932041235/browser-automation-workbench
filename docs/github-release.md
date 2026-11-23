# Publishing source updates

Run from the repository root:

```powershell
npm run check
npm test
git status --short
git diff --check
```

Review the files that will be committed. Exclude runtime/, work/, outputs/, logs/, browser profiles, credentials and real website captures. Use synthetic fixture pages for shared tests; make exact live-page URLs explicit command arguments.

The public README must describe the source being pushed, list actual installation requirements and distinguish offline tests from real-browser verification. Preserve upstream runtime licences. A source push, a version tag and a GitHub Release are separate operations; create each intentionally.
