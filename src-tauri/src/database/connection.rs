use migration::{Migrator, MigratorTrait};
use sea_orm::{Database, DatabaseConnection, DbErr};
use std::path::Path;

pub async fn connect(database_path: &Path) -> Result<DatabaseConnection, DbErr> {
    let normalized_path = database_path.to_string_lossy().replace('\\', "/");
    let database_url = format!("sqlite://{normalized_path}?mode=rwc");
    let database = Database::connect(database_url).await?;
    Migrator::up(&database, None).await?;
    Ok(database)
}
