const PAGE = location.pathname.split("/").pop();

// ========= Utils =========
function qs(id) { return document.getElementById(id); }

const ENDPOINT = "https://yafmagrjygecwlutxkup.supabase.co/functions/v1/secret-santa";

async function callEdge(payload) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  // On essaye JSON, sinon texte
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); }
  catch { data = { raw: text }; }

  if (!res.ok) {
    const msg = data?.error || data?.message || text || `Erreur ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// ========= Animation parchemin (global) =========
function showPickedAnimated(receiver) {
  const hatEl = document.querySelector(".hat");
  const scrollEl = qs("scroll");
  const sparklesEl = document.querySelector(".sparkles");
  const whooshEl = qs("whooshSound");

  const pickedName = qs("pickedName");
  const pickedDesc = qs("pickedDesc");

  // fallback si la page n'a pas les éléments (ex: index sans parchemin)
  const name = receiver?.name || receiver;
  const desc = receiver?.desc || "";
  if (!pickedName || !scrollEl) {
    alert(`🎁 Tu offres à : ${name}${desc ? "\n" + desc : ""}`);
    return;
  }

  pickedName.textContent = name || "";
  pickedDesc.textContent = desc || "";

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

// ========= Pages =========
document.addEventListener("DOMContentLoaded", () => {
  const page = location.pathname.split("/").pop();

if (PAGE === "" || PAGE === "index.html") {
  const ENDPOINT = "https://yafmagrjygecwlutxkup.supabase.co/functions/v1/secret-santa";

  const giverInput = document.getElementById("giverName");
  const goBtn = document.getElementById("goBtn");

  goBtn.addEventListener("click", async () => {
  const giverName = giverInput.value.trim();
  if (!giverName) {
    alert("Entre ton prénom 🙂");
    return;
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ giverName })
    });

    const data = await res.json();

    if (!res.ok) {
      alert(`Erreur ${res.status}:\n${JSON.stringify(data)}`);
      return;
    }

    showPickedAnimated(data.receiver);

  } catch (e) {
    alert("Erreur réseau");
    console.error(e);
  }
});


// ⬇️ ⬇️ ⬇️ ICI EXACTEMENT ⬇️ ⬇️ ⬇️
function showPickedAnimated(receiver) {
  const scrollEl = document.getElementById("scroll");
  const pickedName = document.getElementById("pickedName");
  const pickedDesc = document.getElementById("pickedDesc");
  const whooshEl = document.getElementById("whooshSound");

  // ✅ Si la page n'a pas le parchemin → fallback
  if (!scrollEl || !pickedName) {
    alert(`🎁 Tu offres à : ${receiver.name}`);
    return;
  }

  pickedName.textContent = receiver.name;
  pickedDesc.textContent = receiver.desc || "";

  scrollEl.classList.add("show");

  if (whooshEl) {
    whooshEl.currentTime = 0;
    whooshEl.play().catch(() => {});
  }
}

}

// ========= Me (optionnel) =========
// ✅ Si tu gardes une page me.html (révélation) avec musique
function initMe() {
  const revealBtn = qs("revealBtn");
  const status = qs("status");

  const music = qs("bgMusic");
  const musicToggle = qs("musicToggle");

  // Toggle musique (si présent)
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

  // Si tu n'utilises plus me.html, rien à faire
  if (!revealBtn) return;

  // Exemple : révélation via un appel simple (à adapter si tu as un système de lien)
  revealBtn.addEventListener("click", async () => {
    try {
      status && (status.textContent = "La magie opère… ✨");
      const data = await callEdge({ action: "me" }); // à adapter si besoin

      if (data.receiver) {
        showPickedAnimated(data.receiver);
        status && (status.textContent = "✅ Révélé. Joyeux Secret Santa 🎁");
      } else {
        status && (status.textContent = "❌ Réponse inattendue");
      }
    } catch (e) {
      status && (status.textContent = `❌ ${e.message}`);
    }
  });
}
