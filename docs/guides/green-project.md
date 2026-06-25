---
outline: deep
---
# Green Project: Bookmark Manager

Build a bookmark manager from scratch using the Gears framework. By the end of this guide you will have a running application with REST endpoints for listing and retrieving bookmarks, backed by a database with OData filtering and pagination.

## What you'll build

A **bookmarks** gear that:

- Stores bookmarks (URL, title, description) in a database
- Exposes GET and LIST endpoints via REST
- Supports OData filtering, ordering, and pagination
- Publishes an SDK so other gears can consume bookmarks programmatically

## 1. Create the workspace

```bash
cargo gears new bookmarks-app
cd bookmarks-app
```

This scaffolds:

```
bookmarks-app/
  Cargo.toml            # Workspace manifest
  Gears.toml            # Gears orchestration manifest
  Dockerfile
  config/
    quickstart.yml      # Default runtime config
  gears/
    hello-world/        # Starter gear
```

Verify everything compiles:

```bash
cargo gears run
```

You should see a repeated "hello world" message. Press `Ctrl+C` to stop.

## 2. Generate the bookmarks gear

```bash
cargo gears generate gear --template api-db-handler --name bookmarks
```

This creates `gears/bookmarks/` with the full DDD-light layout:

```
gears/bookmarks/
  Cargo.toml
  src/
    lib.rs                          # Crate root — re-exports the gear struct
    gear.rs                         # #[toolkit::gear(...)] declaration
    config.rs                       # Gear configuration
    errors.rs                       # API error codes (RFC 9457)
    api/rest/
      dto.rs                        # REST DTOs (serde + utoipa)
      error.rs                      # DomainError → Problem mapping
      handlers/pokemon.rs           # Axum handlers
      routes/pokemon.rs             # OperationBuilder route registration
    domain/
      error.rs                      # DomainError enum
      repos/pokemon_repo.rs         # Repository trait
      service/mod.rs                # AppServices DI container + ServiceConfig
      service/pokemon.rs            # Business logic
      local_client/client.rs        # SDK trait impl (in-process)
      local_client/streaming.rs     # Streaming client impl
    infra/storage/
      entity/pokemon.rs             # SeaORM entity
      mapper.rs                     # Entity ↔ domain model conversions
      odata_mapper.rs               # OData filter → SeaORM column mapping
      pokemon_sea_repo.rs           # Repository implementation (ORM)
      migrations/                   # Database migrations
      db.rs                         # Error conversion helpers
  sdk/
    Cargo.toml
    src/
      lib.rs                        # SDK crate root
      client.rs                     # Public client trait
      models.rs                     # Transport-agnostic models
      errors.rs                     # Transport-agnostic errors
      odata/pokemon.rs              # OData filter field definitions
```

::: info
The `api-db-handler` template generates a working example using "Pokemon" as a placeholder domain. In the following sections we will transform it into our Bookmarks domain. This is a good exercise because it walks you through every layer of the DDD-light architecture.
:::

For a deeper look at this layout, see [Gears](/intro/core/gears) and [Gear Layout & SDK Pattern](/toolkit/02_gear_layout_and_sdk_pattern).

## 3. Generate a database config

The default `quickstart.yml` has no database section. Replace it with a database-ready config:

```bash
rm config/quickstart.yml
cargo gears generate config --template db --name bookmarks
```

The generated config includes a PostgreSQL connection. Update the `dbname` from `app` to `bookmarks`:

```yaml
database:
  servers:
    main:
      engine: postgres
      host: localhost
      port: 5432
      user: postgres
      password: ${DB_PASSWORD}
      dbname: bookmarks
```

Next, add the `api-gateway` gear configuration under the `gears:` section. The gateway needs a bind address, and for local development we disable authentication:

```yaml
gears:
  api-gateway:
    config:
      bind_addr: "0.0.0.0:8080"
      auth_disabled: true
```

::: warning
Never set `auth_disabled: true` in production. This is a convenience for local development only. Production deployments should use `authn-resolver` to enforce authentication.
:::

Set the password for your local database:

```bash
export DB_PASSWORD=your_password
```

## 4. Register the gear

First, update `Gears.toml` to replace the `hello-world` starter gear with `bookmarks`. The bookmarks gear needs REST endpoints, which requires the `api-gateway` system gear and its dependencies:

```toml
[workspace]
version = 1

[apps.bookmarks.dev]
config = "bookmarks.yml"
gears = [
    { source = "remote", name = "types-registry", package = "cf-gears-types-registry", version = "0.1.22" },
    { source = "remote", name = "authn-resolver", package = "cf-gears-authn-resolver", version = "0.2.16" },
    { source = "remote", name = "grpc-hub", package = "cf-gears-grpc-hub", version = "0.2.6" },
    { source = "remote", name = "api-gateway", package = "cf-gears-api-gateway", version = "0.2.7" },

    { source = "local", name = "bookmarks", features = ["postgres"] },
]
```

::: info
Any gear with `rest` capability requires `api-gateway` (the HTTP gateway that owns the server and mounts routes). The `api-gateway` in turn depends on `grpc-hub` and `authn-resolver`, which depends on `types-registry`. All four must be listed — order them so dependencies come before dependents.
:::

Then register the gear in the runtime config and wire it to the database:

```bash
cargo gears config gear add bookmarks -c ./config/bookmarks.yml
cargo gears config gear db add bookmarks -c ./config/bookmarks.yml --server main
```

The first command registers the gear in the runtime config. The second wires it to the `main` database server so it receives a connection during startup.

::: tip
Database backend features (like `postgres`) are declared in `Gears.toml` on the gear ref, not in the runtime config. See the `features = ["postgres"]` in the gears list above.
:::

## 5. Transform the SDK layer

The SDK is the public contract other gears use to interact with bookmarks. We start here because the Gears architecture is **SDK-first** — the public interface is defined before the implementation.

### 5.1 Models (`gears/bookmarks/sdk/src/models.rs`)

Replace the Pokemon model with a Bookmark model. We change `name` → `title`, replace `height: i32` with `url: String`, and add an optional `description`:

```rust
//! Public models for the bookmarks gear.

use time::OffsetDateTime;
use uuid::Uuid;

/// A bookmark entity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Bookmark {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub url: String,
    pub title: String,
    pub description: Option<String>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}
```

### 5.2 Errors (`gears/bookmarks/sdk/src/errors.rs`)

Rename `PokemonError` → `BookmarkError`:

```rust
//! Public error types for the bookmarks gear.

use thiserror::Error;
use uuid::Uuid;

/// Errors that can be returned by the `BookmarkClient`.
#[derive(Error, Debug, Clone)]
pub enum BookmarkError {
    #[error("Resource not found: {id}")]
    NotFound { id: Uuid },

    #[error("Validation error: {message}")]
    Validation { message: String },

    #[error("Internal error")]
    Internal,

    #[error("Streaming error: {message}")]
    Streaming { message: String },
}

impl BookmarkError {
    #[must_use]
    pub fn not_found(id: Uuid) -> Self {
        Self::NotFound { id }
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self::Validation {
            message: message.into(),
        }
    }

    #[must_use]
    pub fn internal() -> Self {
        Self::Internal
    }

    pub fn streaming(message: impl Into<String>) -> Self {
        Self::Streaming {
            message: message.into(),
        }
    }
}
```

### 5.3 Client trait (`gears/bookmarks/sdk/src/client.rs`)

Rename all Pokemon types and methods to Bookmark:

```rust
//! Object-safe streaming boundary for the bookmarks gear.
//!
//! Designed for `ClientHub` registration as `Arc<dyn BookmarkClientV1>`.

#[cfg(feature = "odata")]
use futures_core::Stream;
use toolkit::async_trait;
#[cfg(feature = "odata")]
use toolkit_sdk::odata::QueryBuilder;
#[cfg(feature = "odata")]
use std::pin::Pin;
use uuid::Uuid;

use crate::errors::BookmarkError;
use crate::models::Bookmark;

#[cfg(feature = "odata")]
use crate::odata::BookmarkSchema;

/// Boxed stream type returned by streaming client facades.
#[cfg(feature = "odata")]
pub type BookmarkStream<T> = Pin<Box<dyn Stream<Item = Result<T, BookmarkError>> + Send + 'static>>;

/// Object-safe client for inter-gear consumption via `ClientHub` (Version 1).
#[async_trait]
pub trait BookmarkClientV1: Send + Sync {
    #[cfg(feature = "odata")]
    fn bookmarks(&self) -> Box<dyn BookmarkStreamingClientV1>;

    /// Get a single bookmark by ID.
    async fn get_bookmark(&self, id: Uuid) -> Result<Bookmark, BookmarkError>;

    /// List bookmarks with cursor-based pagination.
    async fn list_bookmarks(
        &self,
        query: toolkit_odata::ODataQuery,
    ) -> Result<toolkit_odata::Page<Bookmark>, BookmarkError>;
}

/// Streaming interface for bookmarks (Version 1).
#[cfg(feature = "odata")]
pub trait BookmarkStreamingClientV1: Send + Sync {
    fn stream(&self, query: QueryBuilder<BookmarkSchema>) -> BookmarkStream<Bookmark>;
}
```

### 5.4 OData filter schema

Rename the file and update the filter fields to match our domain:

```bash
mv gears/bookmarks/sdk/src/odata/pokemon.rs gears/bookmarks/sdk/src/odata/bookmark.rs
```

Replace the contents of `gears/bookmarks/sdk/src/odata/bookmark.rs`:

```rust
//! OData filter field definitions for Bookmark resources.

use toolkit_odata_macros::ODataFilterable;
use toolkit_sdk::odata::{FieldRef, Schema};
use time::OffsetDateTime;
use uuid::Uuid;

use toolkit_odata::filter::FilterField as _;

/// Bookmark filterable fields schema.
#[derive(ODataFilterable)]
pub struct BookmarkQuery {
    #[odata(filter(kind = "Uuid"))]
    pub id: Uuid,

    #[odata(filter(kind = "String"))]
    pub title: String,

    #[odata(filter(kind = "String"))]
    pub url: String,

    #[odata(filter(kind = "DateTimeUtc"))]
    pub created_at: OffsetDateTime,
}

/// Type alias for the generated filter field enum.
pub use BookmarkQueryFilterField as BookmarkFilterField;

#[derive(Debug, Clone, Copy)]
pub struct BookmarkSchema;

impl Schema for BookmarkSchema {
    type Field = BookmarkFilterField;

    fn field_name(field: Self::Field) -> &'static str {
        field.name()
    }
}

pub const BOOKMARK_ID: FieldRef<BookmarkSchema, Uuid> = FieldRef::new(BookmarkFilterField::Id);
pub const BOOKMARK_TITLE: FieldRef<BookmarkSchema, String> = FieldRef::new(BookmarkFilterField::Title);
pub const BOOKMARK_URL: FieldRef<BookmarkSchema, String> = FieldRef::new(BookmarkFilterField::Url);
pub const BOOKMARK_CREATED_AT: FieldRef<BookmarkSchema, OffsetDateTime> =
    FieldRef::new(BookmarkFilterField::CreatedAt);
```

Update the OData module declaration in `gears/bookmarks/sdk/src/odata/mod.rs`:

```rust
//! OData filter field definitions for bookmark resources.

mod bookmark;

pub use bookmark::*;
```

### 5.5 SDK crate root (`gears/bookmarks/sdk/src/lib.rs`)

Update re-exports:

```rust
//! Bookmarks SDK
//!
//! Public API contract for the bookmarks gear:
//! - `BookmarkClientV1` trait
//! - `Bookmark` model
//! - `BookmarkError` error type
//! - OData filter schemas (behind `odata` feature)

pub mod client;
pub mod errors;
pub mod models;

#[cfg(feature = "odata")]
pub mod odata;

pub use client::BookmarkClientV1;
#[cfg(feature = "odata")]
pub use client::BookmarkStreamingClientV1;
pub use errors::BookmarkError;
pub use models::Bookmark;
```

## 6. Transform the domain layer

The domain layer contains business logic, repository traits, and error types. It depends on the SDK but not on infrastructure details.

### 6.1 Domain error (`gears/bookmarks/src/domain/error.rs`)

Update error messages and the `From<DomainError> for BookmarkError` conversion:

```rust
use bookmarks_sdk::BookmarkError;
use toolkit_db::DbError;
use toolkit_db::secure::InfraError;
use toolkit_db::secure::ScopeError;
use toolkit_macros::domain_model;
use thiserror::Error;
use uuid::Uuid;

/// Domain-specific errors
#[domain_model]
#[derive(Error, Debug)]
pub enum DomainError {
    #[error("Bookmark not found: {id}")]
    NotFound { id: Uuid },

    #[error("Database error: {message}")]
    Database { message: String },

    #[error("Validation failed: {field}: {message}")]
    Validation { field: String, message: String },

    #[error("Internal error")]
    InternalError,
}

impl DomainError {
    #[must_use]
    pub fn not_found(id: Uuid) -> Self {
        Self::NotFound { id }
    }

    pub fn database(message: impl Into<String>) -> Self {
        Self::Database {
            message: message.into(),
        }
    }

    #[must_use]
    pub fn database_infra(e: InfraError) -> Self {
        Self::database(e.to_string())
    }

    pub fn validation(field: impl Into<String>, message: impl Into<String>) -> Self {
        Self::Validation {
            field: field.into(),
            message: message.into(),
        }
    }
}

impl From<DomainError> for BookmarkError {
    fn from(domain_error: DomainError) -> Self {
        match domain_error {
            DomainError::NotFound { id } => BookmarkError::not_found(id),
            DomainError::Validation { field, message } => {
                BookmarkError::validation(format!("{field}: {message}"))
            }
            DomainError::Database { .. } | DomainError::InternalError => BookmarkError::internal(),
        }
    }
}

impl From<Box<dyn std::error::Error>> for DomainError {
    fn from(value: Box<dyn std::error::Error>) -> Self {
        tracing::debug!(error = %value, "Converting boxed error to DomainError");
        DomainError::InternalError
    }
}

impl From<DbError> for DomainError {
    fn from(e: DbError) -> Self {
        DomainError::database(e.to_string())
    }
}

impl From<ScopeError> for DomainError {
    fn from(e: ScopeError) -> Self {
        DomainError::validation("scope", e.to_string())
    }
}
```

### 6.2 Repository trait

Rename the file and update the trait:

```bash
mv gears/bookmarks/src/domain/repos/pokemon_repo.rs gears/bookmarks/src/domain/repos/bookmark_repo.rs
```

Replace the contents of `gears/bookmarks/src/domain/repos/bookmark_repo.rs`:

```rust
use bookmarks_sdk::Bookmark;
use toolkit::async_trait;
use toolkit_db::secure::DBRunner;
use toolkit_odata::{ODataQuery, Page};
use toolkit_security::AccessScope;
use uuid::Uuid;

use crate::domain::error::DomainError;

/// Repository trait for Bookmark persistence operations.
#[async_trait]
pub trait BookmarkRepository: Send + Sync {
    /// Find a bookmark by ID within the given security scope.
    async fn get<C: DBRunner>(
        &self,
        runner: &C,
        scope: &AccessScope,
        id: Uuid,
    ) -> Result<Option<Bookmark>, DomainError>;

    /// List bookmarks with cursor-based pagination and OData filtering.
    async fn list_page<C: DBRunner>(
        &self,
        runner: &C,
        scope: &AccessScope,
        query: &ODataQuery,
    ) -> Result<Page<Bookmark>, DomainError>;
}
```

Update the repos module declaration in `gears/bookmarks/src/domain/repos/mod.rs`:

```rust
mod bookmark_repo;

pub(crate) use bookmark_repo::BookmarkRepository;
```

### 6.3 Domain service

Rename the file:

```bash
mv gears/bookmarks/src/domain/service/pokemon.rs gears/bookmarks/src/domain/service/bookmark.rs
```

Replace the contents of `gears/bookmarks/src/domain/service/bookmark.rs`:

```rust
use std::sync::Arc;

use bookmarks_sdk::Bookmark;
use toolkit_macros::domain_model;
use toolkit_odata::{ODataQuery, Page};
use toolkit_security::AccessScope;
use tracing::instrument;
use uuid::Uuid;

use crate::domain::error::DomainError;
use crate::domain::repos::BookmarkRepository;
use crate::domain::service::{DbProvider, ServiceConfig};

/// Bookmark service.
#[domain_model]
pub struct BookmarkService<R: BookmarkRepository + 'static> {
    db: Arc<DbProvider>,
    repo: Arc<R>,
    #[allow(dead_code)]
    config: ServiceConfig,
}

impl<R: BookmarkRepository + 'static> BookmarkService<R> {
    pub fn new(db: Arc<DbProvider>, repo: Arc<R>, config: ServiceConfig) -> Self {
        Self { db, repo, config }
    }
}

impl<R: BookmarkRepository + 'static> BookmarkService<R> {
    #[instrument(skip(self), fields(bookmark_id = %id))]
    pub async fn get_bookmark(&self, id: Uuid) -> Result<Bookmark, DomainError> {
        tracing::debug!("Getting bookmark by id");

        let conn = self.db.conn().map_err(DomainError::from)?;
        let scope = AccessScope::allow_all();

        let bookmark = self
            .repo
            .get(&conn, &scope, id)
            .await?
            .ok_or_else(|| DomainError::not_found(id))?;

        tracing::debug!("Successfully retrieved bookmark");
        Ok(bookmark)
    }

    /// List bookmarks with cursor-based pagination
    #[instrument(skip(self, query))]
    pub async fn list_bookmarks_page(
        &self,
        query: &ODataQuery,
    ) -> Result<Page<Bookmark>, DomainError> {
        tracing::debug!("Listing bookmarks with cursor pagination");

        let conn = self.db.conn().map_err(DomainError::from)?;
        let scope = AccessScope::allow_all();

        let page = self.repo.list_page(&conn, &scope, query).await?;

        tracing::debug!("Successfully listed {} bookmarks in page", page.items.len());
        Ok(page)
    }
}
```

Update the service module declaration in `gears/bookmarks/src/domain/service/mod.rs`. Replace all Pokemon references with Bookmark:

```rust
//! Domain service layer - business logic and rules.

use std::sync::Arc;

use toolkit_macros::domain_model;

use crate::domain::repos::BookmarkRepository;
use toolkit_db::DBProvider;
use toolkit_db::odata::LimitCfg;

mod bookmark;

pub(crate) use bookmark::BookmarkService;

pub(crate) type DbProvider = DBProvider<toolkit_db::DbError>;

/// Configuration for the domain service
#[domain_model]
#[derive(Debug, Clone)]
pub struct ServiceConfig {
    pub default_page_size: u32,
    pub max_page_size: u32,
}

impl Default for ServiceConfig {
    fn default() -> Self {
        Self {
            default_page_size: 50,
            max_page_size: 1000,
        }
    }
}

impl ServiceConfig {
    #[must_use]
    pub fn limit_cfg(&self) -> LimitCfg {
        LimitCfg {
            default: u64::from(self.default_page_size),
            max: u64::from(self.max_page_size),
        }
    }
}

/// DI Container - aggregates all domain services
#[domain_model]
pub(crate) struct AppServices<BR>
where
    BR: BookmarkRepository + 'static,
{
    pub(crate) bookmarks: BookmarkService<BR>,
}

impl<BR> AppServices<BR>
where
    BR: BookmarkRepository + 'static,
{
    pub fn new(bookmark_repo: BR, db: Arc<DbProvider>, config: ServiceConfig) -> Self {
        let bookmark_repo = Arc::new(bookmark_repo);

        Self {
            bookmarks: BookmarkService::new(db, bookmark_repo, config),
        }
    }
}
```

### 6.4 Local client (`gears/bookmarks/src/domain/local_client/client.rs`)

```rust
use std::sync::Arc;

use toolkit::async_trait;
use toolkit_macros::domain_model;
use toolkit_odata::{ODataQuery, Page};
use uuid::Uuid;

#[cfg(feature = "odata")]
use bookmarks_sdk::BookmarkStreamingClientV1;
use bookmarks_sdk::{Bookmark, BookmarkClientV1, BookmarkError};

#[cfg(feature = "odata")]
use crate::domain::local_client::streaming::LocalBookmarkStreamingClient;
use crate::gear::ConcreteAppServices;

/// Local implementation of the object-safe `BookmarkClientV1`.
#[domain_model]
#[derive(Clone)]
pub struct BookmarkLocalClient {
    services: Arc<ConcreteAppServices>,
}

impl BookmarkLocalClient {
    #[must_use]
    pub(crate) fn new(services: Arc<ConcreteAppServices>) -> Self {
        Self { services }
    }
}

#[async_trait]
impl BookmarkClientV1 for BookmarkLocalClient {
    #[cfg(feature = "odata")]
    fn bookmarks(&self) -> Box<dyn BookmarkStreamingClientV1> {
        Box::new(LocalBookmarkStreamingClient::new(Arc::clone(&self.services)))
    }

    async fn get_bookmark(&self, id: Uuid) -> Result<Bookmark, BookmarkError> {
        self.services
            .bookmarks
            .get_bookmark(id)
            .await
            .map_err(BookmarkError::from)
    }

    async fn list_bookmarks(&self, query: ODataQuery) -> Result<Page<Bookmark>, BookmarkError> {
        self.services
            .bookmarks
            .list_bookmarks_page(&query)
            .await
            .map_err(BookmarkError::from)
    }
}
```

### 6.5 Streaming client (`gears/bookmarks/src/domain/local_client/streaming.rs`)

```rust
use std::pin::Pin;
use std::sync::Arc;

use bookmarks_sdk::odata::BookmarkSchema;
use bookmarks_sdk::{Bookmark, BookmarkError, BookmarkStreamingClientV1};
use futures_util::{Stream, StreamExt};
use toolkit_macros::domain_model;
use toolkit_sdk::odata::{QueryBuilder, items_stream_boxed};
use toolkit_sdk::pager::PagerError;

use crate::gear::ConcreteAppServices;

#[domain_model]
pub(crate) struct LocalBookmarkStreamingClient {
    services: Arc<ConcreteAppServices>,
}

impl LocalBookmarkStreamingClient {
    #[must_use]
    pub fn new(services: Arc<ConcreteAppServices>) -> Self {
        Self { services }
    }
}

impl BookmarkStreamingClientV1 for LocalBookmarkStreamingClient {
    fn stream(
        &self,
        query: QueryBuilder<BookmarkSchema>,
    ) -> Pin<Box<dyn Stream<Item = Result<Bookmark, BookmarkError>> + Send + 'static>> {
        let services = Arc::clone(&self.services);
        let stream = items_stream_boxed(
            query,
            Box::new(move |q| {
                let services = Arc::clone(&services);
                Box::pin(async move {
                    services
                        .bookmarks
                        .list_bookmarks_page(&q)
                        .await
                        .map_err(BookmarkError::from)
                })
            }),
        );
        Box::pin(stream.map(|res| {
            res.map_err(|err| match err {
                PagerError::Fetch(bookmark_err) => bookmark_err,
                PagerError::InvalidCursor(_) => BookmarkError::streaming(err.to_string()),
            })
        }))
    }
}
```

## 7. Transform the infrastructure layer

The infrastructure layer handles persistence — SeaORM entities, migrations, and the repository implementation.

### 7.1 Database entity

Rename the file:

```bash
mv gears/bookmarks/src/infra/storage/entity/pokemon.rs gears/bookmarks/src/infra/storage/entity/bookmark.rs
```

Replace the contents of `gears/bookmarks/src/infra/storage/entity/bookmark.rs`. Note the new table name, the field changes (`name`/`height` → `url`/`title`/`description`), and the `Option<String>` for `description`:

```rust
use toolkit_db_macros::Scopable;
use sea_orm::entity::prelude::*;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Scopable)]
#[sea_orm(table_name = "bookmarks")]
#[secure(tenant_col = "tenant_id", resource_col = "id", no_owner, no_type)]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub url: String,
    pub title: String,
    pub description: Option<String>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
```

Update the entity module declaration in `gears/bookmarks/src/infra/storage/entity/mod.rs`:

```rust
pub mod bookmark;

pub use bookmark::{Column, Entity, Model};
```

### 7.2 Migration (`gears/bookmarks/src/infra/storage/migrations/m20260111_000001_initial.rs`)

Update the table name to `bookmarks`, replace `name`/`height` columns with `url`/`title`/`description`, and rename indexes:

```rust
use sea_orm_migration::prelude::*;
use sea_orm_migration::sea_orm::ConnectionTrait;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let backend = manager.get_database_backend();
        let conn = manager.get_connection();

        let sql = match backend {
            sea_orm::DatabaseBackend::Postgres => {
                r"
CREATE TABLE bookmarks (
    id UUID PRIMARY KEY NOT NULL,
    tenant_id UUID NOT NULL,
    url VARCHAR(2048) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_bookmarks_tenant_id ON bookmarks(tenant_id);
CREATE INDEX idx_bookmarks_title ON bookmarks(title);
                "
            }
            sea_orm::DatabaseBackend::MySql => {
                r"
CREATE TABLE bookmarks (
    id VARCHAR(36) PRIMARY KEY NOT NULL,
    tenant_id VARCHAR(36) NOT NULL,
    url VARCHAR(2048) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    KEY idx_bookmarks_tenant_id (tenant_id),
    KEY idx_bookmarks_title (title)
);
                "
            }
            sea_orm::DatabaseBackend::Sqlite => {
                r"
CREATE TABLE bookmarks (
    id TEXT PRIMARY KEY NOT NULL,
    tenant_id TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_bookmarks_tenant_id ON bookmarks(tenant_id);
CREATE INDEX idx_bookmarks_title ON bookmarks(title);
                "
            }
        };

        conn.execute_unprepared(sql).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let conn = manager.get_connection();
        let sql = "DROP TABLE IF EXISTS bookmarks;";
        conn.execute_unprepared(sql).await?;
        Ok(())
    }
}
```

::: tip
Always add an index on `tenant_id` — the secure ORM injects tenant filters on every query.
:::

### 7.3 Seed data migration

Add a second migration to populate the table with sample bookmarks so the API returns data immediately. Create `gears/bookmarks/src/infra/storage/migrations/m20260111_000002_seed.rs`:

```rust
use sea_orm_migration::prelude::*;
use sea_orm_migration::sea_orm::ConnectionTrait;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let conn = manager.get_connection();
        let sql = r"
INSERT INTO bookmarks (id, tenant_id, url, title, description, created_at, updated_at) VALUES
  ('a1b2c3d4-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'https://www.rust-lang.org', 'The Rust Programming Language',
   'Official Rust website', NOW(), NOW()),
  ('a1b2c3d4-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'https://doc.rust-lang.org/book/', 'The Rust Book',
   'The official Rust programming guide', NOW(), NOW()),
  ('a1b2c3d4-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'https://crates.io', 'crates.io',
   'The Rust community''s crate registry', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
        ";
        conn.execute_unprepared(sql).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let conn = manager.get_connection();
        let sql = "DELETE FROM bookmarks WHERE id IN (
            'a1b2c3d4-0000-0000-0000-000000000001',
            'a1b2c3d4-0000-0000-0000-000000000002',
            'a1b2c3d4-0000-0000-0000-000000000003'
        );";
        conn.execute_unprepared(sql).await?;
        Ok(())
    }
}
```

Register the new migration in `gears/bookmarks/src/infra/storage/migrations/mod.rs`:

```rust
use sea_orm_migration::prelude::*;

mod m20260111_000001_initial;
mod m20260111_000002_seed;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20260111_000001_initial::Migration),
            Box::new(m20260111_000002_seed::Migration),
        ]
    }
}
```

### 7.4 Mapper (`gears/bookmarks/src/infra/storage/mapper.rs`)

Update the field mappings to match the new model:

```rust
use crate::infra::storage::entity;
use bookmarks_sdk::Bookmark;

/// Convert a database entity to a contract model (owned version)
impl From<entity::bookmark::Model> for Bookmark {
    fn from(e: entity::bookmark::Model) -> Self {
        Self {
            id: e.id,
            tenant_id: e.tenant_id,
            url: e.url,
            title: e.title,
            description: e.description,
            created_at: e.created_at,
            updated_at: e.updated_at,
        }
    }
}

/// Convert a database entity to a contract model (by-ref version)
impl From<&entity::bookmark::Model> for Bookmark {
    fn from(e: &entity::bookmark::Model) -> Self {
        Self {
            id: e.id,
            tenant_id: e.tenant_id,
            url: e.url.clone(),
            title: e.title.clone(),
            description: e.description.clone(),
            created_at: e.created_at,
            updated_at: e.updated_at,
        }
    }
}
```

### 7.5 OData mapper (`gears/bookmarks/src/infra/storage/odata_mapper.rs`)

Update filter field mappings. Note the new `Url` and `Title` fields replacing `Name`:

```rust
//! Infrastructure layer mapping from type-safe `FilterNode` to SeaORM Conditions.
//! Only compiled when the `odata` feature is enabled.
use toolkit_db::odata::sea_orm_filter::{FieldToColumn, ODataFieldMapping};

use crate::infra::storage::entity::{Column, Entity, Model};
use bookmarks_sdk::odata::BookmarkFilterField;

/// Complete OData mapper for bookmarks.
pub struct BookmarkODataMapper;

impl FieldToColumn<BookmarkFilterField> for BookmarkODataMapper {
    type Column = Column;

    fn map_field(field: BookmarkFilterField) -> Column {
        match field {
            BookmarkFilterField::Id => Column::Id,
            BookmarkFilterField::Title => Column::Title,
            BookmarkFilterField::Url => Column::Url,
            BookmarkFilterField::CreatedAt => Column::CreatedAt,
        }
    }
}

impl ODataFieldMapping<BookmarkFilterField> for BookmarkODataMapper {
    type Entity = Entity;

    fn extract_cursor_value(model: &Model, field: BookmarkFilterField) -> sea_orm::Value {
        match field {
            BookmarkFilterField::Id => sea_orm::Value::Uuid(Some(Box::new(model.id))),
            BookmarkFilterField::Title => sea_orm::Value::String(Some(Box::new(model.title.clone()))),
            BookmarkFilterField::Url => sea_orm::Value::String(Some(Box::new(model.url.clone()))),
            BookmarkFilterField::CreatedAt => {
                sea_orm::Value::TimeDateTimeWithTimeZone(Some(Box::new(model.created_at)))
            }
        }
    }
}
```

### 7.6 Repository implementation

Rename the file:

```bash
mv gears/bookmarks/src/infra/storage/pokemon_sea_repo.rs gears/bookmarks/src/infra/storage/bookmark_sea_repo.rs
```

Replace the contents of `gears/bookmarks/src/infra/storage/bookmark_sea_repo.rs`:

```rust
use toolkit::async_trait;

use crate::infra::storage::db::db_err;
use crate::infra::storage::entity::bookmark::{Column, Entity as BookmarkEntity};
#[cfg(feature = "odata")]
use crate::infra::storage::odata_mapper::BookmarkODataMapper;
use crate::{domain::error::DomainError, domain::repos::BookmarkRepository};
use bookmarks_sdk::Bookmark;
#[cfg(feature = "odata")]
use bookmarks_sdk::odata::BookmarkFilterField;
use toolkit_db::odata::LimitCfg;
#[cfg(feature = "odata")]
use toolkit_db::odata::paginate_odata;
use toolkit_db::secure::{DBRunner, SecureEntityExt};
#[cfg(feature = "odata")]
use toolkit_odata::SortDir;
use toolkit_odata::{ODataQuery, Page};
use toolkit_security::AccessScope;
use sea_orm::EntityTrait;
use sea_orm::QueryFilter;
use sea_orm::sea_query::Expr;
use uuid::Uuid;

/// ORM-based implementation of the `BookmarkRepository` trait.
#[derive(Clone)]
pub struct OrmBookmarkRepository {
    limit_cfg: LimitCfg,
}

impl OrmBookmarkRepository {
    #[must_use]
    pub fn new(limit_cfg: LimitCfg) -> Self {
        Self { limit_cfg }
    }
}

#[async_trait]
impl BookmarkRepository for OrmBookmarkRepository {
    async fn get<C: DBRunner>(
        &self,
        conn: &C,
        scope: &AccessScope,
        id: Uuid,
    ) -> Result<Option<Bookmark>, DomainError> {
        let found = BookmarkEntity::find()
            .filter(sea_orm::Condition::all().add(Expr::col(Column::Id).eq(id)))
            .secure()
            .scope_with(scope)
            .one(conn)
            .await
            .map_err(db_err)?;
        Ok(found.map(Into::into))
    }

    async fn list_page<C: DBRunner>(
        &self,
        conn: &C,
        scope: &AccessScope,
        query: &ODataQuery,
    ) -> Result<Page<Bookmark>, DomainError> {
        #[cfg(feature = "odata")]
        {
            let base_query = BookmarkEntity::find().secure().scope_with(scope);

            let page = paginate_odata::<BookmarkFilterField, BookmarkODataMapper, _, _, _, _>(
                base_query,
                conn,
                query,
                ("id", SortDir::Desc),
                self.limit_cfg,
                Into::into,
            )
            .await
            .map_err(db_err)?;

            Ok(page)
        }

        #[cfg(not(feature = "odata"))]
        {
            let _ = (conn, scope, query);
            Err(DomainError::validation(
                "query",
                "OData feature is disabled",
            ))
        }
    }
}
```

Update the storage module declaration in `gears/bookmarks/src/infra/storage/mod.rs`:

```rust
//! Infrastructure storage layer - database persistence and OData mapping.

pub mod entity;
pub mod mapper;
pub mod migrations;
#[cfg(feature = "odata")]
pub mod odata_mapper;

mod db;
mod bookmark_sea_repo;

pub use bookmark_sea_repo::OrmBookmarkRepository;
```

## 8. Transform the API layer

The API layer handles HTTP-specific concerns: DTOs, handlers, routes, and error mapping.

### 8.1 DTO (`gears/bookmarks/src/api/rest/dto.rs`)

Update the DTO with bookmark fields:

```rust
use bookmarks_sdk::Bookmark;
use time::OffsetDateTime;
use uuid::Uuid;

/// REST DTO for bookmark representation with serde/utoipa
#[derive(Debug, Clone)]
#[toolkit_macros::api_dto(request, response)]
pub struct BookmarkDto {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub url: String,
    pub title: String,
    pub description: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

impl From<Bookmark> for BookmarkDto {
    fn from(b: Bookmark) -> Self {
        Self {
            id: b.id,
            tenant_id: b.tenant_id,
            url: b.url,
            title: b.title,
            description: b.description,
            created_at: b.created_at,
            updated_at: b.updated_at,
        }
    }
}
```

### 8.2 Handlers

Rename the file:

```bash
mv gears/bookmarks/src/api/rest/handlers/pokemon.rs gears/bookmarks/src/api/rest/handlers/bookmark.rs
```

Replace the contents of `gears/bookmarks/src/api/rest/handlers/bookmark.rs`:

```rust
use axum::Extension;
use axum::extract::Path;
use tracing::field::Empty;
use uuid::Uuid;

use toolkit::api::odata::OData;

use super::{
    ApiResult, Json, JsonBody, JsonPage, BookmarkDto, apply_select, page_to_projected_json,
};
use crate::gear::ConcreteAppServices;

/// List bookmarks with cursor-based pagination and optional field projection via $select
#[tracing::instrument(
    skip(svc, query),
    fields(
        limit = query.limit,
        request_id = Empty,
    )
)]
pub async fn list_bookmarks(
    Extension(svc): Extension<std::sync::Arc<ConcreteAppServices>>,
    OData(query): OData,
) -> ApiResult<JsonPage<serde_json::Value>> {
    let page = svc.bookmarks.list_bookmarks_page(&query).await?;
    let page = page.map_items(BookmarkDto::from);

    Ok(Json(page_to_projected_json(&page, query.selected_fields())))
}

/// Get a specific bookmark by ID with optional field projection via $select
#[tracing::instrument(
    skip(svc),
    fields(
        bookmark.id = %id,
        request_id = Empty,
    )
)]
pub async fn get_bookmark(
    Extension(svc): Extension<std::sync::Arc<ConcreteAppServices>>,
    Path(id): Path<Uuid>,
    OData(query): OData,
) -> ApiResult<JsonBody<serde_json::Value>> {
    let bookmark = svc.bookmarks.get_bookmark(id).await?;
    let bookmark_dto = BookmarkDto::from(bookmark);
    let projected = apply_select(&bookmark_dto, query.selected_fields());
    Ok(Json(projected))
}
```

Update the handlers module declaration in `gears/bookmarks/src/api/rest/handlers/mod.rs`:

```rust
use crate::api::rest::dto::BookmarkDto;

use toolkit::api::canonical_prelude::*;
use toolkit::api::select::{apply_select, page_to_projected_json};

mod bookmark;

// ==================== Bookmark Handlers ====================

#[cfg(feature = "odata")]
pub(crate) use bookmark::get_bookmark;
#[cfg(feature = "odata")]
pub(crate) use bookmark::list_bookmarks;
```

### 8.3 Routes

Rename the file:

```bash
mv gears/bookmarks/src/api/rest/routes/pokemon.rs gears/bookmarks/src/api/rest/routes/bookmark.rs
```

Replace the contents of `gears/bookmarks/src/api/rest/routes/bookmark.rs`. Note the new route paths under `/bookmarks/v1/bookmarks`:

```rust
//! Only compiled when the `odata` feature is enabled — the list route requires
//! typed OData filter fields from the SDK's `odata` module.
use super::{dto, handlers};
use bookmarks_sdk::odata::BookmarkFilterField;
use axum::Router;
use toolkit::api::OpenApiRegistry;
use toolkit::api::operation_builder::{OperationBuilder, OperationBuilderODataExt};

pub(super) fn register_bookmark_routes(mut router: Router, openapi: &dyn OpenApiRegistry) -> Router {
    // GET /bookmarks/v1/bookmarks - List bookmarks with cursor-based pagination
    router = OperationBuilder::get("/bookmarks/v1/bookmarks")
        .operation_id("bookmarks.list_bookmarks")
        .summary("List bookmarks with cursor pagination")
        .description("Retrieve a paginated list of bookmarks using cursor-based pagination")
        .tag("bookmarks")
        .public()
        .query_param_typed(
            "limit",
            false,
            "Maximum number of bookmarks to return",
            "integer",
        )
        .query_param("cursor", false, "Cursor for pagination")
        .handler(handlers::list_bookmarks)
        .json_response_with_schema::<toolkit_odata::Page<dto::BookmarkDto>>(
            openapi,
            http::StatusCode::OK,
            "Paginated list of bookmarks",
        )
        .with_odata_filter::<BookmarkFilterField>()
        .with_odata_select()
        .with_odata_orderby::<BookmarkFilterField>()
        .error_400(openapi)
        .error_500(openapi)
        .register(router, openapi);

    // GET /bookmarks/v1/bookmarks/{id} - Get a specific bookmark
    router = OperationBuilder::get("/bookmarks/v1/bookmarks/{id}")
        .operation_id("bookmarks.get_bookmark")
        .public()
        .summary("Get bookmark by ID")
        .description("Retrieve a specific bookmark by its UUID")
        .tag("bookmarks")
        .path_param("id", "Bookmark UUID")
        .handler(handlers::get_bookmark)
        .with_odata_select()
        .json_response_with_schema::<dto::BookmarkDto>(
            openapi,
            http::StatusCode::OK,
            "Bookmark found",
        )
        .error_404(openapi)
        .error_500(openapi)
        .register(router, openapi);

    router
}
```

Update the routes module declaration in `gears/bookmarks/src/api/rest/routes/mod.rs`:

```rust
//! REST API route definitions - OpenAPI and Axum routing.

#[cfg(feature = "odata")]
use crate::api::rest::{dto, handlers};
use crate::gear::ConcreteAppServices;
use axum::Router;
use toolkit::api::OpenApiRegistry;
use std::sync::Arc;

#[cfg(feature = "odata")]
mod bookmark;

/// Register all routes for the bookmarks gear
pub(crate) fn register_routes(
    mut router: Router,
    openapi: &dyn OpenApiRegistry,
    services: Arc<ConcreteAppServices>,
) -> Router {
    #[cfg(feature = "odata")]
    {
        router = bookmark::register_bookmark_routes(router, openapi);
    }

    #[cfg(not(feature = "odata"))]
    let _ = openapi;

    router = router.layer(axum::Extension(services));

    router
}
```

### 8.4 Error mapping (`gears/bookmarks/src/api/rest/error.rs`)

Update error messages:

```rust
use toolkit::api::canonical_prelude::{CanonicalError, Problem};

use crate::domain::error::DomainError;
use crate::errors::ErrorCode;

fn domain_error_to_canonical(e: &DomainError) -> CanonicalError {
    match e {
        DomainError::NotFound { id } => {
            ErrorCode::bookmark_not_found_v1().as_canonical(format!("Bookmark with id {id} was not found"))
        }
        DomainError::Validation { .. } => ErrorCode::bookmark_validation_v1().as_canonical(format!("{e}")),
        DomainError::Database { .. } => {
            tracing::error!(error = ?e, "Database error occurred");
            ErrorCode::bookmark_internal_database_v1().as_canonical("An internal database error occurred")
        }
        DomainError::InternalError => {
            tracing::error!(error = ?e, "Internal error occurred");
            ErrorCode::internal_server_error_v1().as_canonical("An internal error occurred")
        }
    }
}

/// Map domain error to RFC9457 Problem using thiserror-backed API error codes.
pub fn domain_error_to_problem(e: &DomainError, instance: &str) -> Problem {
    let trace_id = tracing::Span::current()
        .id()
        .map(|id| id.into_u64().to_string());

    let mut problem = Problem::from(domain_error_to_canonical(e)).with_instance(instance);
    if let Some(tid) = trace_id {
        problem = problem.with_trace_id(tid);
    }
    problem
}

impl From<DomainError> for CanonicalError {
    fn from(e: DomainError) -> Self {
        domain_error_to_canonical(&e)
    }
}

/// Implement Into<Problem> for `DomainError` so `?` works in handlers
impl From<DomainError> for Problem {
    fn from(e: DomainError) -> Self {
        domain_error_to_problem(&e, "/")
    }
}
```

## 9. Update gear wiring

### 9.1 API error codes (`gears/bookmarks/src/errors.rs`)

Update the error namespace and all Pokemon references to Bookmark:

```rust
//! Thiserror-backed API error definitions for bookmarks.

use http::StatusCode;
use toolkit::api::canonical_prelude::{CanonicalError, Problem, resource_error};
use thiserror::Error;

#[resource_error("gts.hx.example2.bookmarks.api.v1~")]
pub struct BookmarkApiError;

/// Strongly-typed API error codes for RFC 9457 responses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Error)]
pub enum ErrorCode {
    #[error("Bookmark not found")]
    BookmarkNotFound,

    #[error("Validation error")]
    BookmarkValidation,

    #[error("Internal database error")]
    BookmarkInternalDatabase,

    #[error("Internal server error")]
    InternalServerError,
}

impl ErrorCode {
    #[must_use]
    pub const fn bookmark_not_found_v1() -> Self {
        Self::BookmarkNotFound
    }

    #[must_use]
    pub const fn bookmark_validation_v1() -> Self {
        Self::BookmarkValidation
    }

    #[must_use]
    pub const fn bookmark_internal_database_v1() -> Self {
        Self::BookmarkInternalDatabase
    }

    #[must_use]
    pub const fn internal_server_error_v1() -> Self {
        Self::InternalServerError
    }

    #[must_use]
    pub const fn status(self) -> StatusCode {
        match self {
            Self::BookmarkNotFound => StatusCode::NOT_FOUND,
            Self::BookmarkValidation => StatusCode::UNPROCESSABLE_ENTITY,
            Self::BookmarkInternalDatabase => StatusCode::INTERNAL_SERVER_ERROR,
            Self::InternalServerError => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    #[must_use]
    pub const fn title(self) -> &'static str {
        match self {
            Self::BookmarkNotFound => "Bookmark Not Found",
            Self::BookmarkValidation => "Validation Error",
            Self::BookmarkInternalDatabase => "Internal Database Error",
            Self::InternalServerError => "Internal Server Error",
        }
    }

    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::BookmarkNotFound => "gts.hx.core.errors.err.v1~hx.example2.bookmarks.not_found.v1",
            Self::BookmarkValidation => {
                "gts.hx.core.errors.err.v1~hx.example2.bookmarks.validation.v1"
            }
            Self::BookmarkInternalDatabase => {
                "gts.hx.core.errors.err.v1~hx.example2.bookmarks.internal_database.v1"
            }
            Self::InternalServerError => "gts.hx.core.errors.err.v1~hx.internal_server_error.v1",
        }
    }

    #[must_use]
    pub const fn type_url(self) -> &'static str {
        self.code()
    }

    pub fn as_canonical(self, detail: impl Into<String>) -> CanonicalError {
        let detail = detail.into();

        match self {
            Self::BookmarkNotFound => BookmarkApiError::not_found(detail.clone())
                .with_resource(detail)
                .create(),
            Self::BookmarkValidation => BookmarkApiError::invalid_argument()
                .with_field_violation("bookmark", detail, "VALIDATION_FAILED")
                .create(),
            Self::BookmarkInternalDatabase => CanonicalError::internal(detail).create(),
            Self::InternalServerError => CanonicalError::internal(detail).create(),
        }
    }

    pub fn as_problem(self, detail: impl Into<String>) -> Problem {
        Problem::from(self.as_canonical(detail))
    }

    pub fn with_context(
        self,
        detail: impl Into<String>,
        instance: &str,
        trace_id: Option<String>,
    ) -> Problem {
        let mut problem = self.as_problem(detail).with_instance(instance);
        if let Some(tid) = trace_id {
            problem = problem.with_trace_id(tid);
        }
        problem
    }
}
```

### 9.2 Gear config (`gears/bookmarks/src/config.rs`)

```rust
use serde::Deserialize;

/// Configuration for the bookmarks gear
#[derive(Debug, Deserialize)]
pub struct BookmarkConfig {
    #[serde(default = "default_page_size")]
    pub default_page_size: u32,
    #[serde(default = "default_max_page_size")]
    pub max_page_size: u32,
}

impl Default for BookmarkConfig {
    fn default() -> Self {
        Self {
            default_page_size: default_page_size(),
            max_page_size: default_max_page_size(),
        }
    }
}

fn default_page_size() -> u32 { 50 }
fn default_max_page_size() -> u32 { 1000 }
```

::: info
Check the generated `config.rs` for the exact helper function pattern — it may vary slightly between template versions.
:::

### 9.3 Gear declaration (`gears/bookmarks/src/gear.rs`)

```rust
use std::sync::{Arc, OnceLock};

use toolkit::api::OpenApiRegistry;
use toolkit::{DatabaseCapability, Gear, GearCtx, RestApiCapability, async_trait};
use toolkit_db::DBProvider;
use toolkit_db::DbError;
use sea_orm_migration::MigrationTrait;
use tracing::{debug, info};

use bookmarks_sdk::BookmarkClientV1;

use crate::api::rest::routes;
use crate::config::BookmarkConfig;
use crate::domain::local_client::client::BookmarkLocalClient;
use crate::domain::service::{AppServices, ServiceConfig};
use crate::infra::storage::OrmBookmarkRepository;

/// Type alias for the concrete `AppServices` type used with ORM repositories.
pub(crate) type ConcreteAppServices = AppServices<OrmBookmarkRepository>;

/// Bookmarks gear with DDD-light layout and proper `ClientHub` integration
#[toolkit::gear(
    name = "bookmarks",
    capabilities = [db, rest]
)]
pub struct BookmarkGear {
    service: OnceLock<Arc<ConcreteAppServices>>,
}

impl Default for BookmarkGear {
    fn default() -> Self {
        Self {
            service: OnceLock::new(),
        }
    }
}

#[async_trait]
impl Gear for BookmarkGear {
    async fn init(&self, ctx: &GearCtx) -> anyhow::Result<()> {
        let cfg: BookmarkConfig = ctx.config()?;
        debug!(
            "Loaded bookmarks config: default_page_size={}, max_page_size={}",
            cfg.default_page_size, cfg.max_page_size
        );

        let db: Arc<DBProvider<DbError>> = Arc::new(ctx.db_required()?);

        let service_config = ServiceConfig {
            default_page_size: cfg.default_page_size,
            max_page_size: cfg.max_page_size,
        };

        let limit_cfg = service_config.limit_cfg();
        let bookmark_repo = OrmBookmarkRepository::new(limit_cfg);

        let services = Arc::new(AppServices::new(bookmark_repo, db, service_config));

        self.service
            .set(services.clone())
            .map_err(|_| anyhow::anyhow!("bookmarks gear already initialized"))?;

        let local = BookmarkLocalClient::new(services);

        ctx.client_hub()
            .register::<dyn BookmarkClientV1>(Arc::new(local));

        Ok(())
    }
}

impl DatabaseCapability for BookmarkGear {
    fn migrations(&self) -> Vec<Box<dyn MigrationTrait>> {
        use sea_orm_migration::MigratorTrait;
        info!("Providing bookmarks database migrations");
        crate::infra::storage::migrations::Migrator::migrations()
    }
}

impl RestApiCapability for BookmarkGear {
    fn register_rest(
        &self,
        _ctx: &GearCtx,
        router: axum::Router,
        openapi: &dyn OpenApiRegistry,
    ) -> anyhow::Result<axum::Router> {
        info!("Registering bookmarks REST routes");

        let service = self
            .service
            .get()
            .ok_or_else(|| anyhow::anyhow!("Service not initialized"))?
            .clone();

        let router = routes::register_routes(router, openapi, service);

        info!("Bookmarks REST routes registered successfully");
        Ok(router)
    }
}
```

### 9.4 Crate root (`gears/bookmarks/src/lib.rs`)

```rust
#![doc = include_str!("../README.md")]

// === API ERROR DEFINITIONS ===
pub mod errors;

// === GEAR DEFINITION ===
pub mod gear;
pub use gear::BookmarkGear;

// === INTERNAL MODULES ===
pub(crate) mod api;
pub(crate) mod config;
pub(crate) mod domain;
pub(crate) mod infra;
```

## 10. Set up a local database

The easiest way to run PostgreSQL locally is with Docker:

```bash
export DB_PASSWORD=changeme
docker run -d --name gears-pg \
  -e POSTGRES_PASSWORD=$DB_PASSWORD \
  -e POSTGRES_DB=bookmarks \
  -p 5432:5432 \
  postgres:17
```

This starts a PostgreSQL 17 container with the `bookmarks` database pre-created. The `DB_PASSWORD` environment variable matches what `bookmarks.yml` references via `${DB_PASSWORD}`.

## 11. Build and run

```bash
cargo gears build
cargo gears run
```

The runtime will:

1. Discover and wire all gears (system gears first, then your local bookmarks gear)
2. Run database migrations (creating the `bookmarks` table and inserting seed data)
3. Register REST routes under `/bookmarks/v1/bookmarks`
4. Start the HTTP server on `0.0.0.0:8080`

## 12. Test with curl

```bash
# List bookmarks (returns the seed data)
curl -s "http://localhost:8080/bookmarks/v1/bookmarks" | jq .

# List with OData filter
curl -s "http://localhost:8080/bookmarks/v1/bookmarks?\$filter=title eq 'The Rust Book'" | jq .

# Get a bookmark by ID
curl -s "http://localhost:8080/bookmarks/v1/bookmarks/a1b2c3d4-0000-0000-0000-000000000001" | jq .
```

::: tip
This guide only covers GET and LIST endpoints. The [Brown Project](./brown-project) guide adds create, update, and delete endpoints.
:::

## 13. Run lint and tests

```bash
cargo gears lint              # formatting + Clippy
cargo gears test              # run test suite with nextest
```

See the [Manifest](/intro/manifest#lint-policy) page for lint and test configuration options.

## What you've built

```text
bookmarks-app/
  Gears.toml
  config/bookmarks.yml
  gears/
    hello-world/              # Starter gear (can be removed)
    bookmarks/
      src/
        gear.rs               # Gear declaration with db + rest
        api/rest/             # DTOs, handlers, routes
        domain/               # Service, errors, local client
        infra/storage/        # Entity, mapper, migrations
      sdk/
        src/                  # Public client trait + models
```

Your application follows the Gears architecture:

- **SDK first** — the public contract is defined before implementation
- **Secure by default** — `SecureConn` enforces tenant isolation at the query level
- **Transport agnostic** — the SDK trait works identically for in-process and gRPC consumers
- **OpenAPI generated** — `OperationBuilder` produces a full OpenAPI spec alongside the routes

## Next steps

- **[Brown Project](./brown-project)** — extend this app with create, update, and delete endpoints, plus a link-checker background worker
- [Toolkit documentation](/toolkit/) — deep-dive into each pattern
- [API Reference](/reference/api-reference) — browse the toolkit crate sources
