// Edge Function: alerta-lineas-manuales
// Correo diario (lun–sáb 8:00 am HN, cron 'alerta-lineas-manuales-diaria') a ventas@focusstore.net con las
// líneas de venta escritas A MANO (sin producto del catálogo) que siguen sin resolver en "Despacho del día".
// Motivo (2026-11-13): una venta del 22-sep ("3 Luces NANLITE FS-300C") se escribió a mano, nunca se
// descontó y la web siguió mostrando 3 unidades que no existían.
//   · Sección 1 (rojo): la línea se PARECE a un producto del catálogo → probablemente hay que vincularla y
//     descontarla del inventario.
//   · Sección 2: el resto (pedidos, servicios) → marcarlas "Sin inventario" en el Despacho para cerrarlas.
// Una línea queda resuelta cuando se vincula a un producto (producto_id) o se marca "Sin inventario"
// (despacho_registros.sin_inv) en la fecha de la venta. Las ventas traídas de Precio Inteligente se ignoran.
// El catálogo se lee por la API externa (solo lectura), igual que productos-externos.
// Parámetros: ?dry=1 devuelve el resultado y el HTML sin enviar · ?dias=N cambia la ventana (def. 60).
// Envío por Resend: secret RESEND_API_KEY de este proyecto.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const DESTINO = 'ventas@focusstore.net';
const FROM    = 'Sistema de Ventas Focus <ventas@focusstore.net>';
const APP_URL = 'https://eventas90.github.io/ventas-eventas90/';

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

// ── Parecido con el catálogo (misma lógica que la advertencia de la app) ──
const STOP = new Set(['de','del','la','el','los','las','para','con','sin','y','en','por','un','una','x',
  'luz','luces','kit','set','unidad','unidades','und','ud','uds','pcs','pack','nuevo','nueva','usado','usada']);
// Pedidos, reparaciones y abonos no salen de bodega: nunca se comparan con el catálogo
const NO_BODEGA = /\b(pedido|reparacion\w*|repacion|mantenimiento|servicio|anticipo|abono|restante|saldo)\b/;
const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/(\d)[.,](\d)/g, '$1$2');                     // 9.8" → 98, f/1.4 → f14
const tokens = (s: string) => norm(s).split(/[^a-z0-9]+/).filter(t => t.length >= 2 && !STOP.has(t));
const compacto = (s: string) => norm(s).replace(/[^a-z0-9]/g, '');

function parecido(texto: string, nombreProd: string): number {
  if (NO_BODEGA.test(norm(texto))) return 0;
  const tk = [...new Set(tokens(texto))];
  if (tk.length < 2) return 0;
  const comp = compacto(nombreProd);
  const ptk  = new Set(tokens(nombreProd));
  const esta = (t: string) => ptk.has(t) || (t.length >= 4 && comp.includes(t));
  // Modelos y medidas (todo token con números): si la línea trae uno, el producto debe tenerlo
  const modelos = tk.filter(t => /\d/.test(t));
  for (const m of modelos) if (!ptk.has(m) && !comp.includes(m)) return 0;
  const hits  = tk.filter(t => esta(t) || (/\d/.test(t) && comp.includes(t))).length;
  const ratio = hits / tk.length;
  if (modelos.length) return ratio >= 0.75 ? ratio + 0.5 : 0;
  return (ratio >= 0.8 && hits >= 3) ? ratio : 0;
}

function mejorCoincidencia(texto: string, sku: string, catalogo: any[]) {
  const s = String(sku || '').trim().toLowerCase();
  if (s) {
    const porSku = catalogo.find(p => String(p.sku || '').trim().toLowerCase() === s);
    if (porSku) return porSku;
  }
  let mejor: any = null, mejorPts = 0;
  for (const p of catalogo) {
    const pts = parecido(texto, p.producto);
    if (!pts) continue;
    const desempate = (Number(p.cantidad) || 0) > 0 ? 0.01 : 0;
    if (pts + desempate > mejorPts) { mejor = p; mejorPts = pts + desempate; }
  }
  return mejor;
}

async function cargarCatalogo(): Promise<any[]> {
  const url  = (Deno.env.get('API_EXTERNA_URL') ?? '').replace(/\/$/, '');
  const tok  = Deno.env.get('API_EXTERNA_TOKEN') ?? '';
  const anon = Deno.env.get('API_EXTERNA_ANON') ?? '';
  const out: any[] = [];
  for (let offset = 0; offset < 20000; offset += 1000) {
    const r = await fetch(`${url}/productos?limit=1000&offset=${offset}`, {
      headers: { 'x-api-key': tok, 'Authorization': `Bearer ${anon}` },
    });
    if (!r.ok) throw new Error(`API catálogo ${r.status}`);
    const j = await r.json();
    const filas = j.datos || [];
    out.push(...filas);
    if (filas.length < 1000) break;
  }
  return out;
}

const esc  = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtF = (f: string) => { const [y, m, d] = String(f).split('-'); return `${d}/${m}/${y}`; };

Deno.serve(async (req) => {
  try {
    const u    = new URL(req.url);
    const dry  = u.searchParams.get('dry') === '1';
    const dias = Math.min(Math.max(parseInt(u.searchParams.get('dias') || '60') || 60, 1), 365);

    const hoyHN = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
    const desde = new Date(Date.parse(hoyHN) - dias * 86400e3).toISOString().slice(0, 10);

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: ventas, error: e1 } = await sb.from('ventas')
      .select('id, fecha, cliente_nombre, vendedor_nombre, observaciones')
      .gte('fecha', desde).lte('fecha', hoyHN);
    if (e1) throw new Error('ventas: ' + e1.message);
    const vMap = new Map((ventas || [])
      .filter(v => !/\[PI vta_[0-9]+\]/.test(v.observaciones || ''))   // traídas de Precio Inteligente
      .map(v => [v.id, v]));

    const ids = [...vMap.keys()];
    const items: any[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await sb.from('venta_items')
        .select('venta_id, sku, nombre, cantidad, producto_id').in('venta_id', ids.slice(i, i + 200));
      if (error) throw new Error('venta_items: ' + error.message);
      items.push(...(data || []));
    }

    const { data: regs, error: e3 } = await sb.from('despacho_registros')
      .select('fecha, producto_key').eq('sin_inv', true).gte('fecha', desde);
    if (e3) throw new Error('despacho_registros: ' + e3.message);
    const sinInv = new Set((regs || []).map(r => `${r.fecha}|${r.producto_key}`));

    const manuales = items.filter(it => {
      if (it.producto_id) return false;
      const nombre = String(it.nombre || '');
      if (/^\s*env[ií]o\b/i.test(nombre)) return false;               // cargo de envío
      const v = vMap.get(it.venta_id);
      const key = 'm:' + String(it.sku || nombre || '?').trim().toLowerCase();   // misma clave que el Despacho
      return !sinInv.has(`${v.fecha}|${key}`);
    });

    const catalogo = manuales.length ? await cargarCatalogo() : [];
    const filas = manuales.map(it => {
      const v = vMap.get(it.venta_id);
      const p = mejorCoincidencia(it.nombre, it.sku, catalogo);
      return {
        fecha: v.fecha, cliente: v.cliente_nombre || '', vendedor: v.vendedor_nombre || '',
        linea: it.nombre || it.sku || '(sin nombre)', cantidad: Number(it.cantidad) || 1,
        sugerido: p ? { producto: p.producto, sku: p.sku || '', stock: Number(p.cantidad) || 0 } : null,
      };
    }).sort((a, b) => b.fecha.localeCompare(a.fecha));

    const rojas = filas.filter(f => f.sugerido);
    const otras = filas.filter(f => !f.sugerido);

    const th = 'padding:8px 10px;text-align:left;font-size:12px;color:#5a6478;border-bottom:2px solid #e3e7ef';
    const td = 'padding:8px 10px;font-size:13px;color:#1a1f2e;border-bottom:1px solid #eef1f6;vertical-align:top';
    const tablaRojas = rojas.map(f => `<tr>
        <td style="${td};white-space:nowrap">${fmtF(f.fecha)}</td>
        <td style="${td}"><b>${esc(f.linea)}</b><br><span style="color:#5a6478;font-size:12px">${esc(f.cliente)} · ${esc(f.vendedor)} · ${f.cantidad} ud</span></td>
        <td style="${td}">${esc(f.sugerido!.producto)}<br><span style="color:#5a6478;font-size:12px">SKU ${esc(f.sugerido!.sku || '—')} · stock en sistema: <b style="color:${f.sugerido!.stock > 0 ? '#c0392b' : '#1a1f2e'}">${f.sugerido!.stock}</b></span></td>
      </tr>`).join('');
    const tablaOtras = otras.map(f => `<tr>
        <td style="${td};white-space:nowrap">${fmtF(f.fecha)}</td>
        <td style="${td}">${esc(f.linea)}</td>
        <td style="${td}">${esc(f.cliente)} · ${esc(f.vendedor)} · ${f.cantidad} ud</td>
      </tr>`).join('');

    const html = `<div style="font-family:Arial,sans-serif;max-width:760px;margin:0 auto;background:#fff">
      <div style="background:#00275E;padding:20px 24px"><div style="color:#FFC100;font-size:13px;font-weight:700;letter-spacing:.5px">FOCUS STORE · SISTEMA DE VENTAS</div>
        <div style="color:#fff;font-size:20px;font-weight:700;margin-top:4px">Productos escritos a mano sin resolver</div>
        <div style="color:#c9d3e6;font-size:13px;margin-top:4px">Ventas del ${fmtF(desde)} al ${fmtF(hoyHN)}</div></div>
      <div style="padding:20px 24px">
      ${rojas.length ? `
        <div style="background:#fdecea;border-left:4px solid #c0392b;padding:12px 14px;border-radius:4px;margin-bottom:12px">
          <b style="color:#c0392b">🔴 ${rojas.length} línea(s) parecen productos del catálogo</b>
          <div style="font-size:13px;color:#1a1f2e;margin-top:4px">Se vendieron escritas a mano, así que <b>no se descontaron del inventario</b> y la web puede seguir mostrando stock que no existe.
          Ábrelas en <b>Despacho del día</b> (con la fecha de la venta) → sección Manuales → <b>Vincular</b> con el producto → <b>Descontar + Wix</b>.</div></div>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px"><tr><th style="${th}">Fecha</th><th style="${th}">Escrito en la venta</th><th style="${th}">Producto del catálogo que parece</th></tr>${tablaRojas}</table>` : ''}
      ${otras.length ? `
        <div style="background:#f4f6fa;border-left:4px solid #5a6478;padding:12px 14px;border-radius:4px;margin-bottom:12px">
          <b>📝 ${otras.length} línea(s) manuales más</b> (pedidos, servicios u otros)
          <div style="font-size:13px;margin-top:4px">Si no salen de bodega, márcalas <b>Sin inventario</b> en el Despacho de su fecha para que dejen de aparecer aquí. Si sí son productos de bodega, vincúlalas y descuéntalas.</div></div>
        <table style="width:100%;border-collapse:collapse"><tr><th style="${th}">Fecha</th><th style="${th}">Escrito en la venta</th><th style="${th}">Cliente · vendedor</th></tr>${tablaOtras}</table>` : ''}
      <div style="text-align:center;margin-top:24px"><a href="${APP_URL}" style="background:#FFC100;color:#00275E;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700">Abrir el sistema de ventas</a></div>
      </div></div>`;

    const resumen = { desde, hasta: hoyHN, manuales: filas.length, parecen_catalogo: rojas.length, otras: otras.length };
    if (dry) {
      // El detalle (clientes) solo se devuelve con la service role key; sin ella, solo los conteos
      const auth = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
      let llaves: string[] = [Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''];
      try { llaves = llaves.concat(Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')) as string[]); } catch (_) { /* sin llaves nuevas */ }
      const admin = !!auth && llaves.some(k => k && k === auth);
      return json(admin ? { ok: true, dry: true, ...resumen, rojas, otras, html } : { ok: true, dry: true, ...resumen });
    }
    if (!filas.length) return json({ ok: true, enviado: false, motivo: 'sin líneas pendientes', ...resumen });

    const key = (Deno.env.get('RESEND_API_KEY') ?? '').trim();
    if (!key) return json({ ok: false, error: 'Falta el secret RESEND_API_KEY', ...resumen }, 500);
    const subject = rojas.length
      ? `🔴 ${rojas.length} producto(s) del catálogo vendidos a mano sin descontar`
      : `📝 ${otras.length} línea(s) manuales sin resolver en el Despacho`;
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [DESTINO], reply_to: DESTINO, subject, html }),
      signal: AbortSignal.timeout(20000),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return json({ ok: false, error: `Resend ${r.status}: ${d?.message || d?.name || 'error'}`, ...resumen }, 502);
    return json({ ok: true, enviado: true, id: d?.id ?? null, ...resumen });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
