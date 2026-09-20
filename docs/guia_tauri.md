# Guia de Tauri para Lease

Tauri convierte una interfaz web en una aplicacion nativa. En Lease, React/TypeScript dibuja la interfaz y Rust controla reglas, persistencia, ventanas y capacidades del sistema.

## 1. Arquitectura

```text
React + TypeScript (src/)
          |
          | invoke, eventos
          v
Tauri + Rust (src-tauri/)
          |
          v
SeaORM -> SQLite
```

No existe un servidor HTTP entre React y Rust por defecto. Se comunican mediante IPC controlado por Tauri.

## 2. Comandos importantes

```bash
pnpm dev          # solo interfaz web
pnpm build        # comprobar TS y construir interfaz
pnpm tauri dev    # app completa en desarrollo
pnpm tauri build  # instalador/ejecutable de produccion
```

## 3. Archivos principales

```text
src/
├── main.tsx              # entrada de React
└── App.tsx               # interfaz inicial

src-tauri/
├── Cargo.toml            # dependencias Rust
├── tauri.conf.json       # producto, ventana y bundle
├── capabilities/
│   └── default.json      # permisos del frontend
└── src/
    ├── main.rs           # arranca la libreria
    └── lib.rs            # construye Tauri y registra comandos
```

## 4. Primer comando Rust

```rust
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hola, {name}")
}
```

Debe registrarse:

```rust
tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![greet])
    .run(tauri::generate_context!())
    .expect("error al ejecutar Tauri");
```

Llamarlo desde TypeScript:

```ts
import { invoke } from "@tauri-apps/api/core";

const message = await invoke<string>("greet", {
  name: "Israel",
});
```

El nombre de cada argumento enviado por TypeScript debe corresponder al esperado por el comando.

## 5. Datos serializables

Rust recibe y devuelve datos mediante Serde:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateDailyTaskInput {
    name: String,
    start_minute: i32,
    end_minute: i32,
    include_weekends: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DailyTaskOutput {
    id: i32,
    name: String,
    start_minute: i32,
    end_minute: i32,
}
```

Comando:

```rust
#[tauri::command]
async fn create_daily_task(
    input: CreateDailyTaskInput,
) -> Result<DailyTaskOutput, String> {
    validate(&input).map_err(|error| error.to_string())?;
    todo!("guardar con SeaORM")
}
```

TypeScript:

```ts
interface CreateDailyTaskInput {
  name: string;
  startMinute: number;
  endMinute: number;
  includeWeekends: boolean;
}

const created = await invoke<DailyTask>("create_daily_task", {
  input: {
    name: "Estudiar",
    startMinute: 1320,
    endMinute: 1380,
    includeWeekends: false,
  },
});
```

`rename_all = "camelCase"` permite que Rust use `snake_case` y TypeScript `camelCase`.

## 6. Errores de comandos

El error de `Result<T, E>` debe poder serializarse. Para empezar puede utilizarse `String`:

```rust
#[tauri::command]
async fn get_task(id: i32) -> Result<DailyTaskOutput, String> {
    repository_find(id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "La tarea no existe".to_owned())
}
```

En TypeScript:

```ts
try {
  const task = await invoke<DailyTask>("get_task", { id: 1 });
} catch (error: unknown) {
  console.error(String(error));
}
```

Mas adelante conviene crear errores estructurados con codigo y mensaje.

## 7. Estado administrado

Tauri puede conservar una conexion compartida:

```rust
use sea_orm::DatabaseConnection;

struct AppState {
    db: DatabaseConnection,
}
```

Registrar durante el arranque:

```rust
tauri::Builder::default()
    .setup(|app| {
        // Resolver ruta, conectar y ejecutar migraciones.
        // Despues: app.manage(AppState { db });
        Ok(())
    })
```

Usarla en un comando:

```rust
#[tauri::command]
async fn list_daily_tasks(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DailyTaskOutput>, String> {
    let db = &state.db;
    todo!("consultar con SeaORM")
}
```

Tauri gestiona el uso compartido de `State`; no agregues `Arc` sin una necesidad concreta. Para conexiones asincronas, el pool de SeaORM ya gestiona conexiones internas.

## 8. Rutas de datos

No guardes `lease.db` suponiendo que el directorio actual siempre sera el mismo. Usa el directorio de datos de la aplicacion:

```rust
use tauri::Manager;

let app_data_dir = app.path().app_data_dir()?;
let database_path = app_data_dir.join("lease.db");
```

Antes de crear el archivo puede ser necesario crear el directorio. La base de desarrollo y la base real del usuario no tienen por que ser el mismo archivo.

## 9. Configuracion de ventana

En `tauri.conf.json`:

```json
{
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "Lease",
        "width": 1000,
        "height": 700,
        "minWidth": 760,
        "minHeight": 520
      }
    ]
  }
}
```

JSON no admite comentarios. Consulta el esquema de Tauri antes de agregar propiedades.

## 10. Eventos

Rust puede emitir eventos hacia el frontend:

```rust
use tauri::Emitter;

app_handle
    .emit("daily-task-due", payload)
    .map_err(|error| error.to_string())?;
```

TypeScript escucha:

```ts
import { listen } from "@tauri-apps/api/event";

const unlisten = await listen<DailyTask>("daily-task-due", (event) => {
  console.log(event.payload);
});

// Al desmontar el componente:
unlisten();
```

Usa comandos para peticiones/respuestas y eventos para sucesos espontaneos, como una tarea que llega a su horario.

## 11. Plugins y permisos

Las funciones nativas se agregan mediante plugins. Un plugin suele requerir:

1. Dependencia Rust.
2. Paquete TypeScript si ofrece API frontend.
3. Registro con `.plugin(...)`.
4. Permisos en `src-tauri/capabilities/default.json`.

Ejemplo conceptual:

```rust
tauri::Builder::default()
    .plugin(algun_plugin::init())
```

No concedas permisos amplios por comodidad. Habilita solo las operaciones necesarias.

## 12. Segundo plano, bandeja y cierre

Para Lease debe distinguirse:

```text
Cerrar ventana -> ocultar ventana y seguir ejecutando
Salir          -> terminar proceso y dejar de alertar
```

La implementacion requerira manejar `WindowEvent::CloseRequested`, impedir el cierre y ocultar la ventana. Tambien se agregara una bandeja del sistema con acciones como "Abrir" y "Salir".

Esto debe implementarse despues del CRUD y del motor de horarios; no mezcles todos los problemas desde el inicio.

## 13. Arranque automatico y notificaciones

Tauri tiene plugins para capacidades como notificaciones y autoarranque. La estrategia de Lease sera:

```text
Sistema inicia
-> Lease arranca
-> abre base de datos
-> revisa ejecuciones pendientes
-> queda en segundo plano
-> alerta al llegar una ventana
```

El autoarranque y las notificaciones requieren probar permisos y comportamiento en cada sistema operativo. Que funcione en Linux no garantiza detalles identicos en Windows o macOS.

## 14. Seguridad

- React no debe poder ejecutar comandos Rust no registrados.
- Valida todos los datos tambien en Rust.
- Usa parametros en consultas SQL.
- Restringe capacidades de plugins.
- No guardes secretos en el frontend.
- No uses comandos de shell para funciones que pueden resolverse con APIs seguras.

Los tipos de TypeScript no existen durante la ejecucion y no constituyen validacion de seguridad.

## 15. Organizacion recomendada

```text
src-tauri/src/
├── lib.rs
├── commands/
│   └── daily_tasks.rs
├── database/
│   ├── connection.rs
│   └── entities/
├── domain/
│   └── daily_task.rs
└── services/
    └── daily_task_service.rs
```

Flujo de un comando:

```text
Command
-> valida entrada basica
-> llama al servicio
-> servicio aplica reglas
-> repositorio/SeaORM persiste
-> command convierte salida para React
```

## 16. Depuracion

```bash
pnpm build
cd src-tauri && cargo check
cd src-tauri && cargo clippy
pnpm tauri dev
```

Los mensajes pueden venir de capas diferentes:

- TypeScript: tipos del frontend.
- Vite/React: interfaz.
- Rust: compilacion y ownership.
- Tauri: comandos, permisos y configuracion.
- SeaORM/SQLite: conexion, esquema o consulta.

Identifica primero la capa que genero el error.

## 17. Camino de aprendizaje

1. Conserva el comando `greet` y entiende `invoke`.
2. Crea un comando puro que valide una ventana horaria.
3. Envia y devuelve una estructura con Serde.
4. Inicializa SQLite y SeaORM como estado.
5. Crea `create_daily_task`.
6. Crea `list_daily_tasks`.
7. Agrega update/delete.
8. Emite un evento de prueba hacia React.
9. Implementa el motor de horarios.
10. Finalmente agrega bandeja, notificaciones y autoarranque.

Referencias: [Tauri 2](https://v2.tauri.app/), [comandos Rust desde el frontend](https://v2.tauri.app/develop/calling-rust/) y [estado administrado](https://v2.tauri.app/develop/state-management/).
