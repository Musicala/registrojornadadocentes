// ====== Config ======
const GAS_URL = "https://script.google.com/macros/s/AKfycbwwz9QoOUlGwHaAYp1uHePJOtp3hwySrADWTm8qQbZZwBE65rJo0_T7rDXvLFLR9VmZ/exec"; // <- reemplaza con tu /exec del Web App

// Docentes líderes (puedes sincronizarlos desde GAS con mode=meta si quieres)
const DOCENTES = [
  "Angie Natalia Nitola",
  "Emily Bejarano",
  "Laura Lorena Sánchez",
  "Natalia Alarcón"
];

const LS_KEY = "docentes.qr.v1"; // { name, cameraId, history: {YYYY-MM-DD:{ingreso?, salida?}} }

let html5QrCode = null;
let currentCameraId = null;
let SUBMIT_LOCK = false; // <- evita doble escaneo mientras registra

// ====== Helpers ======
const $ = (sel, ctx=document) => ctx.querySelector(sel);
const $reader = $("#reader");
const $cameraSelect = $("#cameraSelect");
const $docente = $("#practicanteSelect"); // reutilizamos el mismo id del select
const $result = $("#result");
const $btnStart = $("#btnStart");
const $btnStop = $("#btnStop");
const $summary = $("#summary");

const loadState = () => {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; }
};
const saveState = (data) => localStorage.setItem(LS_KEY, JSON.stringify(data));

function todayKey(d = new Date()){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function fmtTime(d = new Date()){
  const hh = String(d.getHours()).padStart(2,"0");
  const mm = String(d.getMinutes()).padStart(2,"0");
  return `${hh}:${mm}`;
}
function insecureContextMsg() {
  return !window.isSecureContext
    ? "Este sitio no está en HTTPS. En móviles, la cámara se bloquea sin HTTPS."
    : "";
}

// ====== UI Setup ======
function populateDocentes(){
  $docente.innerHTML = "";
  DOCENTES.forEach(n => {
    const opt = document.createElement("option");
    opt.value = n; opt.textContent = n;
    $docente.appendChild(opt);
  });
}

function pickBestCameraId(devices) {
  if (!devices || !devices.length) return null;
  const rear = devices.find(d => /back|trasera|rear|environment/i.test(d.label || ""));
  return (rear && rear.id) || devices[0].id;
}

async function loadCameras() {
  try {
    const devices = await Html5Qrcode.getCameras();
    $cameraSelect.innerHTML = "";
    if (!devices || !devices.length) {
      const msg = insecureContextMsg() || "No se detectaron cámaras. Revisa permisos del navegador.";
      $result.textContent = `⚠️ ${msg}`;
      return;
    }

    currentCameraId = pickBestCameraId(devices);

    devices.forEach((d, i) => {
      const opt = document.createElement("option");
      opt.value = d.id;
      opt.textContent = d.label || `Cámara ${i+1}`;
      $cameraSelect.appendChild(opt);
    });
    if (currentCameraId) $cameraSelect.value = currentCameraId;

    const st = loadState();
    if (st.cameraId && devices.some(d => d.id === st.cameraId)) {
      currentCameraId = st.cameraId;
      $cameraSelect.value = st.cameraId;
    }
  } catch (e) {
    console.error(e);
    const msg = insecureContextMsg() || "Error listando cámaras. Revisa permisos del navegador.";
    $result.textContent = `⚠️ ${msg}`;
  }
}

$cameraSelect.addEventListener("change", (e) => {
  currentCameraId = e.target.value;
  const st = loadState();
  st.cameraId = currentCameraId;
  saveState(st);
});

$docente.addEventListener("change", () => {
  const st = loadState();
  st.name = $docente.value;
  saveState(st);
  renderSummary();
});

// ====== Escaneo ======
async function start() {
  try {
    if (!currentCameraId) await loadCameras();
    if (html5QrCode) await html5QrCode.stop().catch(()=>{});
    html5QrCode = new Html5Qrcode("reader");

    try {
      await html5QrCode.start(
        { deviceId: { exact: currentCameraId } },
        { fps: 10, qrbox: (vw, vh) => ({ width: Math.min(vw, vh) * 0.7, height: Math.min(vw, vh) * 0.7 }) },
        onScanSuccess,
        () => {}
      );
    } catch (err1) {
      console.warn("Falló con deviceId, probando facingMode environment…", err1);
      await html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: (vw, vh) => ({ width: Math.min(vw, vh) * 0.7, height: Math.min(vw, vh) * 0.7 }) },
        onScanSuccess,
        () => {}
      );
    }

    $btnStart.disabled = true;
    $btnStop.disabled = false;
    const st = loadState(); st.cameraId = currentCameraId; saveState(st);

  } catch (err) {
    console.error(err);
    const msg = insecureContextMsg() ||
      "Error al acceder a la cámara. Revisa permisos del sitio o cierra apps que usen la cámara (WhatsApp/Instagram) y vuelve a intentar.";
    $result.textContent = `⚠️ ${msg}`;
  }
}

async function stop() {
  if (html5QrCode) {
    await html5QrCode.stop();
    await html5QrCode.clear();
    html5QrCode = null;
  }
  $btnStart.disabled = false;
  $btnStop.disabled = true;
}

$btnStart.addEventListener("click", start);
$btnStop.addEventListener("click", stop);

async function onScanSuccess(decodedText) {
  // Evita dobles lecturas mientras enviamos
  if (SUBMIT_LOCK) return;
  SUBMIT_LOCK = true;

  try {
    if (navigator.vibrate) navigator.vibrate(20);
    // Pausar la cámara mientras registramos (evita múltiples onScanSuccess)
    if (html5QrCode && html5QrCode.pause) {
      html5QrCode.pause(true); // congela frame
    }

    const name = $docente.value || DOCENTES[0];
    const now = new Date();
    const dateISO = todayKey(now);
    const timeHHMM = fmtTime(now);

    $result.textContent = `Leyó: “${decodedText}” — ${dateISO} ${timeHHMM} — Enviando…`;

    // Enviar como text/plain para evitar preflight CORS
    const res = await fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        mode: "registro",
        payload: {
          date: dateISO,
          name,
          stamp: now.toISOString(),
          raw: decodedText // ADM-INGRESO / ADM-SALIDA
        }
      })
    });

    const rawText = await res.text().catch(()=>"(sin cuerpo)");
    if (!res.ok) {
      $result.textContent = `❌ HTTP ${res.status} – ${rawText}`;
      return;
    }

    let data;
    try { data = JSON.parse(rawText); }
    catch {
      $result.textContent = `❌ Respuesta no JSON del servidor: ${rawText}`;
      return;
    }

    if (!data.ok) {
      $result.textContent = `❌ GAS dijo: ${data.error || "Error desconocido"}`;
      return;
    }

    const tipo = data.type === "salida" ? "Salida" : "Ingreso";
    $result.textContent = `✔️ ${name} — ${tipo} registrado: ${dateISO} ${timeHHMM}`;

    // Guardar historial local del día (solo visual)
    const st = loadState();
    st.history = st.history || {};
    st.history[dateISO] = st.history[dateISO] || {};
    if (data.type === "ingreso") st.history[dateISO].ingreso = timeHHMM;
    if (data.type === "salida")  st.history[dateISO].salida  = timeHHMM;
    saveState(st);
    renderSummary();

  } catch (err) {
    console.error(err);
    $result.textContent = `❌ Fetch falló (¿CORS o red?): ${String(err)}`;
  } finally {
    // Reanudar cámara y liberar lock después de un pequeño respiro
    setTimeout(async () => {
      try {
        if (html5QrCode && html5QrCode.isScanning) {
          if (html5QrCode.resume) html5QrCode.resume();
        }
      } catch(e){ console.warn("No se pudo reanudar:", e); }
      SUBMIT_LOCK = false;
    }, 600); // 0.6s para evitar rebotes por el mismo QR
  }
}

// ====== Render ======
function renderSummary(){
  const st = loadState();
  const k = todayKey();
  const h = (st.history && st.history[k]) || {};
  const nombre = $docente.value || st.name || "-";
  const rows = [
    `<div class="row header"><div>Fecha</div><div>Docente</div><div>Ingreso</div><div>Salida</div></div>`,
    `<div class="row"><div>${k}</div><div>${nombre}</div><div>${h.ingreso || "-"}</div><div>${h.salida || "-"}</div></div>`
  ];
  $summary.innerHTML = rows.join("");
}

// ====== Init ======
document.addEventListener("DOMContentLoaded", async () => {
  populateDocentes();

  const st = loadState();
  if (st.name) $docente.value = st.name;
  if (st.cameraId) currentCameraId = st.cameraId;

  try {
    await loadCameras();
  } catch(e) {
    console.error(e);
    const msg = insecureContextMsg() || "Error listando cámaras. Revisa permisos del navegador.";
    $result.textContent = `⚠️ ${msg}`;
  }

  renderSummary();
});
