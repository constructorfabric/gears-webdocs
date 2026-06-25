# Manifest

`Gears.toml` is the orchestration manifest used by `cargo gears`. It defines workspace defaults, the available apps and environments, the runtime config used by each environment, the selected gears, and the run, build, lint, and test policies.

The default manifest file name is `Gears.toml`. Apps are declared under `[apps.<app>.<env>]`. Each environment must define `config` and can also define `gears`, `run`, `build`, `lint`, and `test`.

Workspace fields include:

- `version`, currently `1`
- `root`, an optional workspace root override
- `config-dir`, which defaults to `config`
- `generated-dir`, which defaults to `.gears`
- `global_env`, an optional shared environment block

Gear references support two sources:

- `local`: `name`, with optional `version` and `package`
- `remote`: `name`, `version`, `package`, and optional `registry`

Optional template registries can also be declared under `templates` for gears, configs, and agents.

```toml
[workspace]
version = 1
config-dir = "config"
generated-dir = ".gears"

[apps.quickstart.dev]
config = "quickstart.yml"
gears = [
  { source = "local", name = "hello-world" },
  { source = "remote", name = "api-gateway", package = "cf-api-gateway", version = "0.1" }
]
```

Use `cargo gears manifest validate` to validate the manifest and `cargo gears manifest ls` to inspect the declared entries. If the manifest contains only one app, the CLI can infer it automatically. If a `dev` environment exists, it is selected by default.

## Build Policy

Build settings live under `[apps.<app>.<env>.build]`.

- `name`: overrides the generated project name. If omitted, the default is `<app>-<env>`
- `profile`: build profile, either `debug`, `release`, or a custom profile name
- `clean`: when set, removes `Cargo.lock` before building

### CLI usage

```bash
cargo gears build                # build with manifest defaults
cargo gears build -r             # release mode (overrides manifest profile)
cargo gears build --fips --otel  # enable FIPS and OpenTelemetry features
cargo gears build --clean        # remove Cargo.lock before building
cargo gears build --dry-run      # print resolved model without building
cargo gears build --name custom  # override the generated binary name
```

CLI flags (`-r`/`--release`, `--fips`, `--otel`, `--clean`) override the corresponding manifest settings when provided.

## Lint Policy

Lint settings live under `[apps.<app>.<env>.lint]`.

- `ref`: reuse the lint policy from another environment
- `clippy`: enables or disables Clippy checks, default `true`
- `fmt`: enables or disables formatting checks, default `true`
- `feature-set-test`: enables feature-set validation, default `true`
- `dylint`: optional Dylint settings with `enabled` and `skip`

### CLI usage

```bash
cargo gears lint              # run suites enabled in the manifest
cargo gears lint --all        # run all available lint suites
cargo gears lint --fmt        # formatting check only (cargo fmt --check)
cargo gears lint --clippy     # Clippy only (follows Cargo.toml exceptions)
cargo gears lint --dylint     # Gears-specific Dylint rules only
cargo gears lint --strict     # turn Clippy warnings into errors (useful for CI)
```

When no suite flag is given, `cargo gears lint` runs the suites enabled in the manifest lint policy. Individual flags (`--fmt`, `--clippy`, `--dylint`) select specific suites regardless of the manifest.

## Run Policy

Run settings live under `[apps.<app>.<env>.run]`.

- `watch.enabled`: enables watch mode, default `true`
- `watch.include`: replaces the default watch set when provided
- `watch.exclude`: removes paths from the effective watch set
- `fips`: enables FIPS-related build features, default `false`
- `otel`: enables OpenTelemetry-related build features, default `false`

### CLI usage

```bash
cargo gears run                  # run with manifest defaults (watch enabled)
cargo gears run --no-watch       # disable file watching
cargo gears run -r               # run in release mode
cargo gears run --fips --otel    # enable FIPS and OpenTelemetry
cargo gears run --app myapp --env staging  # select a specific app/environment
```

Boolean flags use `--flag`/`--no-flag` pairs (e.g. `--watch`/`--no-watch`, `--otel`/`--no-otel`) to explicitly override manifest settings.

## Test Policy

Test settings live under `[apps.<app>.<env>.test]`.

- `ref`: reuse the test policy from another environment
- `runner`: `nextest` or `cargo`, with `nextest` as the default
- `feature-set`: per-gear feature matrices to test
- `custom-command`: optional custom test command

Each `feature-set` entry supports these modes:

- `default-features`
- `all-features`
- `no-default-features`
- `features`, with an explicit `features = ["..."]` list

### CLI usage

```bash
cargo gears test                       # run with manifest defaults (nextest)
cargo gears test --runner cargo        # use cargo test instead of nextest
cargo gears test --gear my-gear        # test a single gear only
cargo gears test --coverage            # run with cargo-llvm-cov coverage
```
