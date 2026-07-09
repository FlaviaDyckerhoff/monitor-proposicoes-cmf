const fs = require('fs');
const nodemailer = require('nodemailer');

const EMAIL_DESTINO = process.env.EMAIL_DESTINO;
const EMAIL_REMETENTE = process.env.EMAIL_REMETENTE;
const EMAIL_SENHA = process.env.EMAIL_SENHA;
const API_TOKEN = process.env.CMF_API_TOKEN;
const ARQUIVO_ESTADO = 'estado_pautas.json';
const API_BASE = 'https://www.cmf.sc.gov.br/jsonweb/web-aplicativo.php';
const LOOKAHEAD_DIAS = Number(process.env.CMF_PAUTAS_LOOKAHEAD_DIAS || 14);

function carregarEstado() {
  if (fs.existsSync(ARQUIVO_ESTADO)) {
    return JSON.parse(fs.readFileSync(ARQUIVO_ESTADO, 'utf8'));
  }
  return { pautas_vistas: [], ultima_execucao: '' };
}

function salvarEstado(estado) {
  fs.writeFileSync(ARQUIVO_ESTADO, JSON.stringify(estado, null, 2));
}

function escaparHtml(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function extrairId(link) {
  const match = String(link || '').match(/\/(\d+)#pesquisa$/);
  return match ? match[1] : null;
}

function parseDataLocal(valor) {
  const match = String(valor || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!match) return null;
  const ano = Number(match[1]);
  const mes = Number(match[2]) - 1;
  const dia = Number(match[3]);
  const hora = Number(match[4]);
  const minuto = Number(match[5]);
  return new Date(ano, mes, dia, hora, minuto);
}

function formatarDataHora(valor) {
  const data = parseDataLocal(valor);
  if (!data) return valor || '-';
  return data.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function classificarPauta(titulo) {
  const texto = String(titulo || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (/SESSAO|PLENARIA|PLENARIO|ORDEM DO DIA/.test(texto)) return 'Plenário';
  if (/AUDIENCIA PUBLICA/.test(texto)) return 'Audiência Pública';
  if (/COMISSAO|CVOPU|CCJ|CFO|CPC|CDD|CDH|CES|CULT|DEFESA|MEIO AMBIENTE|SAUDE|EDUCACAO/.test(texto)) return 'Comissão';
  return 'Pauta';
}

async function buscarPautas() {
  const params = new URLSearchParams({
    keysoft: API_TOKEN,
    call: 'pautas',
    pagina: '1',
  });
  const response = await fetch(API_BASE + '?' + params, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'MonitorLegislativo-RadarCMF/1.0 (+contato: tramitacao@monitorlegislativo.com.br)',
    },
  });

  if (!response.ok) {
    throw new Error('Erro HTTP ' + response.status + ' ao buscar pautas CMF');
  }

  const json = await response.json();
  return Array.isArray(json) ? json : [];
}

function dentroDaJanelaFutura(item) {
  const data = parseDataLocal(item.data);
  if (!data) return false;

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const limite = new Date(hoje);
  limite.setDate(limite.getDate() + LOOKAHEAD_DIAS);
  limite.setHours(23, 59, 59, 999);

  return data >= hoje && data <= limite;
}

function normalizarPauta(item) {
  return {
    id: extrairId(item.link),
    data: item.data || '',
    dataFormatada: formatarDataHora(item.data),
    titulo: item.titulo || '-',
    tipo: classificarPauta(item.titulo),
    url: String(item.link || '').replace('#pesquisa', ''),
  };
}

async function enviarEmail(pautas) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_REMETENTE, pass: EMAIL_SENHA },
  });

  const rows = pautas.map(function (p) {
    return [
      '<tr>',
      '<td style="padding:8px;border-bottom:1px solid #eee;white-space:nowrap">' + escaparHtml(p.dataFormatada) + '</td>',
      '<td style="padding:8px;border-bottom:1px solid #eee;white-space:nowrap">' + escaparHtml(p.tipo) + '</td>',
      '<td style="padding:8px;border-bottom:1px solid #eee">' + escaparHtml(p.titulo) + '</td>',
      '<td style="padding:8px;border-bottom:1px solid #eee;white-space:nowrap"><a href="' + escaparHtml(p.url) + '" style="color:#1a4a7a">Abrir</a></td>',
      '</tr>',
    ].join('');
  }).join('');

  const html = [
    '<div style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto">',
    '<h2 style="color:#1a4a7a;border-bottom:2px solid #1a4a7a;padding-bottom:8px">Radar de Pautas CMF — ' + pautas.length + ' pauta(s) nova(s)</h2>',
    '<p style="color:#555">Fonte: API JSON oficial da Câmara Municipal de Florianópolis, chamada <code>call=pautas</code>.</p>',
    '<p style="color:#7a4a00;background:#fff7e6;border:1px solid #ffd58a;padding:10px;border-radius:4px">Atenção: a API confirmou a lista de pautas, mas ainda não expõe os itens/proposições da pauta. Por isso este alerta é Radar; Pauta Analisada/Mesa ficam pendentes até a CMF liberar detalhe por fonte estruturada.</p>',
    '<table style="width:100%;border-collapse:collapse;font-size:14px">',
    '<thead><tr style="background:#1a4a7a;color:white">',
    '<th style="padding:10px;text-align:left">Data</th>',
    '<th style="padding:10px;text-align:left">Tipo</th>',
    '<th style="padding:10px;text-align:left">Pauta</th>',
    '<th style="padding:10px;text-align:left">Link</th>',
    '</tr></thead>',
    '<tbody>' + rows + '</tbody>',
    '</table>',
    '</div>',
  ].join('');

  await transporter.sendMail({
    from: '"Monitor CMF" <' + EMAIL_REMETENTE + '>',
    to: EMAIL_DESTINO,
    subject: 'Radar de Pautas CMF: ' + pautas.length + ' pauta(s) nova(s) — ' + new Date().toLocaleDateString('pt-BR'),
    html,
  });

  console.log('Email enviado com ' + pautas.length + ' pauta(s) nova(s).');
}

(async function main() {
  console.log('Iniciando Radar de Pautas CMF...');

  if (!API_TOKEN) {
    console.error('CMF_API_TOKEN nao definido.');
    process.exit(1);
  }

  const estado = carregarEstado();
  const vistos = new Set(estado.pautas_vistas || []);
  const pautas = (await buscarPautas())
    .map(normalizarPauta)
    .filter(function (p) { return p.id && dentroDaJanelaFutura(p); })
    .sort(function (a, b) { return String(a.data).localeCompare(String(b.data)); });

  const novas = pautas.filter(function (p) { return !vistos.has(p.id); });
  console.log('Pautas futuras na janela: ' + pautas.length + '; novas: ' + novas.length);

  if (novas.length) {
    await enviarEmail(novas);
    for (const pauta of novas) vistos.add(pauta.id);
  } else {
    console.log('Sem pautas novas na janela. Nada a enviar.');
  }

  estado.pautas_vistas = Array.from(vistos);
  estado.ultima_execucao = new Date().toISOString();
  salvarEstado(estado);
})();
