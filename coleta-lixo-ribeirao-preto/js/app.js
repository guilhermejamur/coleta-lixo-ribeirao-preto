// ===== VARIÁVEIS GLOBAIS =====
let config = null;
let geoDataSeletiva = null;
let geoDataDomiciliar = null;
let map = null;
let userMarker = null;
let currentTimeout = null;

// ===== INICIALIZAÇÃO =====
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await carregarConfig();
        aplicarConfig();
        setupEventListeners();
        await carregarGeoJSON();
    } catch (error) {
        console.error('Erro na inicialização:', error);
        mostrarToast('Erro ao carregar configurações. Recarregue a página.');
    }
});

// ===== CARREGAR CONFIGURAÇÃO =====
async function carregarConfig() {
    const response = await fetch('config.json');
    if (!response.ok) throw new Error('Falha ao carregar config.json');
    config = await response.json();
}

// ===== APLICAR CONFIGURAÇÃO =====
function aplicarConfig() {
    // Cores
    const root = document.documentElement;
    root.style.setProperty('--cor-primaria', config.cores.primaria);
    root.style.setProperty('--cor-secundaria', config.cores.secundaria);
    root.style.setProperty('--cor-fundo', config.cores.fundo);
    root.style.setProperty('--cor-texto', config.cores.texto);
    root.style.setProperty('--cor-texto-claro', config.cores.textoClaro);
    root.style.setProperty('--cor-cartao', config.cores.cartao);
    root.style.setProperty('--cor-borda', config.cores.borda);
    root.style.setProperty('--cor-destaque', config.cores.destaque);
    
    // Logos
    document.getElementById('logo-empresa').src = config.logos.empresa;
    
    // Textos
    document.getElementById('titulo-principal').textContent = `Coleta de Lixo - ${config.cidade.nome}`;
    document.getElementById('subtitulo').textContent = config.textos.subtitulo;
    document.getElementById('endereco-input').placeholder = config.textos.placeholder;
    
    // Footer
    document.getElementById('footer-empresa').textContent = config.textos.rodape.empresa;
    
    // Título da página
    document.title = `Coleta de Lixo - ${config.cidade.nome}`;
    
    // FAQs
    renderizarFAQs();
}

// ===== RENDERIZAR FAQs =====
function renderizarFAQs() {
    const container = document.getElementById('faq-container');
    container.innerHTML = '';
    
    config.faqs.forEach((faq, index) => {
        const item = document.createElement('div');
        item.className = 'faq-item';
        item.innerHTML = `
            <button class="faq-pergunta" data-index="${index}">
                <span>${faq.pergunta}</span>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
            </button>
            <div class="faq-resposta">
                <p class="faq-resposta-content">${faq.resposta}</p>
            </div>
        `;
        container.appendChild(item);
    });
    
    // Event listeners para accordion
    container.querySelectorAll('.faq-pergunta').forEach(btn => {
        btn.addEventListener('click', () => {
            const item = btn.closest('.faq-item');
            const wasActive = item.classList.contains('active');
            
            // Fecha todos
            container.querySelectorAll('.faq-item').forEach(i => i.classList.remove('active'));
            
            // Abre o clicado (se não estava ativo)
            if (!wasActive) {
                item.classList.add('active');
            }
        });
    });
}

// ===== CARREGAR GeoJSON =====
async function carregarGeoJSON() {
    try {
        // Coleta Seletiva
        if (config.arquivosGeoJSON.coletaSeletiva) {
            const respSeletiva = await fetch(config.arquivosGeoJSON.coletaSeletiva);
            if (respSeletiva.ok) {
                geoDataSeletiva = await respSeletiva.json();
            }
        }
        
        // Coleta Domiciliar
        if (config.arquivosGeoJSON.coletaDomiciliar) {
            const respDomiciliar = await fetch(config.arquivosGeoJSON.coletaDomiciliar);
            if (respDomiciliar.ok) {
                geoDataDomiciliar = await respDomiciliar.json();
            }
        }
    } catch (error) {
        console.warn('Alguns arquivos GeoJSON não foram carregados:', error);
    }
}

// ===== EVENT LISTENERS =====
function setupEventListeners() {
    const input = document.getElementById('endereco-input');
    const btnLimpar = document.getElementById('btn-limpar');
    const btnLocalizacao = document.getElementById('btn-localizacao');
    
    // Input de endereço
    input.addEventListener('input', (e) => {
        const valor = e.target.value.trim();
        btnLimpar.style.display = valor ? 'flex' : 'none';
        
        // Debounce para busca
        clearTimeout(currentTimeout);
        if (valor.length >= 3) {
            currentTimeout = setTimeout(() => buscarEndereco(valor), 300);
        } else {
            limparAutocomplete();
        }
    });
    
    // Teclas de navegação
    input.addEventListener('keydown', (e) => {
        const lista = document.getElementById('autocomplete-list');
        const itens = lista.querySelectorAll('.autocomplete-item');
        const ativo = lista.querySelector('.autocomplete-item.active');
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!ativo && itens.length) {
                itens[0].classList.add('active');
            } else if (ativo && ativo.nextElementSibling) {
                ativo.classList.remove('active');
                ativo.nextElementSibling.classList.add('active');
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (ativo && ativo.previousElementSibling) {
                ativo.classList.remove('active');
                ativo.previousElementSibling.classList.add('active');
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (ativo) {
                ativo.click();
            }
        } else if (e.key === 'Escape') {
            limparAutocomplete();
        }
    });
    
    // Botão limpar
    btnLimpar.addEventListener('click', () => {
        input.value = '';
        btnLimpar.style.display = 'none';
        limparAutocomplete();
        esconderResultados();
    });
    
    // Botão geolocalização
    btnLocalizacao.addEventListener('click', usarGeolocalizacao);
    
    // Fechar autocomplete ao clicar fora
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-container')) {
            limparAutocomplete();
        }
    });
}

// ===== BUSCAR ENDEREÇO (Mapbox) =====
async function buscarEndereco(query) {
    try {
        const [lat, lon] = config.cidade.coordenadas;

        // config.cidade.boundingBox: min_lon,max_lat,max_lon,min_lat (formato Nominatim)
        // Mapbox bbox: min_lon,min_lat,max_lon,max_lat
        const [west, north, east, south] = config.cidade.boundingBox.split(',').map(Number);
        const bbox = `${west},${south},${east},${north}`;

        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${config.mapboxToken}&country=BR&proximity=${lon},${lat}&bbox=${bbox}&types=address,place&language=pt&limit=10`;

        const response = await fetch(url);
        const data = await response.json();
        const numeroDigitado = extrairNumeroDoTexto(query);

        const cidadeNorm = config.cidade.nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        const resultados = (data.features || [])
            .filter(feature => {
                const placeName = (feature.place_name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                return placeName.includes(cidadeNorm);
            })
            .map(feature => ({
                lat: feature.center[1],
                lon: feature.center[0],
                display_name: feature.place_name,
                address: extrairEnderecoMapbox(feature)
            }));

        mostrarAutocomplete(resultados, numeroDigitado);
    } catch (error) {
        console.error('Erro na busca:', error);
    }
}

// ===== EXTRAIR ENDEREÇO DO RESULTADO MAPBOX =====
function extrairEnderecoMapbox(feature) {
    const context = feature.context || [];
    const address = {};

    if (feature.text) address.road = feature.text;
    if (feature.address) address.house_number = feature.address;

    context.forEach(item => {
        if (item.id.startsWith('neighborhood')) address.suburb = item.text;
        else if (item.id.startsWith('locality')) address.suburb = address.suburb || item.text;
        else if (item.id.startsWith('place')) address.city = item.text;
        else if (item.id.startsWith('district')) address.district = item.text;
    });

    return address;
}

// ===== EXTRAIR NÚMERO DO TEXTO =====
function extrairNumeroDoTexto(texto) {
    // Procura por padrões como "123", ", 123", "nº 123", "n 123", "numero 123"
    const match = texto.match(/[,\s]+(\d+)[\s]*$|[,\s]+n[º°]?\s*(\d+)|numero\s*(\d+)/i);
    if (match) {
        return match[1] || match[2] || match[3];
    }
    // Procura por número isolado no final
    const matchFinal = texto.match(/\s(\d+)\s*$/);
    if (matchFinal) {
        return matchFinal[1];
    }
    return null;
}

// ===== MOSTRAR AUTOCOMPLETE =====
function mostrarAutocomplete(resultados, numeroDigitado = null) {
    const lista = document.getElementById('autocomplete-list');
    lista.innerHTML = '';
    
    if (!resultados.length) {
        lista.innerHTML = '<li class="autocomplete-item" style="cursor: default; color: var(--cor-texto-claro);">Nenhum endereço encontrado</li>';
        return;
    }
    
    resultados.forEach(item => {
        const li = document.createElement('li');
        li.className = 'autocomplete-item';
        // Exibir endereço formatado curto na lista, passando o número digitado
        li.textContent = formatarEnderecoExibicao(item, numeroDigitado);
        li.addEventListener('click', () => selecionarEndereco(item, numeroDigitado));
        lista.appendChild(li);
    });
}

// ===== LIMPAR AUTOCOMPLETE =====
function limparAutocomplete() {
    document.getElementById('autocomplete-list').innerHTML = '';
}

// ===== SELECIONAR ENDEREÇO =====
async function selecionarEndereco(item, numeroDigitado = null) {
    const lat = parseFloat(item.lat);
    const lon = parseFloat(item.lon);
    
    // Formatar endereço curto
    const endereco = formatarEnderecoExibicao(item, numeroDigitado);
    
    document.getElementById('endereco-input').value = endereco;
    limparAutocomplete();
    
    await processarLocalizacao(lat, lon, endereco);
}

// ===== FORMATAR ENDEREÇO PARA EXIBIÇÃO =====
function formatarEnderecoExibicao(item, numeroDigitado = null) {
    const address = item.address || {};
    
    // Montar endereço curto: Rua, Número - Bairro, Cidade
    let partes = [];
    
    // Rua
    const rua = address.road || address.street || address.pedestrian || address.footway || '';
    if (rua) partes.push(rua);
    
    // Número - usar o digitado pelo usuário ou o retornado pela API
    const numero = numeroDigitado || address.house_number || '';
    if (numero && partes.length > 0) {
        partes[0] = partes[0] + ', ' + numero;
    }
    
    // Bairro
    const bairro = address.suburb || address.neighbourhood || address.district || '';
    if (bairro) partes.push(bairro);
    
    // Cidade
    const cidade = address.city || address.town || address.municipality || config.cidade.nome;
    if (cidade) partes.push(cidade);
    
    // Se não conseguiu montar, usa display_name simplificado
    if (partes.length === 0) {
        return item.display_name
            .split(',')
            .slice(0, 3)
            .join(',')
            .trim();
    }
    
    return partes.join(' - ');
}

// ===== USAR GEOLOCALIZAÇÃO =====
function usarGeolocalizacao() {
    if (!navigator.geolocation) {
        mostrarToast('Geolocalização não suportada pelo navegador.');
        return;
    }
    
    mostrarLoading(true);
    
    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            
            // Reverse geocoding para pegar o endereço
            try {
                const response = await fetch(
                    `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json?access_token=${config.mapboxToken}&language=pt&types=address`
                );
                const data = await response.json();

                let endereco = 'Sua localização';
                if (data.features && data.features.length > 0) {
                    const feature = data.features[0];
                    const addressData = extrairEnderecoMapbox(feature);
                    endereco = formatarEnderecoExibicao({ address: addressData }, null);
                }

                document.getElementById('endereco-input').value = endereco;
                document.getElementById('btn-limpar').style.display = 'flex';

                await processarLocalizacao(lat, lon, endereco);
            } catch (error) {
                mostrarLoading(false);
                mostrarToast('Erro ao obter endereço da localização.');
            }
        },
        (error) => {
            mostrarLoading(false);
            let msg = 'Erro ao obter localização.';
            if (error.code === 1) msg = 'Permissão de localização negada.';
            else if (error.code === 2) msg = 'Localização indisponível.';
            else if (error.code === 3) msg = 'Tempo esgotado ao obter localização.';
            mostrarToast(msg);
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

// ===== PROCESSAR LOCALIZAÇÃO =====
async function processarLocalizacao(lat, lon, endereco) {
    mostrarLoading(true);
    
    // Buscar informações nas áreas
    const infoSeletiva = encontrarAreaNoGeoJSON(lat, lon, geoDataSeletiva);
    const infoDomiciliar = encontrarAreaNoGeoJSON(lat, lon, geoDataDomiciliar);
    
    // Atualizar UI
    atualizarResultados(infoSeletiva, infoDomiciliar, endereco);
    atualizarMapa(lat, lon, infoSeletiva, infoDomiciliar);
    
    mostrarLoading(false);
    
    // Scroll para resultados
    document.getElementById('resultados').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ===== ENCONTRAR ÁREA NO GeoJSON =====
function encontrarAreaNoGeoJSON(lat, lon, geoData) {
    if (!geoData || !geoData.features) return null;
    
    const ponto = [lon, lat]; // GeoJSON usa [lon, lat]
    
    for (const feature of geoData.features) {
        if (pontoEmPoligono(ponto, feature.geometry)) {
            return feature.properties;
        }
    }
    
    return null;
}

// ===== PONTO EM POLÍGONO (Ray Casting) =====
function pontoEmPoligono(ponto, geometria) {
    if (!geometria) return false;
    
    let coordenadas = [];
    
    if (geometria.type === 'Polygon') {
        coordenadas = [geometria.coordinates];
    } else if (geometria.type === 'MultiPolygon') {
        coordenadas = geometria.coordinates;
    } else {
        return false;
    }
    
    for (const poligono of coordenadas) {
        for (const anel of poligono) {
            if (rayCasting(ponto, anel)) {
                return true;
            }
        }
    }
    
    return false;
}

function rayCasting(ponto, poligono) {
    const [x, y] = ponto;
    let dentro = false;
    
    for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
        const [xi, yi] = poligono[i];
        const [xj, yj] = poligono[j];
        
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
            dentro = !dentro;
        }
    }
    
    return dentro;
}

// ===== ATUALIZAR RESULTADOS =====
function atualizarResultados(infoSeletiva, infoDomiciliar, endereco) {
    // Mostrar seção
    document.getElementById('resultados').style.display = 'block';
    document.getElementById('mapa-section').style.display = 'block';
    
    // Endereço
    document.getElementById('endereco-encontrado').textContent = endereco;
    
    // Coleta Seletiva
    if (infoSeletiva) {
        const freqSeletiva = infoSeletiva.FREQUENCIA || infoSeletiva.frequencia;
        document.getElementById('seletiva-frequencia').textContent = formatarFrequencia(freqSeletiva);
        // Tentar pegar turno do campo TURNO, senão extrair de FREQUENCIA
        const turnoSeletiva = infoSeletiva.TURNO || infoSeletiva.turno || extrairTurno(freqSeletiva);
        document.getElementById('seletiva-turno').textContent = formatarTurno(turnoSeletiva);
    } else {
        document.getElementById('seletiva-frequencia').textContent = 'Não disponível';
        document.getElementById('seletiva-turno').textContent = '-';
    }
    
    // Coleta Domiciliar
    if (infoDomiciliar) {
        const freqDomiciliar = infoDomiciliar.FREQUENCIA || infoDomiciliar.frequencia || normalizarLayer(infoDomiciliar.layer);
        document.getElementById('domiciliar-frequencia').textContent = formatarFrequencia(freqDomiciliar);
        // Tentar pegar turno do campo TURNO, senão extrair de FREQUENCIA
        const turnoDomiciliar = infoDomiciliar.TURNO || infoDomiciliar.turno || extrairTurno(freqDomiciliar);
        document.getElementById('domiciliar-turno').textContent = formatarTurno(turnoDomiciliar);
    } else {
        document.getElementById('domiciliar-frequencia').textContent = 'Não disponível';
        document.getElementById('domiciliar-turno').textContent = '-';
    }
}

// ===== FORMATADORES =====
function formatarFrequencia(valor) {
    if (!valor) return '-';
    
    // Formato Ribeirão Preto: "SEGUNDA-FEIRA DIURNO", "SEG/QUA/SEX - NOTURNO", "SABADO DIURNO"
    // Primeiro, extrair apenas os dias (remover turno)
    let dias = valor
        .replace(/ - (DIURNO|NOTURNO|VESPERTINO)/gi, '')
        .replace(/ (DIURNO|NOTURNO|VESPERTINO)/gi, '')
        .trim();
    
    // Converter nomes completos para abreviações
    dias = dias
        .replace(/SEGUNDA-FEIRA/gi, 'Seg')
        .replace(/TERÇA-FEIRA/gi, 'Ter')
        .replace(/TERCA-FEIRA/gi, 'Ter')
        .replace(/QUARTA-FEIRA/gi, 'Qua')
        .replace(/QUINTA-FEIRA/gi, 'Qui')
        .replace(/SEXTA-FEIRA/gi, 'Sex')
        .replace(/SABADO/gi, 'Sáb')
        .replace(/SÁBADO/gi, 'Sáb')
        .replace(/DOMINGO/gi, 'Dom')
        .replace(/SEG/gi, 'Seg')
        .replace(/TER/gi, 'Ter')
        .replace(/QUA/gi, 'Qua')
        .replace(/QUI/gi, 'Qui')
        .replace(/SEX/gi, 'Sex')
        .replace(/SAB/gi, 'Sáb')
        .replace(/DOM/gi, 'Dom');
    
    // Formato Curitiba: "2ª", "3ª e Sáb.", etc
    dias = dias
        .replace(/2ª/g, 'Seg')
        .replace(/3ª/g, 'Ter')
        .replace(/4ª/g, 'Qua')
        .replace(/5ª/g, 'Qui')
        .replace(/6ª/g, 'Sex');
    
    // Limpar separadores
    dias = dias
        .replace(/\//g, ', ')
        .replace(/ e /gi, ', ')
        .replace(/,\s*,/g, ',')
        .replace(/\s+/g, ' ')
        .trim();
    
    return dias;
}

function formatarTurno(valor) {
    if (!valor) return '-';
    const turnos = {
        'DIURNO': 'Diurno (manhã)',
        'VESPERTINO': 'Vespertino (tarde)',
        'NOTURNO': 'Noturno'
    };
    return turnos[valor.toUpperCase()] || valor;
}

function extrairTurno(frequencia) {
    // Extrai turno do campo FREQUENCIA de Ribeirão Preto
    if (!frequencia) return null;
    const match = frequencia.match(/(DIURNO|NOTURNO|VESPERTINO)/i);
    return match ? match[1].toUpperCase() : null;
}

function normalizarLayer(layer) {
    // Converte "DIURNO - SEG/QUA/SEX" → "SEG/QUA/SEX - DIURNO"
    if (!layer) return null;
    const parts = layer.split(' - ');
    if (parts.length === 2) return `${parts[1]} - ${parts[0]}`;
    return layer;
}

function formatarHorario(valor) {
    if (!valor) return '-';
    return valor.replace('A PARTIR DAS ', 'A partir das ').replace('ATE ', 'Até ');
}

// ===== ATUALIZAR MAPA =====
function atualizarMapa(lat, lon, infoSeletiva, infoDomiciliar) {
    // Inicializar mapa se necessário
    if (!map) {
        map = L.map('mapa').setView([lat, lon], 16);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap'
        }).addTo(map);
    } else {
        map.setView([lat, lon], 16);
    }
    
    // Remover marcador anterior
    if (userMarker) {
        map.removeLayer(userMarker);
    }
    
    // Adicionar marcador
    const iconeSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${config.cores.primaria}" width="36" height="36">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
    `;
    
    const icone = L.divIcon({
        html: iconeSvg,
        className: 'custom-marker',
        iconSize: [36, 36],
        iconAnchor: [18, 36],
        popupAnchor: [0, -36]
    });
    
    userMarker = L.marker([lat, lon], { icon: icone }).addTo(map);
    
    // Popup com informações
    let popupContent = '<div class="marker-popup">';
    popupContent += '<h4>📍 Sua localização</h4>';
    
    if (infoSeletiva) {
        popupContent += `<p><strong>Seletiva:</strong> ${formatarFrequencia(infoSeletiva.FREQUENCIA || infoSeletiva.frequencia)}</p>`;
    }
    if (infoDomiciliar) {
        popupContent += `<p><strong>Domiciliar:</strong> ${formatarFrequencia(infoDomiciliar.FREQUENCIA || infoDomiciliar.frequencia)}</p>`;
    }
    
    popupContent += '</div>';
    
    userMarker.bindPopup(popupContent).openPopup();
    
    // Carregar polígonos no mapa (se houver)
    carregarPoligonosNoMapa(lat, lon);
}

// ===== CARREGAR POLÍGONOS NO MAPA =====
function carregarPoligonosNoMapa(lat, lon) {
    // Remove camadas antigas de polígonos
    map.eachLayer(layer => {
        if (layer instanceof L.GeoJSON) {
            map.removeLayer(layer);
        }
    });
    
    // Adiciona polígono da coleta seletiva
    if (geoDataSeletiva) {
        L.geoJSON(geoDataSeletiva, {
            style: {
                color: config.cores.primaria,
                weight: 2,
                opacity: 0.6,
                fillColor: config.cores.primaria,
                fillOpacity: 0.1
            },
            filter: (feature) => {
                // Mostra apenas o polígono que contém o ponto
                return pontoEmPoligono([lon, lat], feature.geometry);
            }
        }).addTo(map);
    }
}

// ===== ESCONDER RESULTADOS =====
function esconderResultados() {
    document.getElementById('resultados').style.display = 'none';
    document.getElementById('mapa-section').style.display = 'none';
}

// ===== LOADING =====
function mostrarLoading(mostrar) {
    document.getElementById('loading').style.display = mostrar ? 'flex' : 'none';
}

// ===== TOAST =====
function mostrarToast(mensagem) {
    const toast = document.getElementById('toast');
    document.getElementById('toast-message').textContent = mensagem;
    toast.style.display = 'block';
    
    setTimeout(() => {
        toast.style.display = 'none';
    }, 4000);
}
