# OData

Gears provides OData-style query capabilities for REST APIs: filtering, pagination, field selection, and ordering. These are implemented through `toolkit-odata` and integrated into route registration via `OperationBuilder`.

## Filterable DTOs

REST DTOs declare which fields support filtering by deriving `ODataFilterable`:

```rust
#[derive(Serialize, Deserialize, ODataFilterable)]
pub struct ItemDto {
    pub id: Uuid,
    pub name: String,
    pub status: Status,
    pub created_at: DateTime<Utc>,
}
```

This generates an `ItemDtoFilterField` enum used for type-safe filter parsing and OpenAPI schema generation.

## Route integration

OData capabilities are added to routes through `OperationBuilder`:

```rust
OperationBuilder::get("/my-gear/v1/items")
    .handler(handlers::list_items)
    .json_response_with_schema::<Page<ItemDto>>(openapi, StatusCode::OK, "Items")
    .with_odata_filter::<ItemDtoFilterField>()
    .with_odata_select()
    .with_odata_orderby::<ItemDtoFilterField>()
    .standard_errors(openapi)
    .register(router, openapi);
```

## Page types

List endpoints return paginated results using `Page<T>` and `PageInfo`:

```rust
pub async fn list_items(
    Extension(ctx): Extension<SecurityContext>,
    Extension(svc): Extension<Arc<Service>>,
    Query(query): Query<ODataQuery>,
) -> ApiResult<JsonBody<Page<ItemDto>>> {
    let page = svc.list_items(&ctx, query).await?;
    Ok(Json(page))
}
```

## QueryBuilder (client-side)

`toolkit-sdk` provides a typed `QueryBuilder` for constructing OData queries with compile-time field checking and deterministic filter hashing for cursor pagination:

```rust
let query = QueryBuilder::<ItemDtoFilterField>::new()
    .filter(ItemDtoFilterField::Status.eq("active"))
    .top(10)
    .build();
```

::: tip
For the full OData API, see the [Toolkit OData Pagination & Filtering](/toolkit/07_odata_pagination_select_filter) documentation.
:::
