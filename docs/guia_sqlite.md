# Guia de SQLite para Lease

SQLite es una base de datos relacional embebida: los datos viven normalmente en un archivo y no hace falta ejecutar un servidor separado. SeaORM enviara consultas a SQLite, pero aprender SQL directamente ayuda a entender y depurar lo que ocurre.

## 1. Conceptos

- **Base de datos:** conjunto de tablas, indices y otras estructuras.
- **Tabla:** conjunto de filas con columnas definidas.
- **Fila:** un registro, por ejemplo una Daily Task.
- **Columna:** un atributo, por ejemplo `name`.
- **Clave primaria:** identifica una fila.
- **Clave foranea:** relaciona una fila con otra tabla.
- **Restriccion:** regla que protege la integridad de los datos.
- **Indice:** estructura que acelera busquedas a cambio de espacio y costo de escritura.

## 2. Abrir una base de datos

Si la herramienta `sqlite3` esta instalada:

```bash
sqlite3 lease.db
```

Comandos de la consola:

```text
.tables
.schema daily_tasks
.headers on
.mode column
.quit
```

Estos comandos empiezan con punto y no son SQL.

## 3. Tipos de SQLite

SQLite usa afinidades de tipo: `INTEGER`, `REAL`, `TEXT`, `BLOB` y `NULL`.

- Booleanos: normalmente `INTEGER` con `0` y `1`.
- Fechas: frecuentemente texto ISO 8601, entero Unix o numero juliano.
- Horas recurrentes: pueden guardarse como `TEXT` (`22:00`) o minutos desde medianoche (`1320`).

Para Lease, una opcion clara es guardar minutos desde medianoche. Un horario que cruza medianoche se detecta cuando `end_minute <= start_minute`.

## 4. Crear tablas

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE daily_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    start_minute INTEGER NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
    end_minute INTEGER NOT NULL CHECK (end_minute BETWEEN 0 AND 1439),
    include_weekends INTEGER NOT NULL DEFAULT 0 CHECK (include_weekends IN (0, 1)),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE task_occurrences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    daily_task_id INTEGER NOT NULL,
    occurrence_date TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN (
        'pending', 'notified', 'snoozed', 'in_progress',
        'completed', 'skipped', 'cancelled', 'missed'
    )),
    scheduled_start TEXT NOT NULL,
    scheduled_end TEXT NOT NULL,
    notified_at TEXT,
    snoozed_until TEXT,
    started_at TEXT,
    finished_at TEXT,
    UNIQUE (daily_task_id, occurrence_date),
    FOREIGN KEY (daily_task_id) REFERENCES daily_tasks(id) ON DELETE CASCADE
);
```

`NOT NULL`, `CHECK`, `UNIQUE` y `FOREIGN KEY` protegen datos incluso si la aplicacion contiene un error.

## 5. Modificar y eliminar tablas

```sql
ALTER TABLE daily_tasks ADD COLUMN notes TEXT;
DROP TABLE task_occurrences;
```

En una aplicacion, los cambios de esquema deben hacerse mediante migraciones versionadas, no manualmente sobre la base de datos del usuario.

## 6. Insertar datos

Una fila:

```sql
INSERT INTO daily_tasks (
    name, start_minute, end_minute,
    include_weekends, enabled, created_at, updated_at
) VALUES (
    'Estudiar', 1320, 1380,
    0, 1, datetime('now'), datetime('now')
);
```

Varias filas:

```sql
INSERT INTO daily_tasks
    (name, start_minute, end_minute, include_weekends, enabled, created_at, updated_at)
VALUES
    ('Leer', 420, 450, 1, 1, datetime('now'), datetime('now')),
    ('Ejercicio', 1080, 1140, 0, 1, datetime('now'), datetime('now'));
```

Obtener la fila insertada:

```sql
INSERT INTO daily_tasks (...)
VALUES (...)
RETURNING *;
```

Nunca construyas SQL concatenando texto del usuario. Usa parametros desde SeaORM o SQLx para evitar inyeccion SQL.

## 7. Consultar con `SELECT`

```sql
SELECT * FROM daily_tasks;

SELECT id, name, start_minute
FROM daily_tasks
WHERE enabled = 1
ORDER BY start_minute ASC
LIMIT 10 OFFSET 0;
```

Operadores frecuentes:

```sql
WHERE start_minute >= 600 AND end_minute <= 720
WHERE enabled = 1 OR include_weekends = 1
WHERE name LIKE '%estudiar%'
WHERE status IN ('pending', 'notified')
WHERE finished_at IS NULL
WHERE id BETWEEN 1 AND 10
```

Con `NULL` se usa `IS NULL` o `IS NOT NULL`, no `= NULL`.

## 8. Actualizar

```sql
UPDATE daily_tasks
SET name = 'Estudiar Rust',
    updated_at = datetime('now')
WHERE id = 1;
```

Actualizar varias filas:

```sql
UPDATE daily_tasks
SET enabled = 0,
    updated_at = datetime('now')
WHERE include_weekends = 0;
```

Sin `WHERE`, se actualizan todas las filas. Antes de ejecutar un `UPDATE` complejo, prueba el mismo filtro con `SELECT`.

## 9. Eliminar

```sql
DELETE FROM daily_tasks WHERE id = 1;
```

Si la clave foranea tiene `ON DELETE CASCADE`, se eliminaran tambien sus ejecuciones. Sin `WHERE`, se eliminan todas las filas.

## 10. Agregaciones y agrupacion

```sql
SELECT status, COUNT(*) AS total
FROM task_occurrences
GROUP BY status
ORDER BY total DESC;
```

```sql
SELECT daily_task_id, COUNT(*) AS completadas
FROM task_occurrences
WHERE status = 'completed'
GROUP BY daily_task_id
HAVING COUNT(*) >= 5;
```

Funciones comunes: `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`. `WHERE` filtra filas antes de agrupar; `HAVING` filtra grupos.

## 11. `JOIN`

### `INNER JOIN`

Devuelve solo filas con relacion:

```sql
SELECT
    dt.name,
    o.occurrence_date,
    o.status
FROM daily_tasks AS dt
INNER JOIN task_occurrences AS o
    ON o.daily_task_id = dt.id
WHERE o.status = 'completed';
```

### `LEFT JOIN`

Incluye todas las tareas, incluso las que no tienen ejecuciones:

```sql
SELECT
    dt.name,
    COUNT(o.id) AS total_occurrences
FROM daily_tasks AS dt
LEFT JOIN task_occurrences AS o
    ON o.daily_task_id = dt.id
GROUP BY dt.id, dt.name;
```

### Encontrar tareas sin ejecuciones

```sql
SELECT dt.*
FROM daily_tasks AS dt
LEFT JOIN task_occurrences AS o
    ON o.daily_task_id = dt.id
WHERE o.id IS NULL;
```

`CROSS JOIN` produce combinaciones cartesianas; rara vez se necesita en Lease.

## 12. `UNION`, `UNION ALL`, `INTERSECT` y `EXCEPT`

Cada consulta debe devolver el mismo numero de columnas compatibles:

```sql
SELECT name, 'active' AS source
FROM daily_tasks
WHERE enabled = 1

UNION ALL

SELECT name, 'inactive' AS source
FROM daily_tasks
WHERE enabled = 0;
```

- `UNION`: une y elimina duplicados.
- `UNION ALL`: une y conserva duplicados; suele ser mas rapido.
- `INTERSECT`: filas presentes en ambos resultados.
- `EXCEPT`: filas del primer resultado ausentes en el segundo.

`ORDER BY` y `LIMIT` se colocan normalmente al final de toda la consulta compuesta.

## 13. Subconsultas y CTE

Subconsulta:

```sql
SELECT *
FROM daily_tasks
WHERE id IN (
    SELECT daily_task_id
    FROM task_occurrences
    WHERE status = 'missed'
);
```

CTE con `WITH`:

```sql
WITH completion_totals AS (
    SELECT daily_task_id, COUNT(*) AS total
    FROM task_occurrences
    WHERE status = 'completed'
    GROUP BY daily_task_id
)
SELECT dt.name, COALESCE(ct.total, 0) AS completed_total
FROM daily_tasks AS dt
LEFT JOIN completion_totals AS ct
    ON ct.daily_task_id = dt.id;
```

## 14. Transacciones

Una transaccion agrupa operaciones como una unidad:

```sql
BEGIN;

UPDATE task_occurrences
SET status = 'cancelled'
WHERE id = 10;

UPDATE daily_tasks
SET start_minute = 1260, updated_at = datetime('now')
WHERE id = 2;

COMMIT;
```

Si algo falla:

```sql
ROLLBACK;
```

Usa transacciones cuando varias escrituras deban completarse juntas o no completarse.

## 15. Indices y planes

```sql
CREATE INDEX idx_occurrences_task_date
ON task_occurrences (daily_task_id, occurrence_date);

CREATE INDEX idx_occurrences_status
ON task_occurrences (status);
```

Inspeccionar el plan:

```sql
EXPLAIN QUERY PLAN
SELECT * FROM task_occurrences WHERE status = 'pending';
```

No indexes todas las columnas. Crea indices para filtros, relaciones y ordenamientos usados con frecuencia.

## 16. UPSERT

```sql
INSERT INTO task_occurrences (
    daily_task_id, occurrence_date, status,
    scheduled_start, scheduled_end
) VALUES (1, '2026-09-18', 'pending', '2026-09-18T22:00:00', '2026-09-18T23:00:00')
ON CONFLICT (daily_task_id, occurrence_date)
DO UPDATE SET status = excluded.status;
```

## 17. Orden logico de una consulta

Aunque se escribe `SELECT` primero, piensa aproximadamente en este orden:

```text
FROM / JOIN
WHERE
GROUP BY
HAVING
SELECT
DISTINCT
ORDER BY
LIMIT / OFFSET
```

## 18. Practica recomendada

1. Crea las dos tablas en una base de prueba.
2. Inserta tres tareas.
3. Consulta solamente las activas.
4. Actualiza una hora.
5. Crea ejecuciones con estados diferentes.
6. Une tareas y ejecuciones con `INNER JOIN`.
7. Muestra tareas sin ejecuciones con `LEFT JOIN`.
8. Agrupa ejecuciones por estado.
9. Ejecuta todo dentro de una transaccion y prueba `ROLLBACK`.

Referencias: [lenguaje SQL de SQLite](https://www.sqlite.org/lang.html) y [SELECT/JOIN/consultas compuestas](https://www.sqlite.org/lang_select.html).
