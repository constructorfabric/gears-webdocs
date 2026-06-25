---
outline: deep
---
# Brown Project: CRUD Bookmarks

Extend the bookmark manager from the [Green Project](./green-project) with create, update, and delete endpoints.

## What you'll add

- **POST** `/bookmarks/v1/bookmarks` — create a bookmark
- **PUT** `/bookmarks/v1/bookmarks/{id}` — replace a bookmark
- **DELETE** `/bookmarks/v1/bookmarks/{id}` — delete a bookmark

We follow the same layer-by-layer approach: SDK → domain → infrastructure → API.

## Prerequisites

A working bookmarks-app from the [Green Project](./green-project) guide with GET and LIST endpoints.

## 1. Enable UUID generation

The service layer generates UUIDs for new bookmarks. Add the `v4` feature to the `uuid` dependency in `gears/bookmarks/Cargo.toml`:

```toml
# UUID support
uuid = { features = ["serde", "v4"] , workspace = true }
```

## 2. Extend the SDK

### 2.1 Input models (`gears/bookmarks/sdk/src/models.rs`)

Add `CreateBookmark` and `UpdateBookmark` input types below the existing `Bookmark` struct. These carry only user-provided fields — the service assigns `id`, `tenant_id`, and timestamps:

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

/// Input for creating a new bookmark.
#[derive(Debug, Clone)]
pub struct CreateBookmark {
    pub url: String,
    pub title: String,
    pub description: Option<String>,
}

/// Input for updating an existing bookmark (full replacement).
#[derive(Debug, Clone)]
pub struct UpdateBookmark {
    pub url: String,
    pub title: String,
    pub description: Option<String>,
}
```

### 2.2 Client trait (`gears/bookmarks/sdk/src/client.rs`)

Add three write methods to `BookmarkClientV1`:

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
use crate::models::{Bookmark, CreateBookmark, UpdateBookmark};

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

    /// Create a new bookmark.
    async fn create_bookmark(&self, input: CreateBookmark) -> Result<Bookmark, BookmarkError>;

    /// Update an existing bookmark (full replacement).
    async fn update_bookmark(&self, id: Uuid, input: UpdateBookmark) -> Result<Bookmark, BookmarkError>;

    /// Delete a bookmark by ID.
    async fn delete_bookmark(&self, id: Uuid) -> Result<(), BookmarkError>;
}

/// Streaming interface for bookmarks (Version 1).
#[cfg(feature = "odata")]
pub trait BookmarkStreamingClientV1: Send + Sync {
    fn stream(&self, query: QueryBuilder<BookmarkSchema>) -> BookmarkStream<Bookmark>;
}
```

### 2.3 SDK re-exports (`gears/bookmarks/sdk/src/lib.rs`)

Add re-exports for the new input types:

```rust
//! Bookmarks SDK
//!
//! Public API contract for the bookmarks gear:
//! - `BookmarkClientV1` trait
//! - `Bookmark`, `CreateBookmark`, `UpdateBookmark` models
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
pub use models::{Bookmark, CreateBookmark, UpdateBookmark};
```

## 3. Extend the domain layer

### 3.1 Repository trait (`gears/bookmarks/src/domain/repos/bookmark_repo.rs`)

Add `create`, `update`, and `delete` methods. All three take an `AccessScope` for tenant isolation enforcement. Create and update take `Bookmark` by value (the service builds it):

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

    /// Insert a new bookmark.
    async fn create<C: DBRunner>(
        &self,
        runner: &C,
        scope: &AccessScope,
        bookmark: Bookmark,
    ) -> Result<Bookmark, DomainError>;

    /// Update an existing bookmark (full replacement).
    async fn update<C: DBRunner>(
        &self,
        runner: &C,
        scope: &AccessScope,
        bookmark: Bookmark,
    ) -> Result<Bookmark, DomainError>;

    /// Delete a bookmark by ID. Returns `true` if a row was deleted.
    async fn delete<C: DBRunner>(
        &self,
        runner: &C,
        scope: &AccessScope,
        id: Uuid,
    ) -> Result<bool, DomainError>;
}
```

### 3.2 Service (`gears/bookmarks/src/domain/service/bookmark.rs`)

Add `create_bookmark`, `update_bookmark`, and `delete_bookmark`. Each method validates input, manages timestamps, and delegates to the repository:

```rust
use std::sync::Arc;

use bookmarks_sdk::{Bookmark, CreateBookmark, UpdateBookmark};
use toolkit_macros::domain_model;
use toolkit_odata::{ODataQuery, Page};
use toolkit_security::AccessScope;
use time::OffsetDateTime;
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

    #[instrument(skip(self, input))]
    pub async fn create_bookmark(&self, input: CreateBookmark) -> Result<Bookmark, DomainError> {
        tracing::debug!("Creating bookmark");

        if input.url.is_empty() {
            return Err(DomainError::validation("url", "must not be empty"));
        }
        if input.title.is_empty() {
            return Err(DomainError::validation("title", "must not be empty"));
        }

        let now = OffsetDateTime::now_utc();
        let bookmark = Bookmark {
            id: Uuid::new_v4(),
            tenant_id: Uuid::nil(),
            url: input.url,
            title: input.title,
            description: input.description,
            created_at: now,
            updated_at: now,
        };

        let conn = self.db.conn().map_err(DomainError::from)?;
        let scope = AccessScope::allow_all();
        let created = self.repo.create(&conn, &scope, bookmark).await?;

        tracing::debug!("Successfully created bookmark");
        Ok(created)
    }

    #[instrument(skip(self, input), fields(bookmark_id = %id))]
    pub async fn update_bookmark(
        &self,
        id: Uuid,
        input: UpdateBookmark,
    ) -> Result<Bookmark, DomainError> {
        tracing::debug!("Updating bookmark");

        if input.url.is_empty() {
            return Err(DomainError::validation("url", "must not be empty"));
        }
        if input.title.is_empty() {
            return Err(DomainError::validation("title", "must not be empty"));
        }

        let conn = self.db.conn().map_err(DomainError::from)?;
        let scope = AccessScope::allow_all();

        let existing = self
            .repo
            .get(&conn, &scope, id)
            .await?
            .ok_or_else(|| DomainError::not_found(id))?;

        let bookmark = Bookmark {
            id: existing.id,
            tenant_id: existing.tenant_id,
            url: input.url,
            title: input.title,
            description: input.description,
            created_at: existing.created_at,
            updated_at: OffsetDateTime::now_utc(),
        };

        let updated = self.repo.update(&conn, &scope, bookmark).await?;

        tracing::debug!("Successfully updated bookmark");
        Ok(updated)
    }

    #[instrument(skip(self), fields(bookmark_id = %id))]
    pub async fn delete_bookmark(&self, id: Uuid) -> Result<(), DomainError> {
        tracing::debug!("Deleting bookmark");

        let conn = self.db.conn().map_err(DomainError::from)?;
        let scope = AccessScope::allow_all();

        let deleted = self.repo.delete(&conn, &scope, id).await?;
        if !deleted {
            return Err(DomainError::not_found(id));
        }

        tracing::debug!("Successfully deleted bookmark");
        Ok(())
    }
}
```

::: info
The service uses `Uuid::nil()` as `tenant_id` because we disabled authentication in the Green Project setup. In production, the tenant ID would come from the authenticated security context.
:::

### 3.3 Local client (`gears/bookmarks/src/domain/local_client/client.rs`)

Implement the three new trait methods by delegating to the service:

```rust
use std::sync::Arc;

use toolkit::async_trait;
use toolkit_macros::domain_model;
use toolkit_odata::{ODataQuery, Page};
use uuid::Uuid;

#[cfg(feature = "odata")]
use bookmarks_sdk::BookmarkStreamingClientV1;
use bookmarks_sdk::{Bookmark, BookmarkClientV1, BookmarkError, CreateBookmark, UpdateBookmark};

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

    async fn create_bookmark(&self, input: CreateBookmark) -> Result<Bookmark, BookmarkError> {
        self.services
            .bookmarks
            .create_bookmark(input)
            .await
            .map_err(BookmarkError::from)
    }

    async fn update_bookmark(&self, id: Uuid, input: UpdateBookmark) -> Result<Bookmark, BookmarkError> {
        self.services
            .bookmarks
            .update_bookmark(id, input)
            .await
            .map_err(BookmarkError::from)
    }

    async fn delete_bookmark(&self, id: Uuid) -> Result<(), BookmarkError> {
        self.services
            .bookmarks
            .delete_bookmark(id)
            .await
            .map_err(BookmarkError::from)
    }
}
```

## 4. Extend the infrastructure layer

### 4.1 Repository implementation (`gears/bookmarks/src/infra/storage/bookmark_sea_repo.rs`)

Implement the three new methods using the toolkit's secure helpers — `secure_insert`, `secure_update_with_scope`, and `SecureDeleteExt` — which wrap SeaORM operations while respecting the `DBRunner` abstraction:

```rust
use toolkit::async_trait;

use crate::infra::storage::db::db_err;
use crate::infra::storage::entity::bookmark::{ActiveModel, Column, Entity as BookmarkEntity};
#[cfg(feature = "odata")]
use crate::infra::storage::odata_mapper::BookmarkODataMapper;
use crate::{domain::error::DomainError, domain::repos::BookmarkRepository};
use bookmarks_sdk::Bookmark;
#[cfg(feature = "odata")]
use bookmarks_sdk::odata::BookmarkFilterField;
use toolkit_db::odata::LimitCfg;
#[cfg(feature = "odata")]
use toolkit_db::odata::paginate_odata;
use toolkit_db::secure::{
    DBRunner, SecureDeleteExt, SecureEntityExt, secure_insert, secure_update_with_scope,
};
#[cfg(feature = "odata")]
use toolkit_odata::SortDir;
use toolkit_odata::{ODataQuery, Page};
use toolkit_security::AccessScope;
use sea_orm::{EntityTrait, QueryFilter, Set};
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

    async fn create<C: DBRunner>(
        &self,
        conn: &C,
        scope: &AccessScope,
        bookmark: Bookmark,
    ) -> Result<Bookmark, DomainError> {
        let active = ActiveModel {
            id: Set(bookmark.id),
            tenant_id: Set(bookmark.tenant_id),
            url: Set(bookmark.url.clone()),
            title: Set(bookmark.title.clone()),
            description: Set(bookmark.description.clone()),
            created_at: Set(bookmark.created_at),
            updated_at: Set(bookmark.updated_at),
        };

        let _ = secure_insert::<BookmarkEntity>(active, scope, conn)
            .await
            .map_err(db_err)?;
        Ok(bookmark)
    }

    async fn update<C: DBRunner>(
        &self,
        conn: &C,
        scope: &AccessScope,
        bookmark: Bookmark,
    ) -> Result<Bookmark, DomainError> {
        let active = ActiveModel {
            id: Set(bookmark.id),
            tenant_id: Set(bookmark.tenant_id),
            url: Set(bookmark.url.clone()),
            title: Set(bookmark.title.clone()),
            description: Set(bookmark.description.clone()),
            created_at: Set(bookmark.created_at),
            updated_at: Set(bookmark.updated_at),
        };

        let _ = secure_update_with_scope::<BookmarkEntity>(active, scope, bookmark.id, conn)
            .await
            .map_err(db_err)?;
        Ok(bookmark)
    }

    async fn delete<C: DBRunner>(
        &self,
        conn: &C,
        scope: &AccessScope,
        id: Uuid,
    ) -> Result<bool, DomainError> {
        let result = BookmarkEntity::delete_many()
            .filter(sea_orm::Condition::all().add(Expr::col(Column::Id).eq(id)))
            .secure()
            .scope_with(scope)
            .exec(conn)
            .await
            .map_err(db_err)?;

        Ok(result.rows_affected > 0)
    }
}
```

::: info
The toolkit's secure helpers (`secure_insert`, `secure_update_with_scope`, `SecureDeleteExt`) wrap SeaORM operations while respecting the `DBRunner` abstraction and enforcing tenant isolation through the `AccessScope`.
:::

## 5. Extend the API layer

### 5.1 Request DTOs (`gears/bookmarks/src/api/rest/dto.rs`)

Add `CreateBookmarkRequest` and `UpdateBookmarkRequest` DTOs. These use `api_dto(request)` — they only need deserialization and schema generation:

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

/// Request body for creating a bookmark.
#[derive(Debug, Clone)]
#[toolkit_macros::api_dto(request)]
pub struct CreateBookmarkRequest {
    pub url: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
}

/// Request body for updating a bookmark (full replacement).
#[derive(Debug, Clone)]
#[toolkit_macros::api_dto(request)]
pub struct UpdateBookmarkRequest {
    pub url: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
}
```

### 5.2 Handlers (`gears/bookmarks/src/api/rest/handlers/bookmark.rs`)

Add `create_bookmark`, `update_bookmark`, and `delete_bookmark` handlers. Note these do not use OData — they work regardless of the `odata` feature:

```rust
use axum::Extension;
use axum::extract::Path;
use tracing::field::Empty;
use uuid::Uuid;

use bookmarks_sdk::{CreateBookmark, UpdateBookmark};
#[cfg(feature = "odata")]
use toolkit::api::odata::OData;

use super::{ApiResult, Json, BookmarkDto, CreateBookmarkRequest, UpdateBookmarkRequest};
#[cfg(feature = "odata")]
use super::{JsonBody, JsonPage, apply_select, page_to_projected_json};
use crate::gear::ConcreteAppServices;

/// List bookmarks with cursor-based pagination and optional field projection via $select
#[cfg(feature = "odata")]
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
#[cfg(feature = "odata")]
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

/// Create a new bookmark
#[tracing::instrument(skip(svc, input), fields(request_id = Empty))]
pub async fn create_bookmark(
    Extension(svc): Extension<std::sync::Arc<ConcreteAppServices>>,
    Json(input): Json<CreateBookmarkRequest>,
) -> ApiResult<Json<BookmarkDto>> {
    let bookmark = svc
        .bookmarks
        .create_bookmark(CreateBookmark {
            url: input.url,
            title: input.title,
            description: input.description,
        })
        .await?;
    Ok(Json(BookmarkDto::from(bookmark)))
}

/// Update an existing bookmark (full replacement)
#[tracing::instrument(skip(svc, input), fields(bookmark.id = %id, request_id = Empty))]
pub async fn update_bookmark(
    Extension(svc): Extension<std::sync::Arc<ConcreteAppServices>>,
    Path(id): Path<Uuid>,
    Json(input): Json<UpdateBookmarkRequest>,
) -> ApiResult<Json<BookmarkDto>> {
    let bookmark = svc
        .bookmarks
        .update_bookmark(
            id,
            UpdateBookmark {
                url: input.url,
                title: input.title,
                description: input.description,
            },
        )
        .await?;
    Ok(Json(BookmarkDto::from(bookmark)))
}

/// Delete a bookmark by ID
#[tracing::instrument(skip(svc), fields(bookmark.id = %id, request_id = Empty))]
pub async fn delete_bookmark(
    Extension(svc): Extension<std::sync::Arc<ConcreteAppServices>>,
    Path(id): Path<Uuid>,
) -> ApiResult<http::StatusCode> {
    svc.bookmarks.delete_bookmark(id).await?;
    Ok(http::StatusCode::NO_CONTENT)
}
```

### 5.3 Handler re-exports (`gears/bookmarks/src/api/rest/handlers/mod.rs`)

Add the new DTOs and handlers. The CUD handlers are not gated behind `odata` — they work unconditionally:

```rust
use crate::api::rest::dto::{BookmarkDto, CreateBookmarkRequest, UpdateBookmarkRequest};

use toolkit::api::canonical_prelude::*;
#[cfg(feature = "odata")]
use toolkit::api::select::{apply_select, page_to_projected_json};

mod bookmark;

// ==================== Bookmark Handlers ====================

#[cfg(feature = "odata")]
pub(crate) use bookmark::get_bookmark;
#[cfg(feature = "odata")]
pub(crate) use bookmark::list_bookmarks;
pub(crate) use bookmark::create_bookmark;
pub(crate) use bookmark::update_bookmark;
pub(crate) use bookmark::delete_bookmark;
```

### 5.4 Routes (`gears/bookmarks/src/api/rest/routes/bookmark.rs`)

Register POST, PUT, and DELETE routes alongside the existing GET routes:

```rust
use super::{dto, handlers};
#[cfg(feature = "odata")]
use bookmarks_sdk::odata::BookmarkFilterField;
use axum::Router;
use toolkit::api::OpenApiRegistry;
use toolkit::api::operation_builder::OperationBuilder;
#[cfg(feature = "odata")]
use toolkit::api::operation_builder::OperationBuilderODataExt;

pub(super) fn register_bookmark_routes(mut router: Router, openapi: &dyn OpenApiRegistry) -> Router {
    // GET /bookmarks/v1/bookmarks - List bookmarks with cursor-based pagination
    #[cfg(feature = "odata")]
    {
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
    }

    // POST /bookmarks/v1/bookmarks - Create a bookmark
    router = OperationBuilder::post("/bookmarks/v1/bookmarks")
        .operation_id("bookmarks.create_bookmark")
        .summary("Create a bookmark")
        .description("Create a new bookmark with the provided URL, title, and optional description")
        .tag("bookmarks")
        .public()
        .handler(handlers::create_bookmark)
        .json_request::<dto::CreateBookmarkRequest>(openapi, "Bookmark to create")
        .json_response_with_schema::<dto::BookmarkDto>(
            openapi,
            http::StatusCode::CREATED,
            "Bookmark created",
        )
        .error_400(openapi)
        .error_422(openapi)
        .error_500(openapi)
        .register(router, openapi);

    // PUT /bookmarks/v1/bookmarks/{id} - Update a bookmark
    router = OperationBuilder::put("/bookmarks/v1/bookmarks/{id}")
        .operation_id("bookmarks.update_bookmark")
        .summary("Update a bookmark")
        .description("Replace all fields of an existing bookmark")
        .tag("bookmarks")
        .public()
        .path_param("id", "Bookmark UUID")
        .handler(handlers::update_bookmark)
        .json_request::<dto::UpdateBookmarkRequest>(openapi, "Updated bookmark data")
        .json_response_with_schema::<dto::BookmarkDto>(
            openapi,
            http::StatusCode::OK,
            "Bookmark updated",
        )
        .error_400(openapi)
        .error_404(openapi)
        .error_422(openapi)
        .error_500(openapi)
        .register(router, openapi);

    // DELETE /bookmarks/v1/bookmarks/{id} - Delete a bookmark
    router = OperationBuilder::delete("/bookmarks/v1/bookmarks/{id}")
        .operation_id("bookmarks.delete_bookmark")
        .summary("Delete a bookmark")
        .description("Delete an existing bookmark by its UUID")
        .tag("bookmarks")
        .public()
        .path_param("id", "Bookmark UUID")
        .handler(handlers::delete_bookmark)
        .no_content_response(http::StatusCode::NO_CONTENT, "Bookmark deleted")
        .error_404(openapi)
        .error_500(openapi)
        .register(router, openapi);

    router
}
```

### 5.5 Routes module (`gears/bookmarks/src/api/rest/routes/mod.rs`)

Remove the `odata` feature gate from the routes module — the CUD routes always compile:

```rust
//! REST API route definitions - OpenAPI and Axum routing.

use crate::api::rest::{dto, handlers};
use crate::gear::ConcreteAppServices;
use axum::Router;
use toolkit::api::OpenApiRegistry;
use std::sync::Arc;

mod bookmark;

/// Register all routes for the bookmarks gear
pub(crate) fn register_routes(
    mut router: Router,
    openapi: &dyn OpenApiRegistry,
    services: Arc<ConcreteAppServices>,
) -> Router {
    router = bookmark::register_bookmark_routes(router, openapi);
    router = router.layer(axum::Extension(services));
    router
}
```

## 6. Build and test

```bash
cargo gears build
cargo gears run
```

Test the new endpoints:

```bash
# Create a bookmark
curl -s -X POST "http://localhost:8080/bookmarks/v1/bookmarks" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://github.com", "title": "GitHub", "description": "Code hosting platform"}' \
  | jq .

# Update a bookmark (use the id from the create response)
curl -s -X PUT "http://localhost:8080/bookmarks/v1/bookmarks/<id>" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://github.com", "title": "GitHub - Where the world builds software", "description": "The complete developer platform"}' \
  | jq .

# Delete a bookmark
curl -s -X DELETE "http://localhost:8080/bookmarks/v1/bookmarks/<id>" -w "\nHTTP %{http_code}\n"

# Verify deletion
curl -s "http://localhost:8080/bookmarks/v1/bookmarks" | jq '.items | length'
```

## What you've added

Across 12 files, you extended each layer of the DDD-light architecture:

| Layer | What changed |
|---|---|
| **SDK** | `CreateBookmark` and `UpdateBookmark` input types, three new client trait methods |
| **Domain** | Repository trait + service methods with input validation |
| **Infrastructure** | SeaORM `ActiveModel` insert/update, scoped delete |
| **API** | Request DTOs, three handlers, POST/PUT/DELETE routes with OpenAPI specs |

The pattern is consistent: every write operation flows through **DTO → service (validation) → repository (ORM) → database**, with the SDK trait ensuring other gears can reuse the same operations programmatically.

## Next steps

- Add PATCH support for partial updates
- Implement optimistic concurrency with `updated_at` ETags
- Add a background worker gear that periodically checks bookmark URLs (see the link-checker pattern in the [Toolkit documentation](/toolkit/))

## Appendix A: Enabling authentication

The Brown guide uses `auth_disabled: true` and `AccessScope::allow_all()` for simplicity. This appendix shows how to make the CUD endpoints authentication-aware, so each request carries a real identity and writes are scoped to the caller's tenant.

GET and LIST stay public — anyone can browse bookmarks. Create, update, and delete require a valid bearer token.

### A.1 Routes — mark CUD as authenticated

In `gears/bookmarks/src/api/rest/routes/bookmark.rs`, replace `.public()` with `.authenticated()` on the three write routes:

```rust
    // POST /bookmarks/v1/bookmarks - Create a bookmark
    router = OperationBuilder::post("/bookmarks/v1/bookmarks")
        .operation_id("bookmarks.create_bookmark")
        .summary("Create a bookmark")
        .description("Create a new bookmark with the provided URL, title, and optional description")
        .tag("bookmarks")
        .authenticated()  // [!code focus]
        // ... rest unchanged

    // PUT /bookmarks/v1/bookmarks/{id} - Update a bookmark
    router = OperationBuilder::put("/bookmarks/v1/bookmarks/{id}")
        .operation_id("bookmarks.update_bookmark")
        .summary("Update a bookmark")
        .description("Replace all fields of an existing bookmark")
        .tag("bookmarks")
        .authenticated()  // [!code focus]
        // ... rest unchanged

    // DELETE /bookmarks/v1/bookmarks/{id} - Delete a bookmark
    router = OperationBuilder::delete("/bookmarks/v1/bookmarks/{id}")
        .operation_id("bookmarks.delete_bookmark")
        .summary("Delete a bookmark")
        .description("Delete an existing bookmark by its UUID")
        .tag("bookmarks")
        .authenticated()  // [!code focus]
        // ... rest unchanged
```

When authentication is enabled, the api-gateway middleware validates the bearer token on these routes and injects a `SecurityContext` into the request extensions. Public routes receive `SecurityContext::anonymous()` instead.

### A.2 Handlers — extract the security context

Import `SecurityContext` in the handlers module. In `gears/bookmarks/src/api/rest/handlers/mod.rs`:

```rust
use crate::api::rest::dto::{BookmarkDto, CreateBookmarkRequest, UpdateBookmarkRequest};

use toolkit::api::canonical_prelude::*;
#[cfg(feature = "odata")]
use toolkit::api::select::{apply_select, page_to_projected_json};
use toolkit_security::SecurityContext; // [!code focus]

mod bookmark;
// ... rest unchanged
```

Then update the three CUD handlers in `gears/bookmarks/src/api/rest/handlers/bookmark.rs` to extract and forward the context:

```rust
use super::{ApiResult, Json, BookmarkDto, CreateBookmarkRequest,
    SecurityContext, UpdateBookmarkRequest}; // [!code focus]

// ...

/// Create a new bookmark
#[tracing::instrument(skip(svc, ctx, input), fields(request_id = Empty))]
pub async fn create_bookmark(
    Extension(ctx): Extension<SecurityContext>, // [!code focus]
    Extension(svc): Extension<std::sync::Arc<ConcreteAppServices>>,
    Json(input): Json<CreateBookmarkRequest>,
) -> ApiResult<Json<BookmarkDto>> {
    let bookmark = svc
        .bookmarks
        .create_bookmark(&ctx, CreateBookmark { // [!code focus]
            url: input.url,
            title: input.title,
            description: input.description,
        })
        .await?;
    Ok(Json(BookmarkDto::from(bookmark)))
}

/// Update an existing bookmark (full replacement)
#[tracing::instrument(skip(svc, ctx, input), fields(bookmark.id = %id, request_id = Empty))]
pub async fn update_bookmark(
    Extension(ctx): Extension<SecurityContext>, // [!code focus]
    Extension(svc): Extension<std::sync::Arc<ConcreteAppServices>>,
    Path(id): Path<Uuid>,
    Json(input): Json<UpdateBookmarkRequest>,
) -> ApiResult<Json<BookmarkDto>> {
    let bookmark = svc
        .bookmarks
        .update_bookmark(
            &ctx, // [!code focus]
            id,
            UpdateBookmark {
                url: input.url,
                title: input.title,
                description: input.description,
            },
        )
        .await?;
    Ok(Json(BookmarkDto::from(bookmark)))
}

/// Delete a bookmark by ID
#[tracing::instrument(skip(svc, ctx), fields(bookmark.id = %id, request_id = Empty))]
pub async fn delete_bookmark(
    Extension(ctx): Extension<SecurityContext>, // [!code focus]
    Extension(svc): Extension<std::sync::Arc<ConcreteAppServices>>,
    Path(id): Path<Uuid>,
) -> ApiResult<http::StatusCode> {
    svc.bookmarks.delete_bookmark(&ctx, id).await?; // [!code focus]
    Ok(http::StatusCode::NO_CONTENT)
}
```

::: tip
Axum extracts parameters in declaration order. Place `Extension<SecurityContext>` before the body extractor (`Json<...>`) — Axum can only consume the request body once, so non-body extractors must come first.
:::

### A.3 Service — use the caller's identity

Update the service methods to accept `&SecurityContext` and derive the tenant ID and access scope from it. In `gears/bookmarks/src/domain/service/bookmark.rs`:

```rust
use toolkit_security::{AccessScope, SecurityContext}; // [!code focus]
```

Replace the hard-coded `Uuid::nil()` tenant and `AccessScope::allow_all()` in the three CUD methods:

```rust
    #[instrument(skip(self, ctx, input))]
    pub async fn create_bookmark(
        &self,
        ctx: &SecurityContext, // [!code focus]
        input: CreateBookmark,
    ) -> Result<Bookmark, DomainError> {
        tracing::debug!("Creating bookmark");

        if input.url.is_empty() {
            return Err(DomainError::validation("url", "must not be empty"));
        }
        if input.title.is_empty() {
            return Err(DomainError::validation("title", "must not be empty"));
        }

        let now = OffsetDateTime::now_utc();
        let bookmark = Bookmark {
            id: Uuid::new_v4(),
            tenant_id: ctx.subject_tenant_id(), // [!code focus]
            url: input.url,
            title: input.title,
            description: input.description,
            created_at: now,
            updated_at: now,
        };

        let conn = self.db.conn().map_err(DomainError::from)?;
        let scope = AccessScope::for_tenant(ctx.subject_tenant_id()); // [!code focus]
        let created = self.repo.create(&conn, &scope, bookmark).await?;

        tracing::debug!("Successfully created bookmark");
        Ok(created)
    }

    #[instrument(skip(self, ctx, input), fields(bookmark_id = %id))]
    pub async fn update_bookmark(
        &self,
        ctx: &SecurityContext, // [!code focus]
        id: Uuid,
        input: UpdateBookmark,
    ) -> Result<Bookmark, DomainError> {
        tracing::debug!("Updating bookmark");

        if input.url.is_empty() {
            return Err(DomainError::validation("url", "must not be empty"));
        }
        if input.title.is_empty() {
            return Err(DomainError::validation("title", "must not be empty"));
        }

        let conn = self.db.conn().map_err(DomainError::from)?;
        let scope = AccessScope::for_tenant(ctx.subject_tenant_id()); // [!code focus]

        let existing = self
            .repo
            .get(&conn, &scope, id)
            .await?
            .ok_or_else(|| DomainError::not_found(id))?;

        let bookmark = Bookmark {
            id: existing.id,
            tenant_id: existing.tenant_id,
            url: input.url,
            title: input.title,
            description: input.description,
            created_at: existing.created_at,
            updated_at: OffsetDateTime::now_utc(),
        };

        let updated = self.repo.update(&conn, &scope, bookmark).await?;

        tracing::debug!("Successfully updated bookmark");
        Ok(updated)
    }

    #[instrument(skip(self, ctx), fields(bookmark_id = %id))]
    pub async fn delete_bookmark(
        &self,
        ctx: &SecurityContext, // [!code focus]
        id: Uuid,
    ) -> Result<(), DomainError> {
        tracing::debug!("Deleting bookmark");

        let conn = self.db.conn().map_err(DomainError::from)?;
        let scope = AccessScope::for_tenant(ctx.subject_tenant_id()); // [!code focus]

        let deleted = self.repo.delete(&conn, &scope, id).await?;
        if !deleted {
            return Err(DomainError::not_found(id));
        }

        tracing::debug!("Successfully deleted bookmark");
        Ok(())
    }
```

The GET and LIST methods can remain unchanged — they use `AccessScope::allow_all()` since the read routes are public.

### A.4 Local client — forward the context

Update the local client to pass `SecurityContext` through. In `gears/bookmarks/sdk/src/client.rs`, add a `ctx` parameter to the three CUD trait methods:

```rust
use crate::{Bookmark, BookmarkError, CreateBookmark, UpdateBookmark};
use toolkit::async_trait;
use toolkit_odata::{ODataQuery, Page};
use toolkit_security::SecurityContext; // [!code focus]
use uuid::Uuid;

#[async_trait]
pub trait BookmarkClientV1: Send + Sync {
    // ... get_bookmark and list_bookmarks unchanged ...

    async fn create_bookmark(
        &self,
        ctx: &SecurityContext, // [!code focus]
        input: CreateBookmark,
    ) -> Result<Bookmark, BookmarkError>;

    async fn update_bookmark(
        &self,
        ctx: &SecurityContext, // [!code focus]
        id: Uuid,
        input: UpdateBookmark,
    ) -> Result<Bookmark, BookmarkError>;

    async fn delete_bookmark(
        &self,
        ctx: &SecurityContext, // [!code focus]
        id: Uuid,
    ) -> Result<(), BookmarkError>;
}
```

Then update the local client implementation in `gears/bookmarks/src/domain/local_client/client.rs` to forward:

```rust
    async fn create_bookmark(
        &self,
        ctx: &SecurityContext, // [!code focus]
        input: CreateBookmark,
    ) -> Result<Bookmark, BookmarkError> {
        self.services
            .bookmarks
            .create_bookmark(ctx, input) // [!code focus]
            .await
            .map_err(BookmarkError::from)
    }

    async fn update_bookmark(
        &self,
        ctx: &SecurityContext, // [!code focus]
        id: Uuid,
        input: UpdateBookmark,
    ) -> Result<Bookmark, BookmarkError> {
        self.services
            .bookmarks
            .update_bookmark(ctx, id, input) // [!code focus]
            .await
            .map_err(BookmarkError::from)
    }

    async fn delete_bookmark(
        &self,
        ctx: &SecurityContext, // [!code focus]
        id: Uuid,
    ) -> Result<(), BookmarkError> {
        self.services
            .bookmarks
            .delete_bookmark(ctx, id) // [!code focus]
            .await
            .map_err(BookmarkError::from)
    }
```

### A.5 Config — enable the auth middleware

In `config/bookmarks.yml`, remove `auth_disabled: true` (or set it to `false`):

```yaml
gears:
  api-gateway:
    config:
      bind_addr: 0.0.0.0:8080
      # auth_disabled removed — authentication is now active
```

With this change, the api-gateway middleware will:
- Validate bearer tokens on `.authenticated()` routes via the **authn-resolver** system gear
- Reject unauthenticated requests with `401 Unauthorized`
- Inject `SecurityContext::anonymous()` on `.public()` routes (GET/LIST still work without a token)

::: warning
Enabling authentication requires a running **authn-resolver** gear configured with your identity provider (OAuth2/OIDC). Setting up the IdP integration is beyond the scope of this guide — see the [authn-resolver documentation](/toolkit/system-gears/authn-resolver) for configuration details.
:::

### What changed

| Layer | Before (Brown guide) | After (auth-enabled) |
|---|---|---|
| **Routes** | `.public()` on all routes | `.authenticated()` on CUD routes |
| **Handlers** | No identity extraction | `Extension<SecurityContext>` on CUD handlers |
| **Service** | `Uuid::nil()` tenant, `AccessScope::allow_all()` | `ctx.subject_tenant_id()`, `AccessScope::for_tenant(...)` |
| **SDK client** | No context parameter | `&SecurityContext` on CUD methods |
| **Config** | `auth_disabled: true` | Auth enabled (default) |

The repository and infrastructure layers are **unchanged** — they already accept `AccessScope` and enforce tenant isolation through the toolkit's secure helpers. The only difference is that the scope now carries a real tenant constraint instead of `allow_all()`.

::: info Going further — policy-based authorization
This appendix uses `AccessScope::for_tenant()` to derive the scope directly from the caller's identity. For fine-grained authorization (role-based access, resource ownership, cross-tenant delegation), the toolkit provides a **PolicyEnforcer** that calls an external Policy Decision Point (PDP) and returns a narrowly-scoped `AccessScope` based on configured policies. See the [users-info example](https://github.com/nicholasgasior/gears-rust/tree/dev/examples/toolkit/users-info) for the full PDP integration pattern.
:::
