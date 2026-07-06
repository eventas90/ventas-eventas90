# Ventas Focus (ventas-eventas90)

PWA de **Ventas, Cobros y Clientes** para Focus Store. Es una copia adaptada de la app
Precio Inteligente que conserva únicamente esos módulos (más administración básica:
usuarios, parámetros e historial para el rol admin).

## Arquitectura

- **Frontend:** `index.html` (HTML + CSS + JS inline, Supabase JS v2), publicado en GitHub Pages.
- **Base de datos:** proyecto Supabase `eqvzzfzydzrgwseirtmu` con las tablas
  `usuarios, clientes, ventas, venta_items, venta_abonos, cobro_recordatorios, historial, parametros, notificaciones`
  y sus RPCs (login con bcrypt vía `login_usuario`).
- **Productos (solo lectura):** esta app NO tiene tabla de productos. Los obtiene de la
  API externa de Precio Inteligente a través de la edge function
  `supabase/functions/productos-externos` (proxy con CORS que agrega las credenciales
  del lado del servidor). El frontend la consume paginando con
  `GET /functions/v1/productos-externos?limit=1000&offset=0` y refresca cada 30 s.
- Los módulos ocultos del monolito original (productos, cotizaciones, combos, inventario,
  gastos, etc.) quedan inaccesibles vía `PERMS[rol].tabs`; sus RPCs alcanzables desde los
  flujos activos fueron neutralizados para devolver listas vacías sin errores.

## Secretos de la edge function `productos-externos`

Configurar con `supabase secrets set` antes de desplegar:

| Secreto | Descripción |
|---|---|
| `API_EXTERNA_URL` | URL base de la API externa de Precio Inteligente (ej. `https://<proyecto-viejo>.supabase.co/functions/v1/api-externa`) |
| `API_EXTERNA_TOKEN` | Token `x-api-key` generado en Precio Inteligente → Parámetros → API Externa |
| `API_EXTERNA_ANON` | Anon key del proyecto Supabase viejo (necesaria para pasar el gateway) |

Desplegar con: `supabase functions deploy productos-externos`
