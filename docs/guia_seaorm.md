# Guia de SeaORM para Lease

SeaORM es la capa Rust que representa tablas como entidades y construye consultas SQL tipadas. No sustituye aprender SQLite: traduce operaciones de Rust a SQL y convierte filas en estructuras Rust.

Esta guia corresponde a SeaORM 2.0.x, que ya esta agregado en `src-tauri/Cargo.toml`.

## 1. Capas y vocabulario

```text
Migration  -> crea o cambia tablas
Entity     -> describe una tabla
Model      -> fila leida de la base de datos
ActiveModel-> valores que se insertan o modifican
Relation   -> relacion entre entidades
DbConn     -> conexion/pool a la base de datos
```

## 2. Dependencias actuales

```toml
sea-orm = { version = "2.0.3", features = [
    "sqlx-sqlite",
    "runtime-tokio-rustls",
    "macros"
] }

sea-orm-migration = { version = "2.0.3", features = [
    "sqlx-sqlite",
    "runtime-tokio-rustls"
] }
```

## 3. Conexion SQLite

```rust
use sea_orm::{Database, DatabaseConnection, DbErr};

async fn connect(database_url: &str) -> Result<DatabaseConnection, DbErr> {
    Database::connect(database_url).await
}
```

Una URL comun:

```text
sqlite://lease.db?mode=rwc
```

`mode=rwc` permite leer, escribir y crear el archivo si no existe. En Tauri, la ruta definitiva debe resolverse dentro del directorio de datos de la aplicacion, no depender del directorio desde el que se ejecuto.

## 4. Migraciones

Crear el proyecto de migraciones con la CLI es una operacion que se realiza una vez:

```bash
cd src-tauri
sea-orm-cli migrate init
```

Generar una migracion:

```bash
sea-orm-cli migrate generate create_daily_tasks
```

Una migracion implementa `up` y `down`:

```rust
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(DailyTask::Table)
                    .if_not_exists()
                    .col(pk_auto(DailyTask::Id))
                    .col(string(DailyTask::Name))
                    .col(integer(DailyTask::StartMinute))
                    .col(integer(DailyTask::EndMinute))
                    .col(boolean(DailyTask::IncludeWeekends).default(false))
                    .col(boolean(DailyTask::Enabled).default(true))
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(DailyTask::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum DailyTask {
    Table,
    Id,
    Name,
    StartMinute,
    EndMinute,
    IncludeWeekends,
    Enabled,
}
```

Ejecutar o revertir durante desarrollo:

```bash
DATABASE_URL='sqlite://lease.db?mode=rwc' sea-orm-cli migrate up
DATABASE_URL='sqlite://lease.db?mode=rwc' sea-orm-cli migrate down
DATABASE_URL='sqlite://lease.db?mode=rwc' sea-orm-cli migrate status
```

En la aplicacion final conviene ejecutar el migrador incorporado al arrancar para actualizar la base de cada usuario.

## 5. Generar entidades

Despues de crear las tablas:

```bash
sea-orm-cli generate entity \
  -u 'sqlite://lease.db?mode=rwc' \
  -o src/database/entities
```

La entidad puede verse asi:

```rust
use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "daily_tasks")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub name: String,
    pub start_minute: i32,
    pub end_minute: i32,
    pub include_weekends: bool,
    pub enabled: bool,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
```

No confundas esta `Model` de persistencia con el modelo del dominio. Al principio pueden ser parecidos; mas adelante pueden separarse.

## 6. Importaciones comunes

```rust
use sea_orm::{
    ActiveModelTrait,
    ColumnTrait,
    EntityTrait,
    QueryFilter,
    QueryOrder,
    Set,
};

use crate::database::entities::daily_tasks;
```

Muchos metodos aparecen gracias a traits importados. Si Rust dice que un metodo existe pero el trait no esta en alcance, revisa los `use`.

## 7. Insertar una fila

```rust
let task = daily_tasks::ActiveModel {
    name: Set("Estudiar".to_owned()),
    start_minute: Set(1320),
    end_minute: Set(1380),
    include_weekends: Set(false),
    enabled: Set(true),
    ..Default::default()
};

let inserted: daily_tasks::Model = task.insert(&db).await?;
```

`Set` indica que el campo debe enviarse en la operacion. El ID autoincremental queda sin establecer.

Varias filas:

```rust
daily_tasks::Entity::insert_many(vec![first, second])
    .exec(&db)
    .await?;
```

## 8. Seleccionar

Todos:

```rust
let tasks: Vec<daily_tasks::Model> =
    daily_tasks::Entity::find().all(&db).await?;
```

Por clave primaria:

```rust
let task: Option<daily_tasks::Model> =
    daily_tasks::Entity::find_by_id(1).one(&db).await?;
```

Filtrar y ordenar:

```rust
let tasks = daily_tasks::Entity::find()
    .filter(daily_tasks::Column::Enabled.eq(true))
    .filter(daily_tasks::Column::StartMinute.gte(600))
    .order_by_asc(daily_tasks::Column::StartMinute)
    .all(&db)
    .await?;
```

Otros filtros:

```rust
.filter(daily_tasks::Column::Name.contains("Rust"))
.filter(daily_tasks::Column::Id.is_in([1, 2, 3]))
.filter(daily_tasks::Column::Name.is_not_null())
```

Paginacion:

```rust
use sea_orm::PaginatorTrait;

let paginator = daily_tasks::Entity::find()
    .order_by_asc(daily_tasks::Column::StartMinute)
    .paginate(&db, 20);

let first_page = paginator.fetch_page(0).await?;
let total_pages = paginator.num_pages().await?;
```

## 9. Actualizar

Partiendo de un modelo leido:

```rust
let model = daily_tasks::Entity::find_by_id(1)
    .one(&db)
    .await?
    .ok_or_else(|| DbErr::Custom("Tarea inexistente".to_owned()))?;

let mut active: daily_tasks::ActiveModel = model.into();
active.name = Set("Estudiar Rust".to_owned());
let updated = active.update(&db).await?;
```

Actualizar varias filas:

```rust
use sea_orm::sea_query::Expr;
use sea_orm::QueryTrait;

daily_tasks::Entity::update_many()
    .col_expr(daily_tasks::Column::Enabled, Expr::value(false))
    .filter(daily_tasks::Column::IncludeWeekends.eq(false))
    .exec(&db)
    .await?;
```

## 10. Eliminar

```rust
let result = daily_tasks::Entity::delete_by_id(1)
    .exec(&db)
    .await?;

println!("Filas eliminadas: {}", result.rows_affected);
```

Eliminar por filtro:

```rust
daily_tasks::Entity::delete_many()
    .filter(daily_tasks::Column::Enabled.eq(false))
    .exec(&db)
    .await?;
```

## 11. Relaciones y JOIN

Una ejecucion pertenece a una Daily Task:

```rust
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::daily_tasks::Entity",
        from = "Column::DailyTaskId",
        to = "super::daily_tasks::Column::Id",
        on_delete = "Cascade"
    )]
    DailyTask,
}
```

En la entidad padre se define `has_many`. La CLI normalmente genera estas relaciones a partir de las claves foraneas.

Cargar una tarea y sus ejecuciones relacionadas:

```rust
let results = daily_tasks::Entity::find()
    .find_with_related(task_occurrences::Entity)
    .all(&db)
    .await?;

for (task, occurrences) in results {
    println!("{}: {} ejecuciones", task.name, occurrences.len());
}
```

JOIN explicito:

```rust
use sea_orm::{JoinType, QuerySelect};

let query = daily_tasks::Entity::find()
    .join(
        JoinType::InnerJoin,
        daily_tasks::Relation::TaskOccurrences.def(),
    )
    .filter(task_occurrences::Column::Status.eq("completed"));
```

## 12. Consultas compuestas y SQL avanzado

SeaORM/SeaQuery puede construir uniones, subconsultas y expresiones avanzadas, pero no siempre la API de entidades es la forma mas clara. Para una consulta especializada puedes usar SeaQuery o SQL parametrizado.

SQL parametrizado:

```rust
use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};

let statement = Statement::from_sql_and_values(
    DatabaseBackend::Sqlite,
    "SELECT name FROM daily_tasks WHERE enabled = ?",
    [true.into()],
);

let rows = db.query_all(statement).await?;
```

No insertes texto del usuario con `format!` dentro del SQL. Usa valores enlazados.

Para `UNION`, ambas consultas necesitan columnas compatibles. Si la consulta es importante y repetida, encapsulala en una funcion del repositorio y agrega una prueba de integracion.

## 13. Transacciones

```rust
use sea_orm::TransactionTrait;

db.transaction::<_, (), DbErr>(|txn| {
    Box::pin(async move {
        first_operation(txn).await?;
        second_operation(txn).await?;
        Ok(())
    })
})
.await?;
```

Usa una transaccion cuando el cambio de estado y otra escritura relacionada deban ser atomicos.

## 14. Errores

Funciones de base de datos suelen devolver `Result<T, DbErr>`:

```rust
async fn find_task(
    db: &DatabaseConnection,
    id: i32,
) -> Result<daily_tasks::Model, DbErr> {
    daily_tasks::Entity::find_by_id(id)
        .one(db)
        .await?
        .ok_or_else(|| DbErr::Custom("Tarea inexistente".to_owned()))
}
```

En el limite con Tauri puedes traducir `DbErr` a un error serializable y comprensible para React.

## 15. Responsabilidades

SeaORM debe encargarse de persistencia, no de todas las reglas. Ejemplo:

```text
Servicio de dominio:
  valida ventana y superposicion
  decide transicion de estado

Repositorio SeaORM:
  busca tareas
  inserta y actualiza filas
  ejecuta transacciones
```

No pongas reglas como "puede posponerse" solamente en componentes React: deben protegerse en Rust.

## 16. Orden recomendado

1. Aprende el SQL de la tabla.
2. Escribe la migracion.
3. Ejecutala sobre una base de desarrollo.
4. Inspecciona el esquema.
5. Genera entidades.
6. Practica `insert`, `find`, `filter`, `update` y `delete`.
7. Agrega `task_occurrences` y su relacion.
8. Practica `find_with_related` y un JOIN.
9. Integra el `DatabaseConnection` con el estado de Tauri.

Referencia principal: [documentacion de SeaORM 2.0](https://www.sea-ql.org/SeaORM/docs/).
