pub use sea_orm_migration::prelude::*;

mod m20260919_040731_create_daily_tasks;
mod m20260919_180000_create_daily_plans;
mod m20260919_190000_add_task_duration;
mod m20260919_200000_add_task_organization;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20260919_040731_create_daily_tasks::Migration),
            Box::new(m20260919_180000_create_daily_plans::Migration),
            Box::new(m20260919_190000_add_task_duration::Migration),
            Box::new(m20260919_200000_add_task_organization::Migration),
        ]
    }
}
