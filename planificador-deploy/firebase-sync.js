/* ============================================================
   THE ICE · Planificador — sincronización Firestore + Google Auth
   ------------------------------------------------------------
   Autosave + tiempo real + login con Google restringido al equipo.
   Si NO pegas la config de Firebase abajo, la app sigue
   funcionando en modo LOCAL (localStorage), sin login.

   Nota (05-ago-2026): el Chief de Producción de Cowork lee estos
   datos por su cuenta, con su propia sesión anónima directo por
   REST — no pasa por este archivo ni por esta pantalla de login.
   Este archivo sigue siendo solo para las personas del equipo.
   ============================================================ */

/* ==== 1) PEGA AQUÍ TU CONFIG DE FIREBASE (Consola → Configuración del proyecto → Tus apps → Web) ==== */
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyAZzo8LyKr-Htf49uunKY6GFn130Hefwhk",
  authDomain:        "theiceproduction.firebaseapp.com",
  projectId:         "theiceproduction",
  storageBucket:     "theiceproduction.firebasestorage.app",
  messagingSenderId: "292261185111",
  appId:             "1:292261185111:web:d2b5041a23684087a40512"
};

/* ==== 2) CORREOS CON ACCESO (los mismos que pongas en las reglas de Firestore) ==== */
const ALLOWED_EMAILS = [
  "felipe@theice.cl",
  "gustavo@theice.cl",
  "sebastian@theice.cl",
];

/* ============================================================
   De aquí para abajo no necesitas tocar nada.
   ============================================================ */

const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";

if (FIREBASE_CONFIG.apiKey) {
  boot().catch(err => { console.error("[TISync] error:", err); });
} else {
  console.info("[TISync] Sin config de Firebase → modo local (localStorage).");
}

async function boot() {
  const [appMod, authMod, fsMod] = await Promise.all([
    import(SDK + "firebase-app.js"),
    import(SDK + "firebase-auth.js"),
    import(SDK + "firebase-firestore.js"),
  ]);
  const { initializeApp } = appMod;
  const { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } = authMod;
  const { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot, getDocs,
          initializeFirestore, persistentLocalCache, persistentMultipleTabManager } = fsMod;

  const app = initializeApp(FIREBASE_CONFIG);
  // Firestore con caché offline (funciona en planta con wifi malo)
  let db;
  try {
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch (e) { db = getFirestore(app); }
  const auth = getAuth(app);

  const gate = makeGate();

  onAuthStateChanged(auth, user => {
    if (!user) { gate.show("signin"); return; }
    const email = (user.email || "").toLowerCase();
    if (ALLOWED_EMAILS.map(e => e.toLowerCase()).indexOf(email) < 0) {
      gate.show("denied", email);
      return;
    }
    gate.hide();
    startSync(user);
  });

  function doLogin() {
    const provider = new GoogleAuthProvider();
    signInWithPopup(auth, provider).catch(err => {
      console.error("[TISync] login:", err);
      gate.error(err && err.message ? err.message : "No se pudo iniciar sesión.");
    });
  }
  gate.onLogin(doLogin);
  gate.onLogout(() => signOut(auth));

  /* ---- sync en tiempo real ----
     ocBolsas/retirosBolsas/comprasMalla/comprasGuantes/conteosGuantes agregadas
     (19-ago-2026) — sistema de Compras (bolsas por OC, malla, guantes). */
  const COLS = { shifts: "shifts", inventory: "inventory", salidas: "salidas", metas: "metas",
                 ocBolsas: "ocBolsas", retirosBolsas: "retirosBolsas", comprasMalla: "comprasMalla",
                 comprasGuantes: "comprasGuantes", conteosGuantes: "conteosGuantes" };

  function startSync(user) {
    window.TICloud = {
      ready: true,
      idToken: null,
      user: { email: user.email, name: user.displayName },
      set(kind, obj) {
        try {
          if (kind === "config")      return setDoc(doc(db, "config", "main"), sane(obj));
          if (kind === "gen")         return setDoc(doc(db, "meta", "generatedWeeks"), { weeks: obj });
          if (!COLS[kind]) { console.error("[TISync] set: colección desconocida:", kind); return; }
          return setDoc(doc(db, COLS[kind], String(obj.id)), sane(obj));
        } catch (e) { console.error("[TISync] set", kind, e); }
      },
      del(kind, id) {
        try {
          if (!COLS[kind]) { console.error("[TISync] del: colección desconocida:", kind); return; }
          return deleteDoc(doc(db, COLS[kind], String(id)));
        } catch (e) { console.error("[TISync] del", e); }
      },
      async wipe(kinds) {
        for (const k of (kinds || [])) {
          if (k === "gen") { await setDoc(doc(db, "meta", "generatedWeeks"), { weeks: [] }); continue; }
          const col = COLS[k]; if (!col) continue;
          const snap = await getDocs(collection(db, col));
          await Promise.all(snap.docs.map(d => deleteDoc(doc(db, col, d.id))));
        }
      },
      signOut() { signOut(auth); }
    };
    // Token para autenticar la Netlify Function de HubSpot (se refresca solo)
    const refreshToken = () => user.getIdToken().then(t => { window.TICloud.idToken = t; }).catch(() => {});
    refreshToken(); setInterval(refreshToken, 30 * 60 * 1000);

    const apply = (kind, data) => { if (window.tiApplyRemote) window.tiApplyRemote(kind, data); };

    onSnapshot(collection(db, "shifts"),    s => apply("shifts",    s.docs.map(d => d.data())),  e => console.error("[TISync] shifts", e));
    onSnapshot(collection(db, "inventory"), s => apply("inventory", s.docs.map(d => d.data())),  e => console.error("[TISync] inventory", e));
    onSnapshot(collection(db, "salidas"),   s => apply("salidas",   s.docs.map(d => d.data())),  e => console.error("[TISync] salidas", e));
    onSnapshot(collection(db, "metas"),     s => apply("metas",     s.docs.map(d => d.data())),  e => console.error("[TISync] metas", e));
    onSnapshot(collection(db, "ocBolsas"),        s => apply("ocBolsas",        s.docs.map(d => d.data())),  e => console.error("[TISync] ocBolsas", e));
    onSnapshot(collection(db, "retirosBolsas"),   s => apply("retirosBolsas",   s.docs.map(d => d.data())),  e => console.error("[TISync] retirosBolsas", e));
    onSnapshot(collection(db, "comprasMalla"),    s => apply("comprasMalla",    s.docs.map(d => d.data())),  e => console.error("[TISync] comprasMalla", e));
    onSnapshot(collection(db, "comprasGuantes"),  s => apply("comprasGuantes",  s.docs.map(d => d.data())),  e => console.error("[TISync] comprasGuantes", e));
    onSnapshot(collection(db, "conteosGuantes"),  s => apply("conteosGuantes",  s.docs.map(d => d.data())),  e => console.error("[TISync] conteosGuantes", e));
    onSnapshot(doc(db, "config", "main"),   d => { if (d.exists()) apply("config", d.data()); });
    onSnapshot(doc(db, "meta", "generatedWeeks"), d => apply("gen", d.exists() ? (d.data().weeks || []) : []));

    migrateOnce();

    async function migrateOnce() {
      try {
        const snap = await getDocs(collection(db, "shifts"));
        if (!snap.empty) return; // la nube ya manda — no vuelve a migrar nunca más
        const local = window.tiLocalData || (() => null);
        const shifts = local("shifts") || [];
        if (!shifts.length) return; // nada local que subir todavía
        shifts.forEach(s => window.TICloud.set("shifts", s));
        (local("inventory") || []).forEach(e => window.TICloud.set("inventory", e));
        (local("metas") || []).forEach(e => window.TICloud.set("metas", e));
        (local("ocBolsas") || []).forEach(e => window.TICloud.set("ocBolsas", e));
        (local("retirosBolsas") || []).forEach(e => window.TICloud.set("retirosBolsas", e));
        (local("comprasMalla") || []).forEach(e => window.TICloud.set("comprasMalla", e));
        (local("comprasGuantes") || []).forEach(e => window.TICloud.set("comprasGuantes", e));
        (local("conteosGuantes") || []).forEach(e => window.TICloud.set("conteosGuantes", e));
        const cfg = local("config"); if (cfg) window.TICloud.set("config", cfg);
        const gen = local("gen"); if (gen) window.TICloud.set("gen", gen);
        console.info("[TISync] Datos locales migrados a la nube.");
      } catch (e) { console.error("[TISync] migrate", e); }
    }
  }

  // Firestore no acepta undefined → limpiar
  function sane(o) { return JSON.parse(JSON.stringify(o)); }
}

/* ---- overlay de login (se autoinyecta) ---- */
function makeGate() {
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;background:linear-gradient(180deg,#0C1A1F,#081215);color:#E2ECEF;font-family:'Space Grotesk',system-ui,sans-serif";
  el.innerHTML =
    '<div style="text-align:center;max-width:360px;padding:32px">' +
      '<div style="width:56px;height:56px;border-radius:16px;background:#0E8FD6;display:grid;place-items:center;margin:0 auto 18px;box-shadow:0 10px 30px rgba(14,143,214,.4)"><div style="width:24px;height:24px;border-radius:50%;border:3px solid #fff;display:grid;place-items:center"><div style="width:8px;height:8px;border-radius:50%;background:#fff"></div></div></div>' +
      '<div style="font:700 10px/1 \'Space Grotesk\';letter-spacing:.26em;color:#8299A0">THE ICE</div>' +
      '<div style="font:700 22px \'Space Grotesk\';margin-top:6px;color:#fff">Planificador de Producción</div>' +
      '<p data-msg style="font:500 13px/1.6 \'Space Grotesk\';color:#8299A0;margin:12px 0 20px">Inicia sesión para continuar.</p>' +
      '<button data-login style="display:inline-flex;align-items:center;justify-content:center;gap:9px;height:46px;padding:0 20px;border-radius:12px;border:0;background:#fff;color:#14202B;font:600 14px \'Space Grotesk\';cursor:pointer;width:100%"><svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.9 2.4 30.4 0 24 0 14.6 0 6.4 5.4 2.6 13.2l7.8 6.1C12.2 13.6 17.6 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9.1h12.4c-.5 2.9-2.1 5.3-4.6 7l7.1 5.5c4.2-3.9 6.6-9.6 6.6-16z"/><path fill="#FBBC05" d="M10.4 28.3c-.5-1.4-.8-2.9-.8-4.3s.3-3 .8-4.3l-7.8-6.1C1 16.7 0 20.2 0 24s1 7.3 2.6 10.4l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.4 0 11.9-2.1 15.9-5.8l-7.1-5.5c-2 1.3-4.6 2.1-8.8 2.1-6.4 0-11.8-4.1-13.6-9.8l-7.8 6.1C6.4 42.6 14.6 48 24 48z"/></svg>Iniciar sesión con Google</button>' +
      '<button data-logout style="display:none;margin-top:12px;height:40px;padding:0 16px;border-radius:11px;border:1px solid rgba(255,255,255,.15);background:transparent;color:#8299A0;font:600 13px \'Space Grotesk\';cursor:pointer;width:100%">Cambiar de cuenta</button>' +
    '</div>';
  document.addEventListener("DOMContentLoaded", () => document.body.appendChild(el));
  if (document.body) document.body.appendChild(el);
  const msg = () => el.querySelector("[data-msg]");
  const loginBtn = () => el.querySelector("[data-login]");
  const logoutBtn = () => el.querySelector("[data-logout]");
  return {
    show(mode, email) {
      el.style.display = "flex";
      if (mode === "denied") {
        msg().textContent = "La cuenta " + (email || "") + " no tiene acceso. Pide que te agreguen o entra con otra cuenta.";
        loginBtn().style.display = "none"; logoutBtn().style.display = "inline-flex";
      } else {
        msg().textContent = "Inicia sesión para continuar.";
        loginBtn().style.display = "inline-flex"; logoutBtn().style.display = "none";
      }
    },
    hide() { el.style.display = "none"; },
    error(t) { if (msg()) msg().textContent = t; },
    onLogin(fn) { el.addEventListener("click", e => { if (e.target.closest("[data-login]")) fn(); }); },
    onLogout(fn) { el.addEventListener("click", e => { if (e.target.closest("[data-logout]")) fn(); }); }
  };
}
