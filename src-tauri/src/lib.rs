mod database;

use database::entities::{categories, daily_plans, daily_tasks};
use sea_orm::{
    sea_query::prelude::chrono, ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait,
    IntoActiveModel, QueryFilter, Set,
};
use sea_orm::sea_query::prelude::chrono::{Datelike, Duration, NaiveDate, Weekday};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use tauri::Manager;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DailyTaskResponse {
    id: i64,
    name: String,
    start_minute: i64,
    end_minute: i64,
    duration_minutes: i64,
    color: String,
    category_id: Option<i64>,
    category_name: Option<String>,
    include_weekends: bool,
    enabled: bool,
    created_at: String,
    updated_at: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateDailyTaskRequest {
    name: String,
    duration_minutes: i64,
    color: String,
    category_id: Option<i64>,
    include_weekends: bool,
    enabled: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateDailyTaskRequest {
    id: i64,
    name: String,
    duration_minutes: i64,
    color: String,
    category_id: Option<i64>,
    include_weekends: bool,
    enabled: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepeatTaskForMonthRequest {
    daily_task_id: i64,
    month: String,
    start_minute: i64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DailyPlanResponse {
    id: i64,
    daily_task_id: i64,
    task_name: String,
    task_color: String,
    category_name: Option<String>,
    scheduled_date: String,
    start_minute: i64,
    end_minute: i64,
    status: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CategoryResponse {
    id: i64,
    name: String,
}

const TASK_COLORS: [&str; 7] = ["violet", "blue", "cyan", "green", "yellow", "orange", "pink"];

fn validate_task_color(color: &str) -> Result<(), String> {
    if TASK_COLORS.contains(&color) {
        Ok(())
    } else {
        Err("El color seleccionado no es válido".to_owned())
    }
}

async fn find_category_name(
    db: &DatabaseConnection,
    category_id: Option<i64>,
) -> Result<Option<String>, String> {
    match category_id {
        Some(id) => Ok(categories::Entity::find_by_id(id)
            .one(db)
            .await
            .map_err(|error| error.to_string())?
            .map(|category| category.name)),
        None => Ok(None),
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateDailyPlanRequest {
    daily_task_id: i64,
    scheduled_date: String,
    start_minute: i64,
    end_minute: i64,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateDailyPlanRequest {
    id: i64,
    start_minute: i64,
    end_minute: i64,
}

struct AppState {
    db: DatabaseConnection,
}

#[tauri::command]
fn import_alert_sound(
    app: tauri::AppHandle,
    source_path: String,
) -> Result<String, String> {
    let source = PathBuf::from(source_path);
    if !source.is_file() {
        return Err("El archivo de sonido ya no existe".to_owned());
    }
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_lowercase)
        .ok_or_else(|| "El archivo no tiene una extensión válida".to_owned())?;
    if !["wav", "mp3", "ogg", "m4a"].contains(&extension.as_str()) {
        return Err("El formato de sonido no es compatible".to_owned());
    }
    let metadata = std::fs::metadata(&source).map_err(|error| error.to_string())?;
    if metadata.len() > 20 * 1024 * 1024 {
        return Err("El sonido no puede superar 20 MB".to_owned());
    }
    let sounds_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("sounds");
    std::fs::create_dir_all(&sounds_directory).map_err(|error| error.to_string())?;
    let filename = format!("alert-{}.{}", chrono::Utc::now().timestamp_millis(), extension);
    let destination = sounds_directory.join(filename);
    std::fs::copy(source, &destination).map_err(|error| error.to_string())?;
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
async fn list_categories(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<CategoryResponse>, String> {
    Ok(categories::Entity::find()
        .all(&state.db)
        .await
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|category| CategoryResponse { id: category.id, name: category.name })
        .collect())
}

#[tauri::command]
async fn create_category(
    state: tauri::State<'_, AppState>,
    name: String,
) -> Result<CategoryResponse, String> {
    let name = name.trim().to_owned();
    if name.is_empty() {
        return Err("El nombre de la categoría es obligatorio".to_owned());
    }
    if name.chars().count() > 40 {
        return Err("La categoría no puede superar 40 caracteres".to_owned());
    }
    let category = categories::ActiveModel {
        name: Set(name),
        created_at: Set(chrono::Utc::now().to_rfc3339()),
        ..Default::default()
    }
    .insert(&state.db)
    .await
    .map_err(|_| "Ya existe una categoría con ese nombre".to_owned())?;
    Ok(CategoryResponse { id: category.id, name: category.name })
}

#[tauri::command]
async fn list_daily_tasks(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DailyTaskResponse>, String> {
    let tasks = daily_tasks::Entity::find()
        .all(&state.db)
        .await
        .map_err(|error| error.to_string())?;

    let category_names: HashMap<i64, String> = categories::Entity::find()
        .all(&state.db)
        .await
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|category| (category.id, category.name))
        .collect();
    let responses = tasks
        .into_iter()
        .map(|task| DailyTaskResponse {
            id: task.id,
            name: task.name,
            start_minute: task.start_minute,
            end_minute: task.end_minute,
            duration_minutes: task.duration_minutes,
            color: task.color,
            category_name: task.category_id.and_then(|id| category_names.get(&id).cloned()),
            category_id: task.category_id,
            include_weekends: task.include_weekends,
            enabled: task.enabled,
            created_at: task.created_at,
            updated_at: task.updated_at,
        })
        .collect();
    Ok(responses)
}

#[tauri::command]
async fn create_daily_task(
    state: tauri::State<'_, AppState>,
    request: CreateDailyTaskRequest,
) -> Result<DailyTaskResponse, String> {
    let name = request.name.trim().to_owned();

    if name.is_empty() {
        return Err("Name cannot be empty".to_owned());
    }

    if !(15..=720).contains(&request.duration_minutes) {
        return Err("La duración debe estar entre 15 minutos y 12 horas".to_owned());
    }
    validate_task_color(&request.color)?;
    let category_name = match request.category_id {
        Some(id) => Some(
            categories::Entity::find_by_id(id)
                .one(&state.db)
                .await
                .map_err(|error| error.to_string())?
                .ok_or_else(|| "La categoría seleccionada no existe".to_owned())?
                .name,
        ),
        None => None,
    };

    let now = chrono::Utc::now().to_rfc3339();

    let insert_model = daily_tasks::ActiveModel {
        name: Set(name),
        // Se conservan estas columnas por compatibilidad con la primera versión.
        // El tablero usa duration_minutes como la fuente real de duración.
        start_minute: Set(0),
        end_minute: Set(request.duration_minutes),
        duration_minutes: Set(request.duration_minutes),
        color: Set(request.color),
        category_id: Set(request.category_id),
        include_weekends: Set(request.include_weekends),
        enabled: Set(request.enabled),
        created_at: Set(now.clone()),
        updated_at: Set(now),
        ..Default::default()
    };

    let task = insert_model
        .insert(&state.db)
        .await
        .map_err(|error| error.to_string())?;

    Ok(DailyTaskResponse {
        id: task.id,
        name: task.name,
        start_minute: task.start_minute,
        end_minute: task.end_minute,
        duration_minutes: task.duration_minutes,
        color: task.color,
        category_id: task.category_id,
        category_name,
        include_weekends: task.include_weekends,
        enabled: task.enabled,
        created_at: task.created_at,
        updated_at: task.updated_at,
    })
}

#[tauri::command]
async fn update_daily_task(
    state: tauri::State<'_, AppState>,
    request: UpdateDailyTaskRequest,
) -> Result<DailyTaskResponse, String> {
    let name = request.name.trim().to_owned();
    if name.is_empty() {
        return Err("El nombre no puede estar vacío".to_owned());
    }
    if !(15..=720).contains(&request.duration_minutes) {
        return Err("La duración debe estar entre 15 minutos y 12 horas".to_owned());
    }
    validate_task_color(&request.color)?;
    let category_name = match request.category_id {
        Some(id) => Some(
            categories::Entity::find_by_id(id)
                .one(&state.db)
                .await
                .map_err(|error| error.to_string())?
                .ok_or_else(|| "La categoría seleccionada no existe".to_owned())?
                .name,
        ),
        None => None,
    };

    let task = daily_tasks::Entity::find_by_id(request.id)
        .one(&state.db)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "La tarea que intentas editar ya no existe".to_owned())?;
    let mut active_task = task.into_active_model();
    active_task.name = Set(name);
    active_task.start_minute = Set(0);
    active_task.end_minute = Set(request.duration_minutes);
    active_task.duration_minutes = Set(request.duration_minutes);
    active_task.color = Set(request.color);
    active_task.category_id = Set(request.category_id);
    active_task.include_weekends = Set(request.include_weekends);
    active_task.enabled = Set(request.enabled);
    active_task.updated_at = Set(chrono::Utc::now().to_rfc3339());
    let task = active_task
        .update(&state.db)
        .await
        .map_err(|error| error.to_string())?;

    Ok(DailyTaskResponse {
        id: task.id,
        name: task.name,
        start_minute: task.start_minute,
        end_minute: task.end_minute,
        duration_minutes: task.duration_minutes,
        color: task.color,
        category_id: task.category_id,
        category_name,
        include_weekends: task.include_weekends,
        enabled: task.enabled,
        created_at: task.created_at,
        updated_at: task.updated_at,
    })
}

#[tauri::command]
async fn delete_daily_task(
    state: tauri::State<'_, AppState>,
    id: i64,
) -> Result<(), String> {
    daily_plans::Entity::delete_many()
        .filter(daily_plans::Column::DailyTaskId.eq(id))
        .exec(&state.db)
        .await
        .map_err(|error| error.to_string())?;
    let result = daily_tasks::Entity::delete_by_id(id)
        .exec(&state.db)
        .await
        .map_err(|error| error.to_string())?;
    if result.rows_affected == 0 {
        return Err("La tarea que intentas eliminar ya no existe".to_owned());
    }
    Ok(())
}

#[tauri::command]
async fn list_daily_plans(
    state: tauri::State<'_, AppState>,
    scheduled_date: String,
) -> Result<Vec<DailyPlanResponse>, String> {
    let plans = daily_plans::Entity::find()
        .filter(daily_plans::Column::ScheduledDate.eq(scheduled_date))
        .all(&state.db)
        .await
        .map_err(|error| error.to_string())?;

    let mut responses = Vec::with_capacity(plans.len());
    for plan in plans {
        let task = daily_tasks::Entity::find_by_id(plan.daily_task_id)
            .one(&state.db)
            .await
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "La tarea de esta planificación ya no existe".to_owned())?;
        let category_name = find_category_name(&state.db, task.category_id).await?;

        responses.push(DailyPlanResponse {
            id: plan.id,
            daily_task_id: plan.daily_task_id,
            task_name: task.name,
            task_color: task.color,
            category_name,
            scheduled_date: plan.scheduled_date,
            start_minute: plan.start_minute,
            end_minute: plan.end_minute,
            status: plan.status,
        });
    }

    responses.sort_by_key(|plan| plan.start_minute);
    Ok(responses)
}

#[tauri::command]
async fn list_month_plans(
    state: tauri::State<'_, AppState>,
    month: String,
) -> Result<Vec<DailyPlanResponse>, String> {
    NaiveDate::parse_from_str(&format!("{month}-01"), "%Y-%m-%d")
        .map_err(|_| "El mes debe tener el formato YYYY-MM".to_owned())?;
    let plans = daily_plans::Entity::find()
        .filter(daily_plans::Column::ScheduledDate.starts_with(month))
        .all(&state.db)
        .await
        .map_err(|error| error.to_string())?;

    let mut responses = Vec::with_capacity(plans.len());
    for plan in plans {
        let task = daily_tasks::Entity::find_by_id(plan.daily_task_id)
            .one(&state.db)
            .await
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "La tarea de esta planificación ya no existe".to_owned())?;
        let category_name = find_category_name(&state.db, task.category_id).await?;
        responses.push(DailyPlanResponse {
            id: plan.id,
            daily_task_id: plan.daily_task_id,
            task_name: task.name,
            task_color: task.color,
            category_name,
            scheduled_date: plan.scheduled_date,
            start_minute: plan.start_minute,
            end_minute: plan.end_minute,
            status: plan.status,
        });
    }
    responses.sort_by(|a, b| a.scheduled_date.cmp(&b.scheduled_date).then(a.start_minute.cmp(&b.start_minute)));
    Ok(responses)
}

#[tauri::command]
async fn repeat_daily_plan_for_month(
    state: tauri::State<'_, AppState>,
    id: i64,
) -> Result<Vec<DailyPlanResponse>, String> {
    let source = daily_plans::Entity::find_by_id(id)
        .one(&state.db)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "La planificación original ya no existe".to_owned())?;
    let task = daily_tasks::Entity::find_by_id(source.daily_task_id)
        .one(&state.db)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "La plantilla original ya no existe".to_owned())?;
    let category_name = find_category_name(&state.db, task.category_id).await?;
    let source_date = NaiveDate::parse_from_str(&source.scheduled_date, "%Y-%m-%d")
        .map_err(|_| "La fecha de la planificación no es válida".to_owned())?;
    let first_day = source_date.with_day(1).unwrap();
    let next_month = if first_day.month() == 12 {
        NaiveDate::from_ymd_opt(first_day.year() + 1, 1, 1).unwrap()
    } else {
        NaiveDate::from_ymd_opt(first_day.year(), first_day.month() + 1, 1).unwrap()
    };
    let month_prefix = first_day.format("%Y-%m").to_string();
    let existing: HashSet<String> = daily_plans::Entity::find()
        .filter(daily_plans::Column::DailyTaskId.eq(task.id))
        .filter(daily_plans::Column::ScheduledDate.starts_with(month_prefix))
        .all(&state.db)
        .await
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|plan| plan.scheduled_date)
        .collect();

    let mut created = Vec::new();
    let mut date = first_day;
    while date < next_month {
        let is_weekend = matches!(date.weekday(), Weekday::Sat | Weekday::Sun);
        let scheduled_date = date.format("%Y-%m-%d").to_string();
        if (task.include_weekends || !is_weekend) && !existing.contains(&scheduled_date) {
            let now = chrono::Utc::now().to_rfc3339();
            let plan = daily_plans::ActiveModel {
                daily_task_id: Set(task.id),
                scheduled_date: Set(scheduled_date),
                start_minute: Set(source.start_minute),
                end_minute: Set(source.end_minute),
                status: Set("planned".to_owned()),
                created_at: Set(now.clone()),
                updated_at: Set(now),
                ..Default::default()
            }
            .insert(&state.db)
            .await
            .map_err(|error| error.to_string())?;
            created.push(DailyPlanResponse {
                id: plan.id,
                daily_task_id: plan.daily_task_id,
                task_name: task.name.clone(),
                task_color: task.color.clone(),
                category_name: category_name.clone(),
                scheduled_date: plan.scheduled_date,
                start_minute: plan.start_minute,
                end_minute: plan.end_minute,
                status: plan.status,
            });
        }
        date += Duration::days(1);
    }
    Ok(created)
}

#[tauri::command]
async fn repeat_task_for_month(
    state: tauri::State<'_, AppState>,
    request: RepeatTaskForMonthRequest,
) -> Result<Vec<DailyPlanResponse>, String> {
    let task = daily_tasks::Entity::find_by_id(request.daily_task_id)
        .one(&state.db)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "La plantilla ya no existe".to_owned())?;
    let category_name = find_category_name(&state.db, task.category_id).await?;
    let end_minute = request.start_minute + task.duration_minutes;
    validate_plan_times(request.start_minute, end_minute)?;
    let first_day = NaiveDate::parse_from_str(&format!("{}-01", request.month), "%Y-%m-%d")
        .map_err(|_| "El mes debe tener el formato YYYY-MM".to_owned())?;
    let next_month = if first_day.month() == 12 {
        NaiveDate::from_ymd_opt(first_day.year() + 1, 1, 1).unwrap()
    } else {
        NaiveDate::from_ymd_opt(first_day.year(), first_day.month() + 1, 1).unwrap()
    };
    let existing: HashSet<String> = daily_plans::Entity::find()
        .filter(daily_plans::Column::DailyTaskId.eq(task.id))
        .filter(daily_plans::Column::ScheduledDate.starts_with(request.month))
        .all(&state.db)
        .await
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|plan| plan.scheduled_date)
        .collect();

    let mut created = Vec::new();
    let mut date = first_day;
    while date < next_month {
        let is_weekend = matches!(date.weekday(), Weekday::Sat | Weekday::Sun);
        let scheduled_date = date.format("%Y-%m-%d").to_string();
        if (task.include_weekends || !is_weekend) && !existing.contains(&scheduled_date) {
            let now = chrono::Utc::now().to_rfc3339();
            let plan = daily_plans::ActiveModel {
                daily_task_id: Set(task.id),
                scheduled_date: Set(scheduled_date),
                start_minute: Set(request.start_minute),
                end_minute: Set(end_minute),
                status: Set("planned".to_owned()),
                created_at: Set(now.clone()),
                updated_at: Set(now),
                ..Default::default()
            }
            .insert(&state.db)
            .await
            .map_err(|error| error.to_string())?;
            created.push(DailyPlanResponse {
                id: plan.id,
                daily_task_id: plan.daily_task_id,
                task_name: task.name.clone(),
                task_color: task.color.clone(),
                category_name: category_name.clone(),
                scheduled_date: plan.scheduled_date,
                start_minute: plan.start_minute,
                end_minute: plan.end_minute,
                status: plan.status,
            });
        }
        date += Duration::days(1);
    }
    Ok(created)
}

fn validate_plan_times(start_minute: i64, end_minute: i64) -> Result<(), String> {
    if !(0..=1439).contains(&start_minute) || !(1..=1440).contains(&end_minute) {
        return Err("El horario debe estar dentro de las 24 horas del día".to_owned());
    }
    if start_minute >= end_minute {
        return Err("La hora de término debe ser posterior a la hora de inicio".to_owned());
    }
    Ok(())
}

#[tauri::command]
async fn create_daily_plan(
    state: tauri::State<'_, AppState>,
    request: CreateDailyPlanRequest,
) -> Result<DailyPlanResponse, String> {
    validate_plan_times(request.start_minute, request.end_minute)?;
    if request.scheduled_date.trim().is_empty() {
        return Err("La fecha es obligatoria".to_owned());
    }

    let task = daily_tasks::Entity::find_by_id(request.daily_task_id)
        .one(&state.db)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "La tarea seleccionada no existe".to_owned())?;
    let category_name = find_category_name(&state.db, task.category_id).await?;
    let already_planned = daily_plans::Entity::find()
        .filter(daily_plans::Column::DailyTaskId.eq(request.daily_task_id))
        .filter(daily_plans::Column::ScheduledDate.eq(request.scheduled_date.clone()))
        .one(&state.db)
        .await
        .map_err(|error| error.to_string())?;
    if already_planned.is_some() {
        return Err("Esta tarea ya está incluida en el plan del día".to_owned());
    }
    let now = chrono::Utc::now().to_rfc3339();
    let plan = daily_plans::ActiveModel {
        daily_task_id: Set(task.id),
        scheduled_date: Set(request.scheduled_date),
        start_minute: Set(request.start_minute),
        end_minute: Set(request.end_minute),
        status: Set("planned".to_owned()),
        created_at: Set(now.clone()),
        updated_at: Set(now),
        ..Default::default()
    }
    .insert(&state.db)
    .await
    .map_err(|error| error.to_string())?;

    Ok(DailyPlanResponse {
        id: plan.id,
        daily_task_id: plan.daily_task_id,
        task_name: task.name,
        task_color: task.color,
        category_name,
        scheduled_date: plan.scheduled_date,
        start_minute: plan.start_minute,
        end_minute: plan.end_minute,
        status: plan.status,
    })
}

#[tauri::command]
async fn update_daily_plan(
    state: tauri::State<'_, AppState>,
    request: UpdateDailyPlanRequest,
) -> Result<(), String> {
    validate_plan_times(request.start_minute, request.end_minute)?;
    let plan = daily_plans::Entity::find_by_id(request.id)
        .one(&state.db)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "La planificación no existe".to_owned())?;
    let mut active_plan = plan.into_active_model();
    active_plan.start_minute = Set(request.start_minute);
    active_plan.end_minute = Set(request.end_minute);
    active_plan.updated_at = Set(chrono::Utc::now().to_rfc3339());
    active_plan
        .update(&state.db)
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
async fn delete_daily_plan(
    state: tauri::State<'_, AppState>,
    id: i64,
) -> Result<(), String> {
    daily_plans::Entity::delete_by_id(id)
        .exec(&state.db)
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let db = tauri::async_runtime::block_on(database::connection::connect())
                .map_err(|error| std::io::Error::other(error.to_string()))?;

            app.manage(AppState { db });

            Ok(())
        })
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            import_alert_sound,
            list_categories,
            create_category,
            list_daily_tasks,
            create_daily_task,
            update_daily_task,
            delete_daily_task,
            list_daily_plans,
            list_month_plans,
            create_daily_plan,
            update_daily_plan,
            delete_daily_plan,
            repeat_daily_plan_for_month,
            repeat_task_for_month
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
