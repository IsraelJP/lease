import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import "./App.css";

type Page = "dashboard" | "today" | "month" | "tasks";
type Theme = "light" | "dark";
type PomodoroPhase = "focus" | "break";

interface DailyTask {
  id: number;
  name: string;
  startMinute: number;
  endMinute: number;
  durationMinutes: number;
  color: string;
  categoryId: number | null;
  categoryName: string | null;
  includeWeekends: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface DailyPlan {
  id: number;
  dailyTaskId: number;
  taskName: string;
  taskColor: string;
  categoryName: string | null;
  scheduledDate: string;
  startMinute: number;
  endMinute: number;
  status: string;
}

interface DailyTaskForm {
  name: string;
  durationMinutes: number;
  color: string;
  categoryId: number | null;
  includeWeekends: boolean;
  enabled: boolean;
  replicateMonth: boolean;
  repeatMonth: string;
  repeatTime: string;
}

interface Category {
  id: number;
  name: string;
}

interface SelectOption {
  value: string | number;
  label: string;
  detail?: string;
}

interface GlassSelectProps {
  value: string | number;
  options: SelectOption[];
  onChange: (value: string | number) => void;
  placeholder?: string;
  ariaLabel: string;
}

function GlassSelect({ value, options, onChange, placeholder, ariaLabel }: GlassSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    function closeOnOutsideClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className={`glass-select ${open ? "open" : ""}`} ref={rootRef}>
      <button className="glass-select-trigger" type="button" onClick={() => setOpen((current) => !current)} aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open}>
        <span className={selected ? "" : "placeholder"}>{selected?.label ?? placeholder ?? "Seleccionar"}</span>
        <i>⌄</i>
      </button>
      {open && (
        <div className="glass-select-menu" role="listbox">
          {options.map((option) => (
            <button className={option.value === value ? "selected" : ""} type="button" role="option" aria-selected={option.value === value} onClick={() => { onChange(option.value); setOpen(false); }} key={String(option.value)}>
              <span>{option.label}{option.detail && <small>{option.detail}</small>}</span>
              {option.value === value && <b>✓</b>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface DragPayload {
  kind: "task" | "plan";
  id: number;
  duration: number;
}

const initialForm: DailyTaskForm = {
  name: "",
  durationMinutes: 60,
  color: "violet",
  categoryId: null,
  includeWeekends: false,
  enabled: true,
  replicateMonth: false,
  repeatMonth: dateValue(new Date()).slice(0, 7),
  repeatTime: "09:00",
};

const hours = Array.from({ length: 24 }, (_, hour) => hour);
const taskColors = ["violet", "blue", "cyan", "green", "yellow", "orange", "pink"];
const durationOptions: SelectOption[] = [
  [15, "15 minutos"], [30, "30 minutos"], [45, "45 minutos"], [60, "1 hora"],
  [90, "1 hora 30 minutos"], [120, "2 horas"], [180, "3 horas"], [240, "4 horas"],
  [360, "6 horas"], [480, "8 horas"],
].map(([value, label]) => ({ value, label })) as SelectOption[];
const timeOptions: SelectOption[] = Array.from({ length: 96 }, (_, index) => {
  const total = index * 15;
  return { value: minutesToTime(total), label: minutesToTime(total) };
});

function dateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function timeToMinutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function minutesToTime(total: number): string {
  const safeTotal = total === 1440 ? 0 : total;
  const hour = Math.floor(safeTotal / 60).toString().padStart(2, "0");
  const minute = (safeTotal % 60).toString().padStart(2, "0");
  return `${hour}:${minute}`;
}

function durationInMinutes(start: number, end: number): number {
  return end > start ? end - start : 1440 - start + end;
}

function durationLabel(start: number, end: number): string {
  const total = durationInMinutes(start, end);
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  if (hour === 0) return `${minute} min`;
  if (minute === 0) return `${hour} h`;
  return `${hour} h ${minute} min`;
}

function friendlyDate(value: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${value}T12:00:00`));
}

function monthTitle(value: string): string {
  return new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" })
    .format(new Date(`${value}-01T12:00:00`));
}

function calendarDays(month: string): Array<string | null> {
  const [year, monthNumber] = month.split("-").map(Number);
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const firstWeekday = (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7;
  const days: Array<string | null> = Array(firstWeekday).fill(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    days.push(`${month}-${String(day).padStart(2, "0")}`);
  }
  while (days.length % 7 !== 0) days.push(null);
  return days;
}

function errorMessage(error: unknown): string {
  return typeof error === "string" ? error : "Ocurrió un error inesperado.";
}

function timerLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

const LeaseApp = () => {
  const [page, setPage] = useState<Page>("dashboard");
  const [theme, setTheme] = useState<Theme>(() => {
    const savedTheme = localStorage.getItem("lease-theme");
    if (savedTheme === "light" || savedTheme === "dark") return savedTheme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [tasks, setTasks] = useState<DailyTask[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [plans, setPlans] = useState<DailyPlan[]>([]);
  const [monthPlans, setMonthPlans] = useState<DailyPlan[]>([]);
  const [selectedDate, setSelectedDate] = useState(dateValue(new Date()));
  const [selectedMonth, setSelectedMonth] = useState(dateValue(new Date()).slice(0, 7));
  const [form, setForm] = useState<DailyTaskForm>(initialForm);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingPlans, setIsLoadingPlans] = useState(true);
  const [isLoadingMonth, setIsLoadingMonth] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [timelineScale, setTimelineScale] = useState(52);
  const [pomodoroPlan, setPomodoroPlan] = useState<DailyPlan | null>(null);
  const [pomodoroPhase, setPomodoroPhase] = useState<PomodoroPhase>("focus");
  const [pomodoroSeconds, setPomodoroSeconds] = useState(25 * 60);
  const [pomodoroRunning, setPomodoroRunning] = useState(false);
  const [pomodoroCycles, setPomodoroCycles] = useState(0);
  const [focusMinutes, setFocusMinutes] = useState(() => {
    const saved = Number(localStorage.getItem("lease-pomodoro-focus"));
    return saved >= 5 && saved <= 90 ? saved : 25;
  });
  const [breakMinutes, setBreakMinutes] = useState(() => {
    const saved = Number(localStorage.getItem("lease-pomodoro-break"));
    return saved >= 1 && saved <= 30 ? saved : 5;
  });
  const [alertsEnabled, setAlertsEnabled] = useState(() => localStorage.getItem("lease-alerts-enabled") === "true");
  const [customSound, setCustomSound] = useState(() => localStorage.getItem("lease-alert-sound") ?? "");
  const [alertsPanelOpen, setAlertsPanelOpen] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<DailyTask | null>(null);
  const [isDeletingTask, setIsDeletingTask] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const scheduleScrollRef = useRef<HTMLDivElement>(null);
  const notifiedPlansRef = useRef(new Set<string>());
  const dragPayloadRef = useRef<DragPayload | null>(null);

  async function loadDailyTasks() {
    setIsLoading(true);
    try {
      setTasks(await invoke<DailyTask[]>("list_daily_tasks"));
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }

  async function loadCategories() {
    try {
      setCategories(await invoke<Category[]>("list_categories"));
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }

  async function loadDailyPlans(date: string) {
    setIsLoadingPlans(true);
    try {
      setPlans(await invoke<DailyPlan[]>("list_daily_plans", { scheduledDate: date }));
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setIsLoadingPlans(false);
    }
  }

  async function loadMonthPlans(month: string) {
    setIsLoadingMonth(true);
    try {
      setMonthPlans(await invoke<DailyPlan[]>("list_month_plans", { month }));
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setIsLoadingMonth(false);
    }
  }

  async function notificationPermission(): Promise<boolean> {
    if (await isPermissionGranted()) return true;
    return await requestPermission() === "granted";
  }

  async function showLeaseNotification(title: string, body: string, force = false) {
    if (!alertsEnabled && !force) return;
    if (!(await notificationPermission())) {
      setError("El sistema no concedió permiso para mostrar notificaciones.");
      return;
    }
    sendNotification({
      title,
      body,
      sound: customSound || undefined,
    });
  }

  async function toggleAlerts() {
    if (alertsEnabled) {
      setAlertsEnabled(false);
      return;
    }
    if (await notificationPermission()) {
      setAlertsEnabled(true);
      setMessage("Las alertas están activadas.");
    } else {
      setError("Necesitas permitir notificaciones desde la configuración del sistema.");
    }
  }

  async function chooseAlertSound() {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Sonidos", extensions: ["wav", "mp3", "ogg", "m4a"] }],
    });
    if (typeof selected === "string") {
      try {
        const importedPath = await invoke<string>("import_alert_sound", { sourcePath: selected });
        setCustomSound(importedPath);
        setMessage("El sonido personalizado quedó guardado en Lease.");
      } catch (soundError) {
        setError(errorMessage(soundError));
      }
    }
  }

  useEffect(() => {
    void loadDailyTasks();
    void loadCategories();
    const updateTimer = window.setTimeout(async () => {
      try {
        setAvailableUpdate(await check({ timeout: 15_000 }));
      } catch (updateError) {
        console.info("No se pudo comprobar si hay actualizaciones", updateError);
      }
    }, 2_500);
    return () => window.clearTimeout(updateTimer);
  }, []);

  async function installAvailableUpdate() {
    if (!availableUpdate || isInstallingUpdate) return;
    setIsInstallingUpdate(true);
    setUpdateProgress(0);
    let downloaded = 0;
    let total = 0;
    try {
      await availableUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setUpdateProgress(total > 0 ? Math.min(100, Math.round(downloaded / total * 100)) : null);
        }
        if (event.event === "Finished") setUpdateProgress(100);
      });
      await relaunch();
    } catch (updateError) {
      setError(`No se pudo instalar la actualización: ${errorMessage(updateError)}`);
      setIsInstallingUpdate(false);
    }
  }

  useEffect(() => {
    if (page !== "today" || !scheduleScrollRef.current) return;
    const today = dateValue(new Date());
    const targetHour = selectedDate === today ? Math.max(new Date().getHours() - 2, 0) : 7;
    requestAnimationFrame(() => {
      if (scheduleScrollRef.current) scheduleScrollRef.current.scrollTop = targetHour * timelineScale;
    });
  }, [page, selectedDate, timelineScale]);

  useEffect(() => {
    if (!pomodoroRunning || !pomodoroPlan) return;
    const interval = window.setInterval(() => {
      setPomodoroSeconds((current) => {
        if (current > 1) return current - 1;
        if (pomodoroPhase === "focus") {
          setPomodoroCycles((cycles) => cycles + 1);
          setPomodoroPhase("break");
          setMessage("Sesión de enfoque terminada. Es momento de descansar.");
          void showLeaseNotification("Enfoque completado", `Es momento de descansar de ${pomodoroPlan.taskName}.`);
          return breakMinutes * 60;
        }
        setPomodoroPhase("focus");
        setMessage("Descanso terminado. Tu siguiente sesión está lista.");
        void showLeaseNotification("Descanso completado", `Puedes continuar con ${pomodoroPlan.taskName}.`);
        return focusMinutes * 60;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [pomodoroRunning, pomodoroPlan, pomodoroPhase, focusMinutes, breakMinutes]);

  useEffect(() => {
    localStorage.setItem("lease-pomodoro-focus", String(focusMinutes));
    localStorage.setItem("lease-pomodoro-break", String(breakMinutes));
  }, [focusMinutes, breakMinutes]);

  useEffect(() => {
    localStorage.setItem("lease-alerts-enabled", String(alertsEnabled));
    localStorage.setItem("lease-alert-sound", customSound);
  }, [alertsEnabled, customSound]);

  useEffect(() => {
    if (!alertsEnabled) return;
    async function checkScheduledTasks() {
      const now = new Date();
      const todayValue = dateValue(now);
      const currentMinute = now.getHours() * 60 + now.getMinutes();
      try {
        const todayPlans = await invoke<DailyPlan[]>("list_daily_plans", { scheduledDate: todayValue });
        for (const plan of todayPlans) {
          const notificationKey = `${todayValue}-${plan.id}-${currentMinute}`;
          if (plan.startMinute === currentMinute && !notifiedPlansRef.current.has(notificationKey)) {
            notifiedPlansRef.current.add(notificationKey);
            await showLeaseNotification(
              `Es hora de ${plan.taskName}`,
              `${minutesToTime(plan.startMinute)}–${minutesToTime(plan.endMinute)} · ${plan.categoryName ?? "Tarea"}`,
            );
          }
        }
      } catch (notificationError) {
        console.error("No se pudieron revisar las alertas", notificationError);
      }
    }
    void checkScheduledTasks();
    const interval = window.setInterval(() => void checkScheduledTasks(), 15_000);
    return () => window.clearInterval(interval);
  }, [alertsEnabled, customSound]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("lease-theme", theme);
  }, [theme]);

  useEffect(() => {
    void loadDailyPlans(selectedDate);
  }, [selectedDate]);

  useEffect(() => {
    void loadMonthPlans(selectedMonth);
  }, [selectedMonth]);

  async function saveDailyTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.replicateMonth && timeToMinutes(form.repeatTime) + form.durationMinutes > 1440) {
      setError("La tarea no cabe completa a esa hora. Elige una hora más temprana.");
      return;
    }
    setIsSaving(true);
    setError(null);
    setMessage(null);
    try {
      const request = {
        name: form.name,
        durationMinutes: form.durationMinutes,
        color: form.color,
        categoryId: form.categoryId,
        includeWeekends: form.includeWeekends,
        enabled: form.enabled,
      };
      const task = editingTaskId === null
        ? await invoke<DailyTask>("create_daily_task", { request })
        : await invoke<DailyTask>("update_daily_task", {
            request: { id: editingTaskId, ...request },
          });

      setTasks((current) => editingTaskId === null
        ? [...current, task]
        : current.map((existing) => existing.id === task.id ? task : existing));
      let replicatedDays = 0;
      if (form.replicateMonth) {
        const createdPlans = await invoke<DailyPlan[]>("repeat_task_for_month", {
          request: {
            dailyTaskId: task.id,
            month: form.repeatMonth,
            startMinute: timeToMinutes(form.repeatTime),
          },
        });
        replicatedDays = createdPlans.length;
        setSelectedMonth(form.repeatMonth);
        await loadMonthPlans(form.repeatMonth);
        if (selectedDate.startsWith(form.repeatMonth)) await loadDailyPlans(selectedDate);
      }
      setForm(initialForm);
      setEditingTaskId(null);
      setMessage(form.replicateMonth
        ? replicatedDays === 0
          ? "Tarea guardada. Los días del mes ya estaban planificados."
          : `Tarea guardada y replicada en ${replicatedDays} días del mes.`
        : editingTaskId === null
          ? "La tarea se creó correctamente."
          : "La tarea se actualizó correctamente.");
    } catch (createError) {
      setError(errorMessage(createError));
    } finally {
      setIsSaving(false);
    }
  }

  function editTask(task: DailyTask) {
    setEditingTaskId(task.id);
    setForm({
      name: task.name,
      durationMinutes: task.durationMinutes,
      color: task.color,
      categoryId: task.categoryId,
      includeWeekends: task.includeWeekends,
      enabled: task.enabled,
      replicateMonth: false,
      repeatMonth: dateValue(new Date()).slice(0, 7),
      repeatTime: "09:00",
    });
    setMessage(null);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function addCategory() {
    if (!newCategoryName.trim()) return;
    setError(null);
    try {
      const category = await invoke<Category>("create_category", { name: newCategoryName });
      setCategories((current) => [...current, category]);
      setForm((current) => ({ ...current, categoryId: category.id }));
      setNewCategoryName("");
      setCategoryModalOpen(false);
    } catch (categoryError) {
      setError(errorMessage(categoryError));
    }
  }

  function cancelEditing() {
    setEditingTaskId(null);
    setForm(initialForm);
  }

  async function deleteTask(task: DailyTask) {
    setIsDeletingTask(true);
    setError(null);
    setMessage(null);
    try {
      await invoke("delete_daily_task", { id: task.id });
      setTasks((current) => current.filter((existing) => existing.id !== task.id));
      setPlans((current) => current.filter((plan) => plan.dailyTaskId !== task.id));
      if (editingTaskId === task.id) cancelEditing();
      setMessage("La tarea se eliminó correctamente.");
      setTaskToDelete(null);
    } catch (deleteError) {
      setError(errorMessage(deleteError));
    } finally {
      setIsDeletingTask(false);
    }
  }

  function startDraggingTask(event: DragEvent, task: DailyTask) {
    const payload: DragPayload = {
      kind: "task",
      id: task.id,
      duration: task.durationMinutes,
    };
    dragPayloadRef.current = payload;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/json", JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", JSON.stringify(payload));
  }

  function startDraggingPlan(event: DragEvent, plan: DailyPlan) {
    const payload: DragPayload = {
      kind: "plan",
      id: plan.id,
      duration: plan.endMinute - plan.startMinute,
    };
    dragPayloadRef.current = payload;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/json", JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", JSON.stringify(payload));
  }

  async function dropOnHour(event: DragEvent<HTMLDivElement>, hour: number) {
    event.preventDefault();
    const rawPayload = event.dataTransfer.getData("application/json") || event.dataTransfer.getData("text/plain");
    let payload = dragPayloadRef.current;
    if (rawPayload) {
      try {
        payload = JSON.parse(rawPayload) as DragPayload;
      } catch {
        // WebView2 can strip custom drag formats; the in-memory payload remains available.
      }
    }
    if (!payload) return;
    dragPayloadRef.current = null;
    const bounds = event.currentTarget.getBoundingClientRect();
    const minute = event.clientY - bounds.top > bounds.height / 2 ? 30 : 0;
    const startMinute = hour * 60 + minute;
    const endMinute = startMinute + payload.duration;
    if (endMinute > 1440) {
      setError("La tarea no cabe completa en ese horario. Elige una hora más temprana.");
      return;
    }

    setError(null);
    setMessage(null);
    try {
      if (payload.kind === "task") {
        const plan = await invoke<DailyPlan>("create_daily_plan", {
          request: {
            dailyTaskId: payload.id,
            scheduledDate: selectedDate,
            startMinute,
            endMinute,
          },
        });
        setPlans((current) => [...current, plan].sort((a, b) => a.startMinute - b.startMinute));
        if (plan.scheduledDate.startsWith(selectedMonth)) {
          setMonthPlans((current) => [...current, plan]);
        }
        setMessage("Tarea agregada al plan del día.");
      } else {
        await invoke("update_daily_plan", {
          request: { id: payload.id, startMinute, endMinute },
        });
        setPlans((current) => current
          .map((plan) => plan.id === payload.id ? { ...plan, startMinute, endMinute } : plan)
          .sort((a, b) => a.startMinute - b.startMinute));
      }
    } catch (dropError) {
      setError(errorMessage(dropError));
    }
  }

  async function removePlan(id: number) {
    try {
      await invoke("delete_daily_plan", { id });
      setPlans((current) => current.filter((plan) => plan.id !== id));
      setMonthPlans((current) => current.filter((plan) => plan.id !== id));
      if (pomodoroPlan?.id === id) {
        setPomodoroPlan(null);
        setPomodoroRunning(false);
      }
      setMessage("La tarea se retiró de este día.");
    } catch (removeError) {
      setError(errorMessage(removeError));
    }
  }

  function openPomodoro(plan: DailyPlan) {
    if (pomodoroPlan?.id === plan.id) return;
    setPomodoroPlan(plan);
    setPomodoroPhase("focus");
    setPomodoroSeconds(focusMinutes * 60);
    setPomodoroCycles(0);
    setPomodoroRunning(false);
  }

  async function openPomodoroPlayer() {
    if (!pomodoroPlan) return;
    const existing = await WebviewWindow.getByLabel("pomodoro-player");
    if (existing) await existing.close();
    const params = new URLSearchParams({
      pomodoro: "player",
      task: pomodoroPlan.taskName,
      color: pomodoroPlan.taskColor,
      focus: String(focusMinutes),
      break: String(breakMinutes),
    });
    const player = new WebviewWindow("pomodoro-player", {
      url: `index.html?${params.toString()}`,
      title: `Pomodoro · ${pomodoroPlan.taskName}`,
      width: 128,
      height: 128,
      minWidth: 128,
      minHeight: 128,
      maxWidth: 360,
      maxHeight: 470,
      resizable: false,
      maximizable: false,
      alwaysOnTop: false,
      skipTaskbar: true,
      center: true,
      decorations: false,
      transparent: true,
      shadow: false,
      focus: true,
    });
    player.once("tauri://created", () => {
      setPomodoroRunning(false);
      setPomodoroPlan(null);
    });
    player.once("tauri://error", (event) => {
      console.error("Error al abrir el reproductor Pomodoro", event.payload);
      setError(`No se pudo abrir el reproductor Pomodoro: ${String(event.payload)}`);
    });
  }

  function resetPomodoro() {
    setPomodoroRunning(false);
    setPomodoroSeconds((pomodoroPhase === "focus" ? focusMinutes : breakMinutes) * 60);
  }

  function skipPomodoroPhase() {
    setPomodoroPhase((phase) => {
      const nextPhase = phase === "focus" ? "break" : "focus";
      setPomodoroSeconds((nextPhase === "focus" ? focusMinutes : breakMinutes) * 60);
      return nextPhase;
    });
  }

  function closePomodoro() {
    setPomodoroRunning(false);
    setPomodoroPlan(null);
  }

  function moveDate(days: number) {
    const date = new Date(`${selectedDate}T12:00:00`);
    date.setDate(date.getDate() + days);
    setSelectedDate(dateValue(date));
  }

  function moveMonth(offset: number) {
    const date = new Date(`${selectedMonth}-01T12:00:00`);
    date.setMonth(date.getMonth() + offset);
    setSelectedMonth(dateValue(date).slice(0, 7));
  }

  const activeTasks = tasks.filter((task) => task.enabled);
  const plannedTaskIds = new Set(plans.map((plan) => plan.dailyTaskId));
  const availableTasks = activeTasks.filter((task) => !plannedTaskIds.has(task.id));
  const plannedMinutes = plans.reduce(
    (total, plan) => total + plan.endMinute - plan.startMinute,
    0,
  );
  const today = dateValue(new Date());
  const currentMinute = new Date().getHours() * 60 + new Date().getMinutes();
  const nextPlan = selectedDate === today
    ? plans.find((plan) => plan.endMinute > currentMinute)
    : plans[0];
  const pomodoroTotalSeconds = (pomodoroPhase === "focus" ? focusMinutes : breakMinutes) * 60;
  const pomodoroProgress = pomodoroTotalSeconds === 0
    ? 0
    : ((pomodoroTotalSeconds - pomodoroSeconds) / pomodoroTotalSeconds) * 100;

  const pageTitle = page === "dashboard" ? "Dashboard" : page === "today" ? "Mi día" : page === "month" ? "Mi mes" : "Tareas";
  const pageSubtitle = page === "dashboard"
    ? "Una vista rápida de tu rutina y lo que viene después."
    : page === "today"
      ? "Arrastra tus tareas al horario y construye el plan de hoy."
      : page === "month"
        ? "Visualiza tus rutinas y repeticiones a lo largo del mes."
      : "Crea y administra las tareas que utilizas para organizar tus días.";
  const categoryOptions: SelectOption[] = [
    { value: "", label: "Sin categoría" },
    ...categories.map((category) => ({ value: category.id, label: category.name })),
  ];
  const monthOptions: SelectOption[] = Array.from({ length: 30 }, (_, index) => {
    const date = new Date();
    date.setDate(1);
    date.setMonth(date.getMonth() - 6 + index);
    const value = dateValue(date).slice(0, 7);
    return { value, label: monthTitle(value) };
  });

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark"><img className="brand-logo" src="/lease-logo.png" alt="" /><span>Lease</span></div>
        <nav className="sidebar-nav" aria-label="Navegación principal">
          <button className={`nav-item ${page === "dashboard" ? "active" : ""}`} onClick={() => setPage("dashboard")} type="button"><span className="nav-icon">⌂</span><span>Dashboard</span></button>
          <button className={`nav-item ${page === "today" ? "active" : ""}`} onClick={() => setPage("today")} type="button"><span className="nav-icon">◷</span><span>Mi día</span></button>
          <button className={`nav-item ${page === "month" ? "active" : ""}`} onClick={() => setPage("month")} type="button"><span className="nav-icon">▦</span><span>Mi mes</span></button>
          <button className={`nav-item ${page === "tasks" ? "active" : ""}`} onClick={() => setPage("tasks")} type="button"><span className="nav-icon">✓</span><span>Tareas</span></button>
        </nav>
        <button className="alerts-button" type="button" onClick={() => setAlertsPanelOpen(true)}>
          <span className="alerts-icon">♬</span>
          <span>Alertas</span>
          <i className={alertsEnabled ? "alert-indicator enabled" : "alert-indicator"} />
        </button>
        <button
          className="theme-toggle"
          type="button"
          onClick={() => setTheme((current) => current === "light" ? "dark" : "light")}
          aria-label={`Cambiar a modo ${theme === "light" ? "oscuro" : "claro"}`}
          title={`Cambiar a modo ${theme === "light" ? "oscuro" : "claro"}`}
        >
          <span className="theme-toggle-icon">{theme === "light" ? "☾" : "☀"}</span>
          <span>{theme === "light" ? "Modo oscuro" : "Modo claro"}</span>
        </button>
        <div className="sidebar-note"><span className="status-dot" />Planificador activo</div>
      </aside>

      <main className={`main-content app-page ${page === "today" ? "planner-page" : ""} page-${page}`}>
        <header className="page-header" key={page}>
          <div>
            <p className="eyebrow">LEASE · ORGANIZA TU TIEMPO</p>
            <h1>{pageTitle}</h1>
            <p className="page-subtitle">{pageSubtitle}</p>
          </div>
          {(page === "dashboard" || page === "today") && (
            <div className="date-switcher">
              <button type="button" onClick={() => moveDate(-1)} aria-label="Día anterior">←</button>
              <button className="date-label" type="button" onClick={() => setSelectedDate(dateValue(new Date()))}>{friendlyDate(selectedDate)}</button>
              <button type="button" onClick={() => moveDate(1)} aria-label="Día siguiente">→</button>
            </div>
          )}
          {page === "month" && (
            <div className="date-switcher">
              <button type="button" onClick={() => moveMonth(-1)} aria-label="Mes anterior">←</button>
              <button className="date-label" type="button" onClick={() => setSelectedMonth(dateValue(new Date()).slice(0, 7))}>{monthTitle(selectedMonth)}</button>
              <button type="button" onClick={() => moveMonth(1)} aria-label="Mes siguiente">→</button>
            </div>
          )}
        </header>

        {(message || error) && (
          <div className={error ? "notice error-notice" : "notice success-notice"} role="status"><span>{error ? "!" : "✓"}</span>{error ?? message}</div>
        )}

        {page === "dashboard" && (
          <div className="page-body dashboard-page-body">
            <section className="stats-grid">
              <article className="stat-card"><span className="stat-label">Plan de hoy</span><strong>{plans.length}</strong><span className="stat-detail">actividades</span></article>
              <article className="stat-card accent-green"><span className="stat-label">Tiempo planeado</span><strong>{Math.round(plannedMinutes / 6) / 10}</strong><span className="stat-detail">horas enfocadas</span></article>
              <article className="stat-card accent-orange"><span className="stat-label">Tareas</span><strong>{activeTasks.length}</strong><span className="stat-detail">actividades disponibles</span></article>
            </section>
            <div className="dashboard-grid">
              <section className="panel dashboard-focus">
                <p className="panel-kicker">SIGUIENTE ACTIVIDAD</p>
                {nextPlan ? (
                  <><span className="focus-time">{minutesToTime(nextPlan.startMinute)}</span><h2>{nextPlan.taskName}</h2><p>{durationLabel(nextPlan.startMinute, nextPlan.endMinute)} reservados</p></>
                ) : (
                  <><span className="focus-time">—</span><h2>Día despejado</h2><p>Abre “Mi día” para comenzar a planear.</p></>
                )}
                <button className="primary-button compact" type="button" onClick={() => setPage("today")}>Abrir mi día <span>→</span></button>
              </section>
              <section className="panel agenda-preview">
                <div className="panel-heading"><div><p className="panel-kicker">AGENDA</p><h2>{friendlyDate(selectedDate)}</h2></div><span className="task-count">{plans.length}</span></div>
                {isLoadingPlans ? <p className="muted-copy">Cargando agenda…</p> : plans.length === 0 ? <p className="muted-copy">Todavía no hay actividades planeadas.</p> : plans.map((plan) => (
                  <div className="agenda-row" key={plan.id}><span>{minutesToTime(plan.startMinute)}</span><strong>{plan.taskName}</strong><small>{durationLabel(plan.startMinute, plan.endMinute)}</small></div>
                ))}
              </section>
            </div>
          </div>
        )}

        {page === "today" && (
          <div className="day-planner">
            <aside className="panel task-palette">
              <div className="panel-heading"><div><p className="panel-kicker">TAREAS</p><h2>Disponibles</h2></div><span className="task-count">{availableTasks.length}</span></div>
              <p className="drag-help">Arrastra una tarea hacia una hora del tablero.</p>
              <div className="palette-list">
                {isLoading ? <p className="muted-copy">Cargando…</p> : availableTasks.length === 0 ? (
                  <div className="palette-complete">
                    <span>✦</span>
                    <strong>{activeTasks.length === 0 ? "Aún no tienes tareas" : "¡Todo está planeado!"}</strong>
                    <small>{activeTasks.length === 0 ? "Crea tu primera tarea para comenzar." : "Quita una tarea del tablero para volver a usarla."}</small>
                    {activeTasks.length === 0 && <button type="button" onClick={() => setPage("tasks")}>Crear tarea →</button>}
                  </div>
                ) : availableTasks.map((task) => (
                  <article className="palette-card" data-task-color={task.color} draggable onDragStart={(event) => startDraggingTask(event, task)} key={task.id}>
                    <span className="drag-handle">⠿</span><div><strong>{task.name}</strong><small>{task.categoryName ?? "Sin categoría"}</small></div><span className="palette-time">{durationLabel(0, task.durationMinutes)}</span>
                  </article>
                ))}
              </div>
            </aside>

            <section className="panel schedule-panel">
              <div className="schedule-heading"><div><p className="panel-kicker">LÍNEA DE TIEMPO</p><h2>{friendlyDate(selectedDate)}</h2></div><div className="timeline-tools"><span>{isLoadingPlans ? "Cargando…" : `${plans.length} actividades`}</span><div className="scale-control"><button type="button" onClick={() => setTimelineScale((scale) => Math.max(36, scale - 8))} aria-label="Compactar tablero">−</button><span>{timelineScale <= 44 ? "Compacto" : timelineScale >= 68 ? "Amplio" : "Normal"}</span><button type="button" onClick={() => setTimelineScale((scale) => Math.min(84, scale + 8))} aria-label="Ampliar tablero">＋</button></div></div></div>
              <div className="schedule-scroll" ref={scheduleScrollRef}>
                <div className="schedule-canvas" style={{ "--hour-height": `${timelineScale}px` } as CSSProperties}>
                  {hours.map((hour) => (
                    <div className="hour-row" key={hour} onDragOver={(event) => event.preventDefault()} onDrop={(event) => void dropOnHour(event, hour)}>
                      <span className="hour-label">{String(hour).padStart(2, "0")}:00</span><div className="hour-line" />
                    </div>
                  ))}
                  <div className="plan-layer">
                    {plans.map((plan) => (
                      <article
                        className="scheduled-block"
                        data-task-color={plan.taskColor}
                        draggable
                        onDragStart={(event) => startDraggingPlan(event, plan)}
                        style={{ top: plan.startMinute * timelineScale / 60, height: Math.max((plan.endMinute - plan.startMinute) * timelineScale / 60, 34) }}
                        key={plan.id}
                      >
                        <div><strong>{plan.taskName}</strong><span>{minutesToTime(plan.startMinute)}–{minutesToTime(plan.endMinute)}</span></div>
                        <div className="scheduled-actions">
                          <button type="button" onClick={() => openPomodoro(plan)} aria-label={`Iniciar Pomodoro para ${plan.taskName}`} title="Modo enfoque">▶</button>
                          <button type="button" onClick={() => void removePlan(plan.id)} aria-label={`Quitar ${plan.taskName}`} title="Quitar del día">×</button>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {page === "month" && (
          <section className="panel month-panel">
            <div className="month-toolbar">
              <div>
                <p className="panel-kicker">CALENDARIO MENSUAL</p>
                <h2>{monthTitle(selectedMonth)}</h2>
              </div>
              <div className="month-legend"><span className="legend-dot" /> Las repeticiones respetan los fines de semana de cada tarea</div>
            </div>
            <div className="weekday-row">
              {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((day) => <span key={day}>{day}</span>)}
            </div>
            <div className="month-grid" aria-busy={isLoadingMonth}>
              {calendarDays(selectedMonth).map((date, index) => {
                if (!date) return <div className="month-cell outside" key={`empty-${index}`} />;
                const dayPlans = monthPlans.filter((plan) => plan.scheduledDate === date);
                const isToday = date === dateValue(new Date());
                return (
                  <button
                    className={`month-cell ${isToday ? "is-today" : ""}`}
                    type="button"
                    key={date}
                    onClick={() => { setSelectedDate(date); setPage("today"); }}
                  >
                    <span className="month-day-number">{Number(date.slice(-2))}</span>
                    <div className="month-events">
                      {dayPlans.slice(0, 3).map((plan) => (
                        <span className="month-event" data-task-color={plan.taskColor} key={plan.id}><b>{minutesToTime(plan.startMinute)}</b>{plan.taskName}</span>
                      ))}
                      {dayPlans.length > 3 && <span className="month-more">+{dayPlans.length - 3} más</span>}
                    </div>
                  </button>
                );
              })}
            </div>
            {isLoadingMonth && <div className="month-loading">Cargando planificación…</div>}
          </section>
        )}

        {page === "tasks" && (
          <div className="page-body tasks-page-body">
            <section className="stats-grid">
              <article className="stat-card"><span className="stat-label">Total</span><strong>{tasks.length}</strong><span className="stat-detail">tareas creadas</span></article>
              <article className="stat-card accent-green"><span className="stat-label">Activas</span><strong>{activeTasks.length}</strong><span className="stat-detail">listas para planear</span></article>
              <article className="stat-card accent-orange"><span className="stat-label">Fin de semana</span><strong>{tasks.filter((task) => task.includeWeekends).length}</strong><span className="stat-detail">disponibles todos los días</span></article>
            </section>
            <div className="workspace-grid">
              <section className="panel form-panel">
                <div className="panel-heading"><div><p className="panel-kicker">{editingTaskId === null ? "NUEVA TAREA" : "EDITANDO TAREA"}</p><h2>{editingTaskId === null ? "Crear tarea" : "Editar tarea"}</h2></div><span className="step-badge">{editingTaskId === null ? "＋" : "✎"}</span></div>
                <form onSubmit={saveDailyTask}>
                  <label className="field"><span>Nombre de la tarea</span><input type="text" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ej. Estudiar inglés" maxLength={80} required /></label>
                  <div className="category-picker-row">
                    <label className="field"><span>Categoría</span><GlassSelect ariaLabel="Seleccionar categoría" value={form.categoryId ?? ""} options={categoryOptions} onChange={(value) => setForm({ ...form, categoryId: value === "" ? null : Number(value) })} /></label>
                    <button className="add-category-button" type="button" onClick={() => setCategoryModalOpen(true)} aria-label="Crear nueva categoría" title="Nueva categoría">＋</button>
                  </div>
                  <label className="field duration-field">
                    <span>Duración</span>
                    <GlassSelect ariaLabel="Seleccionar duración" value={form.durationMinutes} options={durationOptions} onChange={(value) => setForm({ ...form, durationMinutes: Number(value) })} />
                    <small>Este será el espacio que ocupará al soltarla en el tablero.</small>
                  </label>
                  <fieldset className="color-field"><legend>Color de la tarea</legend><div className="color-options">{taskColors.map((color) => <button className={form.color === color ? "selected" : ""} data-task-color={color} type="button" onClick={() => setForm({ ...form, color })} aria-label={`Seleccionar color ${color}`} aria-pressed={form.color === color} key={color}><span /></button>)}</div></fieldset>
                  <div className="options-group">
                    <label className="check-row"><span><strong>Incluir fines de semana</strong><small>Disponible sábados y domingos</small></span><input type="checkbox" checked={form.includeWeekends} onChange={(event) => setForm({ ...form, includeWeekends: event.target.checked })} /><span className="toggle" /></label>
                    <label className="check-row"><span><strong>Activar tarea</strong><small>Mostrarla en el planificador</small></span><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} /><span className="toggle" /></label>
                    <label className="check-row"><span><strong>Replicar durante todo el mes</strong><small>La agregaremos automáticamente a cada día válido</small></span><input type="checkbox" checked={form.replicateMonth} onChange={(event) => setForm({ ...form, replicateMonth: event.target.checked })} /><span className="toggle" /></label>
                  </div>
                  {form.replicateMonth && (
                    <div className="replication-settings">
                      <label className="field"><span>Mes</span><GlassSelect ariaLabel="Seleccionar mes" value={form.repeatMonth} options={monthOptions} onChange={(value) => setForm({ ...form, repeatMonth: String(value) })} /></label>
                      <label className="field"><span>Hora diaria</span><GlassSelect ariaLabel="Seleccionar hora diaria" value={form.repeatTime} options={timeOptions} onChange={(value) => setForm({ ...form, repeatTime: String(value) })} /></label>
                      <p><span>✦</span> Se conservarán la misma hora y duración durante todo el mes.</p>
                    </div>
                  )}
                  <div className="form-actions">
                    {editingTaskId !== null && <button className="cancel-button" type="button" onClick={cancelEditing}>Cancelar</button>}
                    <button className="primary-button" type="submit" disabled={isSaving}>{isSaving ? "Guardando…" : editingTaskId === null ? "Crear tarea" : "Guardar cambios"}<span>→</span></button>
                  </div>
                </form>
              </section>

              <section className="panel tasks-panel">
                <div className="panel-heading list-heading"><div><p className="panel-kicker">BIBLIOTECA</p><h2>Tareas disponibles</h2></div><span className="task-count">{tasks.length}</span></div>
                <div className="task-list">
                  {isLoading ? <div className="empty-state"><div className="empty-icon loading-mark">↻</div><h3>Cargando tareas</h3></div> : tasks.length === 0 ? <div className="empty-state"><div className="empty-icon">＋</div><h3>Tu biblioteca está vacía</h3><p>Crea una tarea para comenzar.</p></div> : tasks.map((task) => (
                    <article className={`task-card ${task.enabled ? "" : "task-disabled"}`} data-task-color={task.color} key={task.id}>
                      <div className="task-duration-badge"><strong>{durationLabel(0, task.durationMinutes)}</strong><span>duración</span></div><div className="timeline"><span /></div>
                      <div className="task-info"><div className="task-title-row"><h3>{task.name}</h3><span className={task.enabled ? "status-pill" : "status-pill inactive"}>{task.enabled ? "Activa" : "Inactiva"}</span></div><p>{task.categoryName ?? "Sin categoría"}</p><div className="task-footer"><div className="task-tags"><span>{task.includeWeekends ? "Todos los días" : "Lunes a viernes"}</span></div><div className="task-actions"><button type="button" onClick={() => editTask(task)}>Editar</button><button className="danger-action" type="button" onClick={() => setTaskToDelete(task)}>Eliminar</button></div></div></div>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          </div>
        )}
      </main>

      {pomodoroPlan && (
        <aside className="pomodoro-widget" data-task-color={pomodoroPlan.taskColor} aria-live="polite">
          <div className="pomodoro-topbar">
            <div><span className="pomodoro-kicker">POMODORO · {pomodoroPhase === "focus" ? "ENFOQUE" : "DESCANSO"}</span><strong>{pomodoroPlan.taskName}</strong></div>
            <div className="pomodoro-window-actions"><button type="button" onClick={() => void openPomodoroPlayer()} aria-label="Abrir como mini reproductor" title="Abrir como ventana">↗</button><button type="button" onClick={closePomodoro} aria-label="Cerrar Pomodoro">×</button></div>
          </div>
          <div className="pomodoro-main">
            <div className="timer-ring" style={{ "--timer-progress": `${pomodoroProgress * 3.6}deg` } as CSSProperties}>
              <span>{timerLabel(pomodoroSeconds)}</span>
              <small>{pomodoroPhase === "focus" ? "concéntrate" : "respira"}</small>
            </div>
            <div className="pomodoro-controls">
              <button type="button" onClick={resetPomodoro} title="Reiniciar">↺</button>
              <button className="timer-play" type="button" onClick={() => setPomodoroRunning((running) => !running)}>{pomodoroRunning ? "Ⅱ" : "▶"}</button>
              <button type="button" onClick={skipPomodoroPhase} title="Siguiente fase">⇥</button>
            </div>
          </div>
          <div className="pomodoro-settings">
            <label>Enfoque <input type="number" min={5} max={90} value={focusMinutes} disabled={pomodoroRunning} onChange={(event) => { const value = Math.min(90, Math.max(5, Number(event.target.value))); setFocusMinutes(value); if (pomodoroPhase === "focus") setPomodoroSeconds(value * 60); }} /> min</label>
            <label>Descanso <input type="number" min={1} max={30} value={breakMinutes} disabled={pomodoroRunning} onChange={(event) => { const value = Math.min(30, Math.max(1, Number(event.target.value))); setBreakMinutes(value); if (pomodoroPhase === "break") setPomodoroSeconds(value * 60); }} /> min</label>
            <span>{pomodoroCycles} {pomodoroCycles === 1 ? "ciclo" : "ciclos"}</span>
          </div>
        </aside>
      )}

      {availableUpdate && (
        <div className="update-toast" role="dialog" aria-live="polite" aria-labelledby="update-title">
          <div className="update-symbol">↻</div>
          <div className="update-copy">
            <span>NUEVA VERSIÓN</span>
            <strong id="update-title">Lease {availableUpdate.version}</strong>
            <small>{isInstallingUpdate ? updateProgress === null ? "Descargando actualización…" : `Descargando… ${updateProgress}%` : availableUpdate.body || "Incluye mejoras y correcciones."}</small>
            {isInstallingUpdate && <div className="update-progress"><i style={{ width: `${updateProgress ?? 12}%` }} /></div>}
          </div>
          <div className="update-actions">
            {!isInstallingUpdate && <button type="button" onClick={() => { void availableUpdate.close(); setAvailableUpdate(null); }}>Después</button>}
            <button className="update-install" type="button" disabled={isInstallingUpdate} onClick={() => void installAvailableUpdate()}>{isInstallingUpdate ? "Instalando" : "Actualizar"}</button>
          </div>
        </div>
      )}

      {alertsPanelOpen && (
        <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAlertsPanelOpen(false); }}>
          <section className="alerts-panel" role="dialog" aria-modal="true" aria-labelledby="alerts-title">
            <div className="alerts-heading">
              <div><p className="panel-kicker">RECORDATORIOS</p><h2 id="alerts-title">Alertas y sonidos</h2></div>
              <button type="button" onClick={() => setAlertsPanelOpen(false)} aria-label="Cerrar configuración">×</button>
            </div>
            <label className="alert-master-row">
              <span><strong>Activar alertas</strong><small>Recibe un aviso al comenzar cada tarea y al cambiar de fase en Pomodoro.</small></span>
              <input type="checkbox" checked={alertsEnabled} onChange={() => void toggleAlerts()} />
              <span className="toggle" />
            </label>
            <div className="sound-setting">
              <div><strong>Sonido de alerta</strong><small>{customSound ? customSound.split(/[\\/]/).pop() : "Sonido predeterminado del sistema"}</small></div>
              <div className="sound-actions">
                {customSound && <button type="button" onClick={() => setCustomSound("")}>Restablecer</button>}
                <button type="button" onClick={() => void chooseAlertSound()}>Elegir archivo</button>
              </div>
            </div>
            <div className="alert-note"><span>i</span><p>Lease revisa el plan del día mientras la aplicación está ejecutándose, incluso si su ventana está oculta.</p></div>
            <button className="primary-button" type="button" onClick={() => void showLeaseNotification("Alerta de prueba", "Tus recordatorios de Lease están listos.", true)}>Probar alerta <span>♬</span></button>
          </section>
        </div>
      )}

      {taskToDelete && (
        <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isDeletingTask) setTaskToDelete(null); }}>
          <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-task-title" aria-describedby="delete-task-description">
            <div className="confirm-symbol" data-task-color={taskToDelete.color}>!</div>
            <p className="panel-kicker">CONFIRMAR ACCIÓN</p>
            <h2 id="delete-task-title">¿Eliminar “{taskToDelete.name}”?</h2>
            <p id="delete-task-description">La tarea también se quitará de todos los días donde esté planeada. Esta acción no se puede deshacer.</p>
            <div className="confirm-actions">
              <button className="cancel-button" type="button" onClick={() => setTaskToDelete(null)} disabled={isDeletingTask}>Conservar tarea</button>
              <button className="confirm-danger" type="button" onClick={() => void deleteTask(taskToDelete)} disabled={isDeletingTask}>{isDeletingTask ? "Eliminando…" : "Eliminar tarea"}</button>
            </div>
          </section>
        </div>
      )}

      {categoryModalOpen && (
        <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCategoryModalOpen(false); }}>
          <section className="category-dialog" role="dialog" aria-modal="true" aria-labelledby="category-dialog-title">
            <div className="category-dialog-heading">
              <div className="category-symbol">＋</div>
              <div><p className="panel-kicker">ORGANIZA TUS TAREAS</p><h2 id="category-dialog-title">Nueva categoría</h2></div>
              <button type="button" onClick={() => setCategoryModalOpen(false)} aria-label="Cerrar">×</button>
            </div>
            <label className="field category-name-field">
              <span>Nombre</span>
              <input autoFocus type="text" value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && newCategoryName.trim()) void addCategory(); }} placeholder="Ej. Salud, Finanzas, Lectura…" maxLength={40} />
              <small>{newCategoryName.length}/40 caracteres</small>
            </label>
            <div className="confirm-actions">
              <button className="cancel-button" type="button" onClick={() => { setCategoryModalOpen(false); setNewCategoryName(""); }}>Cancelar</button>
              <button className="primary-button" type="button" onClick={() => void addCategory()} disabled={!newCategoryName.trim()}>Crear categoría <span>→</span></button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

const PomodoroPlayer = () => {
  const params = new URLSearchParams(window.location.search);
  const taskName = params.get("task") ?? "Sesión de enfoque";
  const taskColor = params.get("color") ?? "violet";
  const focusDuration = Math.min(90, Math.max(5, Number(params.get("focus")) || 25));
  const breakDuration = Math.min(30, Math.max(1, Number(params.get("break")) || 5));
  const [phase, setPhase] = useState<PomodoroPhase>("focus");
  const [seconds, setSeconds] = useState(focusDuration * 60);
  const [running, setRunning] = useState(false);
  const [cycles, setCycles] = useState(0);
  const [compact, setCompact] = useState(true);
  const [pinned, setPinned] = useState(false);

  async function notifyPhase(title: string, body: string) {
    let granted = await isPermissionGranted();
    if (!granted) granted = await requestPermission() === "granted";
    if (granted) sendNotification({ title, body, sound: localStorage.getItem("lease-alert-sound") || undefined });
  }

  useEffect(() => {
    document.documentElement.dataset.theme = (localStorage.getItem("lease-theme") as Theme | null) ?? "dark";
    document.documentElement.classList.add("pomodoro-player-root");
    document.body.classList.add("pomodoro-player-body");
    return () => {
      document.documentElement.classList.remove("pomodoro-player-root");
      document.body.classList.remove("pomodoro-player-body");
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => {
      setSeconds((current) => {
        if (current > 1) return current - 1;
        if (phase === "focus") {
          setCycles((value) => value + 1);
          setPhase("break");
          void notifyPhase("Pomodoro completado", `Descansa después de trabajar en ${taskName}.`);
          return breakDuration * 60;
        }
        setPhase("focus");
        void notifyPhase("Descanso terminado", `Continúa con ${taskName}.`);
        return focusDuration * 60;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [running, phase, taskName, focusDuration, breakDuration]);

  function reset() {
    setRunning(false);
    setSeconds((phase === "focus" ? focusDuration : breakDuration) * 60);
  }

  function nextPhase() {
    setPhase((current) => {
      const next = current === "focus" ? "break" : "focus";
      setSeconds((next === "focus" ? focusDuration : breakDuration) * 60);
      return next;
    });
  }

  function startMovingPlayer(event: ReactMouseEvent<HTMLElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    void getCurrentWindow().startDragging();
  }

  async function toggleCompactPlayer() {
    const nextCompact = !compact;
    await getCurrentWindow().setSize(
      nextCompact ? new LogicalSize(128, 128) : new LogicalSize(360, 470),
    );
    setCompact(nextCompact);
  }

  async function togglePinnedPlayer() {
    const nextPinned = !pinned;
    await getCurrentWindow().setAlwaysOnTop(nextPinned);
    setPinned(nextPinned);
  }

  const total = (phase === "focus" ? focusDuration : breakDuration) * 60;
  const progress = ((total - seconds) / total) * 360;

  return (
    <main className={`mini-pomodoro ${compact ? "compact" : "expanded"}`} data-task-color={taskColor} title={compact ? "Arrastra para mover · Doble clic para ampliar" : undefined}>
      <header className="mini-player-titlebar" data-tauri-drag-region onMouseDown={startMovingPlayer}>
        <div data-tauri-drag-region><img src="/lease-logo.png" alt="" /><span data-tauri-drag-region>POMODORO</span></div>
        <div><button className={pinned ? "pin-button pinned" : "pin-button"} type="button" onClick={() => void togglePinnedPlayer()} aria-label={pinned ? "Desanclar ventana" : "Anclar siempre encima"} title={pinned ? "Desanclar" : "Mantener encima"}>◆</button><button type="button" onClick={() => void toggleCompactPlayer()} aria-label={compact ? "Abrir reproductor grande" : "Vista compacta"} title={compact ? "Abrir reproductor grande" : "Vista compacta"}>{compact ? "↗" : "↙"}</button><button type="button" onClick={() => void getCurrentWindow().minimize()} aria-label="Minimizar">−</button><button type="button" onClick={() => void getCurrentWindow().close()} aria-label="Cerrar">×</button></div>
      </header>
      <section className="mini-player-content" data-tauri-drag-region={compact ? true : undefined} onMouseDown={compact ? startMovingPlayer : undefined} onDoubleClick={compact ? () => void toggleCompactPlayer() : undefined}>
        <div className="mini-phase"><span>{phase === "focus" ? "● ENFOQUE" : "☕ DESCANSO"}</span><small>Ciclo {cycles + 1}</small></div>
        <h1>{taskName}</h1>
        <div className="mini-timer-ring" style={{ "--timer-progress": `${progress}deg` } as CSSProperties}>
          <div><strong>{timerLabel(seconds)}</strong><small>{phase === "focus" ? "mantén el enfoque" : "tómate un respiro"}</small></div>
        </div>
        <div className="mini-player-controls">
          <button type="button" onClick={reset} title="Reiniciar">↺</button>
          <button className="mini-play" type="button" onClick={() => setRunning((value) => !value)} onDoubleClick={(event) => event.stopPropagation()} aria-label={running ? "Pausar" : "Iniciar"}>{running ? "Ⅱ" : "▶"}</button>
          <button type="button" onClick={nextPhase} title="Siguiente fase">⇥</button>
          {compact && <button className={pinned ? "mini-pin pinned" : "mini-pin"} type="button" onClick={() => void togglePinnedPlayer()} onDoubleClick={(event) => event.stopPropagation()} aria-label={pinned ? "Desanclar ventana" : "Mantener delante de otras aplicaciones"} title={pinned ? "Desanclar" : "Mantener siempre visible"}>◆</button>}
        </div>
        <footer><span>{focusDuration} min enfoque</span><i /><span>{breakDuration} min descanso</span><i /><span>{cycles} ciclos</span></footer>
      </section>
    </main>
  );
};

const App = () => new URLSearchParams(window.location.search).get("pomodoro") === "player"
  ? <PomodoroPlayer />
  : <LeaseApp />;

export default App;
