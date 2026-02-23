# 🗑️ Sistema de Coleta de Lixo - Multi-municípios

Sistema configurável para consulta de horários de coleta de lixo. Cada cidade tem sua própria pasta com configurações.

---

## 📁 Estrutura do Projeto

```
coleta-lixo/
├── index.html          # Página principal (NÃO editar)
├── config.json         # ⭐ CONFIGURAÇÕES DA CIDADE (editar aqui!)
├── css/
│   └── styles.css      # Estilos (não precisa editar)
├── js/
│   └── app.js          # Lógica (não precisa editar)
├── data/
│   ├── coleta_seletiva.geojson    # 📍 Dados de coleta seletiva
│   └── coleta_domiciliar.geojson  # 📍 Dados de coleta domiciliar
└── images/
    ├── prefeitura.png  # 🖼️ Logo da prefeitura
    └── empresa.png     # 🖼️ Logo da empresa
```

---

## ⚡ Como Configurar uma Nova Cidade

### 1. Copie a pasta inteira
Copie toda a pasta `coleta-lixo` e renomeie para a nova cidade:
```
coleta-lixo-joinville/
coleta-lixo-londrina/
etc.
```

### 2. Edite o `config.json`

Abra o arquivo `config.json` em um editor de texto (Notepad++, VS Code, ou até o Bloco de Notas).

#### Seção `cidade`:
```json
"cidade": {
    "nome": "Joinville",           // Nome da cidade
    "estado": "SC",                 // Sigla do estado
    "coordenadas": [-26.3045, -48.8487],  // Centro do mapa [latitude, longitude]
    "zoom": 12,                     // Zoom inicial (10-14)
    "boundingBox": "-49.10,-26.10,-48.70,-26.50"  // Limites de busca
}
```

> 💡 **Como obter as coordenadas?** 
> Abra o Google Maps, clique com botão direito no centro da cidade, e copie as coordenadas.

#### Seção `contato`:
```json
"contato": {
    "telefone": "156",              // Número principal
    "url": "https://...",           // Link para atendimento online
    "textoAtendimento": "Central de Atendimento ao Cidadão"
}
```

#### Seção `logos`:
```json
"logos": {
    "prefeitura": "images/prefeitura.png",
    "empresa": "images/empresa.png"
}
```
Coloque os arquivos de imagem na pasta `images/`.

#### Seção `cores` (personalização visual):
```json
"cores": {
    "primaria": "#2d8a5b",      // Verde principal (cabeçalhos, botões)
    "secundaria": "#3b9ebf",    // Azul secundário (card domiciliar)
    "fundo": "#f5f9f7",         // Cor de fundo geral
    "texto": "#1a2e35",         // Cor do texto principal
    "textoClaro": "#5a7a85",    // Cor do texto secundário
    "cartao": "#ffffff",        // Fundo dos cards
    "borda": "#e0ebe5",         // Cor das bordas
    "destaque": "#e8f4ed"       // Cor de destaque/hover
}
```

> 💡 **Como escolher cores?**
> Use as cores oficiais da prefeitura. Ferramentas úteis:
> - https://coolors.co (criar paletas)
> - https://imagecolorpicker.com (extrair cores de logos)

#### Seção `textos`:
```json
"textos": {
    "tituloPrefeitura": "Prefeitura de Joinville",
    "tituloEmpresa": "Nome da Empresa",
    "subtitulo": "Descubra os dias e horários...",
    "placeholder": "Digite seu endereço...",
    "rodape": {
        "prefeitura": "© 2026 Prefeitura Municipal de Joinville",
        "empresa": "Nome da Concessionária"
    }
}
```

#### Seção `faqs`:
Adicione ou remova perguntas conforme necessário:
```json
"faqs": [
    {
        "pergunta": "Sua pergunta aqui?",
        "resposta": "Sua resposta detalhada aqui."
    },
    // ... mais perguntas
]
```

### 3. Substitua os arquivos GeoJSON

Coloque os novos arquivos na pasta `data/`:
- `coleta_seletiva.geojson`
- `coleta_domiciliar.geojson`

> ⚠️ **Importante:** Os arquivos devem estar em formato GeoJSON com coordenadas WGS84 (EPSG:4326).

#### Propriedades esperadas no GeoJSON:
```json
{
    "FREQUENCIA": "3ª e Sáb.",
    "TURNO": "DIURNO",
    "Horario": "A PARTIR DAS 07:00",
    "BAIRRO": "Centro"
}
```

### 4. Adicione os logos

Coloque as imagens na pasta `images/`:
- `prefeitura.png` - Logo da prefeitura (recomendado: 200px altura, fundo transparente)
- `empresa.png` - Logo da empresa (recomendado: 200px altura, fundo transparente)

---

## 🌐 Como Publicar (Hospedagem Gratuita)

### Opção 1: Cloudflare Pages (Recomendado)

1. Crie uma conta em https://pages.cloudflare.com
2. Conecte seu repositório GitHub ou faça upload direto
3. Cada cidade pode ter seu próprio projeto
4. **Custo: Gratuito** (até 500 builds/mês)

### Opção 2: GitHub Pages

1. Crie um repositório para cada cidade
2. Ative o GitHub Pages nas configurações
3. **Custo: Gratuito**

### Opção 3: Vercel

1. Crie uma conta em https://vercel.com
2. Importe o projeto
3. **Custo: Gratuito** (uso pessoal)

---

## 🔧 Solução de Problemas

### "Nenhum endereço encontrado"
- Verifique se o `boundingBox` está correto no config.json
- Tente buscar endereços mais completos (com número)

### Os logos não aparecem
- Verifique se os caminhos em `config.json` estão corretos
- Confirme que os arquivos estão na pasta `images/`

### A área não é encontrada no mapa
- O endereço pode estar fora das áreas cobertas pelo GeoJSON
- Verifique se o GeoJSON tem coordenadas WGS84

### Cores não mudam
- Limpe o cache do navegador (Ctrl+Shift+R)
- Verifique se os valores de cor estão no formato correto (#RRGGBB)

---

## 📞 Suporte

Para dúvidas técnicas, entre em contato com o desenvolvedor.

---

## 📋 Checklist para Nova Cidade

- [ ] Copiar pasta do projeto
- [ ] Editar `config.json` com dados da nova cidade
- [ ] Adicionar logo da prefeitura (`images/prefeitura.png`)
- [ ] Adicionar logo da empresa (`images/empresa.png`)
- [ ] Adicionar arquivo `data/coleta_seletiva.geojson`
- [ ] Adicionar arquivo `data/coleta_domiciliar.geojson`
- [ ] Testar localmente (abrir index.html no navegador)
- [ ] Publicar no Cloudflare Pages/GitHub Pages
- [ ] Configurar domínio personalizado (opcional)
