CREATE OR REPLACE FUNCTION public.save_venta(p_user text, p_venta jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_id text;
  item  jsonb;
  abono jsonb;
  v_saldo numeric;
  v_es_parcial boolean;
  v_fliq date;
BEGIN
  PERFORM set_config('app.user_id', p_user, true);
  v_id := p_venta->>'id';
  v_saldo := COALESCE((p_venta->>'saldo_pendiente')::numeric, 0);
  v_es_parcial := COALESCE(p_venta->>'metodo_pago', '') = 'parcial';
  -- Fecha de liquidación = fecha del último abono (si queda saldada); si se cambia la fecha del abono, se mueve con él
  IF v_es_parcial AND v_saldo = 0 THEN
    SELECT max(NULLIF(a->>'fecha', '')::date) INTO v_fliq
      FROM jsonb_array_elements(COALESCE(p_venta->'abonos', '[]'::jsonb)) a;
    v_fliq := COALESCE(v_fliq, (now() AT TIME ZONE 'America/Tegucigalpa')::date);
  END IF;

  INSERT INTO public.ventas (
    id, fecha, cliente_id, cliente_nombre, cliente_ciudad, cliente_tel,
    vendedor_id, vendedor_nombre, envio,
    subtotal_sin_isv, total_isv, total,
    descuento, descuento_tipo, descuento_valor,
    utilidad_bruta, pct_comision, comision,
    observaciones, maps_link, saldo_pendiente,
    fecha_registro, registrado_por,
    metodo_pago, metodo_pago_label, metodo_pago_obs,
    metodo_envio, promesa_pago, tipo_venta, estado, nota,
    fecha_liquidada
  ) VALUES (
    v_id,
    (p_venta->>'fecha')::date,
    NULLIF(p_venta->>'cliente_id', ''),
    p_venta->>'cliente_nombre',
    p_venta->>'cliente_ciudad',
    p_venta->>'cliente_tel',
    p_venta->>'vendedor_id',
    p_venta->>'vendedor_nombre',
    COALESCE((p_venta->>'envio')::numeric, 0),
    COALESCE((p_venta->>'subtotal_sin_isv')::numeric, 0),
    COALESCE((p_venta->>'total_isv')::numeric, 0),
    COALESCE((p_venta->>'total')::numeric, 0),
    COALESCE((p_venta->>'descuento')::numeric, 0),
    COALESCE(p_venta->>'descuento_tipo', '%'),
    COALESCE((p_venta->>'descuento_valor')::numeric, 0),
    COALESCE((p_venta->>'utilidad_bruta')::numeric, 0),
    COALESCE((p_venta->>'pct_comision')::numeric, 0),
    COALESCE((p_venta->>'comision')::numeric, 0),
    COALESCE(p_venta->>'observaciones', ''),
    COALESCE(p_venta->>'maps_link', ''),
    v_saldo,
    COALESCE((p_venta->>'fecha_registro')::timestamptz, now()),
    COALESCE(p_venta->>'registrado_por', ''),
    COALESCE(p_venta->>'metodo_pago', ''),
    COALESCE(p_venta->>'metodo_pago_label', ''),
    COALESCE(p_venta->>'metodo_pago_obs', ''),
    COALESCE(p_venta->>'metodo_envio', ''),
    NULLIF(p_venta->>'promesa_pago', '')::date,
    COALESCE(p_venta->>'tipo_venta', 'formal'),
    COALESCE(p_venta->>'estado', 'completada'),
    COALESCE(p_venta->>'nota', ''),
    v_fliq
  )
  ON CONFLICT (id) DO UPDATE SET
    fecha             = EXCLUDED.fecha,
    cliente_id        = EXCLUDED.cliente_id,
    cliente_nombre    = EXCLUDED.cliente_nombre,
    cliente_ciudad    = EXCLUDED.cliente_ciudad,
    cliente_tel       = EXCLUDED.cliente_tel,
    vendedor_id       = EXCLUDED.vendedor_id,
    vendedor_nombre   = EXCLUDED.vendedor_nombre,
    envio             = EXCLUDED.envio,
    subtotal_sin_isv  = EXCLUDED.subtotal_sin_isv,
    total_isv         = EXCLUDED.total_isv,
    total             = EXCLUDED.total,
    descuento         = EXCLUDED.descuento,
    descuento_tipo    = EXCLUDED.descuento_tipo,
    descuento_valor   = EXCLUDED.descuento_valor,
    utilidad_bruta    = EXCLUDED.utilidad_bruta,
    pct_comision      = EXCLUDED.pct_comision,
    comision          = EXCLUDED.comision,
    observaciones     = EXCLUDED.observaciones,
    maps_link         = EXCLUDED.maps_link,
    saldo_pendiente   = EXCLUDED.saldo_pendiente,
    fecha_registro    = COALESCE(ventas.fecha_registro, EXCLUDED.fecha_registro), -- editar no cambia la fecha de ingreso
    registrado_por    = EXCLUDED.registrado_por,
    metodo_pago       = EXCLUDED.metodo_pago,
    metodo_pago_label = EXCLUDED.metodo_pago_label,
    metodo_pago_obs   = EXCLUDED.metodo_pago_obs,
    metodo_envio      = EXCLUDED.metodo_envio,
    promesa_pago      = EXCLUDED.promesa_pago,
    tipo_venta        = EXCLUDED.tipo_venta,
    estado            = EXCLUDED.estado,
    nota              = EXCLUDED.nota,
    fecha_liquidada   = v_fliq;

  DELETE FROM public.venta_items WHERE venta_id = v_id;

  FOR item IN SELECT * FROM jsonb_array_elements(p_venta->'items')
  LOOP
    INSERT INTO public.venta_items
      (venta_id, sku, nombre, cantidad, precio_final, lleva_isv, isv_pct, costo_lps, producto_id)
    VALUES (
      v_id,
      COALESCE(item->>'sku', ''),
      COALESCE(item->>'nombre', ''),
      COALESCE((item->>'cantidad')::numeric, 1),
      COALESCE((item->>'precio_final')::numeric, 0),
      COALESCE((item->>'lleva_isv')::boolean, false),
      COALESCE((item->>'isv_pct')::numeric, 0),
      COALESCE((item->>'costo_lps')::numeric, 0),
      NULLIF(item->>'producto_id', '')
    );
  END LOOP;

  DELETE FROM public.venta_abonos WHERE venta_id = v_id;

  FOR abono IN SELECT * FROM jsonb_array_elements(p_venta->'abonos')
  LOOP
    INSERT INTO public.venta_abonos
      (id, venta_id, monto, fecha, nota, registrado_por)
    VALUES (
      COALESCE(NULLIF(abono->>'_id', ''), 'ab_' || extract(epoch from now())::bigint::text || '_' || floor(random()*99999)::text),
      v_id,
      COALESCE((abono->>'monto')::numeric, 0),
      NULLIF(abono->>'fecha', '')::date,
      COALESCE(abono->>'nota', ''),
      COALESCE(abono->>'registrado_por', '')
    );
  END LOOP;

END;
$function$
