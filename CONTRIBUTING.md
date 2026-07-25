# Contributing to n8n-nodes-media-toolkit

Thanks for your interest in contributing! This document covers how to report issues, propose changes, and submit pull requests.

## Reporting Issues

Before opening an issue, please:

1. **Search existing issues** to avoid duplicates
2. **Use the latest version** — the bug may already be fixed
3. Include in your report:
   - n8n version and how it's hosted (cloud, Docker, npm)
   - Node pack version (`n8n-nodes-media-toolkit@x.y.z`)
   - Steps to reproduce, expected vs. actual behavior
   - Relevant workflow JSON (redact any sensitive data)
   - Error messages, quoted exactly

### Issue Labels

| Label | Meaning |
|---|---|
| `bug` | Confirmed defect |
| `enhancement` | Feature request |
| `question` | Usage question |
| `good first issue` | Suitable for new contributors |
| `needs-triage` | Awaiting maintainer review |

## Development Setup

```bash
git clone https://github.com/Media-Studios/n8n-nodes-media-toolkit.git
cd n8n-nodes-media-toolkit
npm install
npm run build
```

### Local testing against n8n

```bash
npm link
cd ~/.n8n/custom
npm link n8n-nodes-media-toolkit
# restart n8n
```

### Available scripts

| Script | Purpose |
|---|---|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Watch-mode compilation |
| `npm run lint` | Run ESLint |
| `npm test` | Run Jest tests |

## Pull Request Process

1. **Fork** the repository and create a branch from `main`:
   ```bash
   git checkout -b feat/my-new-operation
   ```
2. **Make your changes.** Follow the existing code style:
   - TypeScript strict mode — no `any` unless unavoidable
   - Node parameters follow n8n UX conventions (displayName in Title Case, descriptions end without periods where n8n convention applies)
   - Pure helper functions live outside the class for testability
3. **Add or update tests** for any behavior change
4. **Run the full check locally** before pushing:
   ```bash
   npm run lint && npm run build && npm test
   ```
5. **Write a clear PR description**:
   - What changed and why
   - Link related issues (`Closes #123`)
   - Screenshots of the node UI if parameters changed
6. **One logical change per PR.** Split unrelated changes into separate PRs.

### Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add WebM output spec support
fix: hashtag formatter strips unicode characters
docs: clarify resolution scale bounds
chore: bump typescript to 5.4
```

### Review expectations

- Maintainers aim to triage new PRs within one week
- CI (lint + build + tests) must pass before review
- At least one maintainer approval is required to merge
- Squash-merge is the default merge strategy

## Adding a New Operation

1. Add the operation to the `options` array of the `operation` property in `nodes/MediaToolkit/MediaToolkit.node.ts`
2. Add parameters gated with `displayOptions.show.operation`
3. Implement the branch in `execute()`, always pushing items with `pairedItem`
4. Support `continueOnFail()` in your error handling
5. Document the operation in `README.md` with parameter and output tables
6. Add tests covering the happy path and at least one edge case

## Release Process (maintainers)

1. Update `version` in `package.json` following [SemVer](https://semver.org/)
2. Commit: `chore: release v1.2.3`
3. Tag: `git tag v1.2.3 && git push origin v1.2.3`
4. The `publish.yml` workflow publishes to npm automatically via OIDC Trusted Publishing

## Code of Conduct

Be respectful and constructive. Harassment, personal attacks, and bad-faith participation are not tolerated. Maintainers may edit, lock, or remove content that violates this standard.

## Questions?

Open an issue with the `question` label, or start a discussion in the repository's Discussions tab.
