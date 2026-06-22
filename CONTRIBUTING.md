# Contributing to Constructor Fabric Documentation

Thank you for helping improve the Constructor Fabric docs! See the [README](./README.md) for setup and development commands.

## Writing Documentation

All documentation lives in `docs/`. Pages are written in Markdown with VitePress extensions.

### Structure

```text
docs/
├── intro/          # Getting started and architecture guides
│   ├── core/       # Core concepts (modules, SDK, database, OData)
│   └── tutorials/  # Step-by-step tutorials
├── reference/      # API and library reference
│   ├── modkit/     # ModKit library docs
│   └── system-sdks/
└── assets/         # Diagrams and images
```

### Style Guidelines

- Use active voice and present tense
- Keep sentences short and direct
- Include code examples wherever possible
- Use VitePress custom containers for callouts:

  ```md
  ::: tip
  This is a helpful tip.
  :::

  ::: warning
  This is a warning.
  :::

  ::: danger
  This is a danger notice.
  :::
  ```

## Submitting a Pull Request

1. Create a branch with a descriptive name:
   ```sh
   git checkout -b docs/your-topic
   ```
2. Make your changes
3. Verify the site builds without errors:
   ```sh
   bun run docs:build
   ```
4. Commit with a sign-off and push your branch:
   ```sh
   git commit -s -m "docs: your message"
   git push origin docs/your-topic
   ```
   > **Note:** The `-s` flag adds a `Signed-off-by` line to your commit message, required by the DCO check. Without it your PR will be blocked.
5. Open a pull request against `main` with a clear description of what you added or changed

## License

By contributing, you agree that your contributions will be licensed under the [Apache-2.0 License](./LICENSE).
