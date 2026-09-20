# Reglas de una Daily Task

## Definicion

Una **Daily Task** es una tarea recurrente que se realiza todos los dias habilitados dentro de una ventana de tiempo fija.

La tarea no tiene una fecha unica de ejecucion. En su lugar, define una regla diaria compuesta, como minimo, por:

- Un nombre.
- Una hora de inicio.
- Una hora de finalizacion.
- La configuracion para incluir o excluir fines de semana.
- Un indicador que determina si la tarea esta activa.

Por defecto, una semana esta formada por los dias de lunes a viernes. Cuando se habilita la opcion de fines de semana, la tarea tambien se ejecuta los sabados y domingos.

Aunque la definicion de la Daily Task no tenga una fecha, cada ejecucion diaria debe estar asociada internamente con el dia en que ocurre. Esto permite conservar el historial y conocer si la tarea de un dia fue completada, omitida, cancelada o no realizada.

## Ventana de tiempo fija

La hora de inicio y la hora final forman una ventana fija. La hora final nunca se desplaza aunque el usuario comience tarde, posponga, cancele o reinicie la tarea.

Ejemplo:

```text
Tarea: Estudiar
Ventana: 22:00-23:00
Inicio real: 22:02
Tiempo disponible: 58 minutos
Fin obligatorio: 23:00
```

La regla general es:

```text
hora de inicio <= ejecucion < hora final
```

Por tanto:

- La tarea no puede iniciarse antes de su hora de inicio.
- La tarea no puede iniciarse ni reiniciarse despues de su hora final.
- Comenzar tarde reduce el tiempo disponible.
- Posponer reduce el tiempo disponible.
- Reiniciar no recupera tiempo ni crea una ventana nueva.
- Si la tarea esta ejecutandose al llegar la hora final, su ejecucion termina automaticamente.

El tiempo restante se calcula con la hora actual y la hora final programada; no se calcula a partir de la hora real de inicio:

```text
tiempo restante = hora final programada - hora actual
```

## Alertas

Cuando llega la hora inicial, la aplicacion debe avisar que es momento de comenzar la tarea.

Desde la alerta, el usuario puede:

- Iniciar la tarea.
- Posponerla cinco minutos.
- Omitirla durante ese dia.

Una tarea solo puede posponerse cuando el nuevo recordatorio todavia quede dentro de su ventana:

```text
hora actual + 5 minutos < hora final
```

Si no quedan cinco minutos completos, la aplicacion debe impedir la posposicion e informar cuanto tiempo queda disponible.

## Estados de una ejecucion diaria

Cada ejecucion diaria puede pasar por los siguientes estados:

- **Pendiente:** su ventana aun no comienza o todavia espera la respuesta del usuario.
- **Notificada:** la alerta ya fue mostrada.
- **Pospuesta:** el usuario solicito recibir otra alerta cinco minutos despues.
- **En progreso:** el usuario inicio la tarea dentro de su ventana.
- **Completada:** la tarea llego al final establecido para una ejecucion valida.
- **Omitida:** el usuario decidio expresamente no realizarla ese dia.
- **Cancelada:** el usuario la inicio, pero la detuvo antes de completar su ejecucion.
- **No realizada:** la ventana termino sin que el usuario iniciara u omitiera expresamente la tarea.

Flujo principal:

```text
Pendiente
   |
   +-- llega la hora --> Notificada
                            |
                            +-- iniciar ----> En progreso --> Completada
                            +-- posponer ---> Pospuesta -----> Notificada
                            +-- omitir -----> Omitida

Pendiente/Notificada -- termina la ventana --> No realizada
En progreso --------- cancelar -------------> Cancelada
```

## Cancelacion y reinicio

El usuario puede cancelar una tarea que se encuentra en progreso. Despues puede reiniciarla solamente si la hora actual continua dentro de la ventana original.

Ejemplo:

```text
Ventana: 22:00-23:00
Cancelacion: 22:30
Reinicio: 22:40
Tiempo disponible despues del reinicio: 20 minutos
Fin obligatorio: 23:00
```

Reiniciar la tarea no modifica su hora final y no devuelve el tiempo utilizado antes de la cancelacion.

## Aplicacion abierta despues de la hora inicial

Si la aplicacion se abre despues de la hora inicial, pero antes de la hora final, debe mostrar la alerta inmediatamente.

Si la aplicacion se abre despues de que termino la ventana, la ejecucion correspondiente debe considerarse **no realizada**. La aplicacion puede mostrar una notificacion informativa indicando que esa tarea ya paso.

## Suspension de la computadora

Si la computadora estaba suspendida cuando debia aparecer la alerta, la tarea permanece pendiente. Cuando la computadora se reactive:

- Si todavia esta dentro de la ventana, la aplicacion muestra la alerta inmediatamente.
- Si la ventana ya termino, la ejecucion se marca como no realizada y se muestra una notificacion informativa.

Este caso no se considera una posposicion porque el usuario no solicito posponer la tarea.

## Cambio de horario

El horario de una Daily Task puede modificarse. Sin embargo, no se debe cambiar mientras su ejecucion actual este en progreso.

Para modificarla, el usuario debe cancelar primero la ejecucion activa. El nuevo horario se aplica a las siguientes ejecuciones y no modifica el historial anterior.

## Tareas que atraviesan la medianoche

Una tarea puede comenzar antes de la medianoche y terminar al dia siguiente.

Ejemplo:

```text
Inicio: lunes 23:00
Fin: martes 01:00
Dia al que pertenece: lunes
```

La ejecucion pertenece al dia en que comienza, aunque finalice durante el dia siguiente. Internamente deben utilizarse una fecha y hora completas para distinguir correctamente el inicio y el final.

## Superposicion de tareas

No se permiten dos Daily Tasks cuyas ventanas de ejecucion se superpongan.

Estas tareas no son validas porque se superponen:

```text
Estudiar:  22:00-23:00
Ejercicio: 22:30-23:30
```

La comprobacion tambien debe funcionar con tareas que atraviesan la medianoche:

```text
Trabajo: 23:00-01:00
Lectura: 00:30-02:00
```

Una tarea puede comenzar exactamente cuando termina otra:

```text
Estudiar: 22:00-23:00
Leer:     23:00-23:30
```

## Zona horaria

La aplicacion debe respetar la zona horaria local del sistema.

Las siguientes ejecuciones mantienen su hora local programada aunque cambie la zona horaria. Por ejemplo, una tarea configurada para las 22:00 debe continuar ocurriendo a las 22:00 locales.

Una ejecucion que ya esta en progreso debe conservar la hora limite con la que comenzo, evitando que un cambio de zona horaria modifique inesperadamente su ventana activa.

## Ejecucion en segundo plano

Las alertas funcionan mientras la aplicacion esta:

- Abierta y visible.
- Ejecutandose en segundo plano.
- Oculta en la bandeja del sistema.

Cerrar la ventana debe ocultar la aplicacion sin terminar necesariamente su proceso. Debe existir una accion separada para salir completamente.

Si el usuario sale completamente, se le debe advertir que no recibira recordatorios. Para mantener las alertas despues de reiniciar la computadora, la aplicacion debera poder configurarse para ejecutarse durante el inicio del sistema operativo.

## Regla resumida

> Una Daily Task es una actividad recurrente que dispone de una ventana fija diaria. Puede iniciarse, posponerse, omitirse, cancelarse o reiniciarse solamente dentro de esa ventana. La hora final nunca se desplaza.
