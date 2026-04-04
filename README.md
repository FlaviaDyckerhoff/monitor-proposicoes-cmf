# 🏛️ Monitor Proposições Florianópolis — CMF

Monitora automaticamente a API da Câmara Municipal de Florianópolis e envia email quando há proposições novas. Roda **4x por dia** via GitHub Actions (8h, 12h, 17h e 21h, horário de Brasília).

## Diferença em relação aos outros monitores

Este monitor usa a **API JSON oficial da CMF** (`/jsonweb/web-aplicativo.php`) com token de acesso. Não há scraping de HTML. A API retorna JSON limpo com até 50 itens por página.

---

## Como funciona

1. Para cada tipo de proposição, chama `call=proposicoes&tipo=CONTRACT&pagina=N`
2. Itera as páginas até encontrar uma sem IDs novos (a API ordena por data decrescente)
3. Compara com o `estado.json` salvo no repositório
4. Se há proposições novas → envia email organizado por tipo
5. Salva o estado atualizado

**Tipos monitorados:**
- Projetos de Leis Ordinárias
- Projetos de Leis Complementares
- Projetos de Resoluções
- Projetos de Decretos Legislativos
- Propostas de Emendas à Lei Orgânica
- Propostas de Emendas à Constituição de SC
- Requerimentos
- Indicações
- Moções
- Vetos

---

## Estrutura do repositório

```
monitor-proposicoes-florianopolis/
├── monitor.js
├── package.json
├── estado.json
├── README.md
└── .github/workflows/monitor.yml
```

---

## Setup

### PARTE 1 — Obter o token da API

1. Acesse `https://www.cmf.sc.gov.br/dadosabertos`
2. Clique em **"faça seu login/cadastro para obter o token de acesso"**
3. Crie uma conta e copie o token gerado

### PARTE 2 — Criar repositório no GitHub

1. `github.com` → **+ → New repository**
2. Nome: `monitor-proposicoes-florianopolis` | Visibility: **Private**

### PARTE 3 — Fazer upload dos arquivos

1. Faça upload de `monitor.js`, `package.json`, `README.md`
2. Crie `.github/workflows/monitor.yml` com o conteúdo do arquivo `monitor.yml`

### PARTE 4 — Configurar os Secrets

**Settings → Secrets and variables → Actions → New repository secret**

| Name | Valor |
|------|-------|
| `EMAIL_REMETENTE` | seu Gmail |
| `EMAIL_SENHA` | App Password de 16 letras (sem espaços) |
| `EMAIL_DESTINO` | email de destino |
| `CMF_API_TOKEN` | token obtido em cmf.sc.gov.br/dadosabertos |

### PARTE 5 — Testar

**Actions → Monitor Proposições Florianópolis → Run workflow**

O primeiro run vai percorrer vários tipos e páginas — pode demorar ~30 segundos. Verde = funcionou.

---

## API

```
Base:    https://www.cmf.sc.gov.br/jsonweb/web-aplicativo.php
Auth:    ?keysoft=TOKEN
Método:  GET
Tipos:   ?call=proposicoes
Lista:   ?call=proposicoes&tipo=CONTRACT&pagina=N
Página:  50 itens/página
ID:      número no final do campo "link" (.../0/0/0/0/ID#pesquisa)
```

---

## Resetar o estado

Edite `estado.json` no repositório e substitua por:
```json
{"proposicoes_vistas":[],"ultima_execucao":""}
```
