import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const config = window.APP_CONFIG || {};
const configured = typeof config.supabaseUrl === "string"
  && config.supabaseUrl.startsWith("https://")
  && !config.supabaseUrl.includes("YOUR-PROJECT")
  && typeof config.supabaseAnonKey === "string"
  && config.supabaseAnonKey.length > 20
  && !config.supabaseAnonKey.includes("YOUR_PUBLIC");
const supabase = configured ? createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
}) : null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const state = {
  user: null, profile: null, profiles: [], tasks: [], comments: [], attachments: [], contentAssets: [], activities: [],
  view: "dashboard", selectedTaskId: null, loading: false
};
const STATUS = {
  todo: "Belum dimulai",
  in_progress: "Sedang dikerjakan",
  in_review: "Menunggu approval",
  changes_requested: "Perlu revisi",
  approved: "Disetujui",
  done: "Done",
  archived: "Diarsipkan"
};
const PRIORITY = { low: "Rendah", normal: "Normal", high: "Tinggi", urgent: "Urgent" };
const PAGE_TITLE = {
  dashboard: "Dashboard", tasks: "Semua pekerjaan", approvals: "Approval & revisi",
  files: "Arsip & file", content: "Content", activity: "Riwayat aktivitas"
};

function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}
function initials(name) {
  const parts = String(name || "RK").trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || "RK").slice(0, 2)).toUpperCase();
}
function fmtDate(value, options = { day: "numeric", month: "short", year: "numeric" }) {
  if (!value) return "Belum ditentukan";
  const date = new Date(value.length === 10 ? value + "T12:00:00" : value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("id-ID", options).format(date);
}
function fmtDateTime(value) {
  if (!value) return "—";
  return fmtDate(value, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function fmtClock(value) {
  return value ? String(value).slice(0, 5) : "";
}
function deadlineLabel(task, fallback = "—") {
  return task?.due_date ? fmtDate(task.due_date) + (task.due_time ? " · " + fmtClock(task.due_time) : "") : fallback;
}
function contentScheduleLabel(item) {
  return (item.scheduled_date ? fmtDate(item.scheduled_date) : "Tanggal belum diatur") +
    " · " + (item.scheduled_time ? fmtClock(item.scheduled_time) : "Jam belum diatur");
}
function roleLabel(role) { return "Akses penuh"; }
function statusBadge(status) {
  return '<span class="status status-' + esc(status) + '">' + esc(STATUS[status] || status) + "</span>";
}
function isClosed(task) { return ["approved", "done", "archived"].includes(task.status); }
function isLate(task) {
  if (!task.due_date || isClosed(task) || task.status === "in_review") return false;
  const dueAt = new Date(task.due_date + "T" + (task.due_time ? String(task.due_time).slice(0, 8) : "23:59:59"));
  return !Number.isNaN(dueAt.getTime()) && dueAt.getTime() < Date.now();
}
function profileName(id) {
  const found = state.profiles.find((item) => item.id === id);
  return found ? found.display_name : "Belum ditentukan";
}
function taskById(id) { return state.tasks.find((item) => item.id === id); }
function groupContentAssets(assets = state.contentAssets) {
  const groups = new Map();
  for (const asset of assets) {
    const key = asset.content_group_id || asset.id;
    if (!groups.has(key)) groups.set(key, { ...asset, content_group_id: key, files: [] });
    const group = groups.get(key);
    group.files.push(asset);
    if (asset.created_at && asset.created_at < group.created_at) group.created_at = asset.created_at;
  }
  return [...groups.values()];
}
function contentFormatLabel(format) { return ({ reels: "Reels", feed: "Feed", carousel: "Carousel" })[format] || "Feed"; }
function deadlineStatusBadge(task) {
  if (!task?.due_date || ["in_review", "approved", "done", "archived"].includes(task.status)) return "";
  if (isLate(task)) return '<span class="status status-deadline-late">Terlambat</span>';
  return '<span class="status status-deadline-active">Aktif</span>';
}
function setAuthMessage(text, kind = "") {
  const node = $("#auth-message");
  node.textContent = text;
  node.className = "notice" + (kind ? " notice-" + kind : "");
  node.hidden = !text;
}
function toast(text, kind = "success") {
  const region = $("#toast-region");
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = text;
  region.appendChild(el);
  window.setTimeout(() => el.remove(), 4200);
}
function showAuth(message = "", kind = "") {
  $("#app-shell").hidden = true;
  $("#auth-shell").hidden = false;
  $("#modal-root").innerHTML = "";
  $("#login-form")?.reset();
  setAuthMessage(message, kind);
}
function showConfigWarning() {
  const node = $("#config-warning");
  node.hidden = false;
  node.innerHTML = "<strong>Setup belum selesai.</strong> Isi Project URL dan public anon/publishable key di <b>config.js</b>, lalu jalankan <b>supabase/schema.sql</b> di SQL Editor. Jangan memasukkan service-role/secret key di website.";
  $("#login-form button").forEach((button) => { button.disabled = true; });
}
function showLoading(text = "Memuat ruang kerja…") {
  $("#page-content").innerHTML = '<div class="loading-state"><span class="spinner"></span>' + esc(text) + "</div>";
}
function currentRole() { return state.profile ? state.profile.role : "member"; }
function taskDetails(task) {
  const title = esc(task.title);
  const due = deadlineLabel(task, "Tanpa deadline");
  const dueClass = isLate(task) ? "due-overdue" : "";
  const pName = profileName(task.assigned_to);
  return '<div class="task-main"><span class="task-title">' + title + '</span><div class="task-subline"><span class="priority-' + esc(task.priority) + '"><span class="priority-dot"></span>' + esc(PRIORITY[task.priority] || task.priority) + '</span><span class="' + dueClass + '">Deadline: ' + esc(due) + '</span><span>PIC: ' + esc(pName) + "</span></div></div>";
}
function taskRow(task, actionLabel = "Detail") {
  return '<div class="task-row"><div class="task-main-wrap">' + taskDetails(task) + '</div><div class="task-actions">' + statusBadge(task.status) + deadlineStatusBadge(task) + '<button class="btn btn-secondary btn-small task-open" data-id="' + esc(task.id) + '">' + esc(actionLabel) + "</button></div></div>";
}
function personChip(id) {
  const name = profileName(id);
  return '<span class="person-chip"><span class="avatar">' + esc(initials(name)) + "</span>" + esc(name) + "</span>";
}
function statCard(label, value, symbol, sub) {
  return '<article class="stat-card"><div class="stat-top"><span>' + esc(label) + '</span><span class="stat-icon">' + symbol + '</span></div><div class="stat-value">' + esc(value) + '</div><div class="stat-sub">' + esc(sub) + "</div></article>";
}
function emptyState(title, description, button = "") {
  return '<div class="empty-state"><div class="empty-icon">✓</div><strong>' + esc(title) + '</strong><p>' + esc(description) + "</p>" + button + "</div>";
}
function openCreateButton(label = "Buat tugas") {
  return '<button class="btn btn-primary" data-create-task><span aria-hidden="true">＋</span> ' + esc(label) + "</button>";
}
function renderDashboard() {
  const today = new Date().toISOString().slice(0, 10);
  const active = state.tasks.filter((t) => !isClosed(t));
  const dueToday = active.filter((t) => t.due_date === today).length;
  const pending = state.tasks.filter((t) => t.status === "in_review").length;
  const overdue = active.filter(isLate).length;
  const recent = active.slice().sort((a, b) => {
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    const dateDiff = a.due_date.localeCompare(b.due_date);
    if (dateDiff) return dateDiff;
    return String(a.due_time || "23:59:59").localeCompare(String(b.due_time || "23:59:59"));
  }).slice(0, 5);
  const needsMe = state.profile.role === "manager"
    ? state.tasks.filter((t) => t.status === "in_review" || t.status === "changes_requested").length
    : state.tasks.filter((t) => t.status === "changes_requested" && (t.assigned_to === state.user.id || t.created_by === state.user.id)).length;
  return '<div class="page-heading"><div><h2>Halo, ' + esc(state.profile.display_name.split(/\s+/)[0]) + '.</h2><p>Berikut ringkasan pekerjaan tim kamu hari ini.</p></div><div class="heading-actions">' + openCreateButton() + "</div></div>" +
    '<div class="stats-grid">' +
    statCard("Tugas aktif", active.length, "☷", "Semua pekerjaan yang belum selesai") +
    statCard("Deadline hari ini", dueToday, "◷", "Perlu dituntaskan hari ini") +
    statCard(state.profile.role === "manager" ? "Menunggu review" : "Perlu ditindaklanjuti", needsMe, "✓", state.profile.role === "manager" ? "Pekerjaan menunggu keputusan" : "Approval atau revisi") +
    statCard("Terlambat", overdue, "!", overdue ? "Periksa dan perbarui progres" : "Tidak ada tugas terlambat") +
    '</div><div class="dashboard-grid"><section class="panel"><div class="panel-header"><div><h3>Deadline terdekat</h3><p>Prioritas untuk beberapa hari ke depan</p></div><button class="text-action" data-view="tasks">Lihat semua →</button></div>' +
    (recent.length ? '<div class="task-list">' + recent.map((t) => taskRow(t, "Buka")).join("") + "</div>" : emptyState("Belum ada pekerjaan aktif", "Buat tugas pertama supaya deadline dan progres tercatat.", openCreateButton("Buat tugas pertama"))) +
    '</section><section class="panel"><div class="panel-header"><div><h3>Butuh perhatian</h3><p>Approval, revisi, atau tugas lewat deadline</p></div></div><div class="panel-body"><div class="mini-list">' +
    (overdue ? '<div class="mini-item"><span class="mini-dot" style="background:#b44343"></span><div class="mini-copy"><strong>' + overdue + " tugas terlambat</strong><p>Periksa deadline dan kabari penanggung jawab.</p></div></div>" : "") +
    (pending ? '<div class="mini-item"><span class="mini-dot" style="background:#6b54a3"></span><div class="mini-copy"><strong>' + pending + " tugas menunggu approval</strong><p>" + (state.profile.role === "manager" ? "Buka panel approval untuk meninjau hasil." : "Manager perlu meninjau hasil yang diajukan.") + '</p><button class="text-action" data-view="approvals">Buka approval →</button></div></div>' : "") +
    (needsMe === 0 && overdue === 0 && pending === 0 ? '<div class="mini-item"><span class="mini-dot" style="background:#21785b"></span><div class="mini-copy"><strong>Semua terkendali</strong><p>Belum ada hal mendesak yang membutuhkan perhatian.</p></div></div>' : "") +
    '<div class="mini-item"><span class="mini-dot"></span><div class="mini-copy"><strong>Panel ' + esc(roleLabel(state.profile.role)) + '</strong><p>' + (state.profile.role === "manager" ? "Kamu dan pengguna kode akses lain memiliki hak akses yang sama untuk tugas, revisi, dan approval." : "Kamu dapat memperbarui progres, melampirkan file yang diizinkan, dan mengajukan approval.") + "</p></div></div>" +
    "</div></div></section></div>";
}
function renderTasks() {
  const rows = state.tasks.slice().sort((a, b) => {
    const rank = { in_review: 0, changes_requested: 1, in_progress: 2, todo: 3, approved: 4, done: 5, archived: 6 };
    const diff = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
    if (diff) return diff;
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    const dateDiff = a.due_date.localeCompare(b.due_date);
    return dateDiff || String(a.due_time || "23:59:59").localeCompare(String(b.due_time || "23:59:59"));
  });
  return '<div class="page-heading"><div><h2>Semua pekerjaan</h2><p>Semua tugas tim, PIC, deadline, dan statusnya.</p></div><div class="heading-actions">' + openCreateButton() + '</div></div>' +
    '<div class="toolbar"><label class="search-box"><span class="search-mark">⌕</span><input id="task-search" type="search" placeholder="Cari judul atau deskripsi…" autocomplete="off"></label><select id="task-status-filter" class="filter-select" aria-label="Filter status"><option value="">Semua status</option>' +
    Object.keys(STATUS).map((key) => '<option value="' + key + '">' + esc(STATUS[key]) + '</option>').join("") +
    '</select><select id="task-priority-filter" class="filter-select" aria-label="Filter prioritas"><option value="">Semua prioritas</option>' +
    Object.keys(PRIORITY).map((key) => '<option value="' + key + '">' + esc(PRIORITY[key]) + '</option>').join("") +
    '</select></div><section class="panel"><div class="task-table-wrap"><table class="task-table"><thead><tr><th>Pekerjaan</th><th>Status</th><th>PIC</th><th>Deadline</th><th>Prioritas</th></tr></thead><tbody>' +
    (rows.length ? rows.map((task) => '<tr data-status="' + esc(task.status) + '" data-priority="' + esc(task.priority) + '" data-search="' + esc((task.title + " " + (task.description || "") + " " + profileName(task.assigned_to)).toLowerCase()) + '"><td><button class="table-task-button task-open" data-id="' + esc(task.id) + '">' + esc(task.title) + '</button><span class="table-description">' + esc(task.description || "Tidak ada deskripsi") + '</span></td><td>' + statusBadge(task.status) + ' ' + deadlineStatusBadge(task) + '</td><td>' + personChip(task.assigned_to) + '</td><td class="due-cell ' + (isLate(task) ? "due-overdue" : "") + '">' + esc(deadlineLabel(task, "—")) + '</td><td>' + esc(PRIORITY[task.priority] || task.priority) + '</td></tr>').join("") : '<tr><td colspan="5">' + emptyState("Belum ada tugas", "Tambahkan pekerjaan pertama untuk tim.") + '</td></tr>') +
    '</tbody></table></div><div id="filter-empty" class="empty-inline" hidden>Tidak ada tugas yang cocok dengan filter ini.</div></section>';
}
function applyTaskFilters() {
  const needle = ($("#task-search")?.value || "").trim().toLowerCase();
  const status = $("#task-status-filter")?.value || "";
  const priority = $("#task-priority-filter")?.value || "";
  let visible = 0;
  $$(".task-table tbody tr[data-status]").forEach((row) => {
    const show = (!needle || (row.dataset.search || "").includes(needle)) &&
      (!status || row.dataset.status === status) && (!priority || row.dataset.priority === priority);
    row.hidden = !show;
    if (show) visible++;
  });
  const empty = $("#filter-empty");
  if (empty) empty.hidden = visible !== 0;
}
function renderApprovals() {
  const manager = true;
  const candidates = state.tasks.filter((t) => ["in_review", "changes_requested"].includes(t.status));
  const contentCandidates = groupContentAssets().filter((c) => ["in_review", "changes_requested"].includes(c.status));
  const taskCards = candidates.map((task) => '<article class="approval-card"><div><h3>' + esc(task.title) + '</h3><p>' + esc((task.description || "Tidak ada deskripsi").slice(0, 170)) + '</p><div class="task-subline">' + statusBadge(task.status) + deadlineStatusBadge(task) + '<span>PIC: ' + esc(profileName(task.assigned_to)) + '</span><span>Deadline: ' + esc(deadlineLabel(task, "—")) + '</span></div></div><div class="approval-actions"><button class="btn btn-secondary btn-small task-open" data-id="' + esc(task.id) + '">Buka tugas</button>' + (task.status === "in_review" ? '<button class="btn btn-warning btn-small task-quick-revision" data-id="' + esc(task.id) + '">Revisi</button><button class="btn btn-approve btn-small task-quick-status" data-id="' + esc(task.id) + '" data-status="done">Approval · Done</button>' : "") + '</div></article>').join("");
  const contentCards = contentCandidates.map((content) => '<article class="approval-card"><div><h3>' + esc(content.title) + ' <span class="role-badge">' + esc(contentFormatLabel(content.content_format)) + '</span></h3><p>' + esc(content.caption || "Tidak ada caption.") + '</p><div class="task-subline">' + statusBadge(content.status) + '<span>' + content.files.length + ' file</span><span>Jadwal: ' + esc(contentScheduleLabel(content)) + '</span></div>' + (content.revision_note ? '<p class="revision-note-display"><strong>Catatan revisi:</strong> ' + esc(content.revision_note) + '</p>' : '') + '</div><div class="approval-actions">' + (content.status === "in_review" ? '<button class="btn btn-warning btn-small content-quick-revision" data-id="' + esc(content.content_group_id) + '">Revisi</button><button class="btn btn-approve btn-small content-quick-approve" data-id="' + esc(content.content_group_id) + '">Approval · Done</button>' : '<button class="btn btn-secondary btn-small" data-view="content">Buka content</button>') + '</div></article>').join("");
  const total = candidates.length + contentCandidates.length;
  return '<div class="page-heading"><div><h2>Approval & revisi</h2><p>Tugas dan content yang sudah diajukan masuk ke sini. Approval akan mengubah status menjadi Done.</p></div></div><section class="panel"><div class="panel-header"><div><h3>Menunggu approval atau perlu revisi</h3><p>' + total + ' item perlu perhatian</p></div></div>' +
    (total ? taskCards + contentCards : emptyState("Tidak ada approval tertunda", "Klik Sudah beres pada tugas atau content untuk mengirimkannya ke review.")) + '</section>';
}
function renderFiles() {
  const items = state.attachments.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  return '<div class="page-heading"><div><h2>Arsip & file</h2><p>Lampiran kerja dan file contoh yang terkait dengan tugas.</p></div><div class="heading-actions"><button class="btn btn-secondary" data-backup-export>Backup terenkripsi</button><button class="btn btn-primary" data-backup-restore>Pulihkan backup</button></div></div><div class="file-warning"><strong>Perhatian:</strong><span>Hanya unggah file non-rahasia yang memang boleh disimpan di layanan cloud ini.</span></div><section class="panel"><div class="panel-header"><div><h3>Semua lampiran</h3><p>File pekerjaan dapat diajukan untuk approval. File contoh bersifat opsional.</p></div><span class="role-badge">' + items.length + ' file</span></div>' +
    (items.length ? items.map((file) => {
      const task = taskById(file.task_id);
      const ext = (file.file_name.split(".").pop() || "FILE").slice(0, 5).toUpperCase();
      const canSubmit = task && !["in_review", "approved", "done", "archived"].includes(task.status);
      return '<div class="file-row"><div class="file-type-icon">' + esc(ext) + '</div><div class="file-info"><strong>' + esc(file.file_name) + '</strong><p>' + esc(file.attachment_type === "example" ? "Contoh file" : "File pekerjaan") + ' · ' + esc(task ? task.title : "Tugas") + ' · ' + esc(fmtDateTime(file.created_at)) + ' · ' + esc(formatBytes(file.size_bytes)) + '</p></div><div class="file-row-actions"><button class="btn btn-secondary btn-small download-file" data-id="' + esc(file.id) + '">Unduh</button>' + (canSubmit ? '<button class="btn btn-primary btn-small submit-task-file" data-id="' + esc(task.id) + '">Ajukan approval</button>' : '') + '<button class="btn btn-ghost btn-small delete-task-file" data-id="' + esc(file.id) + '">Hapus</button></div></div>';
    }).join("") : emptyState("Belum ada lampiran", "Buka detail tugas untuk menambahkan file pekerjaan atau file contoh.")) + '</section>';
}
function renderContent() {
  const items = groupContentAssets().sort((a, b) => {
    if (a.scheduled_date && b.scheduled_date) {
      const diff = (a.scheduled_date + "T" + (a.scheduled_time || "23:59:59")).localeCompare(b.scheduled_date + "T" + (b.scheduled_time || "23:59:59"));
      if (diff) return diff;
    }
    if (a.scheduled_date && !b.scheduled_date) return -1;
    if (!a.scheduled_date && b.scheduled_date) return 1;
    return b.created_at.localeCompare(a.created_at);
  });
  const rows = items.length ? items.map((item) => {
    const fileRows = item.files.map((file) => '<div class="content-file-row"><span class="file-type-icon">' + esc((file.file_name.split(".").pop() || "FILE").slice(0, 4).toUpperCase()) + '</span><span class="content-file-name">' + esc(file.file_name) + ' · ' + esc(formatBytes(file.size_bytes)) + '</span><button class="btn btn-secondary btn-small download-content" data-id="' + esc(file.id) + '">Unduh</button></div>').join("");
    return '<article class="content-item"><div class="content-item-main"><div class="content-item-copy"><h3>' + esc(item.title) + ' <span class="role-badge">' + esc(contentFormatLabel(item.content_format)) + '</span></h3><p class="content-caption">' + esc(item.caption || "Belum ada caption.") + '</p><div class="content-item-meta"><span>◷ ' + esc(contentScheduleLabel(item)) + '</span><span>' + item.files.length + ' file</span><span>Status: ' + esc(STATUS[item.status] || item.status) + '</span></div>' + (item.revision_note ? '<p class="revision-note-display"><strong>Catatan revisi:</strong> ' + esc(item.revision_note) + '</p>' : '') + '</div></div><div class="content-files-list">' + fileRows + '</div><div class="content-item-actions"><button class="btn btn-secondary btn-small copy-caption" data-id="' + esc(item.content_group_id) + '">Copy caption</button>' + (["todo", "changes_requested"].includes(item.status) ? '<button class="btn btn-primary btn-small content-mark-done" data-id="' + esc(item.content_group_id) + '">Sudah beres</button>' : '') + (item.status === "in_review" ? '<span class="section-note">Menunggu approval</span>' : '') + (item.status === "done" ? '<span class="section-note">Sudah Done</span>' : '') + '<button class="btn btn-ghost btn-small delete-content" data-id="' + esc(item.content_group_id) + '">Hapus content</button></div></article>';
  }).join("") : emptyState("Belum ada content", "Upload beberapa file sekaligus, tambahkan caption, format, dan jadwal publikasi.");
  return '<div class="page-heading"><div><h2>Content</h2><p>Kelola file Reels, Feed, dan Carousel; caption bisa disalin dan item dikirim untuk approval.</p></div><span class="role-badge">' + items.length + ' content</span></div>' +
    '<section class="panel content-upload-panel"><div class="panel-header"><div><h3>Upload content</h3><p>Satu item content bisa memiliki banyak lampiran.</p></div></div><div class="panel-body"><form id="content-upload-form" class="form-stack"><div class="form-grid"><div class="field field-span"><label for="content-title-input">Judul content *</label><input id="content-title-input" name="title" required maxlength="160" placeholder="Contoh: Video promo Oktober"></div><div class="field"><label for="content-format-input">Format content *</label><select id="content-format-input" name="content_format" required><option value="reels">Reels</option><option value="feed">Feed</option><option value="carousel">Carousel</option></select></div><div class="field"><label for="content-date-input">Tanggal content</label><input id="content-date-input" name="scheduled_date" type="date"></div><div class="field"><label for="content-time-input">Jam content</label><input id="content-time-input" name="scheduled_time" type="time"></div><div class="field field-span"><label for="content-caption-input">Caption / catatan</label><textarea id="content-caption-input" name="caption" maxlength="5000" rows="3" placeholder="Tulis caption final, hashtag, atau catatan…"></textarea></div><div class="field field-span"><label for="content-file-input">File content * (bisa pilih banyak)</label><input id="content-file-input" name="files" type="file" multiple required><p class="field-help">Pilih satu atau beberapa file dalam satu content. File disimpan privat.</p></div></div><div class="heading-actions"><button class="btn btn-primary" type="submit">＋ Upload content</button></div></form></div></section>' +
    '<section class="panel content-list-panel"><div class="panel-header"><div><h3>Content tim</h3><p>Caption, status approval, jadwal, dan semua file content.</p></div><span class="role-badge">' + items.length + ' content</span></div><div class="content-list">' + rows + '</div></section>';
}
function renderActivity() {
  const items = state.activities.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  const labels = { task_created: "membuat tugas", status_changed: "mengubah status tugas", task_updated: "memperbarui tugas", comment_added: "menambahkan komentar", file_uploaded: "mengunggah lampiran" };
  return '<div class="page-heading"><div><h2>Riwayat aktivitas</h2><p>Jejak perubahan untuk membantu koordinasi dan review.</p></div></div><section class="panel"><div class="panel-header"><div><h3>Aktivitas terbaru</h3><p>Catatan aktivitas tidak dapat diedit dari halaman ini.</p></div></div>' +
    (items.length ? '<div class="activity-list">' + items.map((item) => {
      const actor = state.profiles.find((p) => p.id === item.actor_id);
      const task = taskById(item.task_id);
      const details = item.details || {};
      let note = "";
      if (item.action === "status_changed") note = (STATUS[details.from] || details.from || "") + " → " + (STATUS[details.to] || details.to || "");
      return '<div class="activity-item"><div class="activity-symbol">◷</div><div class="activity-copy"><strong>' + esc(actor ? actor.display_name : "Anggota tim") + "</strong> " + esc(labels[item.action] || "melakukan aktivitas") + (task ? ' <strong>“' + esc(task.title) + '”</strong>' : "") + '<p>' + esc(note || "Aktivitas dicatat") + " · " + esc(fmtDateTime(item.created_at)) + "</p></div></div>";
    }).join("") + "</div>" : emptyState("Belum ada aktivitas", "Aktivitas pembuatan tugas dan perubahan status akan muncul di sini.")) + "</section>";
}
function renderPage() {
  $("#page-title").textContent = PAGE_TITLE[state.view] || "Ruang Kerja";
  $$(".nav-item").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === state.view));
  $("#nav-task-count").textContent = state.tasks.filter((t) => !isClosed(t)).length;
  $("#nav-approval-count").textContent = state.tasks.filter((t) => t.status === "in_review" || t.status === "changes_requested").length + groupContentAssets().filter((c) => c.status === "in_review" || c.status === "changes_requested").length;
  if (state.view === "dashboard") $("#page-content").innerHTML = renderDashboard();
  else if (state.view === "tasks") $("#page-content").innerHTML = renderTasks();
  else if (state.view === "approvals") $("#page-content").innerHTML = renderApprovals();
  else if (state.view === "files") $("#page-content").innerHTML = renderFiles();
  else if (state.view === "content") $("#page-content").innerHTML = renderContent();
  else $("#page-content").innerHTML = renderActivity();
}
function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return n + " B";
  if (n < 1024 ** 2) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 ** 3) return (n / (1024 ** 2)).toFixed(1) + " MB";
  if (n < 1024 ** 4) return (n / (1024 ** 3)).toFixed(2) + " GB";
  return (n / (1024 ** 4)).toFixed(2) + " TB";
}
async function loadWorkspace() {
  if (!supabase || !state.user) return;
  state.loading = true;
  showLoading();
  const [profileRes, profilesRes, tasksRes, commentsRes, attachmentsRes, contentRes, activityRes] = await Promise.all([
    supabase.from("profiles").select("id,display_name,role,created_at").eq("id", state.user.id).maybeSingle(),
    supabase.from("profiles").select("id,display_name,role,created_at").order("display_name"),
    supabase.from("tasks").select("*").order("created_at", { ascending: false }),
    supabase.from("task_comments").select("id,task_id,user_id,comment,created_at").order("created_at", { ascending: true }),
    supabase.from("task_attachments").select("id,task_id,path,file_name,content_type,size_bytes,uploaded_by,created_at,attachment_type").order("created_at", { ascending: false }),
    supabase.from("content_assets").select("id,title,caption,scheduled_date,scheduled_time,path,file_name,content_type,size_bytes,uploaded_by,created_at,content_group_id,status,revision_note,content_format").order("created_at", { ascending: false }),
    supabase.from("activity_log").select("id,task_id,actor_id,action,details,created_at").order("created_at", { ascending: false }).limit(100)
  ]);
  if (profileRes.error || !profileRes.data) {
    const wasAnonymous = Boolean(state.user?.is_anonymous);
    state.loading = false;
    await supabase.auth.signOut();
    showAuth(
      wasAnonymous ? "Masukkan kode akses untuk membuka ruang kerja." : "Profil tidak ditemukan. Coba masuk kembali dengan kode akses.",
      wasAnonymous ? "" : "error"
    );
    return;
  }
  state.profile = profileRes.data;
  state.profiles = profilesRes.data || [profileRes.data];
  state.tasks = tasksRes.data || [];
  state.comments = commentsRes.data || [];
  state.attachments = attachmentsRes.data || [];
  state.contentAssets = contentRes.data || [];
  state.activities = activityRes.data || [];
  state.loading = false;
  $("#profile-name").textContent = state.profile.display_name;
  $("#profile-role").textContent = "Panel " + roleLabel(state.profile.role);
  $("#profile-avatar").textContent = initials(state.profile.display_name);
  $("#today-label").textContent = fmtDate(new Date().toISOString().slice(0, 10), { weekday: "short", day: "numeric", month: "short" });
  $("#auth-shell").hidden = true;
  $("#app-shell").hidden = false;
  renderPage();
}
async function enterApp(user) {
  state.user = user;
  await loadWorkspace();
}
function changeView(view) {
  if (!PAGE_TITLE[view]) return;
  state.view = view;
  $("#sidebar").classList.remove("mobile-open");
  renderPage();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function openCreateModal() {
  const people = state.profiles.map((p) => '<option value="' + esc(p.id) + '"' + (p.id === state.user.id ? " selected" : "") + ">" + esc(p.display_name + " — " + roleLabel(p.role)) + "</option>").join("");
  $("#modal-root").innerHTML = '<div class="modal-backdrop" data-backdrop><section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="create-task-title"><div class="modal-header"><div><h2 id="create-task-title">Buat pekerjaan baru</h2><p>Jelaskan hasil yang dibutuhkan dan kapan harus selesai.</p></div><button class="icon-button close-modal" aria-label="Tutup">×</button></div><form id="create-task-form"><div class="modal-body"><div class="form-grid"><div class="field field-span"><label for="task-title-input">Judul pekerjaan *</label><input id="task-title-input" name="title" required maxlength="140" placeholder="Contoh: Siapkan laporan bulanan"></div><div class="field field-span"><label for="task-description-input">Deskripsi dan hasil yang diharapkan</label><textarea id="task-description-input" name="description" maxlength="8000" placeholder="Tuliskan brief, langkah kerja, dan kriteria selesai…"></textarea></div><div class="field"><label for="task-due-input">Tanggal deadline</label><input id="task-due-input" name="due_date" type="date"></div><div class="field"><label for="task-due-time-input">Jam deadline</label><input id="task-due-time-input" name="due_time" type="time"></div><div class="field"><label for="task-priority-input">Prioritas</label><select id="task-priority-input" name="priority"><option value="normal">Normal</option><option value="high">Tinggi</option><option value="urgent">Urgent</option><option value="low">Rendah</option></select></div><div class="field field-span"><label for="task-assignee-input">Penanggung jawab (PIC)</label><select id="task-assignee-input" name="assigned_to">' + people + '</select><p class="field-help">Semua pengguna kode akses memiliki hak yang sama.</p></div></div></div><div class="modal-footer"><button type="button" class="btn btn-secondary close-modal">Batal</button><button type="submit" class="btn btn-primary">Simpan pekerjaan</button></div></form></section></div>';
  $("#task-title-input")?.focus();
}
function taskActionButtons(task) {
  let html = "";
  if (task.status === "todo" || task.status === "changes_requested") {
    html += '<button class="btn btn-secondary" data-task-status="in_progress" data-id="' + esc(task.id) + '">Mulai dikerjakan</button>';
  }
  if (["todo", "in_progress", "changes_requested"].includes(task.status)) {
    html += '<button class="btn btn-primary" data-task-status="in_review" data-id="' + esc(task.id) + '">Sudah beres · ajukan approval</button>';
  }
  if (task.status === "in_review") {
    html += '<button class="btn btn-warning" data-show-revision="' + esc(task.id) + '">Revisi</button>';
    html += '<button class="btn btn-approve" data-task-status="done" data-id="' + esc(task.id) + '">Approval · tandai Done</button>';
  }
  if (task.status === "approved") {
    html += '<button class="btn btn-approve" data-task-status="done" data-id="' + esc(task.id) + '">Tandai Done</button>';
  }
  if (task.status === "done") html += '<span class="section-note">Status final: Done</span>';
  return html;
}
function openTaskModal(taskId) {
  const task = taskById(taskId);
  if (!task) return;
  state.selectedTaskId = taskId;
  const comments = state.comments.filter((item) => item.task_id === taskId);
  const files = state.attachments.filter((item) => item.task_id === taskId);
  const actions = taskActionButtons(task);
  $("#modal-root").innerHTML = '<div class="modal-backdrop" data-backdrop><section class="modal-card modal-wide" role="dialog" aria-modal="true" aria-labelledby="detail-task-title"><div class="modal-header"><div><div class="task-subline">' + statusBadge(task.status) + deadlineStatusBadge(task) + '<span class="priority-' + esc(task.priority) + '"><span class="priority-dot"></span>' + esc(PRIORITY[task.priority] || task.priority) + '</span></div><h2 id="detail-task-title" style="margin-top:7px">' + esc(task.title) + '</h2><p>Dibuat ' + esc(fmtDateTime(task.created_at)) + '</p></div><button class="icon-button close-modal" aria-label="Tutup">×</button></div><div class="modal-body"><div class="detail-metadata"><div class="detail-meta"><span>Penanggung jawab</span><strong>' + esc(profileName(task.assigned_to)) + '</strong></div><div class="detail-meta"><span>Deadline</span><strong class="' + (isLate(task) ? "due-overdue" : "") + '">' + esc(deadlineLabel(task, "Belum diatur")) + '</strong></div><div class="detail-meta"><span>Dibuat oleh</span><strong>' + esc(profileName(task.created_by)) + '</strong></div></div><h3 class="section-subtitle" style="margin-top:15px">Deskripsi pekerjaan</h3><div class="detail-description">' + esc(task.description || "Belum ada deskripsi.") + '</div><div class="heading-actions" style="margin-top:14px">' + actions + '</div><div id="revision-box" class="modal-form-note" hidden><form id="revision-form"><label class="field-label" for="revision-note">Deskripsi revisi</label><textarea id="revision-note" name="comment" required maxlength="3000" style="display:block;width:100%;margin:8px 0;border:1px solid #e3d2a9;border-radius:8px;padding:10px;font:inherit;min-height:75px" placeholder="Jelaskan apa yang harus diperbaiki…"></textarea><button type="submit" class="btn btn-warning btn-small">Kirim revisi</button></form></div><h3 class="section-subtitle">Lampiran <span class="role-badge">' + files.length + '</span></h3><div class="file-warning"><strong>Privasi:</strong><span>Unggah hanya file yang diizinkan untuk penyimpanan cloud.</span></div>' +
    (files.length ? files.map((file) => '<div class="file-row"><div class="file-type-icon">' + esc((file.file_name.split(".").pop() || "FILE").slice(0, 4).toUpperCase()) + '</div><div class="file-info"><strong>' + esc(file.file_name) + '</strong><p>' + esc(file.attachment_type === "example" ? "Contoh file (opsional)" : "File pekerjaan") + ' · ' + esc(formatBytes(file.size_bytes)) + ' · ' + esc(fmtDateTime(file.created_at)) + '</p></div><div class="file-row-actions"><button class="btn btn-secondary btn-small download-file" data-id="' + esc(file.id) + '">Unduh</button>' + (!["in_review", "approved", "done", "archived"].includes(task.status) ? '<button class="btn btn-primary btn-small submit-task-file" data-id="' + esc(task.id) + '">Ajukan approval</button>' : '') + '<button class="btn btn-ghost btn-small delete-task-file" data-id="' + esc(file.id) + '">Hapus</button></div></div>').join("") : '<div class="empty-inline">Belum ada lampiran pada tugas ini.</div>') +
    '<form id="upload-form" class="form-stack" style="gap:8px;margin-top:12px"><div class="field"><label for="task-file-work-input">Lampiran file pekerjaan (bisa banyak)</label><input id="task-file-work-input" name="work_files" type="file" multiple><p class="field-help">Pilih file hasil kerja yang akan dinilai.</p></div><div class="field"><label for="task-file-example-input">Lampiran contoh file (opsional, bisa banyak)</label><input id="task-file-example-input" name="example_files" type="file" multiple><p class="field-help">Contoh referensi, template, atau brief tambahan.</p></div><button class="btn btn-secondary" type="submit">Unggah lampiran terpilih</button></form><h3 class="section-subtitle">Komentar & catatan <span class="role-badge">' + comments.length + '</span></h3><div class="comment-list">' + (comments.length ? comments.map((c) => {
      const author = state.profiles.find((p) => p.id === c.user_id);
      return '<article class="comment"><div class="comment-top"><strong>' + esc(author ? author.display_name : "Anggota tim") + '</strong><time>' + esc(fmtDateTime(c.created_at)) + '</time></div><p>' + esc(c.comment) + '</p></article>';
    }).join("") : '<div class="empty-inline">Belum ada komentar. Gunakan bagian ini untuk koordinasi.</div>') + '</div><form id="comment-form" class="comment-form"><textarea name="comment" rows="2" required maxlength="3000" placeholder="Tulis komentar atau update singkat…"></textarea><button type="submit" class="btn btn-primary btn-small">Kirim</button></form></div><div class="modal-footer"><button type="button" class="btn btn-secondary close-modal">Tutup</button></div></section></div>';
}
async function refreshTaskDetail(taskId) {
  await loadWorkspace();
  openTaskModal(taskId);
}
async function createTask(form) {
  const data = new FormData(form);
  const title = String(data.get("title") || "").trim();
  if (!title) return toast("Judul pekerjaan wajib diisi.", "error");
  const payload = {
    title, description: String(data.get("description") || "").trim(),
    due_date: String(data.get("due_date") || "") || null,
    due_time: String(data.get("due_time") || "") || null,
    priority: String(data.get("priority") || "normal"), status: "todo",
    created_by: state.user.id, assigned_to: String(data.get("assigned_to") || state.user.id)
  };
  const button = $('button[type="submit"]', form);
  button.disabled = true; button.textContent = "Menyimpan…";
  const { data: task, error } = await supabase.from("tasks").insert(payload).select("*").single();
  button.disabled = false; button.textContent = "Simpan pekerjaan";
  if (error) return toast("Tugas belum tersimpan: " + error.message, "error");
  $("#modal-root").innerHTML = "";
  toast("Pekerjaan berhasil dibuat.");
  await notifyTelegram("task_created", task.title, STATUS[task.status], "Deadline: " + deadlineLabel(task, "belum diatur") + " · PIC: " + profileName(task.assigned_to));
  await loadWorkspace();
  openTaskModal(task.id);
}
async function changeTaskStatus(taskId, newStatus) {
  if (!STATUS[newStatus]) return;
  const task = taskById(taskId);
  if (!task) return;
  const { error } = await supabase.from("tasks").update({ status: newStatus }).eq("id", taskId);
  if (error) return toast("Status belum berubah: " + error.message, "error");
  const actionLabel = newStatus === "done" ? "Status berubah menjadi Done" :
    newStatus === "in_review" ? "Pekerjaan dikirim ke Menunggu approval" :
    newStatus === "in_progress" ? "Pekerjaan dimulai" : "Status diperbarui";
  toast(actionLabel);
  await notifyTelegram("task_status", task.title, STATUS[newStatus] || newStatus, "Deadline: " + deadlineLabel(task, "belum diatur"));
  await loadWorkspace();
  if ($("#modal-root").innerHTML) openTaskModal(taskId);
}
async function sendRevision(form) {
  const data = new FormData(form);
  const comment = String(data.get("comment") || "").trim();
  const taskId = state.selectedTaskId;
  const task = taskById(taskId);
  if (!comment || !taskId || !task) return toast("Deskripsi revisi wajib diisi.", "error");
  const { error: statusError } = await supabase.from("tasks").update({ status: "changes_requested" }).eq("id", taskId);
  if (statusError) return toast("Permintaan revisi belum tersimpan: " + statusError.message, "error");
  const { error: commentError } = await supabase.from("task_comments").insert({ task_id: taskId, user_id: state.user.id, comment });
  if (commentError) toast("Status revisi tersimpan, tetapi catatan gagal tersimpan: " + commentError.message, "error");
  else toast("Revisi dan deskripsinya berhasil dikirim.");
  await notifyTelegram("task_revision", task.title, STATUS.changes_requested, comment);
  await refreshTaskDetail(taskId);
}
async function addComment(form) {
  const data = new FormData(form);
  const comment = String(data.get("comment") || "").trim();
  const taskId = state.selectedTaskId;
  if (!comment || !taskId) return;
  const { error } = await supabase.from("task_comments").insert({ task_id: taskId, user_id: state.user.id, comment });
  if (error) return toast("Komentar belum terkirim: " + error.message, "error");
  await refreshTaskDetail(taskId);
}
const STORAGE_BUCKET = "ruang-kerja-files";
const MAX_STORAGE_FILE_SIZE = 50 * 1024 * 1024;
async function notifyTelegram(eventType, title, status, details = "") {
  if (!supabase) return;
  try {
    const { error } = await supabase.functions.invoke("notify-telegram", { body: { event_type: eventType, title: String(title || "").slice(0, 180), status: String(status || "").slice(0, 80), details: String(details || "").slice(0, 1200) } });
    if (error) console.warn("Notifikasi Telegram belum terkirim:", error.message || error);
  } catch (error) { console.warn("Notifikasi Telegram belum terkirim:", error?.message || error); }
}

function safeFilename(name) {
  return String(name || "file").normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^[.]+/, "").slice(0, 100) || "file";
}
async function uploadPrivateFile(taskId, file) {
  if (!file || file.size < 1) throw new Error("File kosong.");
  if (file.size > MAX_STORAGE_FILE_SIZE) {
    throw new Error("File melebihi batas upload yang didukung portal. Kompres atau pilih file yang lebih kecil.");
  }
  const path = taskId + "/" + state.user.id + "/" + crypto.randomUUID() + "-" + safeFilename(file.name);
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
    cacheControl: "0",
    contentType: file.type || "application/octet-stream",
    upsert: false
  });
  if (error) throw new Error(error.message || "Penyimpanan file gagal menerima upload.");
  return { path: data.path || path, size: file.size };
}
async function uploadTaskFile(form) {
  const task = taskById(state.selectedTaskId);
  const workFiles = Array.from($("#task-file-work-input")?.files || []).map((file) => ({ file, attachment_type: "work" }));
  const exampleFiles = Array.from($("#task-file-example-input")?.files || []).map((file) => ({ file, attachment_type: "example" }));
  const selected = [...workFiles, ...exampleFiles];
  if (!task || !selected.length) return toast("Pilih setidaknya satu file pekerjaan atau contoh.", "error");
  const oversized = selected.find(({ file }) => file.size > MAX_STORAGE_FILE_SIZE);
  if (oversized) return toast("File " + oversized.file.name + " terlalu besar. Kompres atau pilih file yang lebih kecil.", "error");
  const button = $('button[type="submit"]', form);
  button.disabled = true; button.textContent = "Mengunggah file…";
  const uploaded = [];
  try {
    for (const entry of selected) {
      const saved = await uploadPrivateFile(task.id, entry.file);
      uploaded.push({ ...saved, ...entry });
    }
    const rows = uploaded.map(({ path, file, attachment_type }) => ({
      task_id: task.id, path, file_name: file.name.slice(0, 255),
      content_type: file.type || "application/octet-stream", size_bytes: file.size,
      uploaded_by: state.user.id, attachment_type
    }));
    const { error } = await supabase.from("task_attachments").insert(rows);
    if (error) throw error;
    toast(uploaded.length + " lampiran berhasil diunggah.");
    await notifyTelegram("task_files_uploaded", task.title, STATUS[task.status], uploaded.length + " lampiran baru: " + uploaded.map((x) => x.file.name).join(", "));
    await refreshTaskDetail(task.id);
  } catch (error) {
    if (uploaded.length) await supabase.storage.from(STORAGE_BUCKET).remove(uploaded.map((x) => x.path)).catch(() => {});
    button.disabled = false; button.textContent = "Unggah lampiran terpilih";
    toast("Upload belum selesai: " + (error.message || "periksa koneksi dan kapasitas penyimpanan"), "error");
  }
}
async function downloadFile(attachmentId) {
  const file = state.attachments.find((item) => item.id === attachmentId);
  if (!file) return toast("Lampiran tidak ditemukan.", "error");
  try {
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(file.path, 60, { download: file.file_name });
    if (error) throw error;
    if (!data?.signedUrl) throw new Error("Supabase tidak memberikan tautan unduhan.");
    const link = document.createElement("a"); link.href = data.signedUrl; link.rel = "noopener"; link.download = file.file_name;
    document.body.appendChild(link); link.click(); link.remove();
  } catch (error) { toast("File tidak dapat diunduh: " + (error.message || "kesalahan tidak diketahui"), "error"); }
}
async function deleteTaskAttachment(attachmentId) {
  const file = state.attachments.find((item) => item.id === attachmentId);
  if (!file) return toast("Lampiran tidak ditemukan.", "error");
  if (!window.confirm('Hapus file "' + file.file_name + '" dari semua pengguna?')) return;
  const { error: storageError } = await supabase.storage.from(STORAGE_BUCKET).remove([file.path]);
  if (storageError) return toast("File belum dapat dihapus: " + storageError.message, "error");
  const { error } = await supabase.from("task_attachments").delete().eq("id", attachmentId);
  if (error) return toast("File terhapus dari storage, tetapi catatan belum terhapus: " + error.message, "error");
  toast("Lampiran berhasil dihapus.");
  const taskId = file.task_id;
  await loadWorkspace();
  if ($("#modal-root").innerHTML && taskId) openTaskModal(taskId);
}
async function uploadContent(form) {
  const data = new FormData(form);
  const title = String(data.get("title") || "").trim();
  const caption = String(data.get("caption") || "").trim();
  const scheduledDate = String(data.get("scheduled_date") || "") || null;
  const scheduledTime = String(data.get("scheduled_time") || "") || null;
  const contentFormat = String(data.get("content_format") || "feed");
  const files = Array.from($("#content-file-input")?.files || []);
  if (!title) return toast("Judul content wajib diisi.", "error");
  if (!files.length) return toast("Pilih setidaknya satu file content.", "error");
  const oversized = files.find((file) => file.size < 1 || file.size > MAX_STORAGE_FILE_SIZE);
  if (oversized) return toast("Periksa ukuran file " + oversized.name + " lalu pilih file yang didukung.", "error");
  const button = $('button[type="submit"]', form);
  button.disabled = true; button.textContent = "Mengunggah content…";
  const groupId = crypto.randomUUID();
  const uploaded = [];
  try {
    for (const file of files) {
      const path = "content/" + state.user.id + "/" + crypto.randomUUID() + "-" + safeFilename(file.name);
      const { data: uploadData, error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
        cacheControl: "0", contentType: file.type || "application/octet-stream", upsert: false
      });
      if (error) throw error;
      uploaded.push({ path: uploadData.path || path, file });
    }
    const rows = uploaded.map(({ path, file }) => ({
      content_group_id: groupId, title, caption, scheduled_date: scheduledDate,
      scheduled_time: scheduledTime, content_format: contentFormat, status: "todo", revision_note: "",
      path, file_name: file.name.slice(0, 255), content_type: file.type || "application/octet-stream",
      size_bytes: file.size, uploaded_by: state.user.id
    }));
    const { error: metadataError } = await supabase.from("content_assets").insert(rows);
    if (metadataError) throw metadataError;
    form.reset();
    toast("Content dan " + uploaded.length + " file berhasil diunggah.");
    await notifyTelegram("content_created", title, "Belum diserahkan", contentFormatLabel(contentFormat) + " · " + uploaded.length + " file · Jadwal: " + (scheduledDate || "belum diatur") + (scheduledTime ? " " + scheduledTime : ""));
    state.view = "content";
    await loadWorkspace();
  } catch (error) {
    if (uploaded.length) await supabase.storage.from(STORAGE_BUCKET).remove(uploaded.map((x) => x.path)).catch(() => {});
    button.disabled = false; button.textContent = "＋ Upload content";
    toast("Content belum tersimpan: " + (error.message || "periksa koneksi dan kapasitas penyimpanan"), "error");
  }
}
async function downloadContentFile(contentId) {
  const item = state.contentAssets.find((asset) => asset.id === contentId);
  if (!item) return toast("File content tidak ditemukan.", "error");
  try {
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(item.path, 60, { download: item.file_name });
    if (error) throw error;
    if (!data?.signedUrl) throw new Error("Tautan unduhan belum tersedia.");
    const link = document.createElement("a"); link.href = data.signedUrl; link.rel = "noopener"; link.download = item.file_name;
    document.body.appendChild(link); link.click(); link.remove();
  } catch (error) { toast("Content tidak bisa diunduh: " + (error.message || "kesalahan tidak diketahui"), "error"); }
}
async function deleteContent(contentGroupId) {
  const group = groupContentAssets().find((asset) => asset.content_group_id === contentGroupId);
  if (!group) return toast("Content tidak ditemukan.", "error");
  if (!window.confirm("Hapus content “" + group.title + "” beserta " + group.files.length + " file untuk semua pengguna?")) return;
  const { error: deleteFileError } = await supabase.storage.from(STORAGE_BUCKET).remove(group.files.map((f) => f.path));
  if (deleteFileError) return toast("File belum dapat dihapus: " + deleteFileError.message, "error");
  const { error } = await supabase.from("content_assets").delete().eq("content_group_id", contentGroupId);
  if (error) return toast("File terhapus, tetapi data content belum terhapus: " + error.message, "error");
  toast("Content dan semua lampirannya berhasil dihapus.");
  await loadWorkspace();
}
async function changeContentStatus(contentGroupId, status, revisionNote = "") {
  const group = groupContentAssets().find((asset) => asset.content_group_id === contentGroupId);
  if (!group) return toast("Content tidak ditemukan.", "error");
  const { error } = await supabase.from("content_assets").update({ status, revision_note: revisionNote }).eq("content_group_id", contentGroupId);
  if (error) return toast("Status content belum berubah: " + error.message, "error");
  const label = status === "in_review" ? "Content masuk Menunggu approval" : status === "done" ? "Content disetujui dan menjadi Done" : "Content diminta revisi";
  toast(label);
  await notifyTelegram("content_status", group.title, STATUS[status] || status, revisionNote || (contentFormatLabel(group.content_format) + " · " + group.files.length + " file"));
  await loadWorkspace();
}
function openContentRevision(contentGroupId) {
  const group = groupContentAssets().find((asset) => asset.content_group_id === contentGroupId);
  if (!group) return toast("Content tidak ditemukan.", "error");
  $("#modal-root").innerHTML = '<div class="modal-backdrop" data-backdrop><section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="content-revision-title"><div class="modal-header"><div><h2 id="content-revision-title">Revisi content</h2><p>' + esc(group.title) + '</p></div><button class="icon-button close-modal" aria-label="Tutup">×</button></div><form id="content-revision-form"><div class="modal-body"><input type="hidden" name="content_group_id" value="' + esc(contentGroupId) + '"><label for="content-revision-note">Deskripsi revisi *</label><textarea id="content-revision-note" name="comment" required maxlength="3000" rows="5" placeholder="Jelaskan bagian yang harus diperbaiki…"></textarea></div><div class="modal-footer"><button type="button" class="btn btn-secondary close-modal">Batal</button><button type="submit" class="btn btn-warning">Kirim revisi</button></div></form></section></div>';
}
async function sendContentRevision(form) {
  const data = new FormData(form);
  const groupId = String(data.get("content_group_id") || "");
  const note = String(data.get("comment") || "").trim();
  if (!groupId || !note) return toast("Deskripsi revisi wajib diisi.", "error");
  $("#modal-root").innerHTML = "";
  await changeContentStatus(groupId, "changes_requested", note);
}
async function deriveBackupKey(passphrase, salt, usages) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" },
    material, { name: "AES-GCM", length: 256 }, false, usages
  );
}
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function exportEncryptedBackup() {
  if (currentRole() !== "manager") return toast("Backup penuh hanya tersedia untuk manager.", "error");
  const passphrase = window.prompt("Buat password backup minimal 16 karakter. Simpan di tempat aman; tanpa password ini backup tidak bisa dipulihkan.");
  if (!passphrase) return;
  if (passphrase.length < 16) return toast("Password backup harus minimal 16 karakter.", "error");
  const confirmation = window.prompt("Ketik ulang password backup untuk konfirmasi.");
  if (confirmation !== passphrase) return toast("Konfirmasi password tidak cocok. Backup dibatalkan.", "error");
  toast("Menyiapkan data dan lampiran untuk backup…", "success");
  try {
    const [tasksRes, commentsRes, attachmentsRes, activitiesRes] = await Promise.all([
      supabase.from("tasks").select("*").order("created_at"),
      supabase.from("task_comments").select("*").order("created_at"),
      supabase.from("task_attachments").select("*").order("created_at"),
      supabase.from("activity_log").select("*").order("created_at")
    ]);
    for (const result of [tasksRes, commentsRes, attachmentsRes, activitiesRes]) {
      if (result.error) throw result.error;
    }
    const attachmentTotalBytes = (attachmentsRes.data || []).reduce((sum, item) => sum + Number(item.size_bytes || 0), 0);
    if (attachmentTotalBytes > 300 * 1024 * 1024) {
      throw new Error("Total lampiran melebihi 300 MB. Backup terenkripsi berbasis browser belum aman untuk paket sebesar ini. Simpan salinan file besar secara terpisah di media backup terenkripsi sebelum mengandalkan backup database.");
    }
    const { default: JSZip } = await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm");
    const zip = new JSZip();
    const manifest = {
      format: "ruang-kerja-encrypted-backup",
      version: 1,
      created_at: new Date().toISOString(),
      profiles: state.profiles.map((p) => ({ id: p.id, display_name: p.display_name, role: p.role })),
      tasks: tasksRes.data || [],
      comments: commentsRes.data || [],
      attachments: attachmentsRes.data || [],
      activities: activitiesRes.data || []
    };
    zip.file("backup.json", JSON.stringify(manifest));
    const attachmentRows = manifest.attachments;
    for (let i = 0; i < attachmentRows.length; i++) {
      const item = attachmentRows[i];
      const { data: blob, error: downloadError } = await supabase.storage.from(STORAGE_BUCKET).download(item.path);
      if (downloadError || !blob) throw new Error("Lampiran tidak bisa dibaca: " + item.file_name + (downloadError ? " — " + downloadError.message : ""));
      zip.file("files/" + item.id, blob);
      if ((i + 1) % 5 === 0 || i === attachmentRows.length - 1) {
        toast("Menyiapkan lampiran " + (i + 1) + "/" + attachmentRows.length + "…", "success");
      }
    }
    const archive = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 5 } });
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveBackupKey(passphrase, salt, ["encrypt"]);
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, archive));
    const envelope = new Uint8Array(36 + encrypted.length);
    envelope.set([82, 75, 87, 49, 0, 0, 0, 1], 0);
    envelope.set(salt, 8); envelope.set(iv, 24); envelope.set(encrypted, 36);
    saveBlob(new Blob([envelope], { type: "application/octet-stream" }), "ruang-kerja-backup-" + new Date().toISOString().slice(0, 10) + ".rkbak");
    toast("Backup terenkripsi berhasil diunduh. Simpan salinan di tempat terpisah yang aman.", "success");
  } catch (error) {
    toast("Backup gagal: " + (error.message || "kesalahan yang tidak diketahui"), "error");
  }
}
async function insertInChunks(table, rows, chunkSize = 40) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + chunkSize));
    if (error) throw error;
  }
}
async function restoreEncryptedBackup(file) {
  if (currentRole() !== "manager") return toast("Pemulihan backup hanya tersedia untuk manager.", "error");
  if (!file || file.size < 64 || file.size > 400 * 1024 * 1024) return toast("File backup tidak valid atau melebihi batas 400 MB.", "error");
  const passphrase = window.prompt("Masukkan password yang dipakai saat membuat backup.");
  if (!passphrase) return;
  toast("Memverifikasi dan membuka backup…", "success");
  try {
    const envelope = new Uint8Array(await file.arrayBuffer());
    const magic = [82, 75, 87, 49, 0, 0, 0, 1];
    if (!magic.every((value, index) => envelope[index] === value)) throw new Error("Format file backup tidak dikenali.");
    const salt = envelope.slice(8, 24);
    const iv = envelope.slice(24, 36);
    const encrypted = envelope.slice(36);
    const key = await deriveBackupKey(passphrase, salt, ["decrypt"]);
    let archive;
    try {
      archive = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted));
    } catch (_) {
      throw new Error("Password salah atau file backup rusak.");
    }
    const { default: JSZip } = await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm");
    const zip = await JSZip.loadAsync(archive);
    const manifestFile = zip.file("backup.json");
    if (!manifestFile) throw new Error("Isi backup.json tidak ditemukan.");
    const backup = JSON.parse(await manifestFile.async("string"));
    if (backup.format !== "ruang-kerja-encrypted-backup" || backup.version !== 1 ||
        !Array.isArray(backup.tasks) || !Array.isArray(backup.comments) ||
        !Array.isArray(backup.attachments) || !Array.isArray(backup.activities) ||
        !Array.isArray(backup.profiles)) throw new Error("Struktur backup tidak valid.");
    const profileMap = {};
    backup.profiles.forEach((oldProfile) => {
      const match = state.profiles.find((p) => p.role === oldProfile.role);
      if (match) profileMap[oldProfile.id] = match.id;
    });
    const mapProfile = (id) => id ? profileMap[id] : null;
    if (backup.profiles.some((p) => !profileMap[p.id])) throw new Error("Role anggota backup tidak cocok dengan akun tim saat ini.");
    const { data: presentTasks, error: taskReadError } = await supabase.from("tasks").select("id");
    if (taskReadError) throw taskReadError;
    const taskIds = new Set((presentTasks || []).map((t) => t.id));
    let restoredTasks = 0;
    const statusToRestore = [];
    for (const old of backup.tasks) {
      if (taskIds.has(old.id)) continue;
      const createdBy = mapProfile(old.created_by);
      const assignedTo = mapProfile(old.assigned_to);
      if (!createdBy || !assignedTo) throw new Error("PIC atau pembuat tugas tidak dapat dipetakan.");
      const payload = {
        id: old.id, title: old.title, description: old.description || "",
        due_date: old.due_date || null, due_time: old.due_time || null, priority: old.priority || "normal",
        status: "todo", created_by: createdBy, assigned_to: assignedTo,
        created_at: old.created_at
      };
      const { error } = await supabase.from("tasks").insert(payload);
      if (error) throw error;
      taskIds.add(old.id); restoredTasks++;
      if (old.status && old.status !== "todo") statusToRestore.push({ id: old.id, status: old.status });
    }
    for (const row of statusToRestore) {
      const { error } = await supabase.from("tasks").update({ status: row.status }).eq("id", row.id);
      if (error) throw error;
    }
    const { data: presentComments, error: commentReadError } = await supabase.from("task_comments").select("id");
    if (commentReadError) throw commentReadError;
    const commentIds = new Set((presentComments || []).map((r) => r.id));
    const missingComments = backup.comments.filter((c) => !commentIds.has(c.id)).map((c) => ({
      id: c.id, task_id: c.task_id, user_id: mapProfile(c.user_id),
      comment: c.comment, created_at: c.created_at
    }));
    if (missingComments.some((c) => !c.user_id)) throw new Error("Penulis komentar tidak dapat dipetakan.");
    await insertInChunks("task_comments", missingComments);
    const { data: presentAttachments, error: attachmentReadError } = await supabase.from("task_attachments").select("id,path");
    if (attachmentReadError) throw attachmentReadError;
    const attachmentIds = new Set((presentAttachments || []).map((r) => r.id));
    const attachmentPaths = new Set((presentAttachments || []).map((r) => r.path));
    const missingMetadata = [];
    for (const item of backup.attachments) {
      if (attachmentIds.has(item.id) || attachmentPaths.has(item.path)) continue;
      const entry = zip.file("files/" + item.id);
      if (!entry) throw new Error("Konten lampiran tidak ada di backup: " + item.file_name);
      const bytes = await entry.async("uint8array");
      const blob = new Blob([bytes], { type: item.content_type || "application/octet-stream" });
      const restoredFile = new File([blob], item.file_name, { type: item.content_type || "application/octet-stream" });
      const uploaded = await uploadPrivateFile(item.task_id, restoredFile);
      const uploadedBy = mapProfile(item.uploaded_by);
      if (!uploadedBy) throw new Error("Pemilik lampiran tidak dapat dipetakan.");
      missingMetadata.push({
        id: item.id, task_id: item.task_id, path: uploaded.path,
        file_name: item.file_name, content_type: item.content_type || "application/octet-stream",
        size_bytes: item.size_bytes, uploaded_by: uploadedBy, created_at: item.created_at
      });
      attachmentIds.add(item.id); attachmentPaths.add(uploaded.path);
    }
    await insertInChunks("task_attachments", missingMetadata, 20);
    const { data: presentActivity, error: activityReadError } = await supabase.from("activity_log").select("id");
    if (activityReadError) throw activityReadError;
    const activityIds = new Set((presentActivity || []).map((r) => r.id));
    const missingActivity = backup.activities.filter((a) => !activityIds.has(a.id)).map((a) => ({
      id: a.id, task_id: a.task_id || null, actor_id: mapProfile(a.actor_id),
      action: a.action, details: a.details || {}, created_at: a.created_at
    }));
    await insertInChunks("activity_log", missingActivity, 40);
    await loadWorkspace();
    toast("Pemulihan selesai. " + restoredTasks + " tugas yang sebelumnya belum ada berhasil dipulihkan; data yang sudah ada tidak ditimpa.", "success");
  } catch (error) {
    toast("Pemulihan belum selesai: " + (error.message || "kesalahan yang tidak diketahui") + ". Kamu dapat mencoba lagi; catatan yang sudah ada tidak ditimpa.", "error");
  }
}

function closeModal() {
  $("#modal-root").innerHTML = "";
  state.selectedTaskId = null;
}
async function logout() {
  if (supabase) await supabase.auth.signOut();
  state.user = null;
  state.profile = null;
  state.profiles = [];
  state.tasks = [];
  state.comments = [];
  state.attachments = [];
  state.contentAssets = [];
  state.activities = [];
  showAuth("Kamu sudah keluar dari ruang kerja.", "success");
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) return;

  const form = event.currentTarget;
  const button = $('button[type="submit"]', form);
  const data = new FormData(form);
  const accessCode = String(data.get("access_code") || "").trim().toUpperCase().replace(/\s+/g, "");
  if (accessCode.length < 20) {
    setAuthMessage("Masukkan kode akses yang lengkap.", "error");
    return;
  }

  button.disabled = true;
  button.textContent = "Memverifikasi kode…";
  setAuthMessage("");

  let user = null;
  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;

    user = sessionData.session?.user || null;
    if (!user || !user.is_anonymous) {
      if (user) await supabase.auth.signOut();
      const { data: anonymousData, error: anonymousError } = await supabase.auth.signInAnonymously();
      if (anonymousError) {
        if (/anonymous|disabled|sign.?in provider/i.test(anonymousError.message || "")) {
          throw new Error("Mode kode akses belum diaktifkan di Supabase. Aktifkan Authentication → Providers → Anonymous Sign-Ins, lalu coba lagi.");
        }
        throw anonymousError;
      }
      user = anonymousData.user || anonymousData.session?.user || null;
    }
    if (!user) throw new Error("Sesi belum terbentuk. Coba sekali lagi.");

    const { data: accepted, error: codeError } = await supabase.rpc("activate_access_code", { p_code: accessCode });
    if (codeError) throw codeError;
    if (accepted !== true) {
      await supabase.auth.signOut();
      state.user = null;
      state.profile = null;
      showAuth("Kode akses salah atau tidak aktif. Periksa kode lalu coba lagi.", "error");
      return;
    }

    form.reset();
    state.user = user;
    setAuthMessage("Kode diterima. Membuka ruang kerja…", "success");
    await enterApp(user);
  } catch (error) {
    if (user && /kode akses/i.test(error.message || "") && /belum diaktifkan/i.test(error.message || "")) {
      await supabase.auth.signOut().catch(() => {});
    }
    showAuth(error.message || "Tidak dapat masuk. Periksa koneksi dan coba lagi.", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Masuk ke ruang kerja";
  }
});

document.addEventListener("click", async (event) => {
  const nav = event.target.closest("[data-view]");
  if (nav) { changeView(nav.dataset.view); return; }
  if (event.target.closest("#new-task-top") || event.target.closest("[data-create-task]")) { openCreateModal(); return; }
  if (event.target.closest("#mobile-menu-button")) { $("#sidebar").classList.toggle("mobile-open"); return; }
  if (event.target.closest("#logout-button")) { await logout(); return; }
  const openTask = event.target.closest(".task-open");
  if (openTask) { openTaskModal(openTask.dataset.id); return; }
  const quickStatus = event.target.closest(".task-quick-status");
  if (quickStatus) { await changeTaskStatus(quickStatus.dataset.id, quickStatus.dataset.status); return; }
  const quickRevision = event.target.closest(".task-quick-revision");
  if (quickRevision) { openTaskModal(quickRevision.dataset.id); const box = $("#revision-box"); if (box) { box.hidden = false; $("#revision-note")?.focus(); } return; }
  const contentRevision = event.target.closest(".content-quick-revision");
  if (contentRevision) { openContentRevision(contentRevision.dataset.id); return; }
  const contentApprove = event.target.closest(".content-quick-approve");
  if (contentApprove) { await changeContentStatus(contentApprove.dataset.id, "done", ""); return; }
  const contentMarkDone = event.target.closest(".content-mark-done");
  if (contentMarkDone) { await changeContentStatus(contentMarkDone.dataset.id, "in_review", ""); return; }
  const copyCaption = event.target.closest(".copy-caption");
  if (copyCaption) { const content = groupContentAssets().find((item) => item.content_group_id === copyCaption.dataset.id); if (!content) return toast("Caption tidak ditemukan.", "error"); try { await navigator.clipboard.writeText(content.caption || ""); toast(content.caption ? "Caption berhasil disalin." : "Caption kosong."); } catch { toast("Clipboard tidak tersedia. Salin caption dari teks content.", "error"); } return; }
  const submitTaskFile = event.target.closest(".submit-task-file");
  if (submitTaskFile) { await changeTaskStatus(submitTaskFile.dataset.id, "in_review"); return; }
  const deleteTaskFile = event.target.closest(".delete-task-file");
  if (deleteTaskFile) { await deleteTaskAttachment(deleteTaskFile.dataset.id); return; }
  const status = event.target.closest("[data-task-status]");
  if (status) { await changeTaskStatus(status.dataset.id, status.dataset.taskStatus); return; }
  const revision = event.target.closest("[data-show-revision]");
  if (revision) { const box = $("#revision-box"); box.hidden = !box.hidden; $("#revision-note")?.focus(); return; }
  if (event.target.closest("[data-backup-export]")) { await exportEncryptedBackup(); return; }
  if (event.target.closest("[data-backup-restore]")) {
    if (currentRole() !== "manager") return toast("Pemulihan backup hanya tersedia untuk manager.", "error");
    const picker = document.createElement("input");
    picker.type = "file"; picker.accept = ".rkbak,application/octet-stream";
    picker.addEventListener("change", () => restoreEncryptedBackup(picker.files && picker.files[0]));
    picker.click(); return;
  }
  const download = event.target.closest(".download-file");
  if (download) { await downloadFile(download.dataset.id); return; }
  const contentDownload = event.target.closest(".download-content");
  if (contentDownload) { await downloadContentFile(contentDownload.dataset.id); return; }
  const contentDelete = event.target.closest(".delete-content");
  if (contentDelete) { await deleteContent(contentDelete.dataset.id); return; }
  if (event.target.closest(".close-modal")) { closeModal(); return; }
  if (event.target.matches("[data-backdrop]")) { closeModal(); }
});
document.addEventListener("input", (event) => { if (event.target.id === "task-search") applyTaskFilters(); });
document.addEventListener("change", (event) => {
  if (event.target.id === "task-status-filter" || event.target.id === "task-priority-filter") applyTaskFilters();
});
document.addEventListener("submit", async (event) => {
  if (event.target.id === "create-task-form") { event.preventDefault(); await createTask(event.target); }
  else if (event.target.id === "revision-form") { event.preventDefault(); await sendRevision(event.target); }
  else if (event.target.id === "comment-form") { event.preventDefault(); await addComment(event.target); }
  else if (event.target.id === "upload-form") { event.preventDefault(); await uploadTaskFile(event.target); }
  else if (event.target.id === "content-upload-form") { event.preventDefault(); await uploadContent(event.target); }
  else if (event.target.id === "content-revision-form") { event.preventDefault(); await sendContentRevision(event.target); }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $("#modal-root").innerHTML) closeModal();
});

if (!configured) {
  showConfigWarning();
} else {
  supabase.auth.getSession().then(({ data, error }) => {
    if (error) showAuth("Sesi tidak dapat dibaca. Silakan login kembali.", "error");
    else if (data.session) enterApp(data.session.user);
  }).catch(() => showAuth("Koneksi belum tersedia. Coba refresh halaman.", "error"));
  supabase.auth.onAuthStateChange((event, session) => {
    if (session && ["TOKEN_REFRESHED", "USER_UPDATED"].includes(event) && state.user) {
      window.setTimeout(() => enterApp(session.user), 0);
    } else if (event === "SIGNED_OUT") {
      state.user = null;
      state.profile = null;
      state.profiles = [];
      state.tasks = [];
      state.comments = [];
      state.attachments = [];
      state.contentAssets = [];
      state.activities = [];
      showAuth();
    }
  });
}
