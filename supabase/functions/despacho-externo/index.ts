// ============================================================================
// DESPACHO EXTERNO — ventas-eventas90
// Descuenta del inventario de Precio Inteligente lo vendido y sincroniza Wix,
// con CONTROL DE CONCURRENCIA: varias personas pueden despachar a la vez.
//
// Flujo idempotente por (fecha, producto_key):
//   1. claim_despacho_inv() bloquea la fila y devuelve el delta a descontar
//      (0 si otro usuario ya lo descontó). Registro por producto → no se pisan.
//   2. Si delta > 0, descuenta ese delta en el sistema viejo (api-externa).
//      Si el descuento falla, revierte el claim.
//   3. Registra el resultado de Wix.
//
// Autorización: body.usuario debe ser admin/gerencia activo en usuarios.
// Secretos: API_EXTERNA_URL, API_EXTERNA_TOKEN, API_EXTERNA_ANON.
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

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

async function apiDespacho(payload: Record<string, unknown>) {
  const base = Deno.env.get('API_EXTERNA_URL');
  const r = await fetch(`${base}/despacho`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': Deno.env.get('API_EXTERNA_TOKEN')!,
      Authorization: `Bearer ${Deno.env.get('API_EXTERNA_ANON')}`
    },
    body: JSON.stringify(payload)
  });
  return { status: r.status, data: await r.json() };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Solo POST' }, 405);
  try {
    let body: Record<string, any> = {};
    try { body = await req.json(); } catch (_) { /* vacío */ }

    const usuario = String(body.usuario || '').trim();
    if (!usuario) return json({ error: 'Falta usuario' }, 400);

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Autorización
    const { data: u, error: eu } = await sb.from('usuarios').select('user, rol, activo').eq('user', usuario).maybeSingle();
    if (eu) return json({ error: eu.message }, 500);
    if (!u || !u.activo || !['admin', 'gerencia'].includes(u.rol)) {
      return json({ error: 'Usuario no autorizado para despacho' }, 403);
    }

    const fecha = String(body.fecha || hoyISO()).slice(0, 10);
    const productoKey = String(body.producto_key || body.producto_id || body.sku || '').trim();
    const productoId = body.producto_id ? String(body.producto_id) : null;
    const sku = body.sku ? String(body.sku).trim() : null;
    const vendido = parseInt(body.cantidad);          // total vendido del día para ese producto
    const aplicarWix = body.aplicar_wix !== false;
    if (!productoKey) return json({ error: 'Falta producto_key/producto_id/sku' }, 400);
    if (!Number.isFinite(vendido) || vendido < 0 || vendido > 1000) {
      return json({ error: 'cantidad inválida (0-1000; 0 = solo Wix)' }, 400);
    }

    // 1) Claim atómico: cuánto falta descontar realmente
    let delta = 0;
    if (vendido > 0) {
      const { data: d, error: ec } = await sb.rpc('claim_despacho_inv', {
        p_fecha: fecha, p_key: productoKey, p_producto_id: productoId, p_sku: sku, p_vendido: vendido, p_user: usuario
      });
      if (ec) return json({ error: 'claim: ' + ec.message }, 500);
      delta = Number(d) || 0;
    }

    // 2) Descontar el delta en el sistema viejo (+ Wix). delta 0 → solo sincroniza Wix.
    const { status, data } = await apiDespacho({ producto_id: productoId, sku, cantidad: delta, usuario, aplicar_wix: aplicarWix });
    if (status >= 400 || (data && data.error)) {
      if (delta > 0) {
        await sb.rpc('revertir_despacho_inv', { p_fecha: fecha, p_key: productoKey, p_delta: delta });
      }
      return json({ error: (data && data.error) || ('Error api-externa HTTP ' + status), revertido: delta > 0 }, 502);
    }

    // 3) Registrar Wix
    if (data && data.wix && data.wix.ok) {
      await sb.rpc('registrar_despacho_wix', {
        p_fecha: fecha, p_key: productoKey, p_producto_id: productoId, p_sku: sku, p_vendido: vendido,
        p_wix: vendido, p_wix_stock: data.wix.stock_wix
      });
    }

    return json({
      ok: true,
      producto: data?.producto || '',
      sku: sku || '',
      delta_descontado: delta,
      ya_estaba: vendido > 0 && delta === 0,
      stock_nuevo: data?.stock_nuevo,
      wix: data?.wix || null
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
