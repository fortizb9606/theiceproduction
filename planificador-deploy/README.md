# Planificador de Producción · THE ICE

App de planificación de turnos con calendario, grupos, inventario, reportes y configuración.
Publicada en **Netlify**, con datos compartidos en **Firestore** (autosave + tiempo real) y **login con Google** restringido.

## Contenido del repo
- `index.html` — la app (todo en un archivo).
- `firebase-sync.js` — sincronización con Firestore + login Google. **Aquí pegas tu config.**
- `firestore.rules` — reglas de seguridad (quién puede leer/escribir).
- `netlify.toml` — config de publicación + carpeta de funciones (Fase 3: HubSpot).
- `.gitignore`.

> La app **funciona sin nube**: si no pegas la config de Firebase, usa el navegador (localStorage) igual que antes. La nube "se enciende" cuando completas los pasos de abajo.

---

## Puesta en marcha (una sola vez)

### 1) Firebase (base de datos + login)
1. Entra a <https://console.firebase.google.com> → **Agregar proyecto**.
2. En el proyecto: **Compilación → Firestore Database → Crear base de datos** (modo producción, región `southamerica-east1` o la más cercana).
3. **Compilación → Authentication → Empezar → Google → Habilitar** (elige un correo de soporte y guarda).
4. **⚙️ Configuración del proyecto → Tus apps → Web (`</>`)** → registra la app y copia el objeto `firebaseConfig`.
5. Pega esos valores en **`firebase-sync.js`** (arriba, `FIREBASE_CONFIG`) y agrega los correos del equipo en `ALLOWED_EMAILS`.
6. **Firestore → Reglas** → pega el contenido de `firestore.rules` (con los mismos correos) → **Publicar**.

### 2) GitHub
1. Crea un repo nuevo (privado) y sube estos archivos (arrastrar y soltar en github.com sirve).

### 3) Netlify
1. <https://app.netlify.com> → **Add new site → Import from GitHub** → elige el repo.
2. Build command: *(vacío)* · Publish directory: `.` → **Deploy**.
3. Cuando termine, en **Firebase → Authentication → Settings → Authorized domains**, agrega el dominio que te dio Netlify (ej: `tu-sitio.netlify.app`).
4. Abre la URL, inicia sesión con Google. Listo: lo que edites se guarda y se sincroniza en todos los dispositivos al instante.

---

## Cómo funciona la sincronización
- Cada turno, registro de inventario y la configuración se guardan **solos** en Firestore (un documento cada uno).
- Todos los dispositivos ven los cambios **en tiempo real**.
- Funciona **offline**: guarda local y sube al reconectar (útil en planta).
- La primera vez, si tenías datos en el navegador, se **migran** a la nube automáticamente.

## Seguridad
- La `firebaseConfig` **puede** ir en el código (no es secreta). Lo que protege los datos son el **login + las reglas**: solo los correos de `ALLOWED_EMAILS` / `firestore.rules` entran.
- **Nunca** pongas el token de HubSpot en el HTML. Va como variable de entorno en Netlify (Fase 3).

## Fase 3 · HubSpot → Salidas
Las **salidas** llegan desde HubSpot con una **Netlify Function** que guarda el token de forma segura. La app las lee y en **Reportes → Cruce de inventario** calcula **Producido − Salidas = teórico** y lo compara con el **conteo físico** para mostrar el **descuadre**.

**Pasos:**
1. En HubSpot: **Settings → Integrations → Private Apps → Create** con el scope `crm.objects.tickets.read`. Copia el **token**.
2. En Netlify: **Site settings → Environment variables → Add** →
   - `HUBSPOT_TOKEN` = el token del paso 1.
3. Edita el **MAPEO** al inicio de `netlify/functions/hubspot-salidas.js` con los **nombres internos** de tus propiedades de ticket (producto, mallas, kg, fecha) y —si aplica— el pipeline/etapa de "salida".
   > Los nombres de producto deben coincidir con los de la app (Original 3 kg, Mini 3 kg, Original 2 kg Retail, …). Si difieren, usa `PRODUCT_ALIAS`.
4. Haz push del repo → Netlify despliega la función en `/.netlify/functions/hubspot-salidas`.
5. En la app → **Salidas → Sincronizar con HubSpot**. Las salidas nuevas se escriben en Firestore y aparecen en Reportes.

> **Nota de seguridad (v1):** la función devuelve solo datos de salida (producto/kg/fecha) y mantiene el token oculto en el servidor. Para endurecerla, el siguiente paso es verificar el token de Firebase del usuario dentro de la función (queda pendiente).

## Empezar limpio
En **Configuración → Empezar limpio → Reiniciar datos** borra turnos, inventario y salidas (local y nube) y regenera desde la semana actual. Conserva personas, grupos fijos y stock de bolsas. La app **no** pide rellenar semanas pasadas: las anteriores simplemente quedan vacías.
