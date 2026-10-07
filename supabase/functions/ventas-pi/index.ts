// ============================================================================
// VENTAS-PI — ventas-eventas90
// Proxy de SOLO LECTURA hacia Precio Inteligente (sistema viejo): lista las
// ventas facturadas allá para cargarlas aquí como venta FORMAL y pagar comisiones.
// Cadena: app → ventas-pi (valida usuario activo) → ventas-facturadas del viejo
// (x-api-key). El token nunca llega al navegador.
// Body JSON: { usuario, desde, hasta }  (fechas YYYY-MM-DD)
// Secretos: API_EXTERNA_URL, API_EXTERNA_TOKEN, API_EXTERNA_ANON (los mismos de productos-externos)
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const usuario = String(body.usuario || '').trim();
  const desde = String(body.desde || '');
  const hasta = String(body.hasta || desde);
  if (!usuario) return json({ error: 'Falta usuario' }, 400);
  if (!FECHA_RE.test(desde) || !FECHA_RE.test(hasta)) return json({ error: 'Fechas inválidas' }, 400);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: u, error: eu } = await sb.from('usuarios').select('user, activo').eq('user', usuario).maybeSingle();
  if (eu) return json({ error: eu.message }, 500);
  if (!u || !u.activo) return json({ error: 'Usuario no autorizado' }, 403);

  const URL_API = Deno.env.get('API_EXTERNA_URL') ?? '';
  const TOKEN   = Deno.env.get('API_EXTERNA_TOKEN') ?? '';
  const ANON    = Deno.env.get('API_EXTERNA_ANON') ?? '';
  if (!URL_API || !TOKEN || !ANON) return json({ error: 'Faltan secretos API_EXTERNA_*' }, 500);

  // .../functions/v1/api-externa  →  .../functions/v1/ventas-facturadas
  const destino = new URL(URL_API.replace(/\/$/, '').replace(/\/api-externa$/, '/ventas-facturadas'));
  destino.searchParams.set('desde', desde);
  destino.searchParams.set('hasta', hasta);

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(destino.toString(), {
      headers: { 'x-api-key': TOKEN, Authorization: `Bearer ${ANON}` },
      signal: ctrl.signal
    });
    const data = await r.json().catch(() => ({ error: 'Respuesta inválida de Precio Inteligente' }));
    return json(data, r.ok ? 200 : 502);
  } catch (e) {
    return json({ error: (e as Error).name === 'AbortError' ? 'Precio Inteligente no respondió a tiempo' : (e as Error).message }, 502);
  } finally {
    clearTimeout(to);
  }
});
