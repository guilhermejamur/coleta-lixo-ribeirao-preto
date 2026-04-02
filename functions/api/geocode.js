/**
 * Cloudflare Pages Function — GET /api/geocode
 *
 * Geocodifica um endereço usando Mapbox primeiro,
 * com fallback automático para Google Maps quando não há resultados.
 *
 * A chave do Google Maps NUNCA aparece no frontend — ela é lida exclusivamente
 * da variável de ambiente GOOGLE_MAPS_KEY configurada no Cloudflare Pages.
 *
 * Parâmetros:
 *   ?q=Rua+Claudio+Urenha+Gomes+222   → texto de busca
 *
 * Resposta (array, mesmo formato que o autocomplete do frontend espera):
 * [
 *   {
 *     "lat": -21.20,
 *     "lon": -47.83,
 *     "display_name": "Rua Cláudio Urenha Gomes, 222, Jardim Regatas, ...",
 *     "address": { "road": "...", "house_number": "...", "suburb": "...", "city": "..." },
 *     "fonte": "mapbox" | "google"
 *   }
 * ]
 */

let _cacheConfig = null;

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }

  if (request.method !== 'GET') {
    return jsonResponse({ erro: 'Método não permitido. Use GET.' }, 405);
  }

  const url = new URL(request.url);
  const query = url.searchParams.get('q')?.trim();

  if (!query || query.length < 3) {
    return jsonResponse({ erro: 'Parâmetro q obrigatório (mínimo 3 caracteres).' }, 400);
  }

  try {
    const config = await carregarConfig(request, env);

    // 1. Tentar Mapbox
    const resultadosMapbox = await geocodificarMapbox(query, config);
    if (resultadosMapbox.length > 0) {
      return jsonResponse(resultadosMapbox);
    }

    // 2. Fallback: Google Maps (chave via variável de ambiente)
    if (env.GOOGLE_MAPS_KEY) {
      const resultadosGoogle = await geocodificarGoogle(query, config, env.GOOGLE_MAPS_KEY);
      return jsonResponse(resultadosGoogle);
    }

    return jsonResponse([]);

  } catch (err) {
    console.error('Erro em /api/geocode:', err);
    return jsonResponse({ erro: 'Erro interno. Tente novamente.' }, 500);
  }
}

// ─────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────
async function carregarConfig(request, env) {
  if (_cacheConfig) return _cacheConfig;
  const assetUrl = new URL('/config.json', request.url);
  const resp = await env.ASSETS.fetch(new Request(assetUrl));
  _cacheConfig = await resp.json();
  return _cacheConfig;
}

// ─────────────────────────────────────────────
// Geocodificação via Mapbox
// ─────────────────────────────────────────────
async function geocodificarMapbox(query, config) {
  const token = config.mapboxToken;
  const [lat, lon] = config.cidade?.coordenadas || [];

  // config.cidade.boundingBox: "west,north,east,south"
  // Mapbox bbox espera:         "west,south,east,north"
  const bb = config.cidade?.boundingBox?.split(',') || [];
  const bbox = bb.length === 4 ? `${bb[0]},${bb[3]},${bb[2]},${bb[1]}` : '';

  const params = new URLSearchParams({
    access_token: token,
    country: 'BR',
    types: 'address',
    language: 'pt',
    limit: '5',
    ...(lon && lat ? { proximity: `${lon},${lat}` } : {}),
    ...(bbox ? { bbox } : {}),
  });

  const resp = await fetch(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?${params}`,
    { headers: { 'Referer': 'https://coleta-lixo-ribeirao-preto.pages.dev' } }
  );

  const data = await resp.json();
  if (!data.features?.length) return [];

  const cidadeNorm = config.cidade.nome
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  return data.features
    .filter(f => {
      // Verifica a cidade no contexto (campo "place"), não no nome completo da rua,
      // evitando falsos positivos como "Rua Ribeirão Preto" em outra cidade.
      const ctx = f.context || [];
      const cidadeCtx = (ctx.find(c => c.id?.startsWith('place'))?.text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      return cidadeCtx.includes(cidadeNorm);
    })
    .map(f => {
      const ctx = f.context || [];
      const get = prefix => ctx.find(c => c.id?.startsWith(prefix))?.text || '';
      return {
        lat: f.center[1],
        lon: f.center[0],
        display_name: f.place_name,
        address: {
          road: f.text || '',
          house_number: f.address || '',
          suburb: get('neighborhood') || get('locality'),
          city: get('place'),
        },
        fonte: 'mapbox',
      };
    });
}

// ─────────────────────────────────────────────
// Geocodificação via Google Maps (fallback)
// A chave é lida de env.GOOGLE_MAPS_KEY — nunca exposta ao cliente.
// ─────────────────────────────────────────────
async function geocodificarGoogle(query, config, apiKey) {
  const cidade = config.cidade;
  const [west, north, east, south] = cidade.boundingBox.split(',').map(Number);

  const params = new URLSearchParams({
    address: `${query}, ${cidade.nome}, SP, Brasil`,
    key: apiKey,
    language: 'pt',
    region: 'br',
    components: 'country:BR',
  });

  const resp = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?${params}`
  );
  const data = await resp.json();

  if (data.status !== 'OK' || !data.results?.length) return [];

  const getComp = (components, type) =>
    components.find(c => c.types.includes(type))?.long_name || '';

  return data.results
    .filter(r => {
      const { lat, lng } = r.geometry.location;
      return lat >= south && lat <= north && lng >= west && lng <= east;
    })
    .map(r => {
      const comps = r.address_components || [];
      return {
        lat: r.geometry.location.lat,
        lon: r.geometry.location.lng,
        display_name: r.formatted_address,
        address: {
          road: getComp(comps, 'route'),
          house_number: getComp(comps, 'street_number'),
          suburb: getComp(comps, 'sublocality_level_1') || getComp(comps, 'sublocality'),
          city: getComp(comps, 'administrative_area_level_2'),
        },
        fonte: 'google',
      };
    });
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
