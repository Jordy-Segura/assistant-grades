// Utilidades de UI — funciones reutilizables para toast, modales, confetti
// Compatible con la nomenclatura actual de legacyRuntime.js

export function showToast(msg, type = "success") {
  const toastEl = document.getElementById("toast");
  const text = document.getElementById("toast-text");
  if (!toastEl || !text) return;
  text.textContent = msg;
  toastEl.style.background =
    type === "error" ? "var(--espoch-red)" : "var(--espoch-green)";
  toastEl.classList.add("show");
  setTimeout(function () {
    toastEl.classList.remove("show");
  }, 2800);
}

export function closeModal(e) {
  if (e && e.target !== document.getElementById("modal-overlay")) return;
  const overlay = document.getElementById("modal-overlay");
  if (overlay) overlay.classList.remove("open");
}

export function showSuccessModal() {
  launchConfetti();

  const el = document.getElementById("success-modal-content");
  if (!el) return;

  // Leer state global (compatible con window.STATE)
  const state = window.STATE || {};
  const totalActs = (state.activities || []).length;
  const asig = (state.courseConfig && state.courseConfig.asignatura) || "la asignatura";

  el.innerHTML =
    '<div class="success-checkmark"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
    '<div class="success-title">¡Configuración Guardada!</div>' +
    '<div class="success-text">Se han registrado <strong>' +
    totalActs +
    ' actividades</strong> de evaluación para <strong>' +
    asig +
    '</strong>.<br><br>Los componentes ACD (3.5 pts), APEX (3.5 pts) y AAUT (3.0 pts) están configurados correctamente.</div>' +
    '<div style="margin-top:20px"><button class="btn btn-success" onclick="onConfigConfirmContinue()" style="margin:0 auto">Confirmar y Gestionar</button></div>';

  document.getElementById("success-modal-overlay").classList.add("open");
}

export function closeSuccessModal(e) {
  if (e && e.target !== document.getElementById("success-modal-overlay")) return;
  const overlay = document.getElementById("success-modal-overlay");
  if (overlay) overlay.classList.remove("open");
}

export function launchConfetti() {
  const canvas = document.getElementById("confetti-canvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  canvas.style.display = "block";
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const particles = [];
  const colors = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#7c3aed", "#003366"];

  for (let i = 0; i < 150; i++) {
    particles.push({
      x: canvas.width / 2,
      y: canvas.height / 2,
      vx: (Math.random() - 0.5) * 16,
      vy: (Math.random() - 0.5) * 16 - 5,
      w: Math.random() * 8 + 3,
      h: Math.random() * 6 + 2,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      rotSpeed: (Math.random() - 0.5) * 10,
      gravity: 0.15,
      opacity: 1,
    });
  }

  let frame = 0;
  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    particles.forEach(function (p) {
      p.x += p.vx;
      p.vy += p.gravity;
      p.y += p.vy;
      p.rotation += p.rotSpeed;
      p.vx *= 0.99;
      if (frame > 60) p.opacity -= 0.01;
      if (p.opacity <= 0) return;
      alive = true;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.globalAlpha = Math.max(0, p.opacity);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    frame++;
    if (alive && frame < 200) requestAnimationFrame(animate);
    else canvas.style.display = "none";
  }
  animate();
}

export function openModal(title, bodyHtml, actions) {
  const modalEl = document.querySelector("#modal-overlay .modal");
  if (modalEl) modalEl.style.maxWidth = "";

  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").innerHTML = bodyHtml;
  document.getElementById("modal-actions").innerHTML = actions
    .map(function (a, i) {
      return '<button class="btn ' + a.cls + '" onclick="_modalAction(' + i + ')">' + a.label + "</button>";
    })
    .join("");
  window._modalActions = actions;
  document.getElementById("modal-overlay").classList.add("open");
}

// Exponer _modalAction en window para los onclick
window._modalAction = function (i) {
  const a = window._modalActions[i];
  if (typeof a.action === "function") a.action();
  else if (a.action === "close") closeModal();
};

// Exponer en window para compatibilidad con legacyRuntime.js
window.showToast = showToast;
window.closeModal = closeModal;
window.showSuccessModal = showSuccessModal;
window.closeSuccessModal = closeSuccessModal;
window.launchConfetti = launchConfetti;
window.openModal = openModal;
