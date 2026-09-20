# Guia de Rust para Lease

Esta guia presenta Rust desde cero y se concentra en los conceptos que usara el backend de Lease. Los ejemplos se pueden practicar en un proyecto pequeno creado con `cargo new practica_rust` o dentro de pruebas aisladas.

## 1. Herramientas basicas

```bash
rustc --version       # compilador
cargo --version       # gestor de proyectos y dependencias
cargo new practica    # crear proyecto
cargo check           # comprobar sin generar ejecutable final
cargo run             # compilar y ejecutar
cargo test            # ejecutar pruebas
cargo fmt              # formatear
cargo clippy           # recomendaciones y errores comunes
```

Un programa minimo:

```rust
fn main() {
    println!("Hola, Lease");
}
```

`main` es el punto de entrada de un ejecutable. `println!` termina en `!` porque es una macro.

## 2. Variables y constantes

Las variables son inmutables por defecto:

```rust
let name = "Estudiar";
let duration: i32 = 60;
```

Para modificar una variable se agrega `mut`:

```rust
let mut completed = false;
completed = true;
```

Una constante necesita tipo y se escribe normalmente en mayusculas:

```rust
const SNOOZE_MINUTES: u32 = 5;
```

Rust permite ocultar una variable con otra, llamado *shadowing*:

```rust
let input = "  Estudiar  ";
let input = input.trim();
let input = input.len(); // ahora es usize
```

## 3. Tipos principales

```rust
let signed: i32 = -10;
let positive: u32 = 10;
let index: usize = 0;
let decimal: f64 = 22.5;
let enabled: bool = true;
let letter: char = 'L';
let borrowed: &str = "Estudiar";
let owned: String = String::from("Estudiar");
```

Enteros: `i8`, `i16`, `i32`, `i64`, `i128`, `isize` y sus equivalentes sin signo `u8`...`usize`. Los flotantes son `f32` y `f64`.

### `String` y `&str`

- `String` posee texto modificable y asignado dinamicamente.
- `&str` es una vista prestada de texto.

```rust
fn print_name(name: &str) {
    println!("{name}");
}

let name = String::from("Estudiar");
print_name(&name);
```

Para parametros que solo leen texto suele preferirse `&str`.

### Tuplas, arreglos y vectores

```rust
let window: (&str, &str) = ("22:00", "23:00");
println!("{}", window.0);

let weekdays: [&str; 5] = ["L", "M", "X", "J", "V"];

let mut tasks: Vec<String> = Vec::new();
tasks.push(String::from("Estudiar"));
tasks.push(String::from("Ejercicio"));
```

Un arreglo tiene longitud fija; un `Vec<T>` puede crecer.

## 4. Funciones y expresiones

```rust
fn add(a: i32, b: i32) -> i32 {
    a + b
}

fn notify(name: &str) {
    println!("Es momento de {name}");
}
```

La ultima expresion sin punto y coma es el valor devuelto. Tambien puede usarse `return`:

```rust
fn validate_name(name: &str) -> bool {
    if name.trim().is_empty() {
        return false;
    }
    true
}
```

## 5. Condicionales

Rust usa `if`, `else if` y `else`; no existe `elif`:

```rust
if remaining == 0 {
    println!("Finalizada");
} else if remaining <= 5 {
    println!("Queda poco tiempo");
} else {
    println!("En progreso");
}
```

`if` es una expresion y puede producir un valor:

```rust
let label = if completed { "Lista" } else { "Pendiente" };
```

## 6. Ciclos

### `loop`

```rust
let mut attempts = 0;
let result = loop {
    attempts += 1;
    if attempts == 3 {
        break attempts * 10;
    }
};
```

### `while`

```rust
let mut remaining = 3;
while remaining > 0 {
    println!("{remaining}");
    remaining -= 1;
}
```

### `for` y su equivalente a `foreach`

```rust
let tasks = vec!["Estudiar", "Leer"];

for task in &tasks {
    println!("{task}");
}

for minute in 0..5 {
    println!("{minute}"); // 0, 1, 2, 3, 4
}

for minute in 0..=5 {
    println!("{minute}"); // incluye 5
}
```

Rust no tiene `foreach` como palabra reservada; `for elemento in coleccion` cumple esa funcion.

Rust tampoco tiene `do while`. Se expresa con `loop`:

```rust
loop {
    println!("Esto ocurre al menos una vez");
    if condition() {
        break;
    }
}
```

`continue` salta a la siguiente iteracion y `break` termina el ciclo.

## 7. `match`: alternativa potente a `switch`

```rust
let day = 6;

match day {
    1..=5 => println!("Dia laboral"),
    6 | 7 => println!("Fin de semana"),
    _ => println!("Dia invalido"),
}
```

`match` debe cubrir todos los casos. `_` significa cualquier otro valor.

## 8. `struct`, `enum` e `impl`

```rust
#[derive(Debug)]
struct DailyTask {
    name: String,
    start_minutes: u16,
    end_minutes: u16,
    include_weekends: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum TaskStatus {
    Pending,
    InProgress,
    Completed,
    Skipped,
    Cancelled,
    Missed,
}

impl DailyTask {
    fn new(name: String, start_minutes: u16, end_minutes: u16) -> Self {
        Self {
            name,
            start_minutes,
            end_minutes,
            include_weekends: false,
        }
    }

    fn is_inside_window(&self, now: u16) -> bool {
        now >= self.start_minutes && now < self.end_minutes
    }
}
```

Uso:

```rust
let task = DailyTask::new(String::from("Estudiar"), 22 * 60, 23 * 60);
println!("{}", task.is_inside_window(22 * 60 + 30));
```

Rust prefiere composicion a herencia. Los `enum` modelan un conjunto cerrado de posibilidades.

## 9. `Option` y ausencia de valor

```rust
let started_at: Option<String> = None;
let started_at = Some(String::from("22:02"));

match started_at {
    Some(time) => println!("Inicio: {time}"),
    None => println!("Todavia no inicia"),
}
```

Atajos frecuentes:

```rust
let value = optional.unwrap_or(String::from("Sin valor"));

if let Some(time) = optional_time {
    println!("{time}");
}
```

Evita `unwrap()` en codigo real cuando un `None` sea posible, pues produce un `panic`.

## 10. `Result` y errores

```rust
fn validate_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err(String::from("El nombre es obligatorio"));
    }
    Ok(())
}
```

Consumir el resultado:

```rust
match validate_name("Estudiar") {
    Ok(()) => println!("Valida"),
    Err(error) => eprintln!("{error}"),
}
```

El operador `?` devuelve el error automaticamente:

```rust
fn create_task(name: &str) -> Result<String, String> {
    validate_name(name)?;
    Ok(name.trim().to_owned())
}
```

## 11. Propiedad, prestamos y referencias

Cada valor tiene un propietario:

```rust
let first = String::from("Estudiar");
let second = first; // la propiedad se mueve
// first ya no puede usarse
```

Puede clonarse, aunque no debe hacerse sin necesidad:

```rust
let second = first.clone();
```

Un prestamo permite usar el valor sin tomar propiedad:

```rust
fn length(value: &str) -> usize {
    value.len()
}
```

Un prestamo mutable permite modificarlo:

```rust
fn complete(status: &mut TaskStatus) {
    *status = TaskStatus::Completed;
}
```

Regla practica: pueden existir muchas referencias inmutables o una mutable, pero no ambas simultaneamente.

## 12. Iteradores y cierres

```rust
let minutes = vec![10, 20, 30, 40];

let doubled: Vec<i32> = minutes
    .iter()
    .filter(|value| **value >= 20)
    .map(|value| value * 2)
    .collect();
```

`|value| ...` es un cierre. Los iteradores se usan mucho para transformar colecciones.

## 13. Modulos y visibilidad

```rust
// src/domain/mod.rs
pub mod daily_task;

// src/domain/daily_task.rs
pub struct DailyTask {
    pub name: String,
}
```

Importar:

```rust
use crate::domain::daily_task::DailyTask;
```

Los elementos son privados por defecto. `pub` permite acceder desde otros modulos.

## 14. `async` y `.await`

```rust
async fn load_tasks() -> Result<Vec<DailyTask>, String> {
    let tasks = database_query().await.map_err(|error| error.to_string())?;
    Ok(tasks)
}
```

Una funcion `async` devuelve un futuro. `.await` espera su resultado sin bloquear todo el runtime. SeaORM y los comandos de Tauri usan este estilo.

## 15. Pruebas

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_can_start_inside_window() {
        let task = DailyTask::new("Estudiar".to_owned(), 1320, 1380);
        assert!(task.is_inside_window(1330));
        assert!(!task.is_inside_window(1380));
    }
}
```

## 16. Palabras reservadas importantes

`as`, `async`, `await`, `break`, `const`, `continue`, `crate`, `dyn`, `else`, `enum`, `extern`, `false`, `fn`, `for`, `if`, `impl`, `in`, `let`, `loop`, `match`, `mod`, `move`, `mut`, `pub`, `ref`, `return`, `Self`, `self`, `static`, `struct`, `super`, `trait`, `true`, `type`, `unsafe`, `use`, `where`, `while`.

No es necesario memorizarlas; aprenderas su funcion al utilizarlas.

## 17. Equivalencias rapidas

| Concepto comun | Rust |
|---|---|
| variable | `let value = 1;` |
| variable modificable | `let mut value = 1;` |
| funcion | `fn name() {}` |
| `elif` | `else if` |
| `switch` | `match` |
| `foreach` | `for item in items` |
| `do while` | `loop` con `break` |
| valor nulo | `Option<T>` |
| exito o error | `Result<T, E>` |
| clase de datos | `struct` + `impl` |
| interfaz | `trait` |

## 18. Orden recomendado de practica

1. Crea variables y funciones que conviertan horas a minutos.
2. Modela `TaskStatus` con un `enum`.
3. Modela `DailyTask` con una `struct`.
4. Comprueba una ventana fija con `if`.
5. Usa `match` para describir cada estado.
6. Devuelve `Result` para nombres u horarios invalidos.
7. Escribe pruebas para inicio, final y cruce de medianoche.
8. Solo despues conecta estas reglas con SeaORM y Tauri.

Referencia principal: [The Rust Programming Language](https://doc.rust-lang.org/stable/book/).
