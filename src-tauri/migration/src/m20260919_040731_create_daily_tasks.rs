use sea_orm_migration::{prelude::*, schema::*};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20260919_040731_create_daily_tasks"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table("daily_tasks")
                    .if_not_exists()
                    .col(pk_auto("id"))
                    .col(string("name"))
                    .col(integer("start_minute"))
                    .col(integer("end_minute"))
                    .col(boolean("include_weekends").default(false))
                    .col(boolean("enabled").default(true))
                    .col(string("created_at"))
                    .col(string("updated_at"))
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table("daily_tasks").to_owned())
            .await
    }
}
