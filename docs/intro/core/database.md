# Database

Gears uses [SeaORM](https://www.sea-ql.org/SeaORM/) for data access, wrapped in a secure-by-default layer that enforces tenant isolation at the query level.

## SecureConn

All database access goes through `SecureConn`, a scoped connection that automatically injects `WHERE` clauses based on the caller's [`AccessScope`](/toolkit/06_authn_authz_secure_orm). There is no way to bypass scoping -- unscoped queries don't compile.

```rust
let conn = db.sea_secure();
let users = conn.find::<user::Entity>(&scope).all(&conn).await?;
```

`SecureTx` provides the same guarantees inside a transaction:

```rust
let (conn, result) = secure_conn
    .in_transaction_mapped(DomainError::db_error, |tx| {
        Box::pin(async move {
            repo.create(tx, &scope, model).await?;
            Ok(())
        })
    })
    .await;
result?;
```

## Repository pattern

Repository methods accept `&impl DBRunner` (implemented by both `SecureConn` and `SecureTx`), keeping them reusable across transactional and non-transactional contexts:

```rust
pub async fn find_by_id(
    runner: &impl DBRunner,
    scope: &AccessScope,
    id: Uuid,
) -> Result<Option<Model>, ScopeError> {
    user::Entity::find_by_id(id)
        .secure()
        .scope_with(scope)
        .one(runner)
        .await
}
```

## Scopable entities

SeaORM entities declare their scoping columns with `#[derive(Scopable)]`:

```rust
#[derive(Scopable)]
#[secure(tenant_col = "tenant_id", resource_col = "id", no_owner, no_type)]
pub struct Model { /* ... */ }
```

This tells `SecureConn` which columns to use for automatic tenant filtering.

## Migrations

Each gear owns its migrations and gets its own migration history table. Raw SQL is allowed **only** in migration files:

```rust
impl DatabaseCapability for MyGear {
    fn migrations(&self) -> Vec<Box<dyn MigrationTrait>> {
        migrations::Migrator::migrations()
    }
}
```

## Key rules

- No plain SQL outside migrations
- Repository methods accept `&impl DBRunner`, not `&SecureConn` directly
- `tenant_id` is immutable in updates (enforced at runtime)
- Add indexes on security columns (`tenant_id`, `resource_id`)

::: tip
For detailed patterns and examples, see the [Toolkit Database Patterns](/toolkit/11_database_patterns) documentation.
:::
