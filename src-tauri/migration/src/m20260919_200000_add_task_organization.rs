use sea_orm_migration::{prelude::*, schema::*};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20260919_200000_add_task_organization"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table("categories")
                    .if_not_exists()
                    .col(pk_auto("id"))
                    .col(string_uniq("name"))
                    .col(string("created_at"))
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table("daily_tasks")
                    .add_column(string("color").default("violet"))
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table("daily_tasks")
                    .add_column(big_integer_null("category_id"))
                    .to_owned(),
            )
            .await?;
        manager
            .get_connection()
            .execute_unprepared(
                "INSERT OR IGNORE INTO categories (name, created_at) VALUES
                 ('Estudio', CURRENT_TIMESTAMP),
                 ('Trabajo', CURRENT_TIMESTAMP),
                 ('Ejercicio', CURRENT_TIMESTAMP),
                 ('Personal', CURRENT_TIMESTAMP)",
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table("daily_tasks")
                    .drop_column("category_id")
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table("daily_tasks")
                    .drop_column("color")
                    .to_owned(),
            )
            .await?;
        manager
            .drop_table(Table::drop().table("categories").to_owned())
            .await
    }
}
