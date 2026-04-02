/**
 * Cloudflare Pages Function — GET /api/coleta
 *
 * Parâmetros aceitos (via query string):
 *   ?lat=-21.17&lng=-47.81         → coordenadas diretas
 *   ?endereco=Rua+Exemplo+700      → geocodifica e busca a área
 *
 * Resposta JSON:
 * {
 *   "coordenadas": { "lat": -21.17, "lng": -47.81 },
 *   "encontrado": true,
 *   "seletiva": { ... },
 *   "domiciliar": { ... }
 * }
 */

// Cache em memória por isolate (reutilizado entre requests no mesmo Worker)
let _cacheSeletiva = null;
let _cacheDomiciliar = null;
let _cacheConfig = null;

export async function onRequest(context) {
  const { request, env } = context;

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }

  if (request.method !== 'GET') {
    return jsonResponse({ erro: 'Método não permitido. Use GET.' }, 405);
  }

  try {
    const url = new URL(request.url);
    const latParam = url.searchParams.get('lat');
    const lngParam = url.searchParams.get('lng');
    const enderecoParam = url.searchParams.get('endereco');

    let finalLat, finalLng, enderecoUsado;

    // --- Coordenadas diretas ---
    if (latParam && lngParam) {
      finalLat = parseFloat(latParam);
      finalLng = parseFloat(lngParam);
      enderecoUsado = null;

      if (isNaN(finalLat) || isNaN(finalLng)) {
        return jsonResponse({ erro: 'Coordenadas inválidas.' }, 400);
      }

    // --- Geocodificação por endereço ---
    } else if (enderecoParam) {
      const config = await carregarConfig(request, env);
      const geocoded = await geocodificar(enderecoParam, config, env);

      if (!geocoded) {
        return jsonResponse({
          erro: 'Endereço não encontrado.',
          dica: 'Tente incluir cidade e estado. Ex: Rua Américo Brasiliense 700 Ribeirão Preto SP'
        }, 404);
      }

      finalLat = geocoded.lat;
      finalLng = geocoded.lng;
      enderecoUsado = geocoded.display_name;

    } else {
      return jsonResponse({
        erro: 'Parâmetros obrigatórios ausentes.',
        uso: [
          'GET /api/coleta?lat=-21.17&lng=-47.81',
          'GET /api/coleta?endereco=Rua+Américo+Brasiliense+700+Ribeirão+Preto'
        ]
      }, 400);
    }

    // --- Carregar GeoJSON ---
    const [seletiva, domiciliar] = await Promise.all([
      carregarGeoJSON('coleta_seletiva', request, env),
      carregarGeoJSON('coleta_domiciliar', request, env),
    ]);

    // --- Point-in-polygon ---
    const infoSeletiva = encontrarArea(finalLng, finalLat, seletiva);
    const infoDomiciliar = encontrarArea(finalLng, finalLat, domiciliar);
    const encontrado = !!(infoSeletiva || infoDomiciliar);

    const resposta = {
      coordenadas: { lat: finalLat, lng: finalLng },
      ...(enderecoUsado && { endereco: enderecoUsado }),
      encontrado,
      seletiva: infoSeletiva ? formatarColeta(infoSeletiva) : null,
      domiciliar: infoDomiciliar ? formatarColeta(infoDomiciliar) : null,
      ...(encontrado
        ? {}
        : { mensagem: 'Localização fora da área de cobertura do serviço.' }
      ),
    };

    return jsonResponse(resposta, 200);

  } catch (err) {
    console.error('Erro na API /coleta:', err);
    return jsonResponse({ erro: 'Erro interno. Tente novamente.' }, 500);
  }
}

// ─────────────────────────────────────────────
// Carregar e cachear GeoJSON via ASSETS binding
// ─────────────────────────────────────────────
async function carregarGeoJSON(nome, request, env) {
  if (nome === 'coleta_seletiva' && _cacheSeletiva) return _cacheSeletiva;
  if (nome === 'coleta_domiciliar' && _cacheDomiciliar) return _cacheDomiciliar;

  try {
    const assetUrl = new URL(`/data/${nome}.geojson`, request.url);
    const resp = await env.ASSETS.fetch(new Request(assetUrl));

    if (!resp.ok) return { features: [] };

    const data = await resp.json();

    if (nome === 'coleta_seletiva') _cacheSeletiva = data;
    if (nome === 'coleta_domiciliar') _cacheDomiciliar = data;

    return data;
  } catch {
    return { features: [] };
  }
}

// ─────────────────────────────────────────────
// Carregar config.json via ASSETS
// ─────────────────────────────────────────────
async function carregarConfig(request, env) {
  if (_cacheConfig) return _cacheConfig;

  const assetUrl = new URL('/config.json', request.url);
  const resp = await env.ASSETS.fetch(new Request(assetUrl));
  _cacheConfig = await resp.json();
  return _cacheConfig;
}

// ─────────────────────────────────────────────
// Geocodificação: Mapbox com fallback para Google Maps
// A chave do Google é lida de env.GOOGLE_MAPS_KEY — nunca exposta ao cliente.
// ─────────────────────────────────────────────
async function geocodificar(endereco, config, env) {
  // 1. Tentar Mapbox
  const resultMapbox = await geocodificarMapbox(endereco, config);
  if (resultMapbox) return resultMapbox;

  // 2. Fallback: Google Maps
  if (env.GOOGLE_MAPS_KEY) {
    return await geocodificarGoogle(endereco, config, env.GOOGLE_MAPS_KEY);
  }

  return null;
}

async function geocodificarMapbox(endereco, config) {
  const token = config.mapboxToken;
  const bb = config.cidade?.boundingBox?.split(',') || [];
  const bbox = bb.length === 4 ? `${bb[0]},${bb[3]},${bb[2]},${bb[1]}` : '';
  const [lat, lon] = config.cidade?.coordenadas || [];

  const params = new URLSearchParams({
    access_token: token,
    country: 'BR',
    types: 'address',
    language: 'pt',
    limit: '1',
    ...(lon && lat ? { proximity: `${lon},${lat}` } : {}),
    ...(bbox ? { bbox } : {}),
  });

  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(endereco)}.json?${params}`;
  const resp = await fetch(url, {
    headers: { 'Referer': 'https://coleta-lixo-ribeirao-preto.pages.dev' },
  });

  const data = await resp.json();
  if (!data.features?.length) return null;

  const feature = data.features[0];
  return {
    lat: feature.center[1],
    lng: feature.center[0],
    display_name: feature.place_name,
  };
}

async function geocodificarGoogle(endereco, config, apiKey) {
  const cidade = config.cidade;
  const [west, north, east, south] = cidade.boundingBox.split(',').map(Number);

  const params = new URLSearchParams({
    address: `${endereco}, ${cidade.nome}, SP, Brasil`,
    key: apiKey,
    language: 'pt',
    region: 'br',
    components: 'country:BR',
  });

  const resp = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?${params}`
  );
  const data = await resp.json();

  if (data.status !== 'OK' || !data.results?.length) return null;

  const getComp = (components, type) =>
    components.find(c => c.types.includes(type))?.long_name || '';

  const result = data.results.find(r => {
    const { lat, lng } = r.geometry.location;
    return lat >= south && lat <= north && lng >= west && lng <= east;
  });

  if (!result) return null;

  return {
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    display_name: result.formatted_address,
  };
}

// ─────────────────────────────────────────────
// Point-in-polygon (Ray Casting)
// ─────────────────────────────────────────────
function encontrarArea(lng, lat, geoData) {
  if (!geoData?.features?.length) return null;
  for (const feature of geoData.features) {
    if (pontoEmPoligono([lng, lat], feature.geometry)) {
      return feature.properties;
    }
  }
  return null;
}

function pontoEmPoligono(ponto, geometria) {
  if (!geometria) return false;
  const grupos =
    geometria.type === 'Polygon' ? [geometria.coordinates] :
    geometria.type === 'MultiPolygon' ? geometria.coordinates : [];

  for (const poligono of grupos) {
    for (const anel of poligono) {
      if (rayCasting(ponto, anel)) return true;
    }
  }
  return false;
}

function rayCasting([x, y], poligono) {
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const [xi, yi] = poligono[i];
    const [xj, yj] = poligono[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      dentro = !dentro;
    }
  }
  return dentro;
}

// ─────────────────────────────────────────────
// Formatadores (adaptados para Ribeirão Preto)
// ─────────────────────────────────────────────

/**
 * Extrai turno e dias da FREQUENCIA.
 * Formatos possíveis:
 *   Seletiva:   "SEGUNDA-FEIRA DIURNO", "SABADO NOTURNO"
 *   Domiciliar: "SEG/QUA/SEX - DIURNO", "TER/QUI/SAB - NOTURNO"
 */
function parseFrequencia(valor) {
  if (!valor) return { dias: null, turno: null };

  const turnos = ['DIURNO', 'NOTURNO', 'VESPERTINO'];
  let turno = null;
  let dias = valor;

  for (const t of turnos) {
    if (valor.toUpperCase().includes(t)) {
      turno = t;
      dias = valor.replace(new RegExp(`\\s*-?\\s*${t}`, 'i'), '').trim();
      break;
    }
  }

  return { dias, turno };
}

function formatarColeta(props) {
  const freq = props.FREQUENCIA || props.frequencia || null;
  const { dias, turno } = parseFrequencia(freq);

  return {
    setor: props.APELIDO || props.IDENTIFICA || null,
    setor_completo: props.SETOR || null,
    macrosetor: props.MACROSETOR || null,
    frequencia_raw: freq,
    frequencia: formatarFrequencia(dias),
    turno: formatarTurno(turno),
  };
}

function formatarFrequencia(valor) {
  if (!valor) return null;
  // Substituir formas longas primeiro para evitar conflito com abreviações
  return valor
    .replace(/SEGUNDA-FEIRA/gi, 'Segunda-feira')
    .replace(/TERCA-FEIRA/gi, 'Terça-feira')
    .replace(/QUARTA-FEIRA/gi, 'Quarta-feira')
    .replace(/QUINTA-FEIRA/gi, 'Quinta-feira')
    .replace(/SEXTA-FEIRA/gi, 'Sexta-feira')
    .replace(/SABADO/gi, 'Sábado')
    .replace(/DOMINGO/gi, 'Domingo')
    .replace(/SEG/g, 'Segunda')
    .replace(/TER/g, 'Terça')
    .replace(/QUA/g, 'Quarta')
    .replace(/QUI/g, 'Quinta')
    .replace(/SEX/g, 'Sexta')
    .replace(/SAB/g, 'Sábado')
    .replace(/DOM/g, 'Domingo')
    .replace(/\//g, ' / ');
}

function formatarTurno(valor) {
  if (!valor) return null;
  const mapa = { DIURNO: 'Diurno (manhã)', VESPERTINO: 'Vespertino (tarde)', NOTURNO: 'Noturno' };
  return mapa[valor?.toUpperCase()] || valor;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(),
    },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
