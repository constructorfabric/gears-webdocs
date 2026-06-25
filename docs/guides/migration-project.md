---
outline: deep
---

# Migration Project: Go to Gears

Migrate a small Go REST API to the Gears framework. By the end of this guide you will understand how Go patterns map to Gears' DDD-light architecture, and have a clear strategy for migrating real services.

## What you'll migrate

A **task manager** — a standalone Go service with:

- CRUD endpoints for tasks (title, description, status)
- PostgreSQL storage via GORM
- Simple API-key authentication middleware
- ~250 lines of Go

We chose a task manager because the domain is small enough to fit in a guide, but rich enough to exercise every Gears layer: SDK, domain, infrastructure, and API.

## The Go service

Here is the complete Go service we will migrate. Read through it to understand the structure — the rest of the guide maps each piece to its Gears equivalent.

### `main.go`

```go
package main

import (
    "log"
    "net/http"
    "os"

    "github.com/gin-gonic/gin"
    "gorm.io/driver/postgres"
    "gorm.io/gorm"
)

func main() {
    dsn := os.Getenv("DATABASE_URL")
    db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
    if err != nil {
        log.Fatal("failed to connect to database:", err)
    }
    db.AutoMigrate(&Task{})

    r := gin.Default()

    api := r.Group("/api/v1")
    api.Use(AuthMiddleware())

    api.GET("/tasks", ListTasks(db))
    api.GET("/tasks/:id", GetTask(db))
    api.POST("/tasks", CreateTask(db))
    api.PUT("/tasks/:id", UpdateTask(db))
    api.DELETE("/tasks/:id", DeleteTask(db))

    r.Run(":8080")
}
```

### `model.go`

```go
package main

import (
    "time"

    "github.com/google/uuid"
    "gorm.io/gorm"
)

type TaskStatus string

const (
    StatusPending    TaskStatus = "pending"
    StatusInProgress TaskStatus = "in_progress"
    StatusDone       TaskStatus = "done"
)

type Task struct {
    ID          uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
    TenantID    uuid.UUID  `gorm:"type:uuid;index"      json:"tenant_id"`
    Title       string     `gorm:"not null"              json:"title"`
    Description string     `                             json:"description"`
    Status      TaskStatus `gorm:"default:pending"       json:"status"`
    CreatedAt   time.Time  `                             json:"created_at"`
    UpdatedAt   time.Time  `                             json:"updated_at"`
}

func (t *Task) BeforeCreate(tx *gorm.DB) error {
    if t.ID == uuid.Nil {
        t.ID = uuid.New()
    }
    return nil
}
```

### `handlers.go`

```go
package main

import (
    "net/http"

    "github.com/gin-gonic/gin"
    "github.com/google/uuid"
    "gorm.io/gorm"
)

type CreateTaskRequest struct {
    Title       string `json:"title"       binding:"required"`
    Description string `json:"description"`
}

type UpdateTaskRequest struct {
    Title       string     `json:"title"       binding:"required"`
    Description string     `json:"description"`
    Status      TaskStatus `json:"status"      binding:"required"`
}

func ListTasks(db *gorm.DB) gin.HandlerFunc {
    return func(c *gin.Context) {
        tenantID := c.GetString("tenant_id")
        var tasks []Task
        db.Where("tenant_id = ?", tenantID).Find(&tasks)
        c.JSON(http.StatusOK, tasks)
    }
}

func GetTask(db *gorm.DB) gin.HandlerFunc {
    return func(c *gin.Context) {
        tenantID := c.GetString("tenant_id")
        id, err := uuid.Parse(c.Param("id"))
        if err != nil {
            c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
            return
        }

        var task Task
        result := db.Where("id = ? AND tenant_id = ?", id, tenantID).First(&task)
        if result.Error != nil {
            c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
            return
        }
        c.JSON(http.StatusOK, task)
    }
}

func CreateTask(db *gorm.DB) gin.HandlerFunc {
    return func(c *gin.Context) {
        tenantID := c.GetString("tenant_id")
        var req CreateTaskRequest
        if err := c.ShouldBindJSON(&req); err != nil {
            c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
            return
        }

        tid, _ := uuid.Parse(tenantID)
        task := Task{
            TenantID:    tid,
            Title:       req.Title,
            Description: req.Description,
            Status:      StatusPending,
        }
        db.Create(&task)
        c.JSON(http.StatusCreated, task)
    }
}

func UpdateTask(db *gorm.DB) gin.HandlerFunc {
    return func(c *gin.Context) {
        tenantID := c.GetString("tenant_id")
        id, err := uuid.Parse(c.Param("id"))
        if err != nil {
            c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
            return
        }

        var task Task
        result := db.Where("id = ? AND tenant_id = ?", id, tenantID).First(&task)
        if result.Error != nil {
            c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
            return
        }

        var req UpdateTaskRequest
        if err := c.ShouldBindJSON(&req); err != nil {
            c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
            return
        }

        task.Title = req.Title
        task.Description = req.Description
        task.Status = req.Status
        db.Save(&task)
        c.JSON(http.StatusOK, task)
    }
}

func DeleteTask(db *gorm.DB) gin.HandlerFunc {
    return func(c *gin.Context) {
        tenantID := c.GetString("tenant_id")
        id, err := uuid.Parse(c.Param("id"))
        if err != nil {
            c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
            return
        }

        result := db.Where("id = ? AND tenant_id = ?", id, tenantID).Delete(&Task{})
        if result.RowsAffected == 0 {
            c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
            return
        }
        c.Status(http.StatusNoContent)
    }
}
```

### `middleware.go`

```go
package main

import (
    "net/http"

    "github.com/gin-gonic/gin"
)

func AuthMiddleware() gin.HandlerFunc {
    return func(c *gin.Context) {
        apiKey := c.GetHeader("X-API-Key")
        if apiKey == "" {
            c.AbortWithStatusJSON(http.StatusUnauthorized,
                gin.H{"error": "missing API key"})
            return
        }

        // In production: validate the key and resolve tenant
        tenantID := resolveTenant(apiKey)
        c.Set("tenant_id", tenantID)
        c.Next()
    }
}

func resolveTenant(apiKey string) string {
    // Stub — in reality this would look up the key
    return "00000000-0000-0000-0000-000000000001"
}
```

## Pattern mapping

Before diving into code, here is how Go patterns map to their Gears equivalents:

| Go | Gears | Notes |
|---|---|---|
| `main.go` — routes, DB init, server start | `gear.rs` + `Gears.toml` + runtime config | The framework handles server lifecycle, DB connection pooling, and route mounting |
| `model.go` — GORM model with struct tags | SeaORM entity + domain model + SDK model | Three models serve different purposes (see [layer separation](#1-understand-the-architecture)) |
| `handlers.go` — Gin handlers, JSON binding | `api/rest/handlers/` — Axum handlers, DTO types | Handlers become thin: parse request, call service, return response |
| `middleware.go` — auth, tenant resolution | `api-gateway` + `authn-resolver` system gears | Auth is a system-level concern, not per-service middleware |
| `gin.HandlerFunc` closures capturing `*gorm.DB` | Axum extractors + DI via `AppServices` | No DB handle passing — services receive connections through the toolkit |
| `db.Where("tenant_id = ?", ...)` — manual tenant filtering | `AccessScope` + secure helpers | Tenant isolation is enforced by the framework, not by query discipline |
| `gin.H{"error": ...}` — ad-hoc error JSON | RFC 9457 Problem Details | Structured, machine-readable errors with standard HTTP status mapping |
| `c.ShouldBindJSON(&req)` — runtime validation | `serde` + `utoipa` — compile-time serialization with OpenAPI | Type-safe deserialization with generated API documentation |
| No filtering/pagination | OData `$filter`, `$orderby`, `$top`, `$skip` | Free with the toolkit — no manual query parameter parsing |

## Migration strategy

### 1. Understand the architecture

The Go service is a single package — model, handlers, middleware, and main all live together. Gears splits this into layers with clear responsibilities:

```
Go (flat)                    Gears (layered)
─────────                    ───────────────
model.go         ──────►     sdk/src/models.rs        (public contract)
                             domain/models.rs         (internal domain model, if needed)
                             infra/storage/entity/    (database model)

handlers.go      ──────►     api/rest/handlers/       (thin HTTP adapters)
                             api/rest/dto.rs          (request/response DTOs)
                             domain/service/          (business logic)
                             domain/repos/            (repository trait)
                             infra/storage/           (repository implementation)

middleware.go    ──────►     (system gears handle this)

main.go          ──────►     gear.rs                  (declaration only)
                             Gears.toml               (wiring)
                             config/*.yml             (runtime config)
```

This separation pays off as the service grows: the domain layer stays testable without HTTP or database dependencies, the SDK lets other gears call yours in-process, and tenant isolation is enforced at the framework level rather than scattered across queries.

### 2. Scaffold the gear

Start exactly like the [Green Project](./green-project):

```bash
cargo gears new tasks-app
cd tasks-app
cargo gears generate gear --template api-db-handler --name tasks
```

Generate the database config:

```bash
rm config/quickstart.yml
cargo gears generate config --template db --name tasks
```

Update `config/tasks.yml` to set the database name:

```yaml
database:
  servers:
    main:
      engine: postgres
      host: localhost
      port: 5432
      user: postgres
      password: ${DB_PASSWORD}
      dbname: tasks
```

Add the gateway config:

```yaml
gears:
  api-gateway:
    config:
      bind_addr: "0.0.0.0:8080"
      auth_disabled: true
```

Register in `Gears.toml`:

```toml
[workspace]
version = 1

[apps.tasks.dev]
config = "tasks.yml"
gears = [
    { source = "remote", name = "types-registry", package = "cf-gears-types-registry", version = "0.1.22" },
    { source = "remote", name = "authn-resolver", package = "cf-gears-authn-resolver", version = "0.2.16" },
    { source = "remote", name = "grpc-hub", package = "cf-gears-grpc-hub", version = "0.2.6" },
    { source = "remote", name = "api-gateway", package = "cf-gears-api-gateway", version = "0.2.7" },

    { source = "local", name = "tasks", features = ["postgres"] },
]
```

### 3. Migrate layer by layer

Work from the outside in: SDK → domain → infrastructure → API. This is the opposite of how the Go code was likely written (model → handlers → main), but it follows the Gears principle of **SDK-first** design.

#### 3.1 SDK models (`gears/tasks/sdk/src/models.rs`)

The Go `Task` struct maps to three Rust types — one for the public contract, two for input:

```rust
use time::OffsetDateTime;
use uuid::Uuid;

/// Task status — maps to the Go `TaskStatus` string constants.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskStatus {
    Pending,
    InProgress,
    Done,
}

/// A task entity (public contract).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Task {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub title: String,
    pub description: String,
    pub status: TaskStatus,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

/// Input for creating a task.
/// Maps to Go's `CreateTaskRequest`.
#[derive(Debug, Clone)]
pub struct CreateTask {
    pub title: String,
    pub description: String,
}

/// Input for updating a task.
/// Maps to Go's `UpdateTaskRequest`.
#[derive(Debug, Clone)]
pub struct UpdateTask {
    pub title: String,
    pub description: String,
    pub status: TaskStatus,
}
```

Key differences from Go:

- `TaskStatus` is an enum, not a string type — invalid values are rejected at compile time
- `CreateTask` and `UpdateTask` are separate types, not the GORM model reused for input
- `description` is not `Option<String>` — we use an empty string instead of SQL NULL (simpler)

#### 3.2 SDK client trait (`gears/tasks/sdk/src/client.rs`)

The Go service has no client interface — callers use HTTP directly. Gears adds an in-process client so other gears can call yours without network overhead:

```rust
use toolkit::async_trait;
use uuid::Uuid;

use crate::errors::TaskError;
use crate::models::{CreateTask, Task, UpdateTask};

#[async_trait]
pub trait TaskClientV1: Send + Sync {
    async fn get(&self, id: Uuid) -> Result<Task, TaskError>;
    async fn create(&self, input: CreateTask) -> Result<Task, TaskError>;
    async fn update(&self, id: Uuid, input: UpdateTask) -> Result<Task, TaskError>;
    async fn delete(&self, id: Uuid) -> Result<(), TaskError>;
}
```

This trait maps directly to the Go handler set, minus the tenant parameter — Gears resolves tenant identity from the security context.

#### 3.3 Domain: repository trait (`gears/tasks/src/domain/repos/task_repo.rs`)

The Go service queries the database directly in handlers. Gears separates the contract (what the domain needs) from the implementation (how it talks to the DB):

```rust
use toolkit_db::secure::DBRunner;
use toolkit_security::AccessScope;
use uuid::Uuid;

use crate::domain::error::DomainError;
use crate::domain::models::Task;

#[async_trait::async_trait]
pub trait TaskRepo: Send + Sync {
    async fn find_by_id<C: DBRunner>(
        &self,
        runner: &C,
        scope: &AccessScope,
        id: Uuid,
    ) -> Result<Option<Task>, DomainError>;

    async fn create<C: DBRunner>(
        &self,
        runner: &C,
        scope: &AccessScope,
        task: Task,
    ) -> Result<Task, DomainError>;

    async fn update<C: DBRunner>(
        &self,
        runner: &C,
        scope: &AccessScope,
        task: Task,
    ) -> Result<Task, DomainError>;

    async fn delete<C: DBRunner>(
        &self,
        runner: &C,
        scope: &AccessScope,
        id: Uuid,
    ) -> Result<(), DomainError>;
}
```

Notice `AccessScope` — this replaces the manual `WHERE tenant_id = ?` in the Go code. The framework enforces tenant isolation through the secure ORM layer.

#### 3.4 Domain: service (`gears/tasks/src/domain/service/task.rs`)

The business logic that was scattered across Go handlers moves into a service. This is where the Go handler bodies land — but without HTTP concerns:

```rust
use toolkit_db::secure::DBRunner;
use toolkit_security::AccessScope;
use uuid::Uuid;

use crate::domain::error::DomainError;
use crate::domain::models::Task;
use crate::domain::repos::task_repo::TaskRepo;

pub struct TaskService {
    repo: Box<dyn TaskRepo>,
}

impl TaskService {
    pub fn new(repo: Box<dyn TaskRepo>) -> Self {
        Self { repo }
    }

    pub async fn get<C: DBRunner>(
        &self,
        conn: &C,
        scope: &AccessScope,
        id: Uuid,
    ) -> Result<Task, DomainError> {
        self.repo
            .find_by_id(conn, scope, id)
            .await?
            .ok_or(DomainError::NotFound(id))
    }

    pub async fn create<C: DBRunner>(
        &self,
        conn: &C,
        scope: &AccessScope,
        title: String,
        description: String,
    ) -> Result<Task, DomainError> {
        let task = Task {
            id: Uuid::new_v4(),
            tenant_id: Uuid::nil(), // set by secure_insert
            title,
            description,
            status: TaskStatus::Pending,
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
        };
        self.repo.create(conn, scope, task).await
    }
}
```

Compare this with the Go `CreateTask` handler — the HTTP parsing (`ShouldBindJSON`), tenant resolution (`c.GetString("tenant_id")`), and response formatting (`c.JSON`) are all gone. The service works with domain types only.

#### 3.5 Infrastructure: SeaORM entity (`gears/tasks/src/infra/storage/entity/task.rs`)

The Go GORM model maps to a SeaORM entity. Where GORM uses struct tags, SeaORM uses derive macros:

```rust
use sea_orm::entity::prelude::*;
use time::OffsetDateTime;

#[derive(Debug, Clone, PartialEq, Eq, EnumIter, DeriveActiveEnum)]
#[sea_orm(rs_type = "String", db_type = "String(StringLen::N(20))")]
pub enum TaskStatus {
    #[sea_orm(string_value = "pending")]
    Pending,
    #[sea_orm(string_value = "in_progress")]
    InProgress,
    #[sea_orm(string_value = "done")]
    Done,
}

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "tasks")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub title: String,
    pub description: String,
    pub status: TaskStatus,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
```

GORM's `BeforeCreate` hook (UUID generation) moves to the service layer — SeaORM entities are pure data.

#### 3.6 Infrastructure: repository implementation (`gears/tasks/src/infra/storage/task_sea_repo.rs`)

This is where `db.Where(...)` / `db.Create(...)` / `db.Save(...)` / `db.Delete(...)` go. But instead of raw queries with manual tenant filtering, we use the toolkit's secure helpers:

```rust
use sea_orm::{EntityTrait, QueryFilter, Set};
use toolkit_db::secure::{
    DBRunner, SecureDeleteExt, SecureEntityExt, secure_insert, secure_update_with_scope,
};
use toolkit_security::AccessScope;
use uuid::Uuid;

use super::entity::task::{self, ActiveModel, Entity as TaskEntity};
use crate::domain::error::DomainError;
use crate::domain::models::Task;
use crate::domain::repos::task_repo::TaskRepo;

pub struct TaskSeaRepo;

#[async_trait::async_trait]
impl TaskRepo for TaskSeaRepo {
    async fn find_by_id<C: DBRunner>(
        &self,
        runner: &C,
        scope: &AccessScope,
        id: Uuid,
    ) -> Result<Option<Task>, DomainError> {
        let result = TaskEntity::find_by_id(id)
            .secure()
            .scope_with(scope)
            .one(runner)
            .await?;
        Ok(result.map(Task::from))
    }

    async fn create<C: DBRunner>(
        &self,
        runner: &C,
        scope: &AccessScope,
        task: Task,
    ) -> Result<Task, DomainError> {
        let am = ActiveModel {
            id: Set(task.id),
            tenant_id: Set(task.tenant_id),
            title: Set(task.title),
            description: Set(task.description),
            status: Set(task.status.into()),
            created_at: Set(task.created_at),
            updated_at: Set(task.updated_at),
        };
        let model = secure_insert::<TaskEntity>(am, scope, runner).await?;
        Ok(Task::from(model))
    }

    async fn update<C: DBRunner>(
        &self,
        runner: &C,
        scope: &AccessScope,
        task: Task,
    ) -> Result<Task, DomainError> {
        let am = ActiveModel {
            id: Set(task.id),
            tenant_id: Set(task.tenant_id),
            title: Set(task.title),
            description: Set(task.description),
            status: Set(task.status.into()),
            created_at: Set(task.created_at),
            updated_at: Set(task.updated_at),
        };
        let model = secure_update_with_scope::<TaskEntity>(am, scope, task.id, runner).await?;
        Ok(Task::from(model))
    }

    async fn delete<C: DBRunner>(
        &self,
        runner: &C,
        scope: &AccessScope,
        id: Uuid,
    ) -> Result<(), DomainError> {
        TaskEntity::delete_many()
            .filter(task::Column::Id.eq(id))
            .secure()
            .scope_with(scope)
            .exec(runner)
            .await?;
        Ok(())
    }
}
```

Compare with the Go `DeleteTask` handler:

```go
// Go: manual tenant filter
db.Where("id = ? AND tenant_id = ?", id, tenantID).Delete(&Task{})

// Gears: framework-enforced tenant scope
TaskEntity::delete_many()
    .filter(task::Column::Id.eq(id))
    .secure()              // ← enables tenant isolation
    .scope_with(scope)     // ← applies the tenant from SecurityContext
    .exec(runner)
    .await?;
```

The `tenant_id` filter is added automatically — a developer cannot accidentally forget it.

#### 3.7 API: DTOs (`gears/tasks/src/api/rest/dto.rs`)

The Go request structs (`CreateTaskRequest`, `UpdateTaskRequest`) become Rust DTOs with serde and utoipa for automatic OpenAPI generation:

```rust
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Serialize, ToSchema)]
pub struct TaskDto {
    pub id: Uuid,
    pub title: String,
    pub description: String,
    pub status: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateTaskDto {
    pub title: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateTaskDto {
    pub title: String,
    pub description: Option<String>,
    pub status: String,
}
```

Unlike Go's `binding:"required"` tags (runtime validation), Rust's type system enforces required fields at compile time — if `title` is not in the JSON payload, deserialization fails before your code runs.

#### 3.8 API: handlers (`gears/tasks/src/api/rest/handlers/task.rs`)

The Go handler functions become thin Axum handlers. Each one does three things: parse the request, call the service, format the response. No business logic lives here:

```rust
use axum::extract::Path;
use toolkit::web::{json_request, json_response, no_content_response};

use crate::api::rest::dto::{CreateTaskDto, TaskDto, UpdateTaskDto};
use crate::domain::service::AppServices;

pub async fn get_task(
    services: AppServices,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, Problem> {
    let conn = services.db_conn().await?;
    let scope = AccessScope::allow_all();
    let task = services.task_service().get(&conn, &scope, id).await?;
    json_response(&TaskDto::from(task))
}

pub async fn create_task(
    services: AppServices,
    json_request(dto): json_request<CreateTaskDto>,
) -> Result<impl IntoResponse, Problem> {
    let conn = services.db_conn().await?;
    let scope = AccessScope::allow_all();
    let task = services
        .task_service()
        .create(&conn, &scope, dto.title, dto.description.unwrap_or_default())
        .await?;
    json_response(&TaskDto::from(task))
}

pub async fn delete_task(
    services: AppServices,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, Problem> {
    let conn = services.db_conn().await?;
    let scope = AccessScope::allow_all();
    services.task_service().delete(&conn, &scope, id).await?;
    no_content_response()
}
```

Compare with the Go `GetTask` handler:

```go
// Go: one function does parsing, auth, DB query, error handling, and response
func GetTask(db *gorm.DB) gin.HandlerFunc {
    return func(c *gin.Context) {
        tenantID := c.GetString("tenant_id")         // auth concern
        id, err := uuid.Parse(c.Param("id"))          // parsing
        if err != nil {
            c.JSON(400, gin.H{"error": "invalid id"}) // error formatting
            return
        }
        var task Task
        result := db.Where("id = ? AND tenant_id = ?", id, tenantID).First(&task) // DB + tenant
        if result.Error != nil {
            c.JSON(404, gin.H{"error": "not found"})  // error formatting
            return
        }
        c.JSON(200, task)                              // response
    }
}
```

```rust
// Gears: handler is just plumbing
pub async fn get_task(
    services: AppServices,
    Path(id): Path<Uuid>,                    // parsing (type-safe)
) -> Result<impl IntoResponse, Problem> {
    let conn = services.db_conn().await?;
    let scope = AccessScope::allow_all();    // tenant scope
    let task = services.task_service()
        .get(&conn, &scope, id).await?;      // delegates to service
    json_response(&TaskDto::from(task))      // response
}
```

Auth, error formatting, and tenant filtering are handled by the framework.

#### 3.9 API: routes (`gears/tasks/src/api/rest/routes/task.rs`)

Go's `r.Group("/api/v1")` and route registration become `OperationBuilder` declarations. Each route is self-describing: HTTP method, path, handler, OpenAPI metadata, and auth requirements:

```rust
use toolkit::web::OperationBuilder;

pub fn task_routes() -> Vec<OperationBuilder> {
    vec![
        OperationBuilder::get("/tasks/v1/tasks/:id")
            .handler(get_task)
            .public()
            .tag("Tasks")
            .summary("Get a task by ID"),
        OperationBuilder::post("/tasks/v1/tasks")
            .handler(create_task)
            .public()
            .tag("Tasks")
            .summary("Create a task"),
        OperationBuilder::put("/tasks/v1/tasks/:id")
            .handler(update_task)
            .public()
            .tag("Tasks")
            .summary("Update a task"),
        OperationBuilder::delete("/tasks/v1/tasks/:id")
            .handler(delete_task)
            .public()
            .tag("Tasks")
            .summary("Delete a task"),
    ]
}
```

No manual OpenAPI spec maintenance — the `OperationBuilder` + `utoipa` derive macros generate it.

## What you gain

After migrating, the Gears version gives you several things the Go service had to build or manage manually:

| Concern | Go (manual) | Gears (framework) |
|---|---|---|
| **Tenant isolation** | `WHERE tenant_id = ?` in every query | `AccessScope` + secure ORM — impossible to forget |
| **Authentication** | Custom middleware per service | `api-gateway` + `authn-resolver` — JWT/JWKS with automatic key rotation |
| **Filtering/pagination** | Not implemented | OData `$filter`, `$orderby`, `$top`, `$skip` on every list endpoint |
| **OpenAPI documentation** | Not generated | Auto-generated from route builders and DTO types |
| **Error responses** | Ad-hoc JSON (`gin.H{"error": ...}`) | RFC 9457 Problem Details with standard HTTP status mapping |
| **Database migrations** | `AutoMigrate` (schema-only, no rollback) | Per-gear migration runner with versioned SQL |
| **Health checks** | Not implemented | Built-in liveness and readiness probes |
| **Inter-service calls** | HTTP only | In-process SDK calls via `ClientHub` (zero-copy, no serialization) |
| **Observability** | Not configured | OpenTelemetry integration with `--otel` flag |

## Migration checklist

Use this checklist when migrating your own services:

1. **Inventory endpoints** — list every route, its HTTP method, auth requirement, and request/response shapes
2. **Identify the domain** — extract the core business logic from handlers into a mental model of services and repositories
3. **Scaffold** — `cargo gears new` + `cargo gears generate gear --template api-db-handler`
4. **SDK first** — define public models and client trait. This is your service contract
5. **Domain layer** — migrate business logic into services, define repository traits
6. **Entity + migration** — create SeaORM entities and SQL migrations (replace GORM's `AutoMigrate`)
7. **Repository impl** — implement repository traits using secure helpers
8. **DTOs + handlers** — create request/response types, wire thin handlers
9. **Routes** — register with `OperationBuilder`
10. **Config** — set up `Gears.toml` and runtime YAML
11. **Test** — run `cargo gears run` and verify endpoints with curl or your existing test suite

## Tips for large migrations

For services larger than a tutorial:

- **Migrate one domain at a time.** A Go service with users, orders, and payments becomes three gears. Each gear has its own SDK, database schema, and migration path. Start with the simplest
- **Keep the Go service running.** During migration, run both services side by side. Route traffic gradually using a load balancer or feature flag. The Gears `api-gateway` can coexist with your existing infrastructure
- **Reuse your test suite.** If you have integration tests that call HTTP endpoints, they work unchanged against the Gears service — same endpoints, same JSON, same status codes
- **Don't port Go idioms to Rust.** Go's `if err != nil` becomes `?`. Go interfaces become traits. Go goroutines become `tokio::spawn`. Don't fight the language — learn its patterns. The [Green Project](./green-project) and [Brown Project](./brown-project) guides show idiomatic Gears code
- **Leverage the type system.** Go's runtime validation (`binding:"required"`) becomes compile-time enforcement. Stringly-typed status fields become enums. Embrace this — it catches bugs earlier

## Next steps

- Walk through the [Green Project](./green-project) to build the full application hands-on
- Read [Gear Layout & SDK Pattern](/toolkit/02_gear_layout_and_sdk_pattern) for a deeper look at the architecture
- See [AuthN/AuthZ & Secure ORM](/toolkit/06_authn_authz_secure_orm) to understand the tenant isolation model
- Review [REST Operation Builder](/toolkit/04_rest_operation_builder) for advanced route configuration
