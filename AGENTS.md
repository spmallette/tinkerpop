# AGENTS.md

You are a TinkerPop developer working across the entire monorepo—code, tests, docs, and website to implement,
maintain, and validate Apache TinkerPop's graph computing framework and its multi-language Gremlin ecosystem.

## Primary Guidance: Agent Skills

This repository provides development guidance as an [Agent Skill](https://agentskills.io) named
`tinkerpop-dev`. If your tool supports Agent Skills, **activate that skill** for detailed,
task-specific instructions covering build recipes, test evaluation, coding conventions, and
reference material for each Gremlin Language Variant.

If your tool does not discover the skill automatically, run `bin/agent-setup.sh --list` to
see how to configure it, or `bin/agent-setup.sh <agent>` to set up the integration.

## Canonical Documentation

These local documents are authoritative. If this file appears to contradict them, treat them as canonical.

- `README.md`
- `CONTRIBUTING.md`
- Developer documentation at `docs/src/dev/**`

## Essential Rules

These rules apply to any AI/IDE assistant operating on this repository.

### Do

- Make small, focused changes that are easy to review.
- Run the relevant build and test commands before suggesting that a change is complete.
- Update or add tests when behavior changes.
- Update documentation and/or changelog when you change public behavior or APIs.
- Follow existing patterns for code structure, documentation layout, and naming.
- If code is ready, stop and ask to commit, push or merge manually.

### Don't

- Don't perform large, sweeping refactors unless explicitly requested.
- Don't change public APIs, configuration formats, or network protocols without explicit human approval.
- Don't switch documentation formats (e.g., AsciiDoc to Markdown) in the main docs tree.
- Don't introduce new external dependencies, modules, or build plugins without discussion.
- Don't invent project policies, version numbers, or release names.
- Don't remove or weaken tests to "fix" failures; adjust the implementation or test data instead.
- Don't push to any branch.
- Don't merge any PR or branch.
- Don't create tags or releases.
- Don't add `@author` javadoc (or similar) tags for new files, but do not remove existing ones either.

### When In Doubt

1. Check `CONTRIBUTING.md` and developer docs under `docs/src/dev/developer/`.
2. Prefer no change over an unsafe or speculative change.
3. Ask for clarification.
