// ============================================================================
// RESUMEN DE VENTAS POR WHATSAPP — ventas-eventas90
// Dos mensajes al grupo Social Media, con las MISMAS reglas que "Reporte
// Vendedores" de la app (RPC resumen_ventas_rango):
//   · ?modo=diario  (por defecto) → lunes a sábado 6:00 pm HN: el día + cómo va
//     el mes contra el mes anterior a la misma fecha.
//   · ?modo=semanal → martes 6:00 pm HN: la semana lunes–sábado que cerró el
//     sábado pasado, comparada con la semana anterior.
// Parámetros de prueba: ?dry=1 (no envía) · ?fecha=YYYY-MM-DD (simula "hoy").
// Secretos: ULTRAMSG_INSTANCE, ULTRAMSG_TOKEN, WA_GRUPO_DESTINO
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const fmtL = (n: unknown) => 'L ' + (parseFloat(String(n ?? 0)) || 0).toLocaleString('es-HN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtN = (n: unknown) => (parseFloat(String(n ?? 0)) || 0).toLocaleString('es-HN', { maximumFractionDigits: 0 });
const num  = (n: unknown) => parseFloat(String(n ?? 0)) || 0;

// Honduras es UTC-6 todo el año
const hoyHN = () => new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10);
const d2iso = (d: Date) => d.toISOString().slice(0, 10);
const iso2d = (s: string) => new Date(s + 'T12:00:00Z');
const masDias = (s: string, n: number) => { const d = iso2d(s); d.setUTCDate(d.getUTCDate() + n); return d2iso(d); };
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const DIAS  = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const cap   = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fechaLarga = (s: string) => { const d = iso2d(s); return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`; };
const fechaCorta = (s: string) => { const d = iso2d(s); return `${d.getUTCDate()} ${MESES[d.getUTCMonth()].slice(0, 3)}`; };
const diasEnMes = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

// Variación en % con flecha; sin dato si no hay base
function delta(actual: number, anterior: number): string {
  if (!anterior) return actual ? '(nuevo)' : '';
  const p = (actual - anterior) / anterior * 100;
  const flecha = p > 0.05 ? '▲' : p < -0.05 ? '▼' : '=';
  return `${flecha} ${p > 0 ? '+' : ''}${p.toFixed(1)}%`;
}
function barra(parte: number, todo: number, ancho = 10): string {
  const pct = todo > 0 ? Math.max(0, Math.min(1, parte / todo)) : 0;
  const n = Math.round(pct * ancho);
  return '█'.repeat(n) + '░'.repeat(ancho - n) + ` ${Math.round(pct * 100)}%`;
}
const medallas = ['🥇', '🥈', '🥉'];

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

// ── Bloque común: cifras de un rango (secciones 1 a 8 de Billy) ───────────────
function bloqueCifras(r: any, etiqueta: string): string {
  const roi = r.roi_pct == null ? '— (sin costos registrados)' : `${r.roi_pct}%`;
  const credito = num(r.por_cobrar) > 0
    ? `\n⏳ *Pendiente de cobrar:* ${fmtL(r.por_cobrar)} (${r.ventas_credito} venta${r.ventas_credito === 1 ? '' : 's'} a crédito)`
    : `\n⏳ *Pendiente de cobrar:* L 0.00`;
  const cobrosViejos = num(r.cobros_creditos_anteriores) > 0
    ? `\n💳 Cobros de créditos anteriores: ${fmtL(r.cobros_creditos_anteriores)} (${r.n_cobros_anteriores})` : '';
  return `💰 *Ventas totales${etiqueta}:* ${fmtL(r.total)}
   ${r.ventas} venta${r.ventas === 1 ? '' : 's'} (incluye las ventas a crédito completas)
🧾 *Ventas totales sin ISV:* ${fmtL(r.sin_isv)}
   ISV: ${fmtL(r.isv)}

✅ *Total cobrado (con ISV):* ${fmtL(r.cobrado)}
   contado completo + solo el abono de las ventas a crédito
✅ *Total cobrado sin ISV:* ${fmtL(r.cobrado_sin_isv)}${credito}${cobrosViejos}

📦 *Productos:* ${fmtN(r.unidades)} unidad${num(r.unidades) === 1 ? '' : 'es'} en ${r.lineas} línea${r.lineas === 1 ? '' : 's'}

📈 *ROI promedio:* ${roi}
💵 *Utilidad:* ${fmtL(r.utilidad)} sobre costo ${fmtL(r.costo)}`;
}

function bloqueVendedores(r: any, ant?: any): string {
  const vend: any[] = r.por_vendedor || [];
  if (!vend.length) return '';
  const top = vend[0];
  const antMap = new Map<string, any>((ant?.por_vendedor || []).map((v: any) => [v.vendedor, v]));
  const lineas = vend.map((v, i) => {
    const d = ant ? ` ${delta(num(v.total), num(antMap.get(v.vendedor)?.total))}` : '';
    const pend = num(v.por_cobrar) > 0 ? ` · ⏳ ${fmtL(v.por_cobrar)}` : '';
    return `   ${medallas[i] ?? '▫️'} ${v.vendedor} — ${fmtL(v.total)} (${v.n})${d}\n      utilidad ${fmtL(v.utilidad)}${pend}`;
  }).join('\n');
  const sinCosto = num(r.items_sin_costo) > 0
    ? `\n\n⚠️ ${r.items_sin_costo} producto(s) sin costo registrado — no cuentan para la utilidad ni la comisión.` : '';
  return `🏆 *Vendedor ${ant ? 'de la semana' : 'del día'}:* ${top.vendedor}
   ${fmtL(top.total)} en ${top.n} venta${top.n === 1 ? '' : 's'} · utilidad ${fmtL(top.utilidad)}

👥 *Por vendedor:*
${lineas}${sinCosto}`;
}

// ── Cómo va el mes contra el mes anterior a la misma fecha (sección 11) ───────
function bloqueMes(fecha: string, mes: any, mesAntMismaFecha: any, mesAntCompleto: any, diaN: number, diasMes: number, nombreMes: string, nombreMesAnt: string): string {
  const actual = num(mes.total), antFecha = num(mesAntMismaFecha.total), antFull = num(mesAntCompleto.total);
  const faltan = antFull - actual;
  const diasRestan = diasMes - diaN;
  const ritmo = diaN > 0 ? actual / diaN : 0;
  const proy = ritmo * diasMes;
  const comparacion = antFecha > 0
    ? `${cap(nombreMesAnt)} al día ${diaN}: ${fmtL(antFecha)} → ${delta(actual, antFecha)}`
    : `${cap(nombreMesAnt)} al día ${diaN}: sin ventas registradas`;
  const meta = antFull > 0
    ? (faltan > 0
        ? `Para igualar ${nombreMesAnt} completo (${fmtL(antFull)}) faltan ${fmtL(faltan)} en ${diasRestan} día${diasRestan === 1 ? '' : 's'}`
        : `¡Ya superamos ${nombreMesAnt} completo (${fmtL(antFull)}) por ${fmtL(-faltan)}!`)
    : '';
  return `📆 *${cap(nombreMes)} hasta hoy:* ${fmtL(actual)} (${mes.ventas} ventas, ${diaN} días)
   ${comparacion}
   ${meta}
   ${antFull > 0 ? barra(actual, antFull) + ` de ${nombreMesAnt}` : ''}
   Ritmo actual: ${fmtL(ritmo)}/día → proyección ${fmtL(proy)}`;
}

Deno.serve(async (req) => {
  const url   = new URL(req.url);
  const dry   = url.searchParams.get('dry') === '1';
  const modo  = (url.searchParams.get('modo') || 'diario').toLowerCase();
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('fecha') || '') ? url.searchParams.get('fecha')! : hoyHN();
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const rango = async (desde: string, hasta: string) => {
    const { data, error } = await sb.rpc('resumen_ventas_rango', { p_desde: desde, p_hasta: hasta });
    if (error) throw new Error(error.message);
    return data;
  };

  try {
    let msg = '';
    let datos: any = {};

    if (modo === 'semanal') {
      // Semana lunes–sábado que cerró el sábado pasado, y la anterior
      const d = iso2d(fecha);
      const desdeSab = (d.getUTCDay() + 1) % 7;            // días desde el último sábado (sábado = 0)
      const sab  = masDias(fecha, -desdeSab);
      const lun  = masDias(sab, -5);
      const sabA = masDias(sab, -7), lunA = masDias(lun, -7);
      const [sem, semAnt] = await Promise.all([rango(lun, sab), rango(lunA, sabA)]);
      datos = { semana: sem, anterior: semAnt };

      const dias: any[] = sem.por_dia || [];
      const mejor = [...dias].sort((a, b) => num(b.total) - num(a.total))[0];
      const promDia = dias.length ? num(sem.total) / dias.length : 0;
      const diasVend = (x: any) => (x.por_dia || []).length;

      msg = `📊 *RESUMEN SEMANAL — Focus Store*
📅 Semana del ${fechaCorta(lun)} al ${fechaCorta(sab)} (lunes a sábado)
   vs semana del ${fechaCorta(lunA)} al ${fechaCorta(sabA)}

${bloqueCifras(sem, '')}

📉 *Comparación con la semana anterior:*
   Ventas: ${fmtL(semAnt.total)} → ${fmtL(sem.total)} ${delta(num(sem.total), num(semAnt.total))}
   Cobrado: ${fmtL(semAnt.cobrado)} → ${fmtL(sem.cobrado)} ${delta(num(sem.cobrado), num(semAnt.cobrado))}
   Utilidad: ${fmtL(semAnt.utilidad)} → ${fmtL(sem.utilidad)} ${delta(num(sem.utilidad), num(semAnt.utilidad))}
   ROI: ${semAnt.roi_pct ?? '—'}% → ${sem.roi_pct ?? '—'}%
   Nº de ventas: ${semAnt.ventas} → ${sem.ventas} · Unidades: ${fmtN(semAnt.unidades)} → ${fmtN(sem.unidades)}
   Días con ventas: ${diasVend(semAnt)} → ${diasVend(sem)} · promedio ${fmtL(promDia)}/día
${mejor ? `   Mejor día: ${fechaLarga(mejor.fecha).split(' de ')[0]} con ${fmtL(mejor.total)} (${mejor.n} ventas)` : ''}

${bloqueVendedores(sem, semAnt)}`;
      if (!sem.ventas) msg = `📊 *RESUMEN SEMANAL — Focus Store*\n📅 Semana del ${fechaCorta(lun)} al ${fechaCorta(sab)}\n\n😴 No se registraron ventas en esa semana.`;
    } else {
      // Día + mes contra el mes anterior a la misma fecha
      const d = iso2d(fecha);
      const y = d.getUTCFullYear(), m0 = d.getUTCMonth(), diaN = d.getUTCDate();
      const ini = d2iso(new Date(Date.UTC(y, m0, 1)));
      const yA = m0 === 0 ? y - 1 : y, mA = m0 === 0 ? 11 : m0 - 1;
      const diasMesAnt = diasEnMes(yA, mA);
      const iniAnt = d2iso(new Date(Date.UTC(yA, mA, 1)));
      const finAntFecha = d2iso(new Date(Date.UTC(yA, mA, Math.min(diaN, diasMesAnt))));
      const finAnt = d2iso(new Date(Date.UTC(yA, mA, diasMesAnt)));
      const [dia, mes, mesAntFecha, mesAntFull] = await Promise.all([rango(fecha, fecha), rango(ini, fecha), rango(iniAnt, finAntFecha), rango(iniAnt, finAnt)]);
      datos = { dia, mes, mesAntFecha, mesAntFull };

      if (!dia.ventas) {
        msg = `📊 *RESUMEN DEL DÍA — Focus Store*\n📅 ${fechaLarga(fecha)}\n\n😴 Hoy no se registraron ventas en el sistema.\n\n${bloqueMes(fecha, mes, mesAntFecha, mesAntFull, diaN, diasEnMes(y, m0), MESES[m0], MESES[mA])}`;
      } else {
        msg = `📊 *RESUMEN DEL DÍA — Focus Store*
📅 ${fechaLarga(fecha)}

${bloqueCifras(dia, ' del día')}

${bloqueVendedores(dia)}

${bloqueMes(fecha, mes, mesAntFecha, mesAntFull, diaN, diasEnMes(y, m0), MESES[m0], MESES[mA])}`;
      }
    }

    if (dry) return new Response(JSON.stringify({ ok: true, dry: true, modo, fecha, datos, mensaje: msg }), { headers: { 'Content-Type': 'application/json' } });
    const wa = await sendWA(msg);
    return new Response(JSON.stringify({ ok: true, modo, fecha, enviado: true, wa }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
