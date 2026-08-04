/* ============================================================
   Netlify Function · HubSpot → Salidas
   ------------------------------------------------------------
   Lee tickets de "salida" desde HubSpot y los devuelve como JSON
   normalizado para el Planificador. El token vive SOLO aquí
   (variable de entorno en Netlify), nunca en el navegador.

   Variables de entorno en Netlify (Site settings → Environment):
     HUBSPOT_TOKEN   = token del Private App (scope crm.objects.tickets.read)

   Ajusta el MAPEO abajo con los nombres reales de tus propiedades.
   ============================================================ */

/* ==== MAPEO — cambia estos por los nombres internos de tus propiedades en HubSpot ==== */
const MAP = {
  // Propiedad del ticket que trae el NOMBRE del producto (debe coincidir con los productos de la app)
  product: "producto",          // <-- ej: "producto" o "line_item_product"
  // Cantidades (usa la que tengas; si solo tienes mallas, la app calcula los kilos)
  mesh:    "mallas",            // <-- ej: "mallas" / "cantidad_mallas"
  kg:      "kilos",             // <-- ej: "kilos" / "peso_kg"
  // Fecha de la salida
  date:    "fecha_salida",      // <-- ej: "fecha_salida" (fecha) o usa "hs_createdate"
  note:    "hs_ticket_subject"  // opcional
};

/* Filtro opcional: solo tickets de un pipeline/etapa de "salida". Deja "" para traer todos. */
const FILTER_PIPELINE = "";     // <-- id del pipeline de salidas (opcional)
const FILTER_STAGE    = "";     // <-- id de la etapa (opcional)

/* Mapeo de nombres de producto de HubSpot → nombres de la app (si difieren). Opcional. */
const PRODUCT_ALIAS = {
  // "Orig 3kg": "Original 3 kg",
};

const HS = "https://api.hubapi.com";

exports.handler = async function (event) {
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Falta HUBSPOT_TOKEN en Netlify." }) };
  }
  try {
    const props = [MAP.product, MAP.mesh, MAP.kg, MAP.date, MAP.note].filter(Boolean);
    const filterGroups = [];
    if (FILTER_PIPELINE) filterGroups.push({ filters: [{ propertyName: "hs_pipeline", operator: "EQ", value: FILTER_PIPELINE }] });
    if (FILTER_STAGE)    filterGroups.push({ filters: [{ propertyName: "hs_pipeline_stage", operator: "EQ", value: FILTER_STAGE }] });

    const results = [];
    let after = undefined;
    for (let page = 0; page < 20; page++) { // hasta ~2000 tickets
      const body = {
        limit: 100,
        properties: props,
        sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }],
        ...(filterGroups.length ? { filterGroups } : {}),
        ...(after ? { after } : {})
      };
      const r = await fetch(`${HS}/crm/v3/objects/tickets/search`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!r.ok) {
        const txt = await r.text();
        return { statusCode: 502, headers, body: JSON.stringify({ error: "HubSpot " + r.status, detail: txt.slice(0, 500) }) };
      }
      const data = await r.json();
      (data.results || []).forEach(t => {
        const p = t.properties || {};
        const rawProduct = (p[MAP.product] || "").trim();
        if (!rawProduct) return;
        const product = PRODUCT_ALIAS[rawProduct] || rawProduct;
        const mesh = num(p[MAP.mesh]);
        const kg   = num(p[MAP.kg]);
        results.push({
          hubspotId: String(t.id),
          date: isoDate(p[MAP.date] || t.createdAt),
          product,
          mesh: mesh,
          kg: kg,
          note: (p[MAP.note] || "").toString().slice(0, 140)
        });
      });
      after = data.paging && data.paging.next && data.paging.next.after;
      if (!after) break;
    }
    return { statusCode: 200, headers, body: JSON.stringify(results) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};

function num(v) { if (v == null || v === "") return null; const n = Number(String(v).replace(/[^\d.-]/g, "")); return isNaN(n) ? null : n; }
function isoDate(v) {
  if (!v) return new Date().toISOString().slice(0, 10);
  // HubSpot puede entregar epoch ms o ISO
  const d = /^\d+$/.test(String(v)) ? new Date(Number(v)) : new Date(v);
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}
