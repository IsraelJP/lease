# Guia de TypeScript para Lease

TypeScript es JavaScript con comprobacion estatica de tipos. Los tipos se comprueban durante el desarrollo y la compilacion; al ejecutar la aplicacion, el navegador recibe JavaScript.

## 1. Ejecutar y comprobar el proyecto

```bash
pnpm dev       # Vite en el navegador
pnpm build     # TypeScript + compilacion de produccion
pnpm tauri dev # aplicacion de escritorio
```

En Lease, el codigo TypeScript vive principalmente dentro de `src/` y los componentes React usan extension `.tsx`.

## 2. Variables

```ts
const taskName = "Estudiar"; // no puede reasignarse
let completed = false;       // puede reasignarse
completed = true;
```

Evita `var`: tiene reglas de alcance antiguas y confusas. Prefiere `const` y usa `let` cuando necesites reasignar.

TypeScript normalmente infiere el tipo:

```ts
const name = "Estudiar"; // string
let minutes = 60;        // number
```

Tambien puede declararse explicitamente:

```ts
const name: string = "Estudiar";
let minutes: number = 60;
```

## 3. Tipos principales

```ts
const name: string = "Estudiar";
const duration: number = 60;
const enabled: boolean = true;
const tags: string[] = ["estudio", "diaria"];
const window: [string, string] = ["22:00", "23:00"];
const absent: null = null;
const missing: undefined = undefined;
```

Evita `any`, pues desactiva la comprobacion:

```ts
let unsafe: any = "puede ser cualquier cosa";
```

Si el dato es desconocido, prefiere `unknown` y validalo:

```ts
function printValue(value: unknown): void {
  if (typeof value === "string") {
    console.log(value.toUpperCase());
  }
}
```

## 4. Objetos, `type` e `interface`

```ts
type TaskStatus =
  | "pending"
  | "notified"
  | "snoozed"
  | "in_progress"
  | "completed"
  | "skipped"
  | "cancelled"
  | "missed";

interface DailyTask {
  id: number;
  name: string;
  startTime: string;
  endTime: string;
  includeWeekends: boolean;
  enabled: boolean;
  description?: string; // propiedad opcional
}
```

`type` es excelente para uniones y alias. `interface` es comoda para describir objetos extensibles. Ambos sirven para modelar objetos.

## 5. Funciones

```ts
function add(a: number, b: number): number {
  return a + b;
}

function notify(name: string): void {
  console.log(`Es momento de ${name}`);
}
```

Funcion flecha:

```ts
const isInsideWindow = (
  now: number,
  start: number,
  end: number,
): boolean => now >= start && now < end;
```

Parametros opcionales y valores predeterminados:

```ts
function snooze(minutes = 5, reason?: string): void {
  console.log(minutes, reason);
}
```

## 6. Condicionales

TypeScript usa `if`, `else if` y `else`; no usa `elif`:

```ts
if (remaining === 0) {
  console.log("Finalizada");
} else if (remaining <= 5) {
  console.log("Queda poco tiempo");
} else {
  console.log("En progreso");
}
```

Operador ternario:

```ts
const label = completed ? "Completada" : "Pendiente";
```

Usa `===` y `!==` en lugar de `==` y `!=` para evitar conversiones automaticas inesperadas.

## 7. `switch`

```ts
switch (status) {
  case "pending":
    console.log("Pendiente");
    break;
  case "in_progress":
    console.log("En progreso");
    break;
  case "completed":
    console.log("Completada");
    break;
  default:
    console.log("Otro estado");
}
```

En TypeScript, `break` evita continuar en el siguiente `case`.

## 8. Ciclos

### `for`

```ts
for (let index = 0; index < 5; index += 1) {
  console.log(index);
}
```

### `for...of`: recorrer valores

```ts
for (const task of tasks) {
  console.log(task.name);
}
```

### `forEach`

```ts
tasks.forEach((task, index) => {
  console.log(index, task.name);
});
```

No puede detenerse un `forEach` con `break`; usa `for...of` si necesitas terminar antes.

### `while` y `do while`

```ts
let remaining = 3;
while (remaining > 0) {
  remaining -= 1;
}

do {
  console.log("Se ejecuta al menos una vez");
} while (remaining > 0);
```

### `for...in`

Recorre claves, no valores. Se usa principalmente con objetos:

```ts
for (const key in task) {
  console.log(key);
}
```

## 9. Metodos de arreglos

```ts
const pending = tasks.filter((task) => !task.completed);
const names = tasks.map((task) => task.name);
const found = tasks.find((task) => task.id === 3);
const hasActive = tasks.some((task) => task.enabled);
const allValid = tasks.every((task) => task.name.length > 0);
const total = durations.reduce((sum, value) => sum + value, 0);
```

`map` crea un arreglo nuevo. `filter` selecciona. `find` devuelve un elemento o `undefined`.

## 10. Nulos, opcionales y operadores utiles

```ts
const startedAt: string | null = null;
const title = task.description ?? "Sin descripcion";
const length = task.description?.length;
```

- `??` usa el valor derecho cuando el izquierdo es `null` o `undefined`.
- `?.` detiene el acceso si el valor no existe.
- `!` afirma que un valor existe, pero debe usarse con cuidado.

## 11. Narrowing o refinamiento de tipos

```ts
function format(value: string | number): string {
  if (typeof value === "number") {
    return value.toFixed(2);
  }
  return value.toUpperCase();
}
```

TypeScript aprende tipos a partir de `typeof`, `instanceof`, comparaciones y el operador `in`.

Union discriminada:

```ts
type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function show(result: Result<DailyTask>): void {
  if (result.ok) {
    console.log(result.value.name);
  } else {
    console.error(result.error);
  }
}
```

## 12. Desestructuracion y propagacion

```ts
const { name, startTime } = task;

const updatedTask = {
  ...task,
  name: "Leer",
};

const newTasks = [...tasks, updatedTask];
```

Estos patrones son fundamentales para actualizar estado en React sin modificar objetos anteriores.

## 13. Clases

```ts
class Timer {
  constructor(
    public start: Date,
    public end: Date,
  ) {}

  remaining(now: Date): number {
    return Math.max(0, this.end.getTime() - now.getTime());
  }
}
```

Para los datos recibidos desde Rust normalmente preferiremos `interface` y funciones puras, no clases.

## 14. Promesas y `async/await`

```ts
async function loadTasks(): Promise<DailyTask[]> {
  const response = await fetch("/tasks");
  if (!response.ok) {
    throw new Error("No se pudieron cargar las tareas");
  }
  return response.json() as Promise<DailyTask[]>;
}
```

Errores:

```ts
try {
  const tasks = await loadTasks();
  console.log(tasks);
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
}
```

## 15. Modulos

```ts
// types/dailyTask.ts
export interface DailyTask {
  id: number;
  name: string;
}

// otro archivo
import type { DailyTask } from "./types/dailyTask";
```

`import type` deja claro que el elemento solo se usa durante la comprobacion de tipos.

## 16. React esencial para Lease

Estado:

```tsx
const [tasks, setTasks] = useState<DailyTask[]>([]);
const [name, setName] = useState("");
```

Evento:

```tsx
function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
  event.preventDefault();
}
```

Lista:

```tsx
{tasks.map((task) => (
  <li key={task.id}>{task.name}</li>
))}
```

Props:

```tsx
interface TaskItemProps {
  task: DailyTask;
  onStart: (id: number) => void;
}

function TaskItem({ task, onStart }: TaskItemProps) {
  return <button onClick={() => onStart(task.id)}>{task.name}</button>;
}
```

## 17. Palabras reservadas frecuentes

`async`, `await`, `break`, `case`, `catch`, `class`, `const`, `continue`, `debugger`, `default`, `delete`, `do`, `else`, `enum`, `export`, `extends`, `false`, `finally`, `for`, `function`, `if`, `import`, `in`, `instanceof`, `interface`, `let`, `new`, `null`, `return`, `static`, `super`, `switch`, `this`, `throw`, `true`, `try`, `typeof`, `undefined`, `var`, `while`, `yield`.

## 18. Equivalencias rapidas

| Concepto | TypeScript |
|---|---|
| inmutable por reasignacion | `const value = 1` |
| reasignable | `let value = 1` |
| funcion | `function name() {}` |
| funcion flecha | `() => {}` |
| `elif` | `else if` |
| seleccion | `switch` |
| foreach | `for...of` o `.forEach()` |
| ciclo posterior | `do...while` |
| dato opcional | `T | null`, `T | undefined` o `prop?: T` |
| objeto tipado | `interface` o `type` |

## 19. Reglas recomendadas

- No uses `any` salvo integración temporal con una libreria sin tipos.
- Prefiere `const`.
- Modela estados con uniones literales.
- No confies en tipos TypeScript para validar datos externos: desaparecen al ejecutar.
- Mantén las reglas de dominio importantes en Rust; React debe concentrarse en presentar y capturar datos.
- Ejecuta `pnpm build` con frecuencia.

Referencia principal: [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/).
