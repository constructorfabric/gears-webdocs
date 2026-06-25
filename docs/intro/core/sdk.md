# SDK

Every gear exposes its public API through a companion **SDK crate** (`<name>-sdk/`). The SDK defines the contract that other gears consume -- transport-agnostic traits, domain models, and error types.

## SDK structure

```
gears/<name>/sdk/
  Cargo.toml
  src/
    lib.rs        # Re-exports main types
    api.rs        # ClientHub trait(s) with SecurityContext
    models.rs     # Transport-agnostic domain models
    errors.rs     # Transport-agnostic errors
```

## SDK traits

The SDK trait defines the operations that a gear exposes. All methods take `&SecurityContext` as the first parameter to propagate identity and authorization:

```rust
#[async_trait]
pub trait MyGearApi: Send + Sync {
    async fn get_item(
        &self,
        ctx: &SecurityContext,
        id: Uuid,
    ) -> Result<Item, MyGearError>;

    async fn list_items(
        &self,
        ctx: &SecurityContext,
        query: ListQuery,
    ) -> Result<Page<Item>, MyGearError>;
}
```

## ClientHub integration

The gear registers its SDK implementation during `init()`, and consumers resolve it through [ClientHub](/toolkit/03_clienthub_and_plugins):

```rust
// Provider (in init)
let api: Arc<dyn MyGearApi> = Arc::new(LocalClient::new(svc));
ctx.client_hub().register::<dyn MyGearApi>(api);

// Consumer
let api = ctx.client_hub().get::<dyn MyGearApi>()?;
let item = api.get_item(&ctx, id).await?;
```

The same trait is implemented by both in-process adapters (direct function calls) and gRPC clients (network calls). Consumers don't know which transport is used.

## WithSecurityContext

`toolkit-sdk` provides `WithSecurityContext` for zero-allocation security context scoping on any client, and a typed `QueryBuilder` with compile-time field checking:

```rust
let items = api
    .with_context(&ctx)
    .list_items(query)
    .await?;
```

## Key rules

- SDK crates must not depend on infrastructure types (no SeaORM, no Axum, no HTTP types)
- SDK error types are transport-agnostic (no serde derives)
- Internals never leak to consumers -- all public API lives in the SDK crate

::: tip
For the full gear layout and SDK pattern, see the [Toolkit Gear Layout](/toolkit/02_gear_layout_and_sdk_pattern) documentation.
:::
