-- ============================================================================
-- resumen_ventas_rango(desde, hasta): cifras de ventas de un rango de fechas
-- con las MISMAS reglas que "Reporte Vendedores" de la app, para que el
-- resumen por WhatsApp y la pantalla digan lo mismo.
--   · total / sin_isv        → suma de ventas.total / subtotal_sin_isv (la venta
--                              a crédito entra COMPLETA, como pide Billy)
--   · cobrado                → total − saldo pendiente (contado completo + solo
--                              el abono de las ventas a crédito)
--   · cobrado_sin_isv        → lo cobrado, quitando el ISV en proporción
--   · por_cobrar             → saldo pendiente de las ventas a crédito del rango
--   · utilidad / costo / roi → utilidad_bruta guardada (ya ≥ 0; sin costo = 0) y
--                              costo = sin_isv − utilidad − descuento (fórmula del reporte)
--   · cobros_creditos_anteriores → abonos recibidos en el rango sobre ventas de
--                              ANTES del rango (dinero que sí entró, aparte)
-- Solo service_role (lo llama la edge function resumen-diario-ventas).
-- ============================================================================
create or replace function public.resumen_ventas_rango(p_desde date, p_hasta date)
returns jsonb
language sql
security definer
set search_path = public
as $fn$
with vd as (
  select v.*,
         (v.metodo_pago = 'parcial' and coalesce(v.saldo_pendiente,0) > 0) as pendiente,
         greatest(coalesce(v.total,0) - case when v.metodo_pago = 'parcial' then coalesce(v.saldo_pendiente,0) else 0 end, 0) as cobrado,
         greatest(coalesce(v.subtotal_sin_isv,0) - coalesce(v.utilidad_bruta,0) - coalesce(v.descuento,0), 0) as costo
  from ventas v
  where v.fecha between p_desde and p_hasta
),
vd2 as (
  select *, case when coalesce(total,0) > 0 then cobrado * coalesce(subtotal_sin_isv,0) / total else 0 end as cobrado_sin_isv from vd
),
items as (
  select i.venta_id, i.cantidad, coalesce(i.costo_lps,0) as costo
  from venta_items i join vd on vd.id = i.venta_id
),
tot as (
  select
    count(*)                                    as ventas,
    round(coalesce(sum(total),0),2)             as total,
    round(coalesce(sum(subtotal_sin_isv),0),2)  as sin_isv,
    round(coalesce(sum(cobrado),0),2)           as cobrado,
    round(coalesce(sum(cobrado_sin_isv),0),2)   as cobrado_sin_isv,
    round(coalesce(sum(case when pendiente then saldo_pendiente else 0 end),0),2) as por_cobrar,
    count(*) filter (where pendiente)           as ventas_credito,
    round(coalesce(sum(utilidad_bruta),0),2)    as utilidad,
    round(coalesce(sum(costo),0),2)             as costo
  from vd2
),
it as (
  select coalesce(sum(cantidad),0) as unidades, count(*) as lineas,
         count(*) filter (where costo = 0) as items_sin_costo
  from items
),
cred as (
  select round(coalesce(sum(a.monto),0),2) as cobros_creditos_anteriores,
         count(*) as n_cobros_anteriores
  from venta_abonos a join ventas v on v.id = a.venta_id
  where a.fecha between p_desde and p_hasta and v.fecha < p_desde
),
vend as (
  select vendedor_nombre as vendedor, count(*) as n,
         round(sum(total),2) as total, round(sum(cobrado),2) as cobrado,
         round(sum(utilidad_bruta),2) as utilidad,
         round(sum(case when pendiente then saldo_pendiente else 0 end),2) as por_cobrar
  from vd2 group by 1 order by 3 desc
),
dia as (
  select fecha, count(*) as n, round(sum(total),2) as total
  from vd2 group by 1 order by 1
)
select jsonb_build_object(
  'desde', p_desde, 'hasta', p_hasta,
  'ventas', tot.ventas, 'total', tot.total, 'sin_isv', tot.sin_isv,
  'isv', round(tot.total - tot.sin_isv, 2),
  'cobrado', tot.cobrado, 'cobrado_sin_isv', tot.cobrado_sin_isv,
  'por_cobrar', tot.por_cobrar, 'ventas_credito', tot.ventas_credito,
  'unidades', it.unidades, 'lineas', it.lineas, 'items_sin_costo', it.items_sin_costo,
  'utilidad', tot.utilidad, 'costo', tot.costo,
  'roi_pct', case when tot.costo > 0 then round(tot.utilidad / tot.costo * 100, 1) else null end,
  'cobros_creditos_anteriores', cred.cobros_creditos_anteriores,
  'n_cobros_anteriores', cred.n_cobros_anteriores,
  'por_vendedor', (select coalesce(jsonb_agg(to_jsonb(vend)), '[]'::jsonb) from vend),
  'por_dia', (select coalesce(jsonb_agg(to_jsonb(dia)), '[]'::jsonb) from dia)
)
from tot, it, cred;
$fn$;

revoke all on function public.resumen_ventas_rango(date, date) from public, anon, authenticated;
grant execute on function public.resumen_ventas_rango(date, date) to service_role;

-- La función de un día queda como atajo (misma salida)
create or replace function public.resumen_ventas_dia(p_fecha date)
returns jsonb language sql security definer set search_path = public
as $fn$ select public.resumen_ventas_rango(p_fecha, p_fecha); $fn$;
revoke all on function public.resumen_ventas_dia(date) from public, anon, authenticated;
grant execute on function public.resumen_ventas_dia(date) to service_role;
