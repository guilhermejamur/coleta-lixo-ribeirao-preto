/**
 * Cloudflare Pages Function — GET /api/areas
 *
 * Lista todas as áreas de coleta disponíveis.
 * Útil para debug, integração com painéis administrativos
 * e validação dos dados pelo time de TI.
 *
 * Query params opcionais:
 *   ?tipo=seletiva         → apenas coleta seletiva (padrão)
 *   ?tipo=domiciliar       → apenas coleta domiciliar
 *   ?tipo=todos            → ambas as coletas
 *   ?setor=2001            → filtra por setor/apelido (case insensitive)
 */

let _cacheSeletiva = null;
let _cacheDomiciliar = null;

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }

  try {
    const url = new URL(request.url);
    const tipo = url.searchParams.get('tipo') || 'seletiva';
    const filtroSetor = url.searchParams.get('setor')?.toUpperCase() || null;

    const resultado = {};

    if (tipo === 'seletiva' || tipo === 'todos') {
      const data = await carregarGeoJSON('coleta_seletiva', request, env);
      resultado.seletiva = extrairAreas(data, filtroSetor);
    }

    if (tipo === 'domiciliar' || tipo === 'todos') {
      const data = await carregarGeoJSON('coleta_domiciliar', request, env);
      resultado.domiciliar = extrairAreas(data, filtroSetor);
    }

    // Totais
    const totais = {};
    for (const [chave, areas] of Object.entries(resultado)) {
      totais[chave] = areas.length;
    }

    return jsonResponse({
      filtros: { tipo, setor: filtroSetor },
      totais,
      ...resultado,
    });

  } catch (err) {
    console.error('Erro na API /areas:', err);
    return jsonResponse({ erro: 'Erro interno.' }, 500);
  }
}

// ─────────────────────────────────────────────
// Carregar GeoJSON via ASSETS binding
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
// Extrair e formatar áreas (adaptado para Ribeirão Preto)
// ─────────────────────────────────────────────
function extrairAreas(geoData, filtroSetor) {
  if (!geoData?.features?.length) return [];

  return geoData.features
    .filter(f => {
      if (!filtroSetor) return true;
      const apelido = (f.properties.APELIDO || '').toUpperCase();
      const identifica = (f.properties.IDENTIFICA || '').toUpperCase();
      const setor = (f.properties.SETOR || '').toUpperCase();
      return apelido.includes(filtroSetor) || identifica.includes(filtroSetor) || setor.includes(filtroSetor);
    })
    .map(f => {
      const p = f.properties;
      const { dias, turno } = parseFrequencia(p.FREQUENCIA);
      return {
        setor: p.APELIDO || p.IDENTIFICA || null,
        setor_completo: p.SETOR || null,
        macrosetor: p.MACROSETOR || null,
        frequencia_raw: p.FREQUENCIA || null,
        frequencia: dias,
        turno: turno,
      };
    });
}

/**
 * Extrai turno e dias da FREQUENCIA.
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
