"use strict";

const STORAGE_KEY = "climblog.logs.v1";
const OWNER_TOKEN_KEY = "climblog.ownerToken.v1";
const BACKUP_VERSION = 1;
const SYNC_DOCUMENT_VERSION = 1;
const DESKTOP_HEATMAP_WEEKS = 53;
const PHONE_HEATMAP_WEEKS = 22;
const PHONE_HEATMAP_QUERY = "(max-width: 640px)";

const ACTIVITY_TYPES = [
  { id: "board", label: "Board", weight: 1.0 },
  { id: "sportLead", label: "Sport/Lead", weight: 1.0 },
  { id: "bouldering", label: "Bouldering", weight: 1.0 },
  { id: "outdoor", label: "Outdoor", weight: 1.0 },
  { id: "hangboard", label: "Hangboard", weight: 0.9 },
  { id: "weights", label: "Weights", weight: 0.7 },
  { id: "core", label: "Core", weight: 0.6 },
  { id: "cardio", label: "Cardio", weight: 0.5 },
  { id: "swimming", label: "Swim", weight: 0.4 },
  { id: "stretching", label: "Stretching", weight: 0.3 },
  { id: "other", label: "Other", weight: 0.5 }
];

const DURATION_OPTIONS = [15, 30, 45, 60, 75, 90, 120, 150, 180];
const ACTIVITY_BY_ID = new Map(ACTIVITY_TYPES.map((activity) => [activity.id, activity]));

const state = {
  logs: [],
  selectedType: "bouldering",
  selectedDate: null,
  editingId: null,
  apiUrl: "",
  ownerToken: "",
  syncConfigured: false,
  isSyncing: false,
  heatmapWeeks: DESKTOP_HEATMAP_WEEKS,
  lastSyncedAt: null
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  init().catch((error) => {
    setSyncStatus(`Startup warning: ${friendlyError(error)}`);
  });
});

async function init() {
  collectElements();
  state.apiUrl = getConfiguredApiUrl();
  state.syncConfigured = Boolean(state.apiUrl);
  state.ownerToken = loadOwnerToken();
  state.logs = loadLogs();
  state.heatmapWeeks = getHeatmapWeeks();
  els.date.value = localDateKey(new Date());
  renderActivityChips();
  renderDurationOptions();
  bindEvents();
  render();
  updateAccessMode();
  registerServiceWorker();
  await refreshFromRemote({ initial: true });
}

function collectElements() {
  els.form = document.querySelector("#log-form");
  els.formTitle = document.querySelector("#form-title");
  els.formStatus = document.querySelector("#form-status");
  els.cancelEdit = document.querySelector("#cancel-edit");
  els.date = document.querySelector("#entry-date");
  els.duration = document.querySelector("#duration");
  els.notes = document.querySelector("#notes");
  els.saveEntry = document.querySelector("#save-entry");
  els.activityChips = document.querySelector("#activity-chips");
  els.heatmapGrid = document.querySelector("#heatmap-grid");
  els.monthRow = document.querySelector("#month-row");
  els.heatmapRange = document.querySelector("#heatmap-range");
  els.todayScore = document.querySelector("#today-score");
  els.dayPanel = document.querySelector("#day-panel");
  els.dayTitle = document.querySelector("#day-title");
  els.daySummary = document.querySelector("#day-summary");
  els.dayEntryList = document.querySelector("#day-entry-list");
  els.clearDay = document.querySelector("#clear-day");
  els.totalHours = document.querySelector("#total-hours");
  els.activeDays = document.querySelector("#active-days");
  els.historyList = document.querySelector("#history-list");
  els.historyCount = document.querySelector("#history-count");
  els.exportData = document.querySelector("#export-data");
  els.importTrigger = document.querySelector("#import-trigger");
  els.importData = document.querySelector("#import-data");
  els.backupStatus = document.querySelector("#backup-status");
  els.modePill = document.querySelector("#mode-pill");
  els.syncStatus = document.querySelector("#sync-status");
  els.syncNow = document.querySelector("#sync-now");
  els.ownerToggle = document.querySelector("#owner-toggle");
  els.ownerForm = document.querySelector("#owner-form");
  els.ownerToken = document.querySelector("#owner-token");
}

function bindEvents() {
  els.form.addEventListener("submit", handleSubmit);
  els.cancelEdit.addEventListener("click", resetForm);
  els.exportData.addEventListener("click", exportBackup);
  els.importTrigger.addEventListener("click", () => {
    if (!canWrite()) {
      setBackupStatus("Owner mode required to import.");
      return;
    }
    els.importData.click();
  });
  els.importData.addEventListener("change", importBackup);
  els.syncNow.addEventListener("click", syncNow);
  els.ownerToggle.addEventListener("click", toggleOwnerMode);
  els.ownerForm.addEventListener("submit", saveOwnerToken);
  els.clearDay.addEventListener("click", clearSelectedDay);
  window.addEventListener("resize", handleViewportChange);
}

function renderActivityChips() {
  els.activityChips.replaceChildren();
  ACTIVITY_TYPES.forEach((activity) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "activity-chip";
    button.textContent = activity.label;
    button.disabled = !canWrite();
    button.setAttribute("aria-pressed", String(activity.id === state.selectedType));
    button.dataset.activityId = activity.id;
    button.addEventListener("click", () => {
      if (!canWrite()) {
        setFormStatus("Owner mode required to write.");
        return;
      }
      state.selectedType = activity.id;
      renderActivityChips();
    });
    els.activityChips.append(button);
  });
}

function renderDurationOptions() {
  els.duration.replaceChildren();
  DURATION_OPTIONS.forEach((minutes) => {
    const option = document.createElement("option");
    option.value = String(minutes);
    option.textContent = `${minutes} min`;
    if (minutes === 90) {
      option.selected = true;
    }
    els.duration.append(option);
  });
}

async function handleSubmit(event) {
  event.preventDefault();

  if (!canWrite()) {
    setFormStatus("Owner mode required to write.");
    return;
  }

  const date = els.date.value;
  const durationMinutes = Number(els.duration.value);
  const type = state.selectedType;
  const notes = els.notes.value.trim();

  if (!isValidDateKey(date) || !ACTIVITY_BY_ID.has(type) || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    setFormStatus("Check the date, activity, and duration.");
    return;
  }

  const now = new Date().toISOString();
  const message = state.editingId ? "Entry updated." : "Entry saved.";

  if (state.editingId) {
    const index = state.logs.findIndex((entry) => entry.id === state.editingId && !entry.deletedAt);
    if (index !== -1) {
      state.logs[index] = {
        ...state.logs[index],
        date,
        type,
        durationMinutes,
        notes,
        deletedAt: undefined,
        updatedAt: now
      };
    }
  } else {
    state.logs.push({
      id: createId(),
      date,
      type,
      durationMinutes,
      notes,
      createdAt: now,
      updatedAt: now
    });
  }

  saveLogs();
  resetForm({ keepStatus: true });
  render();
  await syncAfterLocalWrite(message, setFormStatus);
}

function setFormStatus(message) {
  els.formStatus.textContent = message;
}

function resetForm(options = {}) {
  state.editingId = null;
  state.selectedType = "bouldering";
  els.formTitle.textContent = "Log training";
  els.saveEntry.textContent = "Save entry";
  els.cancelEdit.classList.add("hidden");
  els.date.value = localDateKey(new Date());
  els.duration.value = "90";
  els.notes.value = "";
  if (!options.keepStatus) {
    setFormStatus("");
  }
  renderActivityChips();
}

function render() {
  renderHeatmap();
  renderSelectedDay();
  renderHistory();
  renderSummary();
  updateAccessMode();
}

function renderHeatmap() {
  const today = startOfLocalDay(new Date());
  const weekCount = state.heatmapWeeks;
  const firstDate = startOfWeek(addDays(today, -7 * (weekCount - 1)));
  const scores = buildDailyScores(getVisibleLogs());
  const todayKey = localDateKey(today);
  const cells = [];

  for (let week = 0; week < weekCount; week += 1) {
    for (let day = 0; day < 7; day += 1) {
      const date = addDays(firstDate, week * 7 + day);
      const dateKey = localDateKey(date);
      const score = scores.get(dateKey) || 0;
      cells.push({
        date,
        dateKey,
        score,
        level: scoreToLevel(score),
        week,
        day
      });
    }
  }

  setHeatmapColumns(weekCount);
  renderMonthLabels(firstDate, weekCount);
  els.heatmapGrid.replaceChildren(...cells.map((cell) => createHeatmapCell(cell, todayKey)));
  els.heatmapRange.textContent = `${formatDateShort(firstDate)} - ${formatDateShort(today)}`;
  els.todayScore.textContent = `Today ${(scores.get(todayKey) || 0).toFixed(1)}`;
}

function createHeatmapCell(cell, todayKey) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `heatmap-cell level-${cell.level}`;
  button.style.gridColumn = String(cell.week + 1);
  button.style.gridRow = String(cell.day + 1);
  button.setAttribute("role", "gridcell");
  button.setAttribute("aria-label", `${formatDateLong(cell.date)}: ${cell.score.toFixed(1)} training score`);
  button.title = `${formatDateLong(cell.date)}: ${cell.score.toFixed(1)}`;
  if (cell.dateKey === todayKey) {
    button.classList.add("today");
  }
  if (cell.dateKey === state.selectedDate) {
    button.classList.add("selected");
  }
  button.setAttribute("aria-selected", String(cell.dateKey === state.selectedDate));
  button.addEventListener("click", () => {
    state.selectedDate = cell.dateKey;
    if (canWrite()) {
      els.date.value = cell.dateKey;
      setFormStatus(`Selected ${formatDateLong(cell.date)}.`);
    }
    render();
  });
  return button;
}

function handleViewportChange() {
  const nextWeekCount = getHeatmapWeeks();
  if (nextWeekCount === state.heatmapWeeks) {
    return;
  }

  state.heatmapWeeks = nextWeekCount;
  render();
}

function getHeatmapWeeks() {
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(PHONE_HEATMAP_QUERY).matches
  ) {
    return PHONE_HEATMAP_WEEKS;
  }
  return DESKTOP_HEATMAP_WEEKS;
}

function setHeatmapColumns(weekCount) {
  els.monthRow.style.gridTemplateColumns = `var(--label-width) repeat(${weekCount}, var(--cell))`;
  els.heatmapGrid.style.gridTemplateColumns = `repeat(${weekCount}, var(--cell))`;
}

function clearSelectedDay() {
  state.selectedDate = null;
  render();
}

function renderSelectedDay() {
  if (!state.selectedDate) {
    els.dayPanel.classList.add("hidden");
    els.dayTitle.textContent = "Selected day";
    els.daySummary.textContent = "Click a heatmap day to inspect entries";
    els.dayEntryList.replaceChildren();
    return;
  }

  const entries = getVisibleLogs()
    .filter((entry) => entry.date === state.selectedDate)
    .sort(compareLogsDesc);
  const totalMinutes = entries.reduce((sum, entry) => sum + entry.durationMinutes, 0);
  const score = buildDailyScores(entries).get(state.selectedDate) || 0;
  const entryLabel = entries.length === 1 ? "entry" : "entries";

  els.dayPanel.classList.remove("hidden");
  els.dayTitle.textContent = formatDateLong(dateFromKey(state.selectedDate));
  els.daySummary.textContent = `${entries.length} ${entryLabel} · ${totalMinutes} min · Score ${score.toFixed(1)}`;

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No entries for this day.";
    els.dayEntryList.replaceChildren(empty);
    return;
  }

  els.dayEntryList.replaceChildren(...entries.map(createDayEntryItem));
}

function createDayEntryItem(entry) {
  const item = document.createElement("article");
  item.className = "day-entry-item";

  const main = document.createElement("div");
  main.className = "day-entry-main";

  const text = document.createElement("div");
  const title = document.createElement("div");
  title.className = "day-entry-title";

  const type = document.createElement("span");
  type.className = "history-type";
  type.textContent = activityLabel(entry.type);

  const duration = document.createElement("span");
  duration.className = "history-duration";
  duration.textContent = `${entry.durationMinutes} min`;

  title.append(type, duration);
  text.append(title);

  if (entry.notes) {
    const notes = document.createElement("p");
    notes.className = "history-notes";
    notes.textContent = entry.notes;
    text.append(notes);
  }

  main.append(text);

  if (canWrite()) {
    const actions = document.createElement("div");
    actions.className = "history-actions";

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "ghost-button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => editEntry(entry.id));

    const del = document.createElement("button");
    del.type = "button";
    del.className = "danger-button";
    del.textContent = "Delete";
    del.addEventListener("click", () => deleteEntry(entry.id));

    actions.append(edit, del);
    main.append(actions);
  }

  item.append(main);
  return item;
}

function renderMonthLabels(firstDate, weekCount) {
  const fragment = document.createDocumentFragment();
  const spacer = document.createElement("span");
  fragment.append(spacer);

  let lastMonth = "";
  for (let week = 0; week < weekCount; week += 1) {
    const weekStart = addDays(firstDate, week * 7);
    const labelDate = findMonthLabelDate(weekStart);
    if (!labelDate) {
      continue;
    }

    const monthName = labelDate.toLocaleDateString(undefined, { month: "short" });
    const monthKey = `${labelDate.getFullYear()}-${labelDate.getMonth()}`;
    if (monthKey === lastMonth) {
      continue;
    }

    lastMonth = monthKey;
    const label = document.createElement("span");
    label.className = "month-label";
    label.textContent = monthName;
    label.style.gridColumn = `${week + 2} / span 4`;
    fragment.append(label);
  }

  els.monthRow.replaceChildren(fragment);
}

function findMonthLabelDate(weekStart) {
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(weekStart, offset);
    if (date.getDate() <= 7) {
      return date;
    }
  }
  return null;
}

function buildDailyScores(logs) {
  const scores = new Map();
  logs.forEach((entry) => {
    const activity = ACTIVITY_BY_ID.get(entry.type);
    if (!activity) {
      return;
    }
    const score = (entry.durationMinutes / 60) * activity.weight;
    scores.set(entry.date, (scores.get(entry.date) || 0) + score);
  });
  return scores;
}

function scoreToLevel(score) {
  if (score <= 0) return 0;
  if (score <= 0.4) return 1;
  if (score <= 0.8) return 2;
  if (score <= 1.3) return 3;
  return 4;
}

function renderHistory() {
  const sorted = getVisibleLogs().sort(compareLogsDesc);
  const recent = sorted.slice(0, 30);
  els.historyCount.textContent = sorted.length === 1 ? "1 entry" : `${sorted.length} entries`;

  if (recent.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No entries yet.";
    els.historyList.replaceChildren(empty);
    return;
  }

  els.historyList.replaceChildren(...recent.map(createHistoryItem));
}

function createHistoryItem(entry) {
  const item = document.createElement("article");
  item.className = "history-item";

  const main = document.createElement("div");
  main.className = "history-main";

  const text = document.createElement("div");
  const title = document.createElement("div");
  title.className = "history-title";

  const type = document.createElement("span");
  type.className = "history-type";
  type.textContent = activityLabel(entry.type);

  const date = document.createElement("span");
  date.className = "history-date";
  date.textContent = formatDateKey(entry.date);

  title.append(type, date);

  const details = document.createElement("p");
  details.className = "history-duration";
  details.textContent = `${entry.durationMinutes} min`;

  text.append(title, details);

  if (entry.notes) {
    const notes = document.createElement("p");
    notes.className = "history-notes";
    notes.textContent = entry.notes;
    text.append(notes);
  }

  main.append(text);

  if (canWrite()) {
    const actions = document.createElement("div");
    actions.className = "history-actions";

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "ghost-button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => editEntry(entry.id));

    const del = document.createElement("button");
    del.type = "button";
    del.className = "danger-button";
    del.textContent = "Delete";
    del.addEventListener("click", () => deleteEntry(entry.id));

    actions.append(edit, del);
    main.append(actions);
  }

  item.append(main);
  return item;
}

function renderSummary() {
  const thirtyDaysAgo = localDateKey(addDays(new Date(), -29));
  const recentLogs = getVisibleLogs().filter((entry) => entry.date >= thirtyDaysAgo);
  const totalMinutes = recentLogs.reduce((sum, entry) => sum + entry.durationMinutes, 0);
  const activeDays = new Set(recentLogs.map((entry) => entry.date)).size;

  els.totalHours.textContent = String(Math.round(totalMinutes / 60));
  els.activeDays.textContent = String(activeDays);
}

function editEntry(id) {
  if (!canWrite()) {
    setFormStatus("Owner mode required to edit.");
    return;
  }

  const entry = getVisibleLogs().find((candidate) => candidate.id === id);
  if (!entry) {
    return;
  }

  state.editingId = id;
  state.selectedType = entry.type;
  els.formTitle.textContent = "Edit entry";
  els.saveEntry.textContent = "Update entry";
  els.cancelEdit.classList.remove("hidden");
  els.date.value = entry.date;
  els.duration.value = String(entry.durationMinutes);
  if (!Array.from(els.duration.options).some((option) => option.value === String(entry.durationMinutes))) {
    const option = document.createElement("option");
    option.value = String(entry.durationMinutes);
    option.textContent = `${entry.durationMinutes} min`;
    els.duration.append(option);
    els.duration.value = String(entry.durationMinutes);
  }
  els.notes.value = entry.notes || "";
  setFormStatus("Editing an existing entry.");
  renderActivityChips();
  els.form.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function deleteEntry(id) {
  if (!canWrite()) {
    setFormStatus("Owner mode required to delete.");
    return;
  }

  const entry = getVisibleLogs().find((candidate) => candidate.id === id);
  if (!entry) {
    return;
  }

  const confirmed = window.confirm(`Delete ${activityLabel(entry.type)} on ${formatDateKey(entry.date)}?`);
  if (!confirmed) {
    return;
  }

  const now = new Date().toISOString();
  state.logs = state.logs.map((candidate) => {
    if (candidate.id !== id) {
      return candidate;
    }
    return {
      ...candidate,
      deletedAt: now,
      updatedAt: now
    };
  });

  if (state.editingId === id) {
    resetForm();
  }
  saveLogs();
  render();
  await syncAfterLocalWrite("Entry deleted.", setFormStatus);
}

function exportBackup() {
  const today = localDateKey(new Date());
  const backup = {
    app: "ClimbLog",
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    logs: getVisibleLogs().sort(compareLogsDesc)
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `climblog-backup-${today}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setBackupStatus("Backup exported.");
}

async function importBackup(event) {
  const [file] = event.target.files;
  if (!file) {
    return;
  }

  if (!canWrite()) {
    setBackupStatus("Owner mode required to import.");
    event.target.value = "";
    return;
  }

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const importedLogs = Array.isArray(parsed) ? parsed : parsed.logs;
    if (!Array.isArray(importedLogs)) {
      throw new Error("Backup does not contain a logs array.");
    }

    const beforeCount = getVisibleLogs().length;
    const cleanLogs = normalizeLogArray(importedLogs).map((entry) => ({
      ...entry,
      deletedAt: undefined
    }));
    state.logs = mergeLogs(state.logs, cleanLogs);
    saveLogs();
    render();

    const changedCount = Math.max(0, getVisibleLogs().length - beforeCount);
    await syncAfterLocalWrite(`Imported ${changedCount} new or updated entries.`, setBackupStatus);
  } catch (error) {
    setBackupStatus(error instanceof Error ? error.message : "Import failed.");
  } finally {
    event.target.value = "";
  }
}

function setBackupStatus(message) {
  els.backupStatus.textContent = message;
}

async function syncNow() {
  if (!state.syncConfigured) {
    setSyncStatus("No sync API configured.");
    return;
  }

  if (canWrite()) {
    await syncLogs();
    return;
  }

  await refreshFromRemote({ manual: true });
}

function toggleOwnerMode() {
  if (!state.syncConfigured) {
    setSyncStatus("Add a ClimbLog API URL to enable shared sync.");
    return;
  }

  if (state.ownerToken) {
    state.ownerToken = "";
    saveOwnerTokenValue("");
    els.ownerToken.value = "";
    els.ownerForm.classList.add("hidden");
    resetForm();
    updateAccessMode();
    setSyncStatus("Read-only mode.");
    render();
    return;
  }

  els.ownerForm.classList.toggle("hidden");
  if (!els.ownerForm.classList.contains("hidden")) {
    els.ownerToken.focus();
  }
}

async function saveOwnerToken(event) {
  event.preventDefault();

  const token = els.ownerToken.value.trim();
  if (!token) {
    setSyncStatus("Enter an owner token.");
    return;
  }

  state.ownerToken = token;
  saveOwnerTokenValue(token);
  els.ownerForm.classList.add("hidden");
  updateAccessMode();
  setSyncStatus("Owner mode unlocked.");
  await syncLogs();
}

async function refreshFromRemote(options = {}) {
  if (!state.syncConfigured) {
    setSyncStatus("Local cache only.");
    updateAccessMode();
    return false;
  }

  setSyncing(true);
  setSyncStatus(options.manual ? "Refreshing..." : "Loading shared logs...");

  try {
    const document = await fetchRemoteDocument();
    const remoteLogs = normalizeLogArray(document.logs);
    const localLogs = normalizeLogArray(state.logs);
    const remoteVisibleCount = getVisibleLogs(remoteLogs).length;
    const localVisibleCount = getVisibleLogs(localLogs).length;

    if (remoteVisibleCount === 0 && localVisibleCount > 0) {
      state.logs = localLogs.sort(compareLogsDesc);
      render();
      setSyncStatus(canWrite()
        ? "Shared log is empty; click Sync now to publish local entries."
        : "Shared log is empty; unlock owner mode to publish local entries.");
      return true;
    }

    state.logs = canWrite()
      ? mergeLogs(remoteLogs, localLogs)
      : remoteLogs.sort(compareLogsDesc);
    state.lastSyncedAt = new Date();
    saveLogs();
    render();
    setSyncStatus(`${modeLabel()} synced ${formatTime(state.lastSyncedAt)}.`);
    return true;
  } catch (error) {
    const cached = getVisibleLogs().length;
    setSyncStatus(`Using local cache${cached ? "" : ""}: ${friendlyError(error)}`);
    return false;
  } finally {
    setSyncing(false);
  }
}

async function syncAfterLocalWrite(successMessage, setStatus) {
  if (!state.syncConfigured) {
    setStatus(successMessage);
    setSyncStatus("Local cache updated.");
    return true;
  }

  if (!state.ownerToken) {
    setStatus("Owner mode required to sync.");
    setSyncStatus("Read-only mode.");
    updateAccessMode();
    return false;
  }

  const synced = await syncLogs();
  setStatus(synced ? successMessage : "Saved locally; sync failed.");
  return synced;
}

async function syncLogs() {
  if (!state.syncConfigured) {
    setSyncStatus("Local cache only.");
    return true;
  }

  if (!state.ownerToken) {
    setSyncStatus("Owner token required to write.");
    return false;
  }

  setSyncing(true);
  setSyncStatus("Syncing...");

  try {
    const remoteDocument = await fetchRemoteDocument();
    const remoteLogs = remoteDocument.logs;
    const mergedLogs = mergeLogs(remoteLogs, state.logs);
    const savedDocument = await putRemoteDocument(mergedLogs);
    state.logs = normalizeLogArray(savedDocument.logs).sort(compareLogsDesc);
    state.lastSyncedAt = new Date();
    saveLogs();
    render();
    setSyncStatus(`Owner synced ${formatTime(state.lastSyncedAt)}.`);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      state.ownerToken = "";
      saveOwnerTokenValue("");
      els.ownerToken.value = "";
      els.ownerForm.classList.remove("hidden");
      setSyncStatus("Owner token rejected.");
    } else {
      setSyncStatus(`Sync failed: ${friendlyError(error)}`);
    }
    return false;
  } finally {
    setSyncing(false);
  }
}

async function fetchRemoteDocument() {
  const response = await fetch(logsEndpoint(), {
    headers: {
      Accept: "application/json"
    },
    cache: "no-store"
  });
  return readDocumentResponse(response);
}

async function putRemoteDocument(logs) {
  const document = {
    version: SYNC_DOCUMENT_VERSION,
    updatedAt: new Date().toISOString(),
    logs
  };

  const response = await fetch(logsEndpoint(), {
    method: "PUT",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${state.ownerToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(document)
  });
  return readDocumentResponse(response);
}

async function readDocumentResponse(response) {
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = data && typeof data.error === "string" ? data.error : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  return normalizeSyncDocument(data);
}

function logsEndpoint() {
  return `${state.apiUrl.replace(/\/+$/, "")}/logs`;
}

function normalizeSyncDocument(document) {
  const logs = Array.isArray(document) ? document : document?.logs;
  return {
    version: SYNC_DOCUMENT_VERSION,
    updatedAt: typeof document?.updatedAt === "string" ? document.updatedAt : "",
    logs: normalizeLogArray(Array.isArray(logs) ? logs : [])
  };
}

function updateAccessMode() {
  const readOnly = state.syncConfigured && !state.ownerToken;
  document.body.classList.toggle("read-only", readOnly);
  els.modePill.textContent = modeLabel();
  els.syncNow.disabled = !state.syncConfigured || state.isSyncing;
  els.ownerToggle.disabled = !state.syncConfigured || state.isSyncing;
  els.ownerToggle.textContent = state.ownerToken ? "Lock owner" : "Unlock owner";
  els.saveEntry.disabled = !canWrite() || state.isSyncing;
  els.importTrigger.disabled = !canWrite() || state.isSyncing;
  renderActivityChipsIfReady();
}

function renderActivityChipsIfReady() {
  if (els.activityChips && els.activityChips.children.length) {
    Array.from(els.activityChips.children).forEach((button) => {
      button.disabled = !canWrite();
    });
  }
}

function canWrite() {
  return !state.syncConfigured || Boolean(state.ownerToken);
}

function modeLabel() {
  if (!state.syncConfigured) {
    return "Local";
  }
  return state.ownerToken ? "Owner" : "Read-only";
}

function setSyncing(value) {
  state.isSyncing = value;
  updateAccessMode();
}

function setSyncStatus(message) {
  if (els.syncStatus) {
    els.syncStatus.textContent = message;
  }
}

function getConfiguredApiUrl() {
  const config = window.CLIMBLOG_CONFIG || {};
  const value = config.apiUrl || window.CLIMBLOG_API_URL || "";
  return String(value).trim().replace(/\/+$/, "");
}

function loadOwnerToken() {
  try {
    return window.localStorage.getItem(OWNER_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function saveOwnerTokenValue(value) {
  try {
    if (value) {
      window.localStorage.setItem(OWNER_TOKEN_KEY, value);
    } else {
      window.localStorage.removeItem(OWNER_TOKEN_KEY);
    }
  } catch {
    setSyncStatus("Could not update owner token storage.");
  }
}

function loadLogs() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    const logs = Array.isArray(parsed) ? parsed : parsed.logs;
    return normalizeLogArray(Array.isArray(logs) ? logs : []).sort(compareLogsDesc);
  } catch {
    return [];
  }
}

function saveLogs() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.logs));
  } catch {
    setSyncStatus("Could not update local cache.");
  }
}

function normalizeLogArray(logs) {
  if (!Array.isArray(logs)) {
    return [];
  }
  return logs.map(normalizeImportedLog).filter(Boolean);
}

function normalizeImportedLog(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const id = typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : createId();
  const date = typeof entry.date === "string" ? entry.date : "";
  const type = typeof entry.type === "string" ? migrateActivityType(entry.type) : "";
  const durationMinutes = Number(entry.durationMinutes);

  if (!isValidDateKey(date) || !ACTIVITY_BY_ID.has(type) || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return null;
  }

  const now = new Date().toISOString();
  const createdAt = typeof entry.createdAt === "string" ? entry.createdAt : now;
  const updatedAt = typeof entry.updatedAt === "string" ? entry.updatedAt : createdAt;
  const notes = typeof entry.notes === "string" ? entry.notes : "";
  const deletedAt = typeof entry.deletedAt === "string" && entry.deletedAt ? entry.deletedAt : undefined;

  return {
    id,
    date,
    type,
    durationMinutes,
    notes,
    createdAt,
    updatedAt,
    ...(deletedAt ? { deletedAt } : {})
  };
}

function mergeLogs(...sources) {
  const byId = new Map();

  sources.flat().forEach((entry) => {
    const normalized = normalizeImportedLog(entry);
    if (!normalized) {
      return;
    }

    const existing = byId.get(normalized.id);
    if (!existing || entryFreshness(normalized) >= entryFreshness(existing)) {
      byId.set(normalized.id, normalized);
    }
  });

  return Array.from(byId.values()).sort(compareLogsDesc);
}

function getVisibleLogs(logs = state.logs) {
  return logs.filter((entry) => !entry.deletedAt);
}

function entryFreshness(entry) {
  return Date.parse(entry.deletedAt || entry.updatedAt || entry.createdAt || "") || 0;
}

function compareLogsDesc(a, b) {
  const dateCompare = b.date.localeCompare(a.date);
  if (dateCompare !== 0) {
    return dateCompare;
  }
  return (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || "");
}

function activityLabel(type) {
  return ACTIVITY_BY_ID.get(type)?.label || "Other";
}

function migrateActivityType(type) {
  if (type === "yoga") {
    return "swimming";
  }
  return type;
}

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `log-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date) {
  const local = startOfLocalDay(date);
  return addDays(local, -local.getDay());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return startOfLocalDay(next);
}

function localDateKey(date) {
  const local = startOfLocalDay(date);
  const year = local.getFullYear();
  const month = String(local.getMonth() + 1).padStart(2, "0");
  const day = String(local.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isValidDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function dateFromKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateKey(dateKey) {
  return formatDateLong(dateFromKey(dateKey));
}

function formatDateLong(date) {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function formatDateShort(date) {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}

function formatTime(date) {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit"
  });
}

function friendlyError(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "network unavailable";
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !location.protocol.startsWith("http")) {
    return;
  }

  navigator.serviceWorker.register("./service-worker.js").catch(() => {
    // The app remains fully usable without offline shell caching.
  });
}
