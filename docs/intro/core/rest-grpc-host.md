# REST / gRPC Host

Gears don't own the HTTP or gRPC server. The **API gateway** owns the Axum router and the gRPC service registry. Gears register their routes and services during the [lifecycle](/intro/life-cycle) REST and gRPC phases.

## REST routes with OperationBuilder

Routes are registered using `OperationBuilder`, which integrates type-safe routing with OpenAPI schema generation, auth posture, and error registration in a single chain:

```rust
OperationBuilder::get("/my-gear/v1/items")
    .operation_id("my_gear.list_items")
    .authenticated()
    .require_license_features::<License>([])
    .handler(handlers::list_items)
    .json_response_with_schema::<Page<ItemDto>>(openapi, StatusCode::OK, "Items")
    .with_odata_filter::<ItemDtoFilterField>()
    .standard_errors(openapi)
    .register(router, openapi);
```

### Auth posture

Every route must declare its auth posture before registration:

- `.authenticated()` -- Protected route; requires `.require_license_features()` or `.no_license_required()`
- `.public()` -- No token required

### Content types

| Method | Purpose |
|---|---|
| `.json_request::<T>()` | JSON request body |
| `.json_response_with_schema::<T>()` | JSON response with OpenAPI schema |
| `.multipart_file_request()` | Multipart file upload |
| `.sse_json::<T>()` | Server-Sent Events |
| `.binary_response()` | Binary download |

### Error registration

```rust
.standard_errors(openapi)  // adds 400, 401, 403, 404, 409, 422, 429, 500
.error_404(openapi)        // or individual codes
```

All error responses use [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) Problem Details. See [Errors (RFC 9457)](/toolkit/05_errors_rfc9457) for the full error handling guide.

## Handler conventions

Handlers extract `SecurityContext` and injected services from Axum extensions, and return `ApiResult<T>` which automatically converts domain errors into Problem responses:

```rust
pub async fn get_item(
    Extension(ctx): Extension<SecurityContext>,
    Extension(svc): Extension<Arc<Service>>,
    Path(id): Path<Uuid>,
) -> ApiResult<JsonBody<ItemDto>> {
    let item = svc.get_item(&ctx, id).await?;
    Ok(Json(ItemDto::from(item)))
}
```

## gRPC services

Gears implementing `GrpcServiceCapability` register tonic services during the gRPC phase. gRPC is primarily used for out-of-process inter-gear communication, implementing the same SDK traits as in-process adapters (see [SDK](/intro/core/sdk)).

Security context is propagated via gRPC metadata using `toolkit-transport-grpc`.

## Key rules

- Gears do **not** own the HTTP server or add transport middleware (CORS, timeouts, etc.)
- Attach the service extension once after all routes: `router.layer(Extension(service))`
- Follow the operation ID convention: `<crate>.<resource>.<action>`
- Handlers should complete within ~30s; longer work returns `202 Accepted`

::: tip
For the full OperationBuilder API, see the [Toolkit REST Operation Builder](/toolkit/04_rest_operation_builder) documentation.
:::
