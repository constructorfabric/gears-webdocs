# Getting started

## Prerequisites

- [Rust](https://rust-lang.org/tools/install/)
- [Protobuf](https://protobuf.dev/installation/)

## CLI installation

To ease the development process, we provide a CLI tool that can be installed locally.

```bash
cargo install cargo-gears
```

This CLI will be used to manage the development environment, run the application, build the binary and prepare its deployment.


## First steps

To create a new project, run:

```bash
cargo gears new my-project
cd my-project
cargo gears run
```

This will create a new workspace project in the `my-project` directory in which you'll find a starter workspace with a single application and dev environment with a basic configuration file.

Also, it will start the generated server with the quickstart config. You should see a repeated "hello world" message in the console.

## LLM mode

If you want to stop here and rely on the LLM to generate your code, you can run the following prompt:

> Build a Gears application that exposes a REST API, stores tasks in a database, and runs a background worker that processes pending tasks. Use the Gears CLI and update the workspace until the app builds.

## Add a gear

```bash
cargo gears generate gear --template background-worker
cargo gears config mod add background-worker -c ./config/quickstart.yml
```

## Building the project

To build the project, run:

```bash
cargo gears build -r
```

This will build the application in release mode. You can find the binary in the `target/release/quickstart-dev` file.

