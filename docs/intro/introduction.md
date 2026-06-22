# Introduction

Constructor Fabric is an enterprise-grade framework for building multi-tenant Software-as-a-Service applications. Built with Rust, it provides a modular runtime system designed for reliability, performance, and cloud-native deployment.

## What is Constructor Fabric?

Constructor Fabric gives teams a structured foundation for XaaS development - handling cross-cutting concerns so you can focus on business logic:

- **Toolkit** - a composable gear system that manages the full service lifecycle
- **OData support** - standardized query and data access layer
- **Built-in security** - authentication and authorization primitives out of the box
- **gRPC + REST** - flexible transport options for every integration need

## Toolchain

Constructor Fabric is built on a curated set of open-source tools:

- [Rust](https://www.rust-lang.org/) - secure and performant language foundation
- [Cargo](https://doc.rust-lang.org/cargo/) - package manager for Rust
- [Clippy](https://github.com/rust-lang/rust-clippy) - code quality checks for generic Rust code
- [Dylint](https://github.com/trailofbits/dylint) - specialized lints for Gears-specific projects
- [Nextest](https://nexte.st/) - next-generation testing framework
- [Protobuf](https://protobuf.dev/) - efficient wire-communication between services
- [Cargo generate](https://github.com/cargo-generate/cargo-generate) - project templating
- [cargo-llvm-cov](https://github.com/taiki-e/cargo-llvm-cov) - code coverage
- [aws-lc-rs](https://github.com/aws/aws-lc-rs) - FIPS compliance

In order to ease and centralize the use of these tools, we provide a CLI tool called `gears` that streamlines all software development tasks related to Constructor Fabric.

## Core Concepts

| Concept | Description |
|---------|-------------|
| Gear    | The basic unit of functionality in Constructor Fabric |
| Toolkit | The SDK and macro system for building gears |
| Runtime | The lifecycle manager that initializes and coordinates gears |
| Tenant  | An isolated unit of multi-tenant data and configuration |

## Next Steps

- [Get Started](./getting-started.md) - Install the CLI and scaffold your first project
- [Architecture](./architecture.md) - Understand the runtime lifecycle
- [Core Concepts](./core/gears.md) - Deep dive into the gear system
