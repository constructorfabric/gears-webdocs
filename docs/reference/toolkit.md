# Toolkit Libraries

The Toolkit is the library ecosystem that powers gears. It provides the runtime substrate -- gear registration, database access, HTTP/gRPC transport, security primitives, error handling, and query building -- so that gear developers can focus on business logic.

All Toolkit crates are prefixed with `cf-gears-toolkit` and designed to work together.

## Crate map

| Group | Crates | Purpose |
|---|---|---|
| **Gear system** | [toolkit][src-toolkit], [toolkit-macros][src-macros], [toolkit-sdk][src-sdk] | Gear registration, `ClientHub`, lifecycle macros, and client-side query builders |
| **Data & storage** | [toolkit-db][src-db], [toolkit-db-macros][src-db-macros] | SeaORM integration, `SecureConn`, tenant-scoped queries, migrations |
| **Networking** | [toolkit-http][src-http], [toolkit-transport-grpc][src-transport-grpc] | HTTP client with retries and SSRF protection, gRPC security context propagation |
| **Errors** | [toolkit-canonical-errors][src-errors], [toolkit-canonical-errors-macro][src-errors-macro] | RFC 9457 Problem Details, canonical error types (AIP-193), `resource_error!` macro |
| **Query & data access** | [toolkit-odata][src-odata], [toolkit-odata-macros][src-odata-macros] | OData filter/pagination primitives and proc-macros |
| **Security** | [toolkit-auth][src-auth], [toolkit-security][src-security] | JWT/JWKS validation, OAuth2 client-credentials, `SecurityContext`, `AccessScope` |
| **Type system** | [toolkit-gts][src-gts], [toolkit-gts-macros][src-gts-macros] | Global Type System (GTS) for schema-validated extensibility |
| **Platform** | [toolkit-node-info][src-node-info] | System information (hardware UUID, OS, CPU, GPU, network) |

[src-toolkit]: https://github.com/constructorfabric/gears-rust/tree/main/libs/toolkit
[src-macros]: https://github.com/constructorfabric/gears-rust/tree/main/libs/toolkit-macros
[src-sdk]: https://github.com/constructorfabric/gears-rust/tree/main/libs/toolkit-sdk
[src-db]: https://github.com/constructorfabric/gears-rust/tree/main/libs/toolkit-db
[src-db-macros]: https://github.com/constructorfabric/gears-rust/tree/main/libs/toolkit-db-macros
[src-http]: https://github.com/constructorfabric/gears-rust/tree/main/libs/toolkit-http
[src-transport-grpc]: https://github.com/constructorfabric/gears-rust/tree/main/libs/toolkit-transport-grpc
[src-errors]: https://github.com/constructorfabric/gears-rust/tree/main/libs/toolkit-canonical-errors
[src-errors-macro]: https://github.com/constructorfabric/gears-rust/tree/main/libs/toolkit-canonical-errors-macro
[src-odata]: https://github.com/constructorfabric/gears-rust/tree/main/libs/toolkit-odata
[src-odata-macros]: https://github.com/constructorfabric/gears-rust/tree/main/libs/toolkit-odata-macros
[src-auth]: https://github.com/constructorfabric/gears-rust/tree/main/libs/toolkit-auth
[src-security]: https://github.com/constructorfabric/gears-rust/tree/main/libs/toolkit-security
[src-gts]: https://github.com/constructorfabric/gears-rust/tree/main/libs/toolkit-gts
[src-gts-macros]: https://github.com/constructorfabric/gears-rust/tree/main/libs/toolkit-gts-macros
[src-node-info]: https://github.com/constructorfabric/gears-rust/tree/main/libs/toolkit-node-info

For the full library reference with detailed descriptions, see the [API reference](/reference/api-reference).

## How the pieces fit together

A typical gear uses Toolkit crates at every layer:

- **Gear declaration** -- `toolkit-macros` provides `#[toolkit::gear(...)]` and `#[lifecycle(...)]`
- **REST routes** -- The core `toolkit` crate provides `OperationBuilder` for type-safe route registration with integrated OpenAPI, auth, and error schemas
- **Database** -- `toolkit-db` provides `SecureConn` and `SecureTx` for tenant-scoped queries, plus a per-gear migration runner
- **Error handling** -- `toolkit-canonical-errors` defines the `Problem` type (RFC 9457) and provides standard HTTP error constructors
- **Inter-gear calls** -- `toolkit-sdk` provides `WithSecurityContext` for scoping any client, and `QueryBuilder` for typed OData queries
- **Auth** -- `toolkit-auth` handles JWT validation and token refresh; `toolkit-security` provides `SecurityContext` and `AccessScope` types used throughout

## Getting started

Gears don't depend on Toolkit crates individually. Instead, they depend on `cf-gears-toolkit`, which re-exports the relevant types through a unified prelude. The toolkit feature flags control which capabilities are available:

```toml
[dependencies]
cf-gears-toolkit = { workspace = true, features = ["http", "db"] }
```
