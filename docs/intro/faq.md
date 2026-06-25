# FAQ

## Do I need to know Rust to use Gears?

Yes. Gears are Rust crates and the toolkit is a Rust library. Familiarity with Cargo, traits, async/await, and derive macros is expected.

## What databases are supported?

Gears uses [SeaORM](https://www.sea-ql.org/SeaORM/) with SQLx backends. Supported databases are **PostgreSQL**, **MySQL**, and **SQLite**. All database access goes through `SecureConn`, which automatically enforces tenant isolation via scoped queries.

## How does inter-gear communication work?

Gears communicate through **ClientHub**, a type-safe service locator. Each gear registers an implementation of its SDK trait during initialization. Consumers resolve the trait at runtime:

```rust
let api = ctx.client_hub().get::<dyn MyGearApi>()?;
```

In-process calls are direct function calls. Out-of-process calls use gRPC transport implementing the same trait, so consumers don't know (or care) which is used.

## Can I run gears in separate processes?

Yes. Gears supports three deployment models with the same gear code:

- **Single-node** -- All gears in one process (development, edge, testing)
- **Multi-node** -- Gears communicate over REST/gRPC
- **Kubernetes** -- Containerized services with full orchestration

## How do I add FIPS-compliant cryptography?

Enable the `fips` flag in your manifest or on the CLI:

```bash
cargo gears run --fips
```

This activates [aws-lc-rs](https://github.com/aws/aws-lc-rs) as the crypto provider. See the [introduction](/intro/introduction) for more on FIPS compliance.

## What is the generated server?

The CLI generates an ephemeral Cargo project (under `.gears/` by default) that aggregates your selected gears into a single runnable binary. It is regenerated on every `build` or `run`. The generated server reads its runtime config from the `GEARS_CONFIG` environment variable, which the CLI sets automatically.

## How do I run my binary outside the CLI?

Set the config path manually:

```bash
GEARS_CONFIG=config/app-dev.yml ./target/release/app-dev
```

## Where do I configure lint, test, and build policies?

In `Gears.toml` under `[apps.<app>.<env>.lint]`, `[apps.<app>.<env>.test]`, and `[apps.<app>.<env>.build]` respectively. See the [Manifest](/intro/manifest) page for the full schema.

## Can I use an LLM to generate my gears?

Yes. After creating a workspace with `cargo gears new`, you can hand off to an LLM with a prompt like:

> Build a Gears application that exposes a REST API, stores tasks in a database, and runs a background worker that processes pending tasks. Use the Gears CLI and update the workspace until the app builds.

The CLI's `help` command provides context that LLMs can use:

```bash
cargo gears help topic architecture
cargo gears help topic gear-layout
cargo gears help schema manifest
```
