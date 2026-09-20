use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "daily_plans")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    pub daily_task_id: i64,
    pub scheduled_date: String,
    pub start_minute: i64,
    pub end_minute: i64,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
