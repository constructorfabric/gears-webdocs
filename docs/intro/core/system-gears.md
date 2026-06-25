# System Gears

System gears are control-plane gears that provide platform-level capabilities. They live under `gears/system/` and have access to privileged lifecycle phases (`pre_init` and `post_init`) through the `SystemCapability`.

## How they differ from regular gears

| | Regular gears | System gears |
|---|---|---|
| **Location** | `gears/` | `gears/system/` |
| **Lifecycle** | `init`, `start`, `stop` | Also `pre_init` and `post_init` |
| **Purpose** | Business logic and domain features | Platform infrastructure (auth, tenancy, gateway) |
| **Dependency direction** | May depend on system gear SDKs | Must not depend on regular gears |

System gears run their `pre_init` hooks before any regular gear initialization, and `post_init` after all gears have completed `init`. This guarantees that platform services (authentication, tenant resolution, type registry) are available before business gears start.

## Examples of system gears

- **API Gateway** -- Single public entry point for external traffic; owns the Axum router, handles routing, rate limiting, and OpenAPI publication
- **AuthN Resolver** -- Validates tokens (JWT/JWKS), produces `SecurityContext`
- **AuthZ Resolver** -- Evaluates access policies, returns authorization decisions and constraints
- **Tenant Resolver** -- Resolves tenant context from incoming requests
- **Types Registry** -- Manages the Global Type System (GTS) for schema-validated extensibility

## Consuming system gears

Regular gears interact with system gears through their SDKs via `ClientHub`, just like any other inter-gear communication:

```rust
let authz = ctx.client_hub().get::<dyn AuthZResolverClient>()?;
let enforcer = PolicyEnforcer::new(authz);
let scope = enforcer.access_scope(ctx, &RESOURCE, action, id).await?;
```

Gear developers generally don't interact with system gears directly -- the toolkit wraps common patterns (like `PolicyEnforcer` for authorization) into ergonomic APIs.

## Listing available gears

```bash
cargo gears ls gears           # all gears
cargo gears ls gears --system  # system gears only
cargo gears ls gears --local   # workspace gears only
```

::: tip
For details on ClientHub, plugins, and inter-gear communication patterns, see [ClientHub & Plugins](/toolkit/03_clienthub_and_plugins). For authorization patterns with `PolicyEnforcer`, see [AuthN/AuthZ & Secure ORM](/toolkit/06_authn_authz_secure_orm).
:::
