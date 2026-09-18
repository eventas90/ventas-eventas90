// ============================================================================
// RESUMEN DIARIO DE VENTAS — ventas-eventas90
// Envía por WhatsApp al grupo Social Media un resumen del día (lunes a sábado,
// 6:00 pm Honduras): cuánto se vendió, ROI promedio y quién vendió más.
// Los datos salen del RPC resumen_ventas_dia(fecha) del sistema nuevo.
// Parámetros: ?dry=1 (no envía, solo devuelve el mensaje) · ?fecha=YYYY-MM-DD
// Secretos: ULTRAMSG_INSTANCE, ULTRAMSG_TOKEN, WA_GRUPO_DESTINO
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const fmtL = (n: unknown) => 'L ' + parseFloat(String(n ?? 0)).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Honduras es UTC-6 todo el año (sin horario de verano)
function fechaHonduras(): string {
  const hn = new Date(Date.now() - 6 * 3600 * 1000);
  return hn.toISOString().slice(0, 10);
}
function fechaLarga(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  const s = d.toLocaleDateString('es-HN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function sendWA(msg: string) {
  const inst  = Deno.env.get('ULTRAMSG_INSTANCE') ?? '';
  const token = Deno.env.get('ULTRAMSG_TOKEN') ?? '';
  const to    = Deno.env.get('WA_GRUPO_DESTINO') ?? '';
  if (!inst || !token || !to) return { error: 'Faltan secretos de WhatsApp' };
  // UltraMsg NO lee JSON: el token y los campos van como formulario (x-www-form-urlencoded)
  const r = await fetch(`https://api.ultramsg.com/${inst}/messages/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token, to, body: msg }).toString()
  });
  return await r.json().catch(() => ({}));
}

Deno.serve(async (req) => {
  const url   = new URL(req.url);
  const dry   = url.searchParams.get('dry') === '1';
  const fecha = url.searchParams.get('fecha') || fechaHonduras();
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: r, error } = await sb.rpc('resumen_ventas_dia', { p_fecha: fecha });
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  const medallas = ['🥇', '🥈', '🥉'];
  const vend: any[] = r.por_vendedor || [];
  const top = vend[0];

  let msg: string;
  if (!r.ventas) {
    msg = `📊 *RESUMEN DEL DÍA — Focus Store*\n📅 ${fechaLarga(fecha)}\n\n😴 Hoy no se registraron ventas en el sistema.`;
  } else {
    const lineasVend = vend.map((v, i) =>
      `   ${medallas[i] ?? '▫️'} ${v.vendedor} — ${fmtL(v.total)} (${v.n} ${v.n === 1 ? 'venta' : 'ventas'})`
    ).join('\n');

    const roiTxt = r.roi_pct == null ? '— (sin costos registrados)' : `${r.roi_pct}%`;
    const credito = r.por_cobrar > 0 ? `\n   💳 A crédito (por cobrar): ${fmtL(r.por_cobrar)}` : '';
    const sinCosto = r.items_sin_costo > 0
      ? `\n\n⚠️ ${r.items_sin_costo} producto(s) sin costo registrado — no cuentan para el ROI ni la comisión.`
      : '';

    msg =
`📊 *RESUMEN DEL DÍA — Focus Store*
📅 ${fechaLarga(fecha)}

💰 *Ventas del día:* ${fmtL(r.total)}
   ${r.ventas} ${r.ventas === 1 ? 'venta' : 'ventas'} · ${r.items} producto(s)
   Sin ISV: ${fmtL(r.sin_isv)}${credito}

📈 *ROI promedio del día:* ${roiTxt}
   Utilidad: ${fmtL(r.utilidad)} sobre costo ${fmtL(r.costo)}

🏆 *Vendedor del día:* ${top.vendedor}
   ${fmtL(top.total)} en ${top.n} ${top.n === 1 ? 'venta' : 'ventas'}

👥 *Por vendedor:*
${lineasVend}${sinCosto}`;
  }

  if (dry) return new Response(JSON.stringify({ ok: true, dry: true, fecha, datos: r, mensaje: msg }), { headers: { 'Content-Type': 'application/json' } });
  const wa = await sendWA(msg);
  return new Response(JSON.stringify({ ok: true, fecha, ventas: r.ventas, total: r.total, enviado: true, wa }), { headers: { 'Content-Type': 'application/json' } });
});
