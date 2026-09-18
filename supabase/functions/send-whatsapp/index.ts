// ============================================================================
// SEND-WHATSAPP — ventas-eventas90
// Envía un WhatsApp por UltraMsg desde la app sin exponer el token en el HTML.
// Body JSON: { usuario, to, body }  ·  ?dry=1 valida sin enviar.
// Autorización: body.usuario debe existir y estar activo en `usuarios`.
// Secretos: ULTRAMSG_INSTANCE, ULTRAMSG_TOKEN
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  const dry = new URL(req.url).searchParams.get('dry') === '1';

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const usuario = String(body.usuario || '').trim();
  const to      = String(body.to || '').replace(/[^\d+]/g, '');
  const texto   = String(body.body || '').trim();
  if (!usuario) return json({ error: 'Falta usuario' }, 400);
  if (!/^\+?\d{8,15}$/.test(to)) return json({ error: 'Teléfono inválido' }, 400);
  if (!texto) return json({ error: 'Mensaje vacío' }, 400);
  if (texto.length > 4000) return json({ error: 'Mensaje demasiado largo' }, 400);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: u, error: eu } = await sb.from('usuarios').select('user, activo').eq('user', usuario).maybeSingle();
  if (eu) return json({ error: eu.message }, 500);
  if (!u || !u.activo) return json({ error: 'Usuario no autorizado' }, 403);

  if (dry) return json({ ok: true, dry: true, to, largo: texto.length });

  const inst  = Deno.env.get('ULTRAMSG_INSTANCE') ?? '';
  const token = Deno.env.get('ULTRAMSG_TOKEN') ?? '';
  if (!inst || !token) return json({ error: 'Faltan secretos de WhatsApp' }, 500);

  // UltraMsg espera formulario (x-www-form-urlencoded), no JSON
  const r = await fetch(`https://api.ultramsg.com/${inst}/messages/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token, to, body: texto }).toString()
  });
  const data = await r.json().catch(() => ({ error: 'Respuesta inválida de UltraMsg' }));
  // Se devuelve tal cual: la app ya evalúa data.sent === 'true' || data.id
  return json(data, r.ok ? 200 : 502);
});
