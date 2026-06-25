# What is Gears?

Gears is a set of libraries, gears and tools that enable XaaS vendors to compose their own products. Vendors decide which gears to include, how to combine them into services, and where to run them—from edge devices to Kubernetes clusters.

Among these components are:
- [Rust](https://www.rust-lang.org/) in the base layer to provide a secure and performant language foundation
- [Cargo](https://doc.rust-lang.org/cargo/) as the package manager for Rust
- [Clippy](https://github.com/rust-lang/rust-clippy) for code quality checks in generic Rust code
- [Dylint](https://github.com/trailofbits/dylint) for specialized lints in Gears-specific projects
- [Nextest](https://nexte.st/) for next-generation testing framework
- [Protobuf](https://protobuf.dev/) for efficient wire-communication between services
- [Cargo generate](https://github.com/cargo-generate/cargo-generate) for project templating
- [Coverage with llvm-cov](https://github.com/taiki-e/cargo-llvm-cov) for code coverage
- FIPS compliance with [aws-lc-rs](https://github.com/aws/aws-lc-rs)

And many other open-source tools and libraries that, when combined, make Gears a powerful platform for building applications.

In order to ease and centralize the use of these tools, we provide a CLI tool called `gears` that eases all software development tasks related to Gears.
