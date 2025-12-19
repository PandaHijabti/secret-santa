// ============================
// Secret Santa - Front (GitHub Pages) -> Supabase Edge Function
// Pages: admin.html / me.html / index.html
// ============================

const ENDPOINT =
  "https://yafmagrjygecwlutxkup.supabase.co/functions/v1/secret-santa";


const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhZm1hZ3JqeWdlY3dsdXR4a3VwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwMzYxMTQsImV4cCI6MjA4MTYxMjExNH0.CTEbnH3AMUdxhTl_xPT7nQ4_uf1THT037rl7oz3jAFM";

function qs(id) { return document.getElementById(id); }

function getParams() {
  const u = new URL(location.href);
  return {
    room: (u.searchParams.get("room") || "").toUpperCase(),
    admin: u.searchParams.get("admin") || "",
    key: u.searchParams.get("key") || ""
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[m]));
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

async function api(path, opts = {}) {
  const url = `${ENDPOINT}${path}`;

  const headers = {
    "apikey": SUPABASE_ANON_KEY,
    ...(opts.headers || {})
  };

  // si aucune Authorization explicite → anon
  if (!headers.Authorization && !headers.authorization) {
    headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
  }

  const res = await fetch(url, {
    method: opts.method || "GET",
    headers,
    body: opts.body
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok) {
    throw new Error(data?.error || data?.message || text || `HTTP ${res.status}`);
  }
  return data;
}


// ============================
// Animation parchemin (global)
// ============================
function showPickedAnimated(receiver) {
  const hatEl = document.querySelector(".hat");
  const scrollEl = qs("scroll");
  const sparklesEl = document.querySelector(".sparkles");
  const whooshEl = qs("whooshSound");

  const pickedName = qs("pickedName");
  const pickedDesc = qs("pickedDesc");

  const name = receiver?.name || "";
  const desc = receiver?.desc || receiver?.description || "";

  // fallback si on est sur une page sans parchemin
  if (!pickedName || !scrollEl) {
    alert(`🎁 Tu offres à : ${name}${desc ? "\n" + desc : ""}`);
    return;
  }

  pickedName.textContent = name;
  pickedDesc.textContent = desc;

  hatEl?.classList.remove("spitting");
  scrollEl?.classList.remove("show");
  sparklesEl?.classList.remove("burst");

  void hatEl?.offsetWidth;

  hatEl?.classList.add("spitting");
  sparklesEl?.classList.add("burst");
  setTimeout(() => sparklesEl?.classList.remove("burst"), 750);

  if (whooshEl) {
    whooshEl.currentTime = 0;
    whooshEl.play().catch(() => {});
  }

  setTimeout(() => {
    scrollEl?.classList.add("show");
  }, 520);
}

// ============================
// Admin page
// ============================
function initAdmin() {
  const params = getParams();

  const roomCode = qs("roomCode");
  const adminKey = qs("adminKey");
  const status = qs("roomStatus");
  const linksBox = qs("links");

  if (!roomCode || !adminKey || !status || !linksBox) return;

  // preload from url or localStorage
  roomCode.value = params.room || localStorage.getItem("ss_room") || "SS-24JAN";
  adminKey.value = params.admin || localStorage.getItem("ss_admin") || "";

  qs("createRoom")?.addEventListener("click", async () => {
    const code = (roomCode.value || "").trim().toUpperCase();
    if (!code) return alert("Mets un room code 🙂");

    // si adminKey déjà renseignée -> juste refresh
    if (adminKey.value.trim()) {
      localStorage.setItem("ss_room", code);
      localStorage.setItem("ss_admin", adminKey.value.trim());
      status.textContent = `Room ${code} chargée.`;
      return refresh();
    }

    try {
      const created = await api("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code })
      });

      adminKey.value = created.adminKey;
      localStorage.setItem("ss_room", created.code);
      localStorage.setItem("ss_admin", created.adminKey);
      status.textContent = `✅ Room créée: ${created.code} (adminKey sauvegardée ici).`;

      await refresh();
    } catch (e) {
      status.textContent = `⚠️ Room existe déjà. Renseigne l’adminKey puis “Rafraîchir”.`;
    }
  });

  qs("importBtn")?.addEventListener("click", async () => {
    const code = (roomCode.value || "").trim().toUpperCase();
    const admin = (adminKey.value || "").trim();
    if (!code || !admin) return alert("Room + adminKey obligatoires 🙂");

    const raw = (qs("importBox")?.value || "").trim();
    if (!raw) return alert("Colle ta liste 🙂");

    const lines = raw.split("\n")
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => {
        const parts = l.split(" - ");
        if (parts.length < 2) return null;
        return { name: parts[0].trim(), desc: parts.slice(1).join(" - ").trim() };
      })
      .filter(Boolean);

    if (!lines.length) return alert("Format attendu: Prénom - description");

    try {
      const data = await api(`/api/rooms/${encodeURIComponent(code)}/import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${admin}`
        },
        body: JSON.stringify({ lines })
      });

      status.textContent = `✅ Import: ${data.createdCount} ajoutés.`;
      await refresh();
    } catch (e) {
      status.textContent = `❌ ${e.message}`;
    }
  });

  qs("refreshBtn")?.addEventListener("click", refresh);

  qs("drawBtn")?.addEventListener("click", async () => {
    const code = (roomCode.value || "").trim().toUpperCase();
    const admin = (adminKey.value || "").trim();
    if (!code || !admin) return alert("Room + adminKey obligatoires 🙂");

    if (!confirm("Lancer le tirage ? Après ça, c’est figé 🔒")) return;

    try {
      const data = await api(`/api/rooms/${encodeURIComponent(code)}/draw`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${admin}` }
      });

      status.textContent = `🎁 Tirage: ${data.status} (${data.count || ""})`;
      await refresh();
    } catch (e) {
      status.textContent = `❌ ${e.message}`;
    }
  });

  async function refresh() {
    const code = (roomCode.value || "").trim().toUpperCase();
    const admin = (adminKey.value || "").trim();
    if (!code || !admin) return;

    try {
      const data = await api(`/api/rooms/${encodeURIComponent(code)}/links`, {
        headers: { "Authorization": `Bearer ${admin}` }
      });

      status.textContent = `Room ${data.room} — status: ${data.status}`;

      linksBox.innerHTML = (data.participants || []).map(p => {
        // ✅ crucial pour GitHub Pages (/secret-santa/)
        const full = new URL(p.link, location.href).href;

        const hint = p.desc || p.description || "";

        return `
          <div class="linkCard">
            <div class="linkTop">
              <div class="linkName">${escapeHtml(p.name)}</div>
              <button class="copyBtn" data-copy="${escapeAttr(full)}">Copier lien</button>
            </div>
            <div class="linkUrl">${escapeHtml(full)}</div>
            <div class="hint">${escapeHtml(hint)}</div>
          </div>
        `;
      }).join("");

      linksBox.querySelectorAll(".copyBtn").forEach(btn => {
        btn.addEventListener("click", async () => {
          const text = btn.getAttribute("data-copy");
          try {
            await navigator.clipboard.writeText(text);
            btn.textContent = "✅ Copié";
          } catch {
            alert("Copie manuelle:\n" + text);
          }
          setTimeout(() => btn.textContent = "Copier lien", 900);
        });
      });

    } catch (e) {
      status.textContent = `❌ ${e.message}`;
    }
  }
}

// ============================
// Me page (révélation + musique)
// ============================
function initMe() {
  const { room, key } = getParams();

  const status = qs("status");
  const revealBtn = qs("revealBtn");

  // Musique (optionnel)
  const music = qs("bgMusic");
  const musicToggle = qs("musicToggle");

  if (music && musicToggle) {
    music.volume = 0.25;

    musicToggle.addEventListener("click", async () => {
      if (music.paused) {
        try {
          await music.play();
          musicToggle.textContent = "⏸️ Couper la musique";
        } catch {
          alert("Le navigateur bloque la lecture auto. Re-clique si besoin 🙂");
        }
      } else {
        music.pause();
        musicToggle.textContent = "🎶 Lancer la musique";
      }
    });
  }

  if (!status || !revealBtn) return;

  if (!room || !key) {
    status.textContent = "❌ Lien invalide (room/key manquant). Demande un nouveau lien à l’admin.";
    revealBtn.disabled = true;
    return;
  }

  status.textContent = `Room: ${room}. En attente du tirage…`;

  revealBtn.addEventListener("click", async () => {
    revealBtn.disabled = true;
    status.textContent = "La magie opère… ✨";

    // démarre musique au clic (plus fiable mobile)
    if (music && music.paused) {
      try { await music.play(); } catch {}
    }

    try {
      const data = await api(`/api/rooms/${encodeURIComponent(room)}/me`, {
        method: "GET",
        headers: { "Authorization": `Bearer ${key}` }
      });

      if (data.status !== "DRAWN") {
        status.textContent = "⏳ Le tirage n’a pas encore été lancé. Reviens plus tard 🙂";
        revealBtn.disabled = false;
        return;
      }

      showPickedAnimated({ name: data.receiverName, desc: data.receiverDesc });
      status.textContent = "✅ Révélé. Joyeux Secret Santa 🎁";
    } catch (e) {
      status.textContent = `❌ ${e.message}`;
      revealBtn.disabled = false;
    }
  });
}

// ============================
// Boot
// ============================
document.addEventListener("DOMContentLoaded", () => {
  const page = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  if (page === "admin.html") initAdmin();
  if (page === "me.html") initMe();
});
