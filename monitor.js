const fs = require('fs');
const nodemailer = require('nodemailer');

const EMAIL_DESTINO = process.env.EMAIL_DESTINO;
const EMAIL_REMETENTE = process.env.EMAIL_REMETENTE;
const EMAIL_SENHA = process.env.EMAIL_SENHA;
const API_TOKEN = process.env.CMF_API_TOKEN;
const ARQUIVO_ESTADO = 'estado.json';
const API_BASE = 'http://www.cmf.sc.gov.br/jsonweb/web-aplicativo.php';
const MAX_PAGINAS = 20;

// Todos os tipos de proposição disponíveis na API da CMF
const TIPOS = [
  { contract: 'Projetos-de-Leis-ordinarias',              titulo: 'Projetos de Leis Ordinárias' },
  { contract: 'Projetos-de-Leis-Complementares',          titulo: 'Projetos de Leis Complementares' },
  { contract: 'Projetos-de-Resolucoes',                   titulo: 'Projetos de Resoluções' },
  { contract: 'Projetos-de-Decretos-Legislativos',        titulo: 'Projetos de Decretos Legislativos' },
  { contract: 'Propostas-de-Emendas-a-Lei-Organica',      titulo: 'Propostas de Emendas à Lei Orgânica' },
  { contract: 'Propostas-de-Emendas-a-Constituicao-de-SC',titulo: 'Propostas de Emendas à Constituição de SC' },
  { contract: 'Requerimentos',                            titulo: 'Requerimentos' },
  { contract: 'Indicacoes',                               titulo: 'Indicações' },
  { contract: 'Mocoes',                                   titulo: 'Moções' },
  { contract: 'Vetos',                                    titulo: 'Vetos' },
];

function carregarEstado() {
  if (fs.existsSync(ARQUIVO_ESTADO)) {
    return JSON.parse(fs.readFileSync(ARQUIVO_ESTADO, 'utf8'));
  }
  return { proposicoes_vistas: [], ultima_execucao: '' };
}

function salvarEstado(estado) {
  fs.writeFileSync(ARQUIVO_ESTADO, JSON.stringify(estado, null, 2));
}

function extrairId(link) {
  // link: "https://www.cmf.sc.gov.br/proposicoes/0/0/0/0/114280#pesquisa"
  const match = link.match(/\/(\d+)#pesquisa$/);
  return match ? match[1] : null;
}

async function buscarPagina(contract, pagina) {
  const url = `${API_BASE}?keysoft=${API_TOKEN}&call=proposicoes&tipo=${contract}&pagina=${pagina}`;
  console.log(`   🌐 ${contract} — página ${pagina}`);

  const response = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    console.error(`   ❌ Erro HTTP ${response.status}`);
    return null;
  }

  const json = await response.json();
  return Array.isArray(json) ? json : [];
}

// Itera páginas até não encontrar nenhum ID novo em uma página inteira
async function buscarTodasNovas(tipo, idsVistos) {
  const novas = [];
  let pagina = 1;

  console.log(`\n🔍 Buscando ${tipo.titulo}...`);

  while (pagina <= MAX_PAGINAS) {
    const itens = await buscarPagina(tipo.contract, pagina);

    if (itens === null) break;
    if (itens.length === 0) {
      console.log(`   → Página ${pagina} vazia. Fim.`);
      break;
    }

    const novasDaPagina = itens.filter(item => {
      const id = extrairId(item.link || '');
      return id && !idsVistos.has(id);
    });

    console.log(`   → Página ${pagina}: ${itens.length} itens, ${novasDaPagina.length} novos`);

    novas.push(...novasDaPagina.map(item => ({
      id: extrairId(item.link),
      tipo: tipo.titulo,
      titulo: item.titulo || '-',
      ementa: (item.ementa || '-').trim(),
      autoria: item.autoria || '-',
      data: item.data ? item.data.substring(0, 10) : '-',
      url: (item.link || '').replace('#pesquisa', ''),
    })));

    // Se nenhum item desta página é novo, todos os anteriores também já foram vistos
    if (novasDaPagina.length === 0) {
      console.log(`   → Nenhuma novidade nesta página. Parando.`);
      break;
    }

    // Página com menos de 50 itens = última página
    if (itens.length < 50) {
      console.log(`   → Última página alcançada.`);
      break;
    }

    pagina++;
  }

  if (pagina > MAX_PAGINAS) {
    console.warn(`   ⚠️ Limite de ${MAX_PAGINAS} páginas atingido em ${tipo.titulo}.`);
  }

  console.log(`   ✅ Total novas em ${tipo.titulo}: ${novas.length}`);
  return novas;
}

function prioridadeTipoEmail(tipo) {
  const t = String(tipo || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();

  if (/^(PL|PLO)(\b|$)/.test(t) || /^PROJETO DE LEI( ORDINARIA)?$/.test(t)) return 0;
  if (/^PLC(\b|$)/.test(t) || /^PROJETO DE LEI COMPLEMENTAR/.test(t)) return 1;
  if (/^PEC(\b|$)/.test(t) || /^(PROPOSTA|PROJETO) DE EMENDA (A )?CONSTITUCIONAL/.test(t)) return 2;
  return 10;
}

function compararTiposEmail(a, b) {
  const prioridadeA = prioridadeTipoEmail(a);
  const prioridadeB = prioridadeTipoEmail(b);
  if (prioridadeA !== prioridadeB) return prioridadeA - prioridadeB;
  return String(a || '').localeCompare(String(b || ''), 'pt-BR');
}


const CLIENTES_NOMES_PROPRIOS = [
  'FIRJAN', 'Red Bull', 'Sindicerv', 'Boticario',
  'Boticário', 'Grupo Boticario', 'Grupo Boticário', 'O Boticario',
  'O Boticário', 'Abrasel', 'Abrasel PB', 'Abrasel Paraíba',
  'ANBRASEL', 'Ambev', 'Heineken', 'Abralatas',
  'ABIR', 'Coca-Cola', 'Coca Cola', 'Coca-Cola Company',
  'Femsa', 'Solar', 'Grupo Simões', 'Grupo Simoes',
  'Andina', 'CVI', 'iFood', 'Zé Delivery',
  'Ze Delivery', 'Verde Brasil', 'JCRIG', 'Associação dos Cemitérios e Crematórios do Brasil',
  'Associacao dos Cemiterios e Crematorios do Brasil', 'Lalamove', 'Matrix', 'CVC',
  'Rei do Pitaco', 'Maersk', 'Mac Jee', 'Norte Energia',
  'Pacto Pela Fome', 'Sanofi', 'TikTok', 'Minalba',
  'Esmaltec', 'Nacional Gás', 'Nacional Gas', 'Syngenta',
  'Braskem', 'Ypê', 'Ype', 'VTal',
  'V.tal', 'Grupo EPR', 'EPR', 'Natural Energia',
  'DIAGEO', 'Alpargatas', 'Ternium', 'ABRADEE',
  'Eletrobras', 'Eletrobrás', 'MeetKai', 'IPQ',
  'Equatorial', 'EquatorialEnergia', 'Equatorial Energia', 'Equatorial Goiás',
  'Equatorial Goias', 'Equatorial Goiás Distribuidora de Energia', 'Equatorial Goias Distribuidora de Energia', 'CEA Equatorial',
  'CEA Equatorial Energia', 'Equtorial', 'Energisa', 'EnergisaLuz',
  'Neoenergia', 'ENEL', 'Ampla Energia', 'SABESP',
  'COMGAS', 'COMGÁS', 'AEGEA', 'Aegea Saneamento',
  'Águas de Teresina', 'Aguas de Teresina', 'Águas de Timon', 'Aguas de Timon',
  'Águas do Rio', 'Aguas do Rio', 'Águas do Rio 1', 'Águas do Rio 4',
  'Naturgy', 'Agenersa', 'Regenera', 'Comlurb',
  'Hekos', 'Orizon', 'Solvi', 'União Norte',
  'Uniao Norte', 'Vital', 'Eletromidia', 'Eletromídia',
  'AkzoNobel', 'Expedia', 'Hotels.com', 'Vrbo',
  'RTSC', 'Gramado Parks', 'Grupo Wish', 'Huawei',
  'Carrefour', 'Atacadão', 'Atacadao', 'Walmart',
  "Sam's Club", 'Sams Club', 'JBS', 'Friboi',
  'Seara', 'Swift', "Pilgrim's", 'Pilgrims',
  'Wild Fork', 'Ajinomoto', 'Vibra', 'Vibra Energia',
  'BR Distribuidora', 'Raízen', 'Raizen', 'Mindlab',
  'ABVTEX', 'Semove', 'Barcas', 'Seta',
  'Nova Infra', 'BRT'
];

function clientesCitadosNaProposicao(p) {
  const texto = [p.cliente, p.clientes, p.autor, p.autores, p.tipo, p.rotulo, p.titulo, p.identificacao, p.ementa]
    .filter(Boolean)
    .join(' ');
  const achados = [];
  for (const nome of CLIENTES_NOMES_PROPRIOS) {
    const escaped = nome.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(^|[^A-Za-zÀ-ÿ0-9])' + escaped + '([^A-Za-zÀ-ÿ0-9]|$)', 'i');
    if (re.test(texto) && !achados.some(a => a.toLowerCase() === nome.toLowerCase())) achados.push(nome);
  }
  return achados;
}

function anotarClientesCitados(proposicoes) {
  for (const p of proposicoes || []) {
    const clientes = clientesCitadosNaProposicao(p);
    p.clientesCitados = clientes;
    if (clientes.length && p.ementa && !String(p.ementa).includes('Cliente citado:')) {
      p.ementa = String(p.ementa).trim() + ' | Cliente citado: ' + clientes.join(', ');
    }
  }
}

function mlEscapeHtmlClienteDestaque(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function mlEscapeRegExpClienteDestaque(valor) {
  return String(valor).replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
}

function mlDestacarTermosClienteEmail(texto, clientes) {
  const nomes = Array.from(new Set([...(clientes || []), ...CLIENTES_NOMES_PROPRIOS]))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (!nomes.length) return mlEscapeHtmlClienteDestaque(texto);

  const regex = new RegExp('(^|[^A-Za-zÀ-ÿ0-9])(' + nomes.map(mlEscapeRegExpClienteDestaque).join('|') + ')(?=[^A-Za-zÀ-ÿ0-9]|$)', 'gi');
  return mlEscapeHtmlClienteDestaque(texto).replace(regex, (match, prefixo, termo) => {
    return prefixo + '<span style="background:#dbeafe;color:#1e3a8a;font-weight:700;border-radius:3px;padding:1px 3px">' + termo + '</span>';
  });
}

function renderizarEmentaCliente(p, renderBase) {
  const texto = String((p && p.ementa) || '-');
  const partes = texto.split(/\s+\|\s+Cliente citado:\s+/i);
  const ementa = renderBase
    ? renderBase(partes[0])
    : mlDestacarTermosClienteEmail(partes[0], p && p.clientesCitados);
  const clientes = partes.length > 1
    ? partes.slice(1).join(' | Cliente citado: ')
    : ((p && p.clientesCitados) || []).join(', ');

  if (!clientes) return ementa;
  return ementa + '<div style="margin-top:6px">' +
    '<span style="display:inline-block;background:#eef6ff;border:1px solid #bfdbfe;color:#1e3a8a;border-radius:999px;padding:3px 8px;font-size:11px;font-weight:700">' +
    'Cliente citado: ' + mlDestacarTermosClienteEmail(clientes, p && p.clientesCitados) +
    '</span></div>';
}

async function enviarEmail(novas) {
  anotarClientesCitados(novas);
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_REMETENTE, pass: EMAIL_SENHA },
  });

  // Agrupa por tipo
  const porTipo = {};
  novas.forEach(p => {
    if (!porTipo[p.tipo]) porTipo[p.tipo] = [];
    porTipo[p.tipo].push(p);
  });

  const linhas = Object.keys(porTipo).sort(compararTiposEmail).map(tipo => {
    const header = `<tr><td colspan="5" style="padding:10px 8px 4px;background:#f0f0f7;font-weight:bold;color:#1a4a7a;font-size:13px;border-top:2px solid #1a4a7a">${tipo} — ${porTipo[tipo].length} proposição(ões)</td></tr>`;
    const rows = porTipo[tipo].map(p =>
      `<tr>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px;white-space:nowrap">${p.titulo || '-'}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px">${p.autoria || '-'}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px;white-space:nowrap">${p.data || '-'}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px">${renderizarEmentaCliente(p)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px;white-space:nowrap"><a href="${p.url}" style="color:#1a4a7a">Ver</a></td>
      </tr>`
    ).join('');
    return header + rows;
  }).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:960px;margin:0 auto">
      <h2 style="color:#1a4a7a;border-bottom:2px solid #1a4a7a;padding-bottom:8px">
        🏛️ CMF Florianópolis — ${novas.length} nova(s) proposição(ões)
      </h2>
      <p style="color:#666">Monitoramento automático — ${new Date().toLocaleString('pt-BR')}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#1a4a7a;color:white">
            <th style="padding:10px;text-align:left">Proposição</th>
            <th style="padding:10px;text-align:left">Autoria</th>
            <th style="padding:10px;text-align:left">Data</th>
            <th style="padding:10px;text-align:left">Ementa</th>
            <th style="padding:10px;text-align:left">Link</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>
      <p style="margin-top:20px;font-size:12px;color:#999">
        Acesse: <a href="https://www.cmf.sc.gov.br/proposicoes">cmf.sc.gov.br/proposicoes</a>
      </p>
    </div>
  `;

  await transporter.sendMail({
    from: `"Monitor CMF" <${EMAIL_REMETENTE}>`,
    to: EMAIL_DESTINO,
    subject: `🏛️ Florianópolis: ${novas.length} nova(s) proposição(ões) — ${new Date().toLocaleDateString('pt-BR')}`,
    html,
  });

  console.log(`\n✅ Email enviado com ${novas.length} proposições novas.`);
}

(async () => {
  console.log('🚀 Iniciando monitor CMF Florianópolis...');
  console.log(`⏰ ${new Date().toLocaleString('pt-BR')}`);

  if (!API_TOKEN) {
    console.error('❌ CMF_API_TOKEN não definido. Configure o secret no GitHub.');
    process.exit(1);
  }

  const estado = carregarEstado();
  const idsVistos = new Set(estado.proposicoes_vistas);

  const todasNovas = [];

  for (const tipo of TIPOS) {
    const novasDoTipo = await buscarTodasNovas(tipo, idsVistos);
    todasNovas.push(...novasDoTipo);
  }

  console.log(`\n📊 Total de novas: ${todasNovas.length}`);

  if (todasNovas.length > 0) {
    // Ordena por tipo alfabético, depois por número decrescente dentro do tipo
    todasNovas.sort((a, b) => {
      if (a.tipo < b.tipo) return -1;
      if (a.tipo > b.tipo) return 1;
      return (parseInt(b.id) || 0) - (parseInt(a.id) || 0);
    });

    await enviarEmail(todasNovas);

    todasNovas.forEach(p => idsVistos.add(p.id));
    estado.proposicoes_vistas = Array.from(idsVistos);
  } else {
    console.log('✅ Sem novidades. Nada a enviar.');
  }

  estado.ultima_execucao = new Date().toISOString();
  salvarEstado(estado);
})();
