// ============================================================================
// CHECK COSTOS FALTANTES — ventas-eventas90
// Revisa las ventas con productos sin costo registrado y avisa por WhatsApp
// al grupo Social Media. Se repite cada 24h hasta que todos tengan costo.
// Un producto sin costo NO genera utilidad ni comisión, por eso urge corregirlo.
// Secretos: ULTRAMSG_INSTANCE, ULTRAMSG_TOKEN, WA_GRUPO_DESTINO
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const DESDE = '2026-08-01'; // desde que el sistema nuevo lleva las ventas

const fmtL = (n: unknown) => 'L ' + parseFloat(String(n ?? 0)).toLocaleString('es-HN', { minimumFractionDigits: 2 });
function fmtFecha(d: string) {
  if (!d) return '—';
  try { return new Date(d + 'T12:00:00').toLocaleDateString('es-HN', { day: '2-digit', month: 'short' }); }
  catch { return d; }
}

async function sendWA(msg: string) {
  const inst  = Deno.env.get('ULTRAMSG_INSTANCE') ?? '';
  const token = Deno.env.get('ULTRAMSG_TOKEN') ?? '';
  const to    = Deno.env.get('WA_GRUPO_DESTINO') ?? '';
  if (!inst || !token || !to) return { error: 'Faltan secretos de WhatsApp' };
  const r = await fetch(`https://api.ultramsg.com/${inst}/messages/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, to, body: msg })
  });
  return await r.json().catch(() => ({}));
}

Deno.serve(async (req) => {
  const dry = new URL(req.url).searchParams.get('dry') === '1'; // prueba sin enviar WhatsApp
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: ventas, error } = await sb
    .from('ventas')
    .select('id,fecha,cliente_nombre,vendedor_nombre,venta_items!inner(nombre,sku,cantidad,precio_final,costo_lps)')
    .gte('fecha', DESDE)
    .eq('venta_items.costo_lps', 0)
    .order('fecha', { ascending: true });

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!ventas || !ventas.length) {
    return new Response(JSON.stringify({ ok: true, pendientes: 0, enviado: false }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let totalItems = 0;
  const porVendedor: Record<string, number> = {};
  const bloques = ventas.map((v: any) => {
    const items = (v.venta_items || []).map((it: any) => {
      totalItems++;
      const vend = v.vendedor_nombre || '—';
      porVendedor[vend] = (porVendedor[vend] || 0) + 1;
      return `   ▫️ ${it.nombre || it.sku || '(sin nombre)'} · ${it.cantidad} × ${fmtL(it.precio_final)}`;
    }).join('\n');
    return `• *${fmtFecha(v.fecha)}* · ${v.cliente_nombre || '—'} · vend: ${v.vendedor_nombre || '—'}\n${items}`;
  }).join('\n\n');

  const resumenVend = Object.entries(porVendedor)
    .sort((a, b) => b[1] - a[1])
    .map(([v, n]) => `   • ${v}: ${n}`).join('\n');

  const msg =
`⚠️ *PRODUCTOS SIN COSTO — Sistema Ventas*

Hay *${totalItems} producto(s)* en *${ventas.length} venta(s)* sin costo registrado.

❗ Estos productos *NO generan utilidad ni comisión* para el vendedor, y el ROI de esas ventas no se puede calcular.

👤 *Por vendedor:*
${resumenVend}

${bloques}

📝 *Cómo corregirlo:* Ventas → Historial de Ventas → ✏️ Editar la venta → escribir el *"Costo L"* de cada producto → Actualizar Venta.

🔁 Este aviso se repite cada 24 horas hasta que todos los costos estén ingresados.`;

  if (dry) return new Response(JSON.stringify({ ok: true, dry: true, pendientes: totalItems, ventas: ventas.length, mensaje: msg }), { headers: { 'Content-Type': 'application/json' } });
  const resp = await sendWA(msg);
  return new Response(JSON.stringify({ ok: true, pendientes: totalItems, ventas: ventas.length, enviado: true, wa: resp }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
