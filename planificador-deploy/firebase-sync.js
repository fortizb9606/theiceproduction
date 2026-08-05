/* ============================================================
   THE ICE · Planificador — sincronización Firestore (sesión anónima)
   ------------------------------------------------------------
   Autosave + tiempo real, sin pantalla de login — se conecta solo
   con una sesión anónima de Firebase (mismo esquema que ya usa
   la Torre de Control para escribir en sus Chiefs).
   Si NO pegas la config de Firebase abajo, la app sigue
   funcionando en modo LOCAL (localStorage), sin conexión.

   OJO — implicancia de seguridad de este cambio (léelo antes de
   subir esto): cualquiera que sepa la URL del sitio puede ver y
   editar los datos (turnos, nombres del equipo, asistencia, costo
   por persona) sin iniciar sesión — ya no hay restricción de
   correo. Esto es intencional (decisión tomada el 05-ago-2026 para
   que un proceso automático — el Chief de Producción en Cowork —
   pueda leer los datos todos los días sin credenciales especiales).
   Si en algún momento quieres volver a pedir login, avísale a
   quien te ayude con esto y se puede revertir.
   ============================================================ */

/* ==== PEGA AQUÍ TU CONFIG DE FIREBASE (Consola → Configuración del proyecto → Tus apps → Web) ==== */
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyAZzo8LyKr-Htf49uunKY6GFn130Hefwhk",
  authDomain:        "theiceproduction.firebaseapp.com",
  projectId:         "theiceproduction",
  storageBucket:     "theiceproduction.firebasestorage.app",
  messagingSenderId: "292261185111",
  appId:             "1:292261185111:web:d2b5041a23684087a40512"
};

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
  const { getAuth, signInAnonymously, onAuthStateChanged } = authMod;
  const { getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot, getDocs,
          initializeFirestore, persistentLocalCache, persistentMultipleTabManager } = fsMod;

  const app = initializeApp(FIREBASE_CONFIG);
  // Firestore con caché offline (funciona en planta con wifi malo)
  let db;
  try {
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch (e) { db = getFirestore(app); }
  const auth = getAuth(app);

  onAuthStateChanged(auth, user => {
    if (!user) {
      signInAnonymously(auth).catch(err => console.error("[TISync] login anónimo:", err));
      return;
    }
    startSync(user);
  });

  /* ---- sync en tiempo real ---- */
  const COLS = { shifts: "shifts", inventory: "inventory", salidas: "salidas", metas: "metas" };

  function startSync(user) {
    window.TICloud = {
      ready: true,
      idToken: null,
      user: { email: user.email || null, name: user.displayName || null, anonymous: true },
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
      signOut() { /* no aplica: sesión anónima, no hay a quién cerrarle sesión */ }
    };

    const apply = (kind, data) => { if (window.tiApplyRemote) window.tiApplyRemote(kind, data); };

    onSnapshot(collection(db, "shifts"),    s => apply("shifts",    s.docs.map(d => d.data())),  e => console.error("[TISync] shifts", e));
    onSnapshot(collection(db, "inventory"), s => apply("inventory", s.docs.map(d => d.data())),  e => console.error("[TISync] inventory", e));
    onSnapshot(collection(db, "salidas"),   s => apply("salidas",   s.docs.map(d => d.data())),  e => console.error("[TISync] salidas", e));
    onSnapshot(collection(db, "metas"),     s => apply("metas",     s.docs.map(d => d.data())),  e => console.error("[TISync] metas", e));
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
        const cfg = local("config"); if (cfg) window.TICloud.set("config", cfg);
        const gen = local("gen"); if (gen) window.TICloud.set("gen", gen);
        console.info("[TISync] Datos locales migrados a la nube.");
      } catch (e) { console.error("[TISync] migrate", e); }
    }
  }

  // Firestore no acepta undefined → limpiar
  function sane(o) { return JSON.parse(JSON.stringify(o)); }
}
