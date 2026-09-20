use sea_orm_migration::{prelude::*, schema::*};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20260919_190000_add_task_duration"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table("daily_tasks")
                    .add_column(integer("duration_minutes").default(60))
                    .to_owned(),
            )
            .await?;

        manager
            .get_connection()
            .execute_unprepared(
                "UPDATE daily_tasks
                 SET duration_minutes = CASE
                     WHEN end_minute > start_minute THEN end_minute - start_minute
                     ELSE 1440 - start_minute + end_minute
                 END",
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table("daily_tasks")
                    .drop_column("duration_minutes")
                    .to_owned(),
            )
            .await
    }
}
