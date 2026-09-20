use sea_orm_migration::{prelude::*, schema::*};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20260919_180000_create_daily_plans"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table("daily_plans")
                    .if_not_exists()
                    .col(pk_auto("id"))
                    .col(big_integer("daily_task_id"))
                    .col(string("scheduled_date"))
                    .col(integer("start_minute"))
                    .col(integer("end_minute"))
                    .col(string("status").default("planned"))
                    .col(string("created_at"))
                    .col(string("updated_at"))
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-daily-plans-task")
                            .from("daily_plans", "daily_task_id")
                            .to("daily_tasks", "id")
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table("daily_plans").to_owned())
            .await
    }
}
