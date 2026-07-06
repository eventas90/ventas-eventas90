// Edge Function: productos-externos
// Proxy de SOLO LECTURA hacia la API externa de Precio Inteligente.
// La app ventas-eventas90 no tiene tabla de productos: los lee a través de este proxy,
// que agrega las credenciales (secretos) del lado del servidor para no exponerlas al cliente.
//
// Secretos requeridos (supabase secrets set ...):
//   API_EXTERNA_URL   → ej. https://uzhjnedhmbvgfqqssuov.supabase.co/functions/v1/api-externa
//   API_EXTERNA_TOKEN → token x-api-key generado en Precio Inteligente (Parámetros → API Externa)
//   API_EXTERNA_ANON  → anon key del proyecto viejo (para pasar el gateway de Supabase)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PARAMS_PERMITIDOS = ['buscar', 'sku', 'categoria', 'con_stock', 'limit', 'offset'];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Método no permitido — solo GET' }, 405);
  }

  const API_EXTERNA_URL   = Deno.env.get('API_EXTERNA_URL')   ?? '';
  const API_EXTERNA_TOKEN = Deno.env.get('API_EXTERNA_TOKEN') ?? '';
  const API_EXTERNA_ANON  = Deno.env.get('API_EXTERNA_ANON')  ?? '';

  if (!API_EXTERNA_URL || !API_EXTERNA_TOKEN || !API_EXTERNA_ANON) {
    return jsonResponse({
      error: 'Configuración incompleta: faltan secretos API_EXTERNA_URL, API_EXTERNA_TOKEN o API_EXTERNA_ANON',
    }, 500);
  }

  try {
    const urlEntrante = new URL(req.url);
    const destino = new URL(`${API_EXTERNA_URL.replace(/\/$/, '')}/productos`);

    // Reenviar solo los query params permitidos
    for (const nombre of PARAMS_PERMITIDOS) {
      const valor = urlEntrante.searchParams.get(nombre);
      if (valor !== null && valor !== '') destino.searchParams.set(nombre, valor);
    }
    // Siempre pedir costos (la app calcula precios con calcProd a partir de costos)
    destino.searchParams.set('incluir_costos', '1');

    const respuesta = await fetch(destino.toString(), {
      headers: {
        'x-api-key': API_EXTERNA_TOKEN,
        'Authorization': `Bearer ${API_EXTERNA_ANON}`,
      },
    });

    const cuerpo = await respuesta.text();

    if (!respuesta.ok) {
      return jsonResponse({
        error: `API externa respondió ${respuesta.status}`,
        detalle: cuerpo.slice(0, 500),
      }, respuesta.status);
    }

    // Devolver el JSON tal cual, con headers CORS
    return new Response(cuerpo, {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: 'Error interno del proxy', detalle: msg }, 500);
  }
});
