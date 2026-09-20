use sea_orm::{Database, DatabaseConnection, DbErr};
use migration::{Migrator, MigratorTrait};

pub async fn connect() -> Result<DatabaseConnection, DbErr> {
    let database_url = format!("sqlite://{}/lease-dev.db", env!("CARGO_MANIFEST_DIR"));
    let database = Database::connect(database_url).await?;
    Migrator::up(&database, None).await?;
    Ok(database)
}
