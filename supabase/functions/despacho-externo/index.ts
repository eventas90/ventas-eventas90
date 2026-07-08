// ============================================================================
// DESPACHO EXTERNO — ventas-eventas90
// Proxy de escritura hacia la api-externa de Precio Inteligente (sistema viejo):
// descuenta del inventario lo vendido y sincroniza el producto en Wix.
// El token de la API vive como secreto (API_EXTERNA_TOKEN), nunca en el cliente.
// Autorización: el body.usuario debe ser un usuario activo con rol admin o
// gerencia en la tabla usuarios de ESTE proyecto.
// Secretos requeridos: API_EXTERNA_URL, API_EXTERNA_TOKEN, API_EXTERNA_ANON.
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Solo POST' }, 405);
  try {
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch (_) { /* vacío */ }

    const usuario = String(body.usuario || '').trim();
    if (!usuario) return json({ error: 'Falta usuario' }, 400);

    // Verificar que el usuario exista, esté activo y tenga rol permitido
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: u, error: eu } = await sb.from('usuarios')
      .select('user, rol, activo').eq('user', usuario).maybeSingle();
    if (eu) return json({ error: eu.message }, 500);
    if (!u || !u.activo || !['admin', 'gerencia'].includes(u.rol)) {
      return json({ error: 'Usuario no autorizado para despacho' }, 403);
    }

    const base = Deno.env.get('API_EXTERNA_URL');
    const r = await fetch(`${base}/despacho`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': Deno.env.get('API_EXTERNA_TOKEN')!,
        Authorization: `Bearer ${Deno.env.get('API_EXTERNA_ANON')}`
      },
      body: JSON.stringify({
        producto_id: body.producto_id || undefined,
        sku: body.sku || undefined,
        cantidad: body.cantidad,
        usuario,
        aplicar_wix: body.aplicar_wix !== false
      })
    });
    const data = await r.json();
    return json(data, r.status);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
