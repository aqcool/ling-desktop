# Contributing to LING

LING is evolving from an existing Desktop Runtime into a product with its own Renderer. Before making a change, make sure it belongs to the current product boundary.

## Development environment

```sh
git submodule update --init --recursive
corepack yarn install --immutable
corepack yarn check
```

## Repository boundaries

- Never modify `deepseek-harness/`; upstream updates are separate commits.
- Validate Desktop Host changes in `dsh-plugin-desktop-beta/` first, then synchronize them to Stable and run `corepack yarn check:desktop-variants`.
- `dsh-desktop-next/` is the experimental home for the first-party Renderer. Do not remove the current official-frontend path until its replacement is stable.
- `dsh-community-market/` remains part of the current build and packaging graph. Removing or replacing it requires a separate product decision and complete verification.

## Before committing

- Use a clear Conventional Commit message, such as `feat(renderer): ...` or `docs: ...`.
- Run verification proportional to the change. Host or shared Desktop changes require at least type checking, relevant tests, and variant validation.
- Keep documentation bilingual and update the matching `.i18n.yaml` record.
