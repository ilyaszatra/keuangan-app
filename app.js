const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const rp = (n) => "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");
const compact = (n) =>
  Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + "jt" : Math.round(n / 1e3) + "rb";
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromYmd = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (d, n) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const daysBetween = (a, b) => Math.round((fromYmd(b) - fromYmd(a)) / 864e5) + 1;
const today = () => ymd(new Date());
const LBL = (s) =>
  fromYmd(s).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const PALETTE = [
  "#6d5efc",
  "#2dd4bf",
  "#f472b6",
  "#60a5fa",
  "#a78bfa",
  "#34d399",
  "#fbbf24",
  "#f87171",
  "#38bdf8",
  "#c084fc",
  "#94a3b8",
  "#fb923c",
];

let cfg = JSON.parse(localStorage.getItem("keuangan_cfg") || "null");
let ref = null; // daftar dropdown dari sheet Referensi
let tx = []; // semua transaksi
let visible = []; // transaksi yang tampil di riwayat
let period = "bulan";
let editing = null; // transaksi yang sedang diedit
const charts = {};

/* ---------- API ---------- */
async function api(action, data = {}) {
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ token: cfg.token, action, data }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Gagal memproses data");
  return json;
}

const friendly = (err) =>
  err instanceof TypeError
    ? "Tidak bisa terhubung. Cek koneksi internet."
    : err.message;

function toast(msg, type = "ok") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  $("#toasts").append(el);
  setTimeout(() => el.classList.add("out"), 2600);
  setTimeout(() => el.remove(), 3000);
}

/* ---------- Muat data ---------- */
async function loadAll(showOk = false) {
  $("#progress").classList.remove("hidden");
  try {
    const [r, l] = await Promise.all([api("ref"), api("list")]);
    ref = r.data;
    tx = l.data.transactions;
    fillCategoryFilter();
    renderAll();
    if (showOk) toast("Data diperbarui ✓");
  } catch (err) {
    toast(friendly(err), "err");
  } finally {
    $("#progress").classList.add("hidden");
  }
}

async function reload() {
  tx = (await api("list")).data.transactions;
  renderAll();
}

function renderAll() {
  renderHome();
  renderHistory();
}

/* ---------- Setup & navigasi ---------- */
function showScreen() {
  const has = !!cfg;
  $("#setup").classList.toggle("hidden", has);
  $("#app").classList.toggle("hidden", !has);
  if (has) loadAll();
}

$("#setupForm").addEventListener("submit", (e) => {
  e.preventDefault();
  cfg = { url: $("#sUrl").value.trim(), token: $("#sToken").value.trim() };
  localStorage.setItem("keuangan_cfg", JSON.stringify(cfg));
  showScreen();
});

const TITLES = { home: "Beranda", history: "Riwayat", settings: "Pengaturan" };
function showView(name) {
  $$(".view").forEach((v) =>
    v.classList.toggle("hidden", v.id !== "view-" + name),
  );
  $$(".bottom-nav [data-view]").forEach((b) =>
    b.classList.toggle("on", b.dataset.view === name),
  );
  $("#title").textContent = TITLES[name];
  window.scrollTo({ top: 0 });
}
$$("[data-view]").forEach((b) =>
  b.addEventListener("click", () => showView(b.dataset.view)),
);
$("#refresh").addEventListener("click", () => loadAll(true));
$("#btnRefresh").addEventListener("click", () => loadAll(true));
$("#btnLogout").addEventListener("click", async () => {
  if (
    !(await confirmBox(
      "Hapus URL dan token dari HP ini? Data di spreadsheet tidak ikut terhapus.",
    ))
  )
    return;
  localStorage.removeItem("keuangan_cfg");
  cfg = null;
  showScreen();
});

/* ---------- Periode ---------- */
function getRange() {
  const now = new Date();
  if (period === "hari") return [today(), today()];
  if (period === "minggu") {
    const start = addDays(now, -((now.getDay() + 6) % 7));
    return [ymd(start), ymd(addDays(start, 6))];
  }
  if (period === "bulan") {
    return [
      ymd(new Date(now.getFullYear(), now.getMonth(), 1)),
      ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    ];
  }
  let [a, b] = [$("#cFrom").value || today(), $("#cTo").value || today()];
  if (a > b) [a, b] = [b, a];
  return [a, b];
}

function prevRange([a, b]) {
  if (period === "bulan") {
    const d = fromYmd(a);
    return [
      ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)),
      ymd(new Date(d.getFullYear(), d.getMonth(), 0)),
    ];
  }
  const n = daysBetween(a, b);
  return [ymd(addDays(fromYmd(a), -n)), ymd(addDays(fromYmd(a), -1))];
}

const rangeText = ([a, b]) => (a === b ? LBL(a) : `${LBL(a)} – ${LBL(b)}`);
const isCounted = (t, [a, b]) =>
  t.status === "Berhasil" && t.tanggal >= a && t.tanggal <= b;
const sumOf = (list, type) =>
  list.filter((t) => t.type === type).reduce((s, t) => s + t.nominal, 0);
const groupCat = (list) =>
  list.reduce((m, t) => {
    m[t.kategori] = (m[t.kategori] || 0) + t.nominal;
    return m;
  }, {});

$("#periodChips").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  period = b.dataset.p;
  $$("#periodChips button").forEach((x) => x.classList.toggle("on", x === b));
  $("#customRange").classList.toggle("hidden", period !== "custom");
  if (period === "custom" && !$("#cFrom").value) {
    $("#cFrom").value = today();
    $("#cTo").value = today();
  }
  renderHome();
});
["#cFrom", "#cTo"].forEach((s) => $(s).addEventListener("change", renderHome));

/* ---------- Beranda ---------- */
function renderHome() {
  if (!tx.length && !ref) return;
  const r = getRange(),
    pr = prevRange(r);
  const cur = tx.filter((t) => isCounted(t, r));
  const prev = tx.filter((t) => isCounted(t, pr));
  const inc = sumOf(cur, "in"),
    out = sumOf(cur, "out"),
    net = inc - out;

  $("#rangeLabel").textContent = rangeText(r);
  $("#sumIn").textContent = rp(inc);
  $("#sumOut").textContent = rp(out);
  $("#sumNet").textContent = rp(net);
  renderInsights(cur, out, sumOf(prev, "out"), r);
  renderCharts(cur, r);
}

function renderInsights(cur, out, prevOut, r) {
  const box = $("#insights");
  if (!cur.length) {
    box.innerHTML = `<h3>Insight</h3><p class="empty">Belum ada transaksi di periode ini.<br>Tekan <b>+</b> untuk mulai mencatat.</p>`;
    return;
  }
  const cats = Object.entries(
    groupCat(cur.filter((t) => t.type === "out")),
  ).sort((a, b) => b[1] - a[1]);
  const top = cats[0];
  const endDate = today() < r[1] ? today() : r[1];
  const elapsed = endDate < r[0] ? 1 : daysBetween(r[0], endDate);
  const change = prevOut > 0 ? ((out - prevOut) / prevOut) * 100 : null;

  let changeText = "🔎 Belum ada data periode sebelumnya untuk dibandingkan";
  if (change !== null) {
    changeText = `${change > 0 ? "📈" : "📉"} Pengeluaran ${change > 0 ? "naik" : "turun"} <b>${Math.abs(change).toFixed(0)}%</b> dibanding periode sebelumnya`;
  }

  box.innerHTML = `
    <h3>Insight</h3>
    <ul class="insight-list">
      <li>🏆 Pengeluaran terbesar: <b>${esc(top ? top[0] : "-")}</b>${top && out ? ` (${rp(top[1])}, ${Math.round((top[1] / out) * 100)}%)` : ""}</li>
      <li>📆 Rata-rata pengeluaran harian: <b>${rp(out / elapsed)}</b></li>
      <li>${changeText}</li>
    </ul>`;
}

function drawChart(id, config) {
  charts[id]?.destroy();
  charts[id] = new Chart(document.getElementById(id), config);
}

const chartOpts = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { boxWidth: 10, font: { family: "inherit" } } },
  },
};

function renderCharts(cur, r) {
  // Doughnut kategori pengeluaran
  const cats = Object.entries(
    groupCat(cur.filter((t) => t.type === "out")),
  ).sort((a, b) => b[1] - a[1]);
  $("#emptyCat").classList.toggle("hidden", cats.length > 0);
  $("#chCat").classList.toggle("hidden", cats.length === 0);
  if (cats.length) {
    drawChart("chCat", {
      type: "doughnut",
      data: {
        labels: cats.map((c) => c[0]),
        datasets: [
          {
            data: cats.map((c) => c[1]),
            backgroundColor: PALETTE,
            borderWidth: 0,
          },
        ],
      },
      options: { ...chartOpts, cutout: "62%" },
    });
  } else {
    charts.chCat?.destroy();
    delete charts.chCat;
  }

  // Tren harian
  const days = [];
  for (let i = 0; i < daysBetween(r[0], r[1]); i++)
    days.push(ymd(addDays(fromYmd(r[0]), i)));
  drawChart("chDaily", {
    type: "line",
    data: {
      labels: days.map((d) => d.slice(8) + "/" + d.slice(5, 7)),
      datasets: [
        {
          label: "Pemasukan",
          data: days.map((d) =>
            sumOf(
              cur.filter((t) => t.tanggal === d),
              "in",
            ),
          ),
          borderColor: "#2dd4bf",
          backgroundColor: "rgba(45,212,191,.15)",
          fill: true,
          tension: 0.35,
          pointRadius: 0,
        },
        {
          label: "Pengeluaran",
          data: days.map((d) =>
            sumOf(
              cur.filter((t) => t.tanggal === d),
              "out",
            ),
          ),
          borderColor: "#f472b6",
          backgroundColor: "rgba(244,114,182,.12)",
          fill: true,
          tension: 0.35,
          pointRadius: 0,
        },
      ],
    },
    options: { ...chartOpts, scales: { y: { ticks: { callback: compact } } } },
  });

  // Bar 6 bulan terakhir
  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--)
    months.push(
      ymd(new Date(now.getFullYear(), now.getMonth() - i, 1)).slice(0, 7),
    );
  const sumM = (m, type) =>
    tx
      .filter(
        (t) =>
          t.status === "Berhasil" && t.type === type && t.tanggal.startsWith(m),
      )
      .reduce((s, t) => s + t.nominal, 0);
  drawChart("chMonth", {
    type: "bar",
    data: {
      labels: months.map((m) =>
        fromYmd(m + "-01").toLocaleDateString("id-ID", { month: "short" }),
      ),
      datasets: [
        {
          label: "Pemasukan",
          data: months.map((m) => sumM(m, "in")),
          backgroundColor: "#2dd4bf",
          borderRadius: 6,
        },
        {
          label: "Pengeluaran",
          data: months.map((m) => sumM(m, "out")),
          backgroundColor: "#f472b6",
          borderRadius: 6,
        },
      ],
    },
    options: { ...chartOpts, scales: { y: { ticks: { callback: compact } } } },
  });
}

/* ---------- Riwayat ---------- */
function fillCategoryFilter() {
  const cats = [...new Set([...ref.expenseCats, ...ref.incomeCats])];
  const sel = $("#hCat");
  const current = sel.value;
  sel.innerHTML =
    '<option value="">Semua kategori</option>' +
    cats.map((c) => `<option>${esc(c)}</option>`).join("");
  sel.value = current;
}

function renderHistory() {
  const q = $("#search").value.trim().toLowerCase();
  const jenis = $("#hJenis").value;
  const cat = $("#hCat").value;
  const box = $("#historyList");

  if (!tx.length) {
    box.innerHTML = `<div class="glass empty-state"><div>🧾</div><h3>Belum ada transaksi</h3><p class="muted">Tekan tombol + untuk mencatat transaksi pertama.</p></div>`;
    return;
  }

  visible = tx
    .filter(
      (t) =>
        (jenis === "all" || t.type === jenis) &&
        (!cat || t.kategori === cat) &&
        (!q ||
          [
            t.kategori,
            t.subkategori,
            t.deskripsi,
            t.catatan,
            t.merchant,
            t.sumber,
          ]
            .join(" ")
            .toLowerCase()
            .includes(q)),
    )
    .sort(
      (a, b) =>
        b.tanggal.localeCompare(a.tanggal) ||
        String(b.id).localeCompare(String(a.id)),
    );

  if (!visible.length) {
    box.innerHTML = `<p class="empty">Tidak ada transaksi yang cocok dengan pencarian.</p>`;
    return;
  }

  let html = "",
    last = "";
  visible.forEach((t, i) => {
    if (t.tanggal !== last) {
      last = t.tanggal;
      html += `<p class="date-head">${LBL(t.tanggal)}</p>`;
    }
    const sub = t.deskripsi || t.subkategori || t.merchant || t.sumber || "";
    html += `
      <button class="tx" data-i="${i}">
        <span class="dot ${t.type}">${t.type === "in" ? "↓" : "↑"}</span>
        <span class="tx-main">
          <b>${esc(t.kategori)}</b>
          <small>${esc(sub)}</small>
          ${t.status !== "Berhasil" ? `<em>${esc(t.status)}</em>` : ""}
        </span>
        <span class="amt ${t.type}">${t.type === "in" ? "+" : "−"} ${rp(t.nominal)}</span>
      </button>`;
  });
  box.innerHTML = html;
}

$("#historyList").addEventListener("click", (e) => {
  const b = e.target.closest(".tx");
  if (b) openForm(visible[Number(b.dataset.i)]);
});
["#search", "#hJenis", "#hCat"].forEach((s) =>
  $(s).addEventListener("input", renderHistory),
);

/* ---------- Form tambah / edit ---------- */
function fillSel(sel, items, selected = "", placeholder = "") {
  sel.innerHTML =
    (placeholder ? `<option value="">${placeholder}</option>` : "") +
    items
      .map(
        (i) => `<option ${i === selected ? "selected" : ""}>${esc(i)}</option>`,
      )
      .join("");
  if (selected && !items.includes(selected))
    sel.insertAdjacentHTML(
      "beforeend",
      `<option selected>${esc(selected)}</option>`,
    );
}

function buildSelects(type, v) {
  const isIn = type === "in";
  $$("#fTypeSeg button").forEach((b) =>
    b.classList.toggle("on", b.dataset.type === type),
  );
  $("#fType").value = type;
  $("#partyLabel").textContent = isIn
    ? "Sumber pemasukan"
    : "Merchant / Penerima";
  $("#jenisWrap").classList.toggle("hidden", isIn);
  fillSel(
    $("#fKategori"),
    isIn ? ref.incomeCats : ref.expenseCats,
    v.kategori || "",
    "Pilih kategori",
  );
  fillSel($("#fSub"), ref.subcats, v.subkategori || "", "— tidak ada —");
  fillSel($("#fMetode"), ref.methods, v.metode || "", "— pilih —");
  fillSel($("#fRek"), ref.accounts, v.rekening || "", "— pilih —");
  fillSel($("#fStatus"), ref.statuses, v.status || "Berhasil");
  fillSel($("#fBerulang"), ref.recurring, v.berulang || "Tidak");
  fillSel($("#fJenis2"), ref.expenseTypes, v.jenis || "", "— pilih —");
}

const getNominal = () =>
  Number(($("#nominal").value || "").replace(/\D/g, "")) || 0;
const setNominal = (n) => {
  $("#nominal").value = n ? Number(n).toLocaleString("id-ID") : "";
};

$("#nominal").addEventListener("input", (e) => {
  const digits = e.target.value.replace(/\D/g, "");
  e.target.value = digits ? Number(digits).toLocaleString("id-ID") : "";
});

function readForm() {
  return {
    type: $("#fType").value,
    tanggal: $("#fTanggal").value,
    nominal: getNominal(),
    kategori: $("#fKategori").value,
    subkategori: $("#fSub").value,
    deskripsi: $("#fDesc").value.trim(),
    party: $("#fParty").value.trim(),
    jenis: $("#fJenis2").value,
    metode: $("#fMetode").value,
    rekening: $("#fRek").value,
    status: $("#fStatus").value,
    berulang: $("#fBerulang").value,
    catatan: $("#fCatatan").value.trim(),
  };
}

function openForm(t = null) {
  editing = t;
  const v = t
    ? { ...t, party: t.type === "in" ? t.sumber : t.merchant }
    : { type: "out", tanggal: today(), status: "Berhasil", berulang: "Tidak" };

  $("#formTitle").textContent = t ? "Edit transaksi" : "Tambah transaksi";
  buildSelects(v.type, v);
  setNominal(v.nominal);
  $("#fTanggal").value = v.tanggal;
  $("#fDesc").value = v.deskripsi || "";
  $("#fParty").value = v.party || "";
  $("#fCatatan").value = v.catatan || "";
  $("#fDelete").classList.toggle("hidden", !t);
  $("#formError").classList.add("hidden");
  $("#form").classList.remove("hidden");
  $("#sheetBackdrop").classList.remove("hidden");
  if (!t) $("#nominal").focus();
}

function closeForm() {
  editing = null;
  $("#form").classList.add("hidden");
  $("#sheetBackdrop").classList.add("hidden");
}

function showFormError(msg) {
  const el = $("#formError");
  el.textContent = msg;
  el.classList.remove("hidden");
}

$("#fab").addEventListener("click", () => openForm());
$("#formClose").addEventListener("click", closeForm);
$("#sheetBackdrop").addEventListener("click", closeForm);

$("#fTypeSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) buildSelects(b.dataset.type, readForm());
});

$("#form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const v = readForm();
  const problem =
    !v.nominal || v.nominal <= 0
      ? "Nominal wajib diisi dan harus lebih dari 0"
      : !v.kategori
        ? "Pilih kategori dulu"
        : !v.tanggal
          ? "Tanggal wajib diisi"
          : "";
  if (problem) return showFormError(problem);

  const payload = {
    ...v,
    sumber: v.type === "in" ? v.party : "",
    merchant: v.type === "out" ? v.party : "",
  };
  const wasEdit = !!editing;
  const btn = $("#fSave");
  btn.disabled = true;
  btn.textContent = "Menyimpan…";
  try {
    if (wasEdit)
      await api("update", {
        ...payload,
        id: editing.id,
        oldType: editing.type,
      });
    else await api("add", payload);
    closeForm();
    toast(wasEdit ? "Perubahan tersimpan ✓" : "Transaksi tersimpan ✓");
    await reload();
  } catch (err) {
    showFormError(friendly(err));
  } finally {
    btn.disabled = false;
    btn.textContent = "Simpan";
  }
});

$("#fDelete").addEventListener("click", async () => {
  if (!editing) return;
  const target = editing;
  const ok = await confirmBox(
    `Hapus transaksi ${rp(target.nominal)} (${target.kategori})? Tindakan ini tidak bisa dibatalkan.`,
  );
  if (!ok) return;
  try {
    await api("delete", { id: target.id, type: target.type });
    closeForm();
    toast("Transaksi dihapus");
    await reload();
  } catch (err) {
    showFormError(friendly(err));
  }
});

/* ---------- Dialog konfirmasi ---------- */
function confirmBox(text) {
  return new Promise((resolve) => {
    $("#confirmText").textContent = text;
    const dlg = $("#confirm");
    dlg.onclose = () => resolve(dlg.returnValue === "yes");
    dlg.showModal();
  });
}

/* ---------- Mulai ---------- */
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
showScreen();
