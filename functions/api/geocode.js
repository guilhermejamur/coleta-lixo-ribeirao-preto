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

    // 1. Nominatim (OpenStreetMap) — gratuito, sem chave de API
    const resultadosNominatim = await geocodificarNominatim(query, config);
    if (resultadosNominatim.length > 0) {
      return jsonResponse(resultadosNominatim);
    }

    // 2. Fallback: Mapbox
    const resultadosMapbox = await geocodificarMapbox(query, config);
    if (resultadosMapbox.length > 0) {
      return jsonResponse(resultadosMapbox);
    }

    // 3. Fallback final: Google Maps (chave via variável de ambiente)
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
// Geocodificação via Nominatim (OpenStreetMap) — primário, gratuito
// ─────────────────────────────────────────────
async function geocodificarNominatim(query, config) {
  try {
    const cidade = config.cidade;
    // boundingBox no config: "west,north,east,south"
    // Nominatim viewbox espera: "west,south,east,north"
    const [west, north, east, south] = cidade.boundingBox.split(',').map(Number);

    const params = new URLSearchParams({
      q: `${query}, ${cidade.nome}, ${cidade.estado}, Brasil`,
      format: 'json',
      limit: '5',
      countrycodes: 'br',
      bounded: '1',
      viewbox: `${west},${south},${east},${north}`,
      addressdetails: '1',
      'accept-language': 'pt',
    });

    const resp = await fetch(
      `https://nominatim.openstreetmap.org/search?${params}`,
      {
        headers: {
          'User-Agent': `coleta-lixo-${cidade.nome.toLowerCase().replace(/\s+/g, '-')}/1.0`,
          'Accept-Language': 'pt',
        },
      }
    );

    if (!resp.ok) return [];
    const data = await resp.json();
    if (!data?.length) return [];

    const stopWords = new Set([
      'rua', 'avenida', 'av', 'alameda', 'al', 'travessa', 'tv', 'estrada',
      'est', 'praca', 'pc', 'de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o',
      'sp', 'br', 'brasil',
    ]);
    const cidadeNorm = cidade.nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    const palavrasQuery = query
      .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, '').split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w) && !/^\d+$/.test(w) && !cidadeNorm.includes(w));

    return data
      .filter(r => {
        const lat = parseFloat(r.lat);
        const lng = parseFloat(r.lon);
        if (lat < south || lat > north || lng < west || lng > east) return false;

        // Rejeitar resultados cuja rua não tem nenhuma palavra da query
        if (palavrasQuery.length > 0) {
          const addr = r.address || {};
          const rua = (addr.road || addr.pedestrian || r.display_name || '')
            .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          const matches = palavrasQuery.filter(w => rua.includes(w)).length;
          if (matches === 0) return false;
        }

        return true;
      })
      .map(r => {
        const addr = r.address || {};
        return {
          lat: parseFloat(r.lat),
          lon: parseFloat(r.lon),
          display_name: r.display_name,
          address: {
            road: addr.road || addr.pedestrian || '',
            house_number: addr.house_number || '',
            suburb: addr.suburb || addr.neighbourhood || addr.city_district || '',
            city: addr.city || addr.town || addr.municipality || '',
          },
          fonte: 'nominatim',
        };
      });
  } catch {
    return [];
  }
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

  // Palavras significativas da query (ignora tipo de logradouro, preposições e números)
  const stopWords = new Set(['rua', 'avenida', 'av', 'alameda', 'al', 'travessa', 'tv',
    'estrada', 'est', 'praca', 'pc', 'de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o']);
  const queryWords = query
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '').split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w) && !/^\d+$/.test(w));

  return data.features
    .filter(f => {
      // 1. Verifica cidade pelo contexto (evita "Rua Ribeirão Preto" em outra cidade)
      const ctx = f.context || [];
      const cidadeCtx = (ctx.find(c => c.id?.startsWith('place'))?.text || '')
        .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (!cidadeCtx.includes(cidadeNorm)) return false;

      // 2. Palavras significativas da busca que aparecem no nome da rua
      const streetName = (f.text || '')
        .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const matches = queryWords.filter(w => streetName.includes(w)).length;
      // Exige ao menos min(2, total de palavras) para evitar falsos positivos por palavras comuns
      return matches >= Math.min(2, queryWords.length);
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
          suburb: get('locality') || get('neighborhood'),
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
