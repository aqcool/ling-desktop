# LING

[中文](README.md)

LING is a task-first desktop Agent product. This repository keeps a pinned DeepSeek Harness Runtime and Electron Host while it progressively builds a LING-owned Renderer, task experience, and desktop workflow.

The project is in a product-refoundation phase. This is not the historical DSH Desktop installer, sponsor, or community portal.

## Product boundaries

- `deepseek-harness/` is a pinned upstream submodule used as the Runtime. Desktop work never changes its source directly.
- `dsh-plugin-desktop/` and `dsh-plugin-desktop-beta/` own the Stable and Beta Electron Hosts, Profiles, native windows, and release paths.
- `dsh-desktop-next/` is an isolated experimental shell and the place to prototype the LING Renderer.
- `dsh-community-market/` remains in the current build and packaging dependency graph until the product explicitly replaces it.

LING is organized around Workspaces, Tasks, and Threads rather than a traditional editor-first experience. The Runtime owns agents, sessions, tools, and approvals; the Renderer owns LING's interface, state adaptation, and desktop experience.

## Development

```sh
git submodule update --init --recursive
corepack yarn install --immutable
corepack yarn dev
```

Useful headless checks:

```sh
corepack yarn typecheck
corepack yarn test
corepack yarn check
```

## Documentation

- [Architecture](docs/architecture.en.md)
- [Plugin development](docs/plugin-development.en.md)
- [Desktop service contract](dsh-plugin-desktop/docs/plugin-services.md)
- [Contributing](CONTRIBUTING.en.md)
