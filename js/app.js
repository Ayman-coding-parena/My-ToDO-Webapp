"use strict";

const STORAGE_KEY = "my-todo-data";
const SETTINGS_KEY = "my-todo-settings";
const RING_CIRCUMFERENCE = 2 * Math.PI * 52;

function applyTheme(theme) {
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else if (theme === "gold") {
    document.documentElement.setAttribute("data-theme", "gold");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const colors = { dark: "#0b1220", light: "#eef2f7", gold: "#1a1410" };
    meta.content = colors[theme] || "#0b1220";
  }
}

// ── Data layer ─────────────────────────────────────────────

function emptyStore() {
  return { next_id: 1, tasks: [] };
}

function nowISO() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

class TodoStore {
  constructor() {
    this._data = emptyStore();
    this._persist = true;
    this._theme = "dark";
    this.loadSettings();
    this.load();
  }

  get persist() {
    return this._persist;
  }

  get theme() {
    return this._theme;
  }

  set theme(value) {
    this._theme = (value === "light" || value === "gold") ? value : "dark";
    this.saveSettings();
  }

  set persist(value) {
    const wasPersist = this._persist;
    this._persist = value;
    this.saveSettings();

    if (wasPersist !== value) {
      const other = value ? sessionStorage : localStorage;
      const current = value ? localStorage : sessionStorage;
      other.removeItem(STORAGE_KEY);
      this.save();
    }
  }

  get tasks() {
    return this._data.tasks;
  }

  storage() {
    return this._persist ? localStorage : sessionStorage;
  }

  loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const settings = JSON.parse(raw);
        this._persist = settings.persist !== false;
        this._theme = (settings.theme === "light" || settings.theme === "gold") ? settings.theme : "dark";
      }
    } catch {
      this._persist = true;
      this._theme = "dark";
    }
  }

  saveSettings() {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ persist: this._persist, theme: this._theme })
    );
  }

  load() {
    try {
      const raw = this.storage().getItem(STORAGE_KEY);
      if (!raw) {
        this._data = emptyStore();
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.tasks)) {
        this._data = emptyStore();
        return;
      }
      this._data = {
        next_id: Number(parsed.next_id) || 1,
        tasks: parsed.tasks.map(normalizeTask),
      };
    } catch {
      this._data = emptyStore();
    }
  }

  save() {
    this.storage().setItem(STORAGE_KEY, JSON.stringify(this._data));
  }

  addTask(title, description = "") {
    title = title.trim();
    if (!title) throw new Error("Task title cannot be empty.");

    const task = {
      id: this._data.next_id++,
      title,
      description: description.trim(),
      completed: false,
      created_at: nowISO(),
      order: this.tasks.length,
    };
    this.tasks.push(task);
    this.save();
    return task;
  }

  deleteTask(id) {
    const idx = this.tasks.findIndex((t) => t.id === id);
    if (idx === -1) throw new Error(`Task #${id} not found.`);
    const removed = this.tasks.splice(idx, 1)[0];
    this.reindexOrder();
    this.save();
    return removed;
  }

  toggleComplete(id, completed) {
    const task = this.getTask(id);
    if (!task) throw new Error(`Task #${id} not found.`);
    task.completed = completed;
    this.save();
    return task;
  }

  editTask(id, { title, description }) {
    const task = this.getTask(id);
    if (!task) throw new Error(`Task #${id} not found.`);

    if (title !== undefined) {
      title = title.trim();
      if (!title) throw new Error("Task title cannot be empty.");
      task.title = title;
    }
    if (description !== undefined) {
      task.description = description.trim();
    }
    this.save();
    return task;
  }

  clearCompleted() {
    const before = this.tasks.length;
    this._data.tasks = this.tasks.filter((t) => !t.completed);
    const removed = before - this.tasks.length;
    if (removed) {
      this.reindexOrder();
      this.save();
    }
    return removed;
  }

  getTask(id) {
    return this.tasks.find((t) => t.id === id) ?? null;
  }

  reorderTasks(orderedIds) {
    const map = new Map(this.tasks.map((t) => [t.id, t]));
    const reordered = [];
    for (const id of orderedIds) {
      const task = map.get(id);
      if (task) {
        task.order = reordered.length;
        reordered.push(task);
        map.delete(id);
      }
    }
    for (const task of map.values()) {
      task.order = reordered.length;
      reordered.push(task);
    }
    this._data.tasks = reordered;
    this.save();
  }

  reindexOrder() {
    this.tasks.forEach((t, i) => {
      t.order = i;
    });
  }

  progressStats() {
    const total = this.tasks.length;
    const completed = this.tasks.filter((t) => t.completed).length;
    const pct = total ? (completed / total) * 100 : 0;
    return { completed, total, active: total - completed, pct };
  }

  filterTasks(filterBy) {
    const sorted = [...this.tasks].sort((a, b) => a.order - b.order);
    if (filterBy === "active") return sorted.filter((t) => !t.completed);
    if (filterBy === "completed") return sorted.filter((t) => t.completed);
    return sorted;
  }

  searchTasks(keyword, filterBy) {
    const kw = keyword.trim().toLowerCase();
    let list = this.filterTasks(filterBy);
    if (!kw) return list;
    return list.filter((t) => {
      const haystack = `${t.title} ${t.description || ""}`.toLowerCase();
      return haystack.includes(kw);
    });
  }
}

function normalizeTask(task) {
  return {
    id: task.id,
    title: task.title || "",
    description: task.description || "",
    completed: Boolean(task.completed),
    created_at: task.created_at || nowISO(),
    order: typeof task.order === "number" ? task.order : 0,
  };
}

// ── UI ─────────────────────────────────────────────────────

class TodoApp {
  constructor() {
    this.store = new TodoStore();
    this.filter = "all";
    this.search = "";
    this.deleteTargetId = null;
    this.dragId = null;
    this.toastTimer = null;

    this.cacheElements();
    this.bindEvents();
    this.render();
  }

  cacheElements() {
    this.el = {
      addForm: document.getElementById("addForm"),
      taskTitle: document.getElementById("taskTitle"),
      taskDescription: document.getElementById("taskDescription"),
      taskList: document.getElementById("taskList"),
      emptyState: document.getElementById("emptyState"),
      emptyMessage: document.getElementById("emptyMessage"),
      searchInput: document.getElementById("searchInput"),
      filterBtns: document.querySelectorAll(".filter-btn"),
      clearCompletedBtn: document.getElementById("clearCompletedBtn"),
      statTotal: document.getElementById("statTotal"),
      statActive: document.getElementById("statActive"),
      statCompleted: document.getElementById("statCompleted"),
      progressPercent: document.getElementById("progressPercent"),
      progressBar: document.getElementById("progressBar"),
      progressCircle: document.getElementById("progressCircle"),
      progressRing: document.getElementById("progressRing"),
      settingsBtn: document.getElementById("settingsBtn"),
      settingsModal: document.getElementById("settingsModal"),
      closeSettings: document.getElementById("closeSettings"),
      saveSettings: document.getElementById("saveSettings"),
      persistToggle: document.getElementById("persistToggle"),
      themeSelect: document.getElementById("themeSelect"),
      deleteModal: document.getElementById("deleteModal"),
      deleteMessage: document.getElementById("deleteMessage"),
      cancelDelete: document.getElementById("cancelDelete"),
      confirmDelete: document.getElementById("confirmDelete"),
      toast: document.getElementById("toast"),
    };
  }

  bindEvents() {
    this.el.addForm.addEventListener("submit", (e) => {
      e.preventDefault();
      this.handleAdd();
    });

    this.el.searchInput.addEventListener("input", () => {
      this.search = this.el.searchInput.value;
      this.renderList();
    });

    this.el.filterBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        this.setFilter(btn.dataset.filter);
      });
    });

    this.el.clearCompletedBtn.addEventListener("click", () => {
      const count = this.store.clearCompleted();
      if (count) {
        this.showToast(`Cleared ${count} completed task${count > 1 ? "s" : ""}`);
        this.render();
      }
    });

    this.el.settingsBtn.addEventListener("click", () => this.openSettings());
    this.el.closeSettings?.addEventListener("click", () => this.closeSettings());
    this.el.saveSettings?.addEventListener("click", () => this.applySettings());
    this.el.settingsModal?.addEventListener("click", (e) => {
      if (e.target === this.el.settingsModal) this.closeSettings();
    });

    this.el.cancelDelete?.addEventListener("click", () => this.closeDeleteModal());
    this.el.confirmDelete?.addEventListener("click", () => this.confirmDelete());
    this.el.deleteModal?.addEventListener("click", (e) => {
      if (e.target === this.el.deleteModal) this.closeDeleteModal();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.closeAllModals();
      }
    });
  }

  openModal(overlay) {
    if (!overlay) return;
    this.closeAllModals();
    overlay.hidden = false;
    overlay.classList.add("is-open");
  }

  closeModal(overlay) {
    if (!overlay) return;
    overlay.hidden = true;
    overlay.classList.remove("is-open");
  }

  closeAllModals() {
    this.closeModal(this.el.settingsModal);
    this.closeModal(this.el.deleteModal);
    this.deleteTargetId = null;
  }

  handleAdd() {
    const title = this.el.taskTitle.value;
    const description = this.el.taskDescription.value;
    try {
      const task = this.store.addTask(title, description);
      this.el.taskTitle.value = "";
      this.el.taskDescription.value = "";
      this.el.taskTitle.focus();
      this.showToast(`Added "${task.title}"`);
      this.render();
    } catch (err) {
      this.showToast(err.message, true);
    }
  }

  setFilter(filter) {
    this.filter = filter;
    this.el.filterBtns.forEach((btn) => {
      const active = btn.dataset.filter === filter;
      btn.classList.toggle("filter-btn--active", active);
      btn.setAttribute("aria-selected", String(active));
    });
    this.renderList();
  }

  openSettings() {
    if (!this.el.settingsModal || !this.el.persistToggle) return;
    this.el.persistToggle.checked = this.store.persist;
    if (this.el.themeSelect) {
      this.el.themeSelect.value = this.store.theme;
    }
    this.openModal(this.el.settingsModal);
  }

  closeSettings() {
    this.closeModal(this.el.settingsModal);
  }

  applySettings() {
    if (!this.el.persistToggle) return;
    const newPersist = this.el.persistToggle.checked;
    const newTheme = this.el.themeSelect?.value || "dark";
    const persistChanged = newPersist !== this.store.persist;
    const themeChanged = newTheme !== this.store.theme;

    this.store.persist = newPersist;
    this.store.theme = newTheme;
    applyTheme(newTheme);

    this.closeSettings();

    if (themeChanged && !persistChanged) {
      const names = { dark: "Dark", light: "Light", gold: "Gold" };
      this.showToast(`${names[newTheme] || "Dark"} theme enabled`);
    } else if (persistChanged) {
      this.showToast(
        newPersist
          ? "Tasks will be remembered after closing the browser"
          : "Tasks will reset when you close this tab"
      );
    }
  }

  openDeleteModal(id) {
    if (!this.el.deleteModal || !this.el.deleteMessage) return;
    const task = this.store.getTask(id);
    if (!task) return;
    this.el.deleteMessage.textContent = `Delete "${task.title}"? This cannot be undone.`;
    this.openModal(this.el.deleteModal);
    this.deleteTargetId = id;
  }

  closeDeleteModal() {
    this.deleteTargetId = null;
    this.closeModal(this.el.deleteModal);
  }

  confirmDelete() {
    if (this.deleteTargetId === null) return;
    const id = this.deleteTargetId;
    try {
      const removed = this.store.deleteTask(id);
      this.closeDeleteModal();
      this.showToast(`Deleted "${removed.title}"`);
      this.render();
    } catch (err) {
      this.showToast(err.message, true);
    }
  }

  showToast(message, isError = false) {
    clearTimeout(this.toastTimer);
    this.el.toast.textContent = message;
    this.el.toast.style.background = isError ? "var(--danger)" : "var(--surface-2)";
    this.el.toast.style.borderColor = isError ? "var(--danger-dim)" : "var(--border)";
    this.el.toast.style.color = isError ? "#fff" : "var(--text)";
    this.el.toast.hidden = false;
    requestAnimationFrame(() => {
      this.el.toast.classList.add("toast--visible");
    });
    this.toastTimer = setTimeout(() => {
      this.el.toast.classList.remove("toast--visible");
      setTimeout(() => {
        this.el.toast.hidden = true;
      }, 300);
    }, 2500);
  }

  render() {
    this.renderStats();
    this.renderList();
  }

  renderStats() {
    const { completed, total, active, pct } = this.store.progressStats();
    this.el.statTotal.textContent = total;
    this.el.statActive.textContent = active;
    this.el.statCompleted.textContent = completed;
    this.el.progressPercent.textContent = `${Math.round(pct)}%`;
    this.el.progressBar.style.width = `${pct}%`;

    const offset = RING_CIRCUMFERENCE - (pct / 100) * RING_CIRCUMFERENCE;
    this.el.progressCircle.style.strokeDashoffset = offset;
    this.el.progressRing.setAttribute("aria-label", `${Math.round(pct)}% complete`);

    const hasCompleted = completed > 0;
    this.el.clearCompletedBtn.hidden = !hasCompleted;
  }

  renderList() {
    const tasks = this.store.searchTasks(this.search, this.filter);
    this.el.taskList.innerHTML = "";

    if (tasks.length === 0) {
      this.el.emptyState.hidden = false;
      this.el.emptyMessage.textContent = this.getEmptyMessage();
      return;
    }

    this.el.emptyState.hidden = true;

    for (const task of tasks) {
      this.el.taskList.appendChild(this.createTaskElement(task));
    }
  }

  getEmptyMessage() {
    if (this.search) return `No tasks match "${this.search}"`;
    if (this.filter === "active") return "No active tasks — you're all caught up!";
    if (this.filter === "completed") return "No completed tasks yet";
    return "No tasks yet — add one above!";
  }

  createTaskElement(task) {
    const li = document.createElement("li");
    li.className = "task-item" + (task.completed ? " task-item--completed" : "");
    li.dataset.id = task.id;
    li.draggable = true;

    li.innerHTML = `
      <span class="task-item__drag" title="Drag to reorder" aria-hidden="true">⠿</span>
      <input type="checkbox" class="task-item__check" ${task.completed ? "checked" : ""} aria-label="Mark complete" />
      <div class="task-item__body">
        <div class="task-item__title" data-field="title">${escapeHtml(task.title)}</div>
        ${task.description ? `<div class="task-item__desc" data-field="description">${escapeHtml(task.description)}</div>` : `<div class="task-item__desc" data-field="description"></div>`}
        <div class="task-item__meta">#${task.id} · ${formatDate(task.created_at)}</div>
      </div>
      <div class="task-item__actions">
        <button type="button" class="task-item__action task-item__action--edit" title="Edit" aria-label="Edit task">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button type="button" class="task-item__action task-item__action--delete" title="Delete" aria-label="Delete task">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>
    `;

    const checkbox = li.querySelector(".task-item__check");
    checkbox.addEventListener("change", () => {
      this.store.toggleComplete(task.id, checkbox.checked);
      this.render();
    });

    li.querySelector(".task-item__action--delete").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openDeleteModal(task.id);
    });

    li.querySelector(".task-item__action--edit").addEventListener("click", () => {
      this.startInlineEdit(li, task);
    });

    li.querySelector(".task-item__title").addEventListener("dblclick", () => {
      this.startInlineEdit(li, task);
    });

    li.querySelector(".task-item__desc").addEventListener("dblclick", () => {
      this.startInlineEdit(li, task);
    });

    this.bindDragEvents(li, task.id);

    return li;
  }

  startInlineEdit(li, task) {
    if (li.dataset.editing === "true") return;
    li.dataset.editing = "true";

    const titleEl = li.querySelector(".task-item__title");
    const descEl = li.querySelector(".task-item__desc");
    const actions = li.querySelector(".task-item__actions");
    actions.style.opacity = "0";
    actions.style.pointerEvents = "none";

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.className = "task-item__edit-input";
    titleInput.value = task.title;
    titleInput.maxLength = 200;

    const descInput = document.createElement("input");
    descInput.type = "text";
    descInput.className = "task-item__edit-input task-item__edit-input--desc";
    descInput.value = task.description || "";
    descInput.placeholder = "Description (optional)";
    descInput.maxLength = 500;

    titleEl.replaceWith(titleInput);
    descEl.replaceWith(descInput);
    titleInput.focus();
    titleInput.select();

    const save = () => {
      try {
        this.store.editTask(task.id, {
          title: titleInput.value,
          description: descInput.value,
        });
        this.showToast("Task updated");
        this.render();
      } catch (err) {
        this.showToast(err.message, true);
        titleInput.focus();
      }
    };

    const cancel = () => {
      li.dataset.editing = "false";
      this.renderList();
    };

    titleInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        save();
      } else if (e.key === "Escape") {
        cancel();
      }
    });

    descInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        save();
      } else if (e.key === "Escape") {
        cancel();
      }
    });

    titleInput.addEventListener("blur", () => {
      setTimeout(() => {
        if (!li.isConnected) return;
        if (document.activeElement === descInput) return;
        save();
      }, 100);
    });

    descInput.addEventListener("blur", () => {
      setTimeout(() => {
        if (!li.isConnected) return;
        if (document.activeElement === titleInput) return;
        save();
      }, 100);
    });
  }

  bindDragEvents(li, id) {
    li.addEventListener("dragstart", (e) => {
      this.dragId = id;
      li.classList.add("task-item--dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(id));
    });

    li.addEventListener("dragend", () => {
      this.dragId = null;
      li.classList.remove("task-item--dragging");
      this.el.taskList.querySelectorAll(".task-item--drag-over").forEach((el) => {
        el.classList.remove("task-item--drag-over");
      });
    });

    li.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (this.dragId !== id) {
        li.classList.add("task-item--drag-over");
      }
    });

    li.addEventListener("dragleave", () => {
      li.classList.remove("task-item--drag-over");
    });

    li.addEventListener("drop", (e) => {
      e.preventDefault();
      li.classList.remove("task-item--drag-over");
      const fromId = Number(e.dataTransfer.getData("text/plain"));
      const toId = id;
      if (fromId === toId) return;
      this.reorderByDrop(fromId, toId);
    });
  }

  reorderByDrop(fromId, toId) {
    const visibleIds = [...this.el.taskList.querySelectorAll(".task-item")].map((el) =>
      Number(el.dataset.id)
    );
    const fromIdx = visibleIds.indexOf(fromId);
    const toIdx = visibleIds.indexOf(toId);
    if (fromIdx === -1 || toIdx === -1) return;

    visibleIds.splice(fromIdx, 1);
    visibleIds.splice(toIdx, 0, fromId);

    const allSorted = [...this.store.tasks].sort((a, b) => a.order - b.order);
    const visibleSet = new Set(visibleIds);
    const hidden = allSorted.filter((t) => !visibleSet.has(t.id)).map((t) => t.id);
    const newOrder = [...visibleIds, ...hidden];

    this.store.reorderTasks(newOrder);
    this.renderList();
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const app = new TodoApp();
  applyTheme(app.store.theme);
});
