/* ============================================================
   THE ICE · Planificador — RESPALDO de sincronización para
   dispositivos antiguos (iPads viejos, Safari sin módulos ES).

   Por qué existe: firebase-sync.js usa la librería moderna de
   Firebase (módulos ES + sintaxis nueva). En un iPad viejo eso
   ni siquiera llega a ejecutarse, la app queda en modo local y
   lo que se anota NO se guarda.

   Este archivo está escrito a propósito en JavaScript "viejo"
   (ES5, sin flechas, sin const/let, sin plantillas, con
   XMLHttpRequest en vez de fetch) para que corra en cualquier
   iPad. Habla directo con la API REST de Firestore.

   Se activa SOLO si a los 6 segundos la vía moderna no conectó.
   Sincroniza leyendo cada 15 segundos (no es tiempo real como
   la vía moderna, pero guarda de verdad, que es lo que importa).
   ============================================================ */
(function () {
  var API_KEY = "AIzaSyAZzo8LyKr-Htf49uunKY6GFn130Hefwhk";
  var PROJECT = "theiceproduction";
  var ESPERA_MS = 3500;
  var POLL_MS = 90000;  // antes 15s — leía las 9 colecciones enteras cada 15s
                        // y eso agota la cuota gratuita diaria de Firestore en
                        // pocas horas si el iPad queda abierto (01-sep-2026).

  var COLS = ["shifts", "inventory", "salidas", "metas",
              "ocBolsas", "retirosBolsas", "comprasMalla",
              "comprasGuantes", "conteosGuantes"];

  var token = null;
  var activo = false;

  function xhr(metodo, url, cuerpo, onOk, onErr) {
    var r = new XMLHttpRequest();
    r.open(metodo, url, true);
    r.setRequestHeader("Content-Type", "application/json");
    if (token) r.setRequestHeader("Authorization", "Bearer " + token);
    r.onreadystatechange = function () {
      if (r.readyState !== 4) return;
      if (r.status >= 200 && r.status < 300) {
        var d = null;
        try { d = r.responseText ? JSON.parse(r.responseText) : null; } catch (e) {}
        if (onOk) onOk(d);
      } else {
        if (onErr) onErr(r.status + " " + r.responseText);
      }
    };
    r.send(cuerpo ? JSON.stringify(cuerpo) : null);
  }

  /* ---- convertir del formato de Firestore a objetos normales ---- */
  function desdeFs(v) {
    if (!v) return null;
    if (v.stringValue !== undefined) return v.stringValue;
    if (v.booleanValue !== undefined) return v.booleanValue;
    if (v.integerValue !== undefined) return parseInt(v.integerValue, 10);
    if (v.doubleValue !== undefined) return v.doubleValue;
    if (v.nullValue !== undefined) return null;
    if (v.timestampValue !== undefined) return v.timestampValue;
    if (v.arrayValue !== undefined) {
      var arr = [], vals = v.arrayValue.values || [], i;
      for (i = 0; i < vals.length; i++) arr.push(desdeFs(vals[i]));
      return arr;
    }
    if (v.mapValue !== undefined) return camposDesdeFs(v.mapValue.fields || {});
    return null;
  }
  function camposDesdeFs(f) {
    var o = {}, k;
    for (k in f) { if (f.hasOwnProperty(k)) o[k] = desdeFs(f[k]); }
    return o;
  }

  /* ---- convertir de objetos normales al formato de Firestore ---- */
  function haciaFs(v) {
    if (v === null || v === undefined) return { nullValue: null };
    var t = typeof v;
    if (t === "boolean") return { booleanValue: v };
    if (t === "number") {
      if (v === Math.floor(v) && isFinite(v)) return { integerValue: String(v) };
      return { doubleValue: v };
    }
    if (t === "string") return { stringValue: v };
    if (Object.prototype.toString.call(v) === "[object Array]") {
      var vals = [], i;
      for (i = 0; i < v.length; i++) vals.push(haciaFs(v[i]));
      return { arrayValue: { values: vals } };
    }
    if (t === "object") {
      var f = {}, k;
      for (k in v) { if (v.hasOwnProperty(k)) f[k] = haciaFs(v[k]); }
      return { mapValue: { fields: f } };
    }
    return { stringValue: String(v) };
  }
  function camposHaciaFs(o) {
    var f = {}, k;
    for (k in o) { if (o.hasOwnProperty(k)) f[k] = haciaFs(o[k]); }
    return f;
  }

  function urlDoc(col, id) {
    return "https://firestore.googleapis.com/v1/projects/" + PROJECT +
           "/databases/(default)/documents/" + col + "/" + encodeURIComponent(id);
  }

  function leerColeccion(col, listo) {
    var acumulado = [];
    function pagina(tk) {
      var u = "https://firestore.googleapis.com/v1/projects/" + PROJECT +
              "/databases/(default)/documents/" + col + "?pageSize=300";
      if (tk) u += "&pageToken=" + encodeURIComponent(tk);
      xhr("GET", u, null, function (d) {
        var docs = (d && d.documents) || [], i;
        for (i = 0; i < docs.length; i++) acumulado.push(camposDesdeFs(docs[i].fields || {}));
        if (d && d.nextPageToken) pagina(d.nextPageToken);
        else listo(acumulado);
      }, function () { listo(acumulado); });
    }
    pagina(null);
  }

  function traerTodo() {
    var i;
    for (i = 0; i < COLS.length; i++) {
      (function (col) {
        leerColeccion(col, function (items) {
          if (window.tiApplyRemote) window.tiApplyRemote(col, items);
        });
      })(COLS[i]);
    }
    xhr("GET", urlDoc("config", "main"), null, function (d) {
      if (d && d.fields && window.tiApplyRemote) window.tiApplyRemote("config", camposDesdeFs(d.fields));
    });
    xhr("GET", urlDoc("meta", "generatedWeeks"), null, function (d) {
      if (d && d.fields && window.tiApplyRemote) {
        var w = camposDesdeFs(d.fields).weeks || [];
        window.tiApplyRemote("gen", w);
      }
    });
  }

  function montarTICloud() {
    window.TICloud = {
      ready: true,
      modo: "rest",
      idToken: token,
      user: { email: null, name: null, anonymous: true },
      set: function (kind, obj) {
        try {
          if (kind === "config") {
            xhr("PATCH", urlDoc("config", "main"), { fields: camposHaciaFs(obj) });
            return;
          }
          if (kind === "gen") {
            xhr("PATCH", urlDoc("meta", "generatedWeeks"), { fields: camposHaciaFs({ weeks: obj }) });
            return;
          }
          xhr("PATCH", urlDoc(kind, String(obj.id)), { fields: camposHaciaFs(obj) });
        } catch (e) {}
      },
      del: function (kind, id) {
        try { xhr("DELETE", urlDoc(kind, String(id)), null); } catch (e) {}
      },
      signOut: function () {}
    };
    try { window.TICloudError = null; } catch (e) {}
  }

  function arrancar() {
    if (activo) return;
    activo = true;
    xhr("POST",
      "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=" + API_KEY,
      { returnSecureToken: true },
      function (d) {
        if (!d || !d.idToken) {
          try { window.TICloudError = "No se pudo abrir sesión (modo compatible)"; } catch (e) {}
          return;
        }
        token = d.idToken;
        montarTICloud();
        traerTodo();
        try { if (window.tiApplyRemote) window.tiApplyRemote("gen", null); } catch (e) {}
        setInterval(traerTodo, POLL_MS);
        // el token dura 1 hora: renovarlo antes de que expire
        setInterval(function () {
          xhr("POST",
            "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=" + API_KEY,
            { returnSecureToken: true },
            function (d2) { if (d2 && d2.idToken) { token = d2.idToken; if (window.TICloud) window.TICloud.idToken = token; } });
        }, 45 * 60 * 1000);
      },
      function (err) {
        try { window.TICloudError = "Modo compatible: " + err; } catch (e) {}
        activo = false;                       // permite reintentar
        setTimeout(arrancar, 8000);           // por si la red del iPad tardó
      });
  }

  // Solo entra a la cancha si la vía moderna no logró conectar.
  setTimeout(function () {
    if (window.TICloud && window.TICloud.ready) return;
    arrancar();
  }, ESPERA_MS);
})();
