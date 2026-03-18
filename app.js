// app.js v10.26 (patched)
document.addEventListener('DOMContentLoaded', async () => {
  // Loading (tela inicial)
  const loadingEl = document.getElementById('app_loading');
  const hideLoading = () => {
    if (loadingEl) loadingEl.style.display = 'none';
  };

  try {
    // 1) garante login + conexão com Supabase antes de abrir o sistema
    await DB.init();
	

    // 2) agora pode carregar a tela normalmente
    await renderView('checkin');

    // 3) some com o loading
    hideLoading();
  } catch (e) {
    console.error(e);
    hideLoading();
    toast('Falha ao iniciar (login/banco). Veja o console.', false);
  }
});

// ================================
// HELPERS DO CONTRATO (GLOBAL)
// (tem que ficar FORA de qualquer função)
// ================================
function __isAcceptedContract(c){
  const vAceito = c?.aceito;
  const aceitoBool =
    vAceito === true || vAceito === 1 || vAceito === '1' ||
    (typeof vAceito === 'string' && vAceito.toLowerCase() === 'true');

  const aceitoEm =
    c?.aceito_em || c?.aceitoEm || c?.accepted_at || c?.acceptedAt || null;

  return !!(aceitoBool || aceitoEm);
}

function __getExpiresAt(c){
  return c?.expiresAt || c?.expires_at || c?.expiraEm || c?.expira_em || c?.expira_em;
}

// ================================
// EDGE FUNCTIONS - Contratos
// ================================
const CONTRACT_SUPABASE_URL = "https://siksojcleumugquntrgc.supabase.co";
// ⚠️ Copie do seu db.js (SUPABASE_ANON_KEY)
const CONTRACT_ANON_KEY = "sb_publishable_6KMGqcdP2m5A8vx46Ew--g_GU8giA2V";

let __contractClient = null;

function ensureContractClient(){
  if (__contractClient) return __contractClient;

  if (!window.supabase || !window.supabase.createClient) {
    throw new Error("Supabase SDK não carregou. Verifique se o index.html está incluindo o script do Supabase.");
  }

  __contractClient = window.supabase.createClient(CONTRACT_SUPABASE_URL, CONTRACT_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    }
  });

  return __contractClient;
}

async function callEdgeFn(name, payload){
  const c = ensureContractClient();

  // pega a sessão real do mesmo client que chama a function
  const sessRes = await c.auth.getSession();
  const jwt = sessRes?.data?.session?.access_token;

  if (!jwt) {
    throw new Error("Sem sessão no Supabase (recarregue o site e faça login novamente).");
  }

  const url = `${CONTRACT_SUPABASE_URL}/functions/v1/${name}`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + jwt
    },
    body: JSON.stringify(payload || {})
  });

  // tenta ler JSON; se não der, lê texto
  let body;
  let text = "";
  try {
    body = await r.json();
  } catch (e) {
    text = await r.text().catch(()=> "");
  }

  if (!r.ok) {
    const msg =
      (body && (body.error || body.message)) ? (body.error || body.message) :
      (body ? JSON.stringify(body) : (text || "Erro desconhecido"));

    throw new Error(`(${r.status}) ${msg}`);
  }

  return body;
}

async function gerarLinkContrato(kind, refId){
  const out = await callEdgeFn("contract-create", { kind, refId });
  
  // ✅ abre a telinha profissional do sistema
  await showContractLink(kind, refId, {
    forceUrl: out.url,
    forceExpiresAt: out.expiresAt || null,
    justCreated: true
  });
}

function __contractRefId(c){
  // ref_id é o nome real no Postgres
  return (c?.ref_id ?? c?.refId ?? c?.refID ?? null);
}

function __contractExpiresAt(c){
  // usa o helper global (mais “à prova de variações”)
  return __getExpiresAt(c) || null;
}

function __contractIsAccepted(c){
  // usa o helper global (mais “à prova de variações”)
  return __isAcceptedContract(c);
}

function __contractBuildUrlFromToken(token){
  const base = `${location.origin}${location.pathname.replace(/\/[^\/]*$/, '/')}`;
  return `${base}contrato.html?t=${encodeURIComponent(token)}`;
}

// Busca contrato existente (mais recente) ou cria um novo
async function getOrCreateContractLink(kind, refId){
  const now = Date.now();

  // 1) tenta achar um contrato válido no banco
  let contratos = [];
  try { contratos = await DB.list('contratos'); } catch(e) { contratos = []; }

  const matches = (contratos || []).filter(c => {
    const ref = __contractRefId(c);
    return String(c.kind) === String(kind) && Number(ref) === Number(refId);
  });

  // mais novo primeiro
  matches.sort((a,b)=> Number(b.id||0) - Number(a.id||0));
  const best = matches[0];

  if (best && best.token){
    const exp = __contractExpiresAt(best);
    const expMs = exp ? new Date(exp).getTime() : 0;
    const expired = expMs ? (now > expMs) : false;

    if (!expired){
      return {
        url: __contractBuildUrlFromToken(best.token),
        expiresAt: exp || null,
        accepted: __contractIsAccepted(best),
      };
    }
  }

  // 2) se não achou ou expirou, cria novo via edge function
  const out = await callEdgeFn("contract-create", { kind, refId });
  return {
    url: out.url,
    expiresAt: out.expiresAt || null,
    accepted: false
  };
}

// Abre a telinha do sistema com o link (e copia/abre)
async function showContractLink(kind, refId, opts = {}){
  const {
    forceUrl = null,
    forceExpiresAt = null,
    justCreated = false,
  } = opts;

  const out = forceUrl
    ? { url: forceUrl, expiresAt: forceExpiresAt, accepted: false }
    : await getOrCreateContractLink(kind, refId);

  const title = justCreated ? 'Contrato gerado ✅' : 'Contrato';

  // Se a telinha existir, usa ela
  if (typeof uiContractLinkModal === 'function'){
    await uiContractLinkModal({
      title,
      url: out.url,
      expiresAt: out.expiresAt,
      accepted: out.accepted
    });
    return;
  }

  // fallback: uiConfirm (texto puro)
  const expTxt = out.expiresAt ? new Date(out.expiresAt).toLocaleString() : '(sem data)';
  const msg =
`Link do contrato:
${out.url}

Expira em: ${expTxt}

Deseja copiar o link agora?`;

  let ok = false;
  if (typeof uiConfirm === "function") {
    ok = await uiConfirm(msg, title, { okText: "Copiar link", cancelText: "Fechar" });
  } else {
    ok = window.confirm(msg + "\n\nClique em OK para copiar o link.");
  }

  if (ok) {
    try { await navigator.clipboard.writeText(out.url); } catch(e) {}
    toast("Link copiado!");
  }
}

// ================================
// MODAL DO CONTRATO (GLOBAL)
// (precisa ficar FORA de qualquer função)
// ================================
function uiEscapeHtml(str){
  return (str ?? '').toString()
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#039;");
}

function uiModalTextToHtml(text){
  return uiEscapeHtml(text || '').replace(/\n/g, '<br>');
}

function uiConfirm(message, title='Confirmação', opts = {}){
  const {
    okText = 'OK',
    cancelText = 'Cancelar'
  } = opts || {};

  return new Promise((resolve) => {
    const old = document.getElementById('ui_confirm_overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'ui_confirm_overlay';
    overlay.style.cssText = `
      position:fixed;
      inset:0;
      z-index:999999;
      display:flex;
      align-items:center;
      justify-content:center;
      padding:16px;
      background:rgba(0,0,0,.45);
    `;

    const box = document.createElement('div');
    box.style.cssText = `
      width:min(560px, 100%);
      background:var(--bg);
      color:var(--text);
      border:1px solid #d4bbff;
      border-radius:16px;
      box-shadow:0 18px 40px rgba(0,0,0,.25);
      overflow:hidden;
    `;

    box.innerHTML = `
      <div style="
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
        padding:12px 14px;
        background:#ede4ff;
        border-bottom:1px solid #ddcdfc;
      ">
        <strong>${uiEscapeHtml(title)}</strong>
        <button id="ui_confirm_x" class="btn btn-ghost">Fechar</button>
      </div>

      <div style="padding:14px; line-height:1.5;">
        ${uiModalTextToHtml(message)}
      </div>

      <div style="padding:12px 14px; display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap;">
        <button id="ui_confirm_cancel" class="btn btn-outline">${uiEscapeHtml(cancelText)}</button>
        <button id="ui_confirm_ok" class="btn btn-primary">${uiEscapeHtml(okText)}</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const finish = (result) => {
      try { overlay.remove(); } catch(e){}
      resolve(!!result);
    };

    const btnOk = box.querySelector('#ui_confirm_ok');
    const btnCancel = box.querySelector('#ui_confirm_cancel');
    const btnX = box.querySelector('#ui_confirm_x');

    if (btnOk) btnOk.onclick = () => finish(true);
    if (btnCancel) btnCancel.onclick = () => finish(false);
    if (btnX) btnX.onclick = () => finish(false);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(false);
    });

    window.addEventListener('keydown', function esc(e){
      if (e.key === 'Escape') {
        window.removeEventListener('keydown', esc);
        finish(false);
      }
    });
  });
}

function uiAlert(message, title='Aviso', opts = {}){
  const {
    okText = 'Fechar'
  } = opts || {};

  return new Promise((resolve) => {
    const old = document.getElementById('ui_alert_overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'ui_alert_overlay';
    overlay.style.cssText = `
      position:fixed;
      inset:0;
      z-index:999999;
      display:flex;
      align-items:center;
      justify-content:center;
      padding:16px;
      background:rgba(0,0,0,.45);
    `;

    const box = document.createElement('div');
    box.style.cssText = `
      width:min(560px, 100%);
      background:var(--bg);
      color:var(--text);
      border:1px solid #d4bbff;
      border-radius:16px;
      box-shadow:0 18px 40px rgba(0,0,0,.25);
      overflow:hidden;
    `;

    box.innerHTML = `
      <div style="
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
        padding:12px 14px;
        background:#ede4ff;
        border-bottom:1px solid #ddcdfc;
      ">
        <strong>${uiEscapeHtml(title)}</strong>
        <button id="ui_alert_x" class="btn btn-ghost">Fechar</button>
      </div>

      <div style="padding:14px; line-height:1.5;">
        ${uiModalTextToHtml(message)}
      </div>

      <div style="padding:12px 14px; display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap;">
        <button id="ui_alert_ok" class="btn btn-primary">${uiEscapeHtml(okText)}</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const finish = () => {
      try { overlay.remove(); } catch(e){}
      resolve(true);
    };

    const btnOk = box.querySelector('#ui_alert_ok');
    const btnX = box.querySelector('#ui_alert_x');

    if (btnOk) btnOk.onclick = finish;
    if (btnX) btnX.onclick = finish;

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish();
    });

    window.addEventListener('keydown', function esc(e){
      if (e.key === 'Escape') {
        window.removeEventListener('keydown', esc);
        finish();
      }
    });
  });
}

// expiração no formato: "Expira em 5 dias (10/03/2026)" OU "Expirado há 2 dias (01/03/2026)"
function uiContractExpiryText(expiresAt){
  if (!expiresAt) return '(sem data)';

  const dt = new Date(expiresAt);
  if (isNaN(dt.getTime())) return '(sem data)';

  const hoje = new Date();
  // zera hora pra calcular por “dias”
  const a = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime();
  const b = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();

  const diffDias = Math.round((b - a) / 86400000);

  const dataBR = dt.toLocaleDateString('pt-BR'); // dd/mm/aaaa

  if (diffDias > 1) return `Expira em ${diffDias} dias (${dataBR})`;
  if (diffDias === 1) return `Expira amanhã (${dataBR})`;
  if (diffDias === 0) return `Expira hoje (${dataBR})`;
  if (diffDias === -1) return `Expirou ontem (${dataBR})`;
  return `Expirado há ${Math.abs(diffDias)} dias (${dataBR})`;
}

function uiContractLinkModal({ title='Contrato', url='', expiresAt=null, accepted=false } = {}){
  return new Promise((resolve) => {
    // remove modal anterior se existir
    const old = document.getElementById('contract_modal');
    if (old) old.remove();

    const expTxt = accepted ? '' : uiContractExpiryText(expiresAt);
    const statusTxt = accepted ? 'ACEITO ✅' : 'PENDENTE ⏳';

    const overlay = document.createElement('div');
    overlay.id = 'contract_modal';
    overlay.style.cssText = `
      position:fixed; inset:0; z-index:99999;
      display:flex; align-items:center; justify-content:center;
      padding:16px; background:rgba(0,0,0,.55);
    `;

    const box = document.createElement('div');
    box.style.cssText = `
      width:min(720px, 100%);
      max-height:min(85vh, 820px);
      overflow:auto;
      background: var(--bg);
      color: var(--text);
      border: 1px solid #d4bbff;
      border-radius: 14px;
      box-shadow: 0 18px 40px rgba(0,0,0,.25);
      padding: 14px;
    `;

    box.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px;">
        <div style="font-weight:900; font-size:15px;">${uiEscapeHtml(title)}</div>
        <button id="contract_close_x" class="btn btn-ghost" style="padding:6px 10px;">✕</button>
      </div>

      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
        <span class="tag ${accepted ? 'tag-green' : 'tag-yellow'}" style="padding:4px 10px;">${uiEscapeHtml(statusTxt)}</span>
        ${accepted ? '' : `<span class="tag" style="padding:4px 10px;">${uiEscapeHtml(expTxt)}</span>`}
      </div>

      <div style="margin-top:10px;">
        <label style="margin:0 0 6px 0;">Link do contrato</label>
        <textarea id="contract_link" readonly style="min-height:84px;">${uiEscapeHtml(url)}</textarea>
        <div class="muted-sm" style="margin-top:6px;">
          ${accepted ? 'Contrato aceito. Você pode abrir e imprimir.' : 'Copie e envie para o cliente.'}
        </div>
      </div>

      <div style="display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; margin-top:12px;">
        <button id="contract_copy" class="btn btn-primary">Copiar link</button>
        <button id="contract_open" class="btn btn-outline">Abrir</button>
        <button id="contract_print" class="btn btn-outline">Imprimir</button>
        <button id="contract_close" class="btn btn-ghost">Fechar</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const textarea = box.querySelector('#contract_link');
    const btnCopy  = box.querySelector('#contract_copy');
    const btnOpen  = box.querySelector('#contract_open');
    const btnPrint = box.querySelector('#contract_print');
    const closeX   = box.querySelector('#contract_close_x');
    const btnClose = box.querySelector('#contract_close');

    const close = () => {
      try { overlay.remove(); } catch(e){}
      resolve(true);
    };

    closeX.onclick = close;
    btnClose.onclick = close;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    window.addEventListener('keydown', function esc(e){
      if (e.key === 'Escape') {
        window.removeEventListener('keydown', esc);
        close();
      }
    });

    btnCopy.onclick = async () => {
      let ok = false;
      try {
        await navigator.clipboard.writeText(url || '');
        ok = true;
      } catch(e) {
        ok = false;
      }

      if (!ok) {
        try {
          textarea.focus();
          textarea.select();
          ok = document.execCommand('copy');
        } catch(e) {
          ok = false;
        }
      }

      toast(ok ? 'Link copiado!' : 'Não consegui copiar automaticamente. Selecione e copie manualmente.', ok);
    };

    btnOpen.onclick = () => {
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    };

    btnPrint.onclick = () => {
      if (!url) return;
      const printUrl = url + (url.includes('?') ? '&' : '?') + 'print=1';
      window.open(printUrl, '_blank', 'noopener,noreferrer');
    };
  });
}

function getStatusTagClass(status){
  const s = String(status || '').trim().toLowerCase();

  if (s === 'agendado' || s === 'agendada') return 'tag-yellow';
  if (s === 'checkin' || s === 'check-in' || s === 'check-in feito') return 'tag-blue';
  if (s === 'checkout' || s === 'check-out' || s === 'check-out feito' || s === 'concluído' || s === 'concluido') return 'tag-green';
  if (s === 'cancelado' || s === 'cancelada') return 'tag-red';

  return 'tag';
}

// Helpers
function fmtMoney(v){ return 'R$ ' + Number(v||0).toFixed(2); }
function ymd(d){ return d.toISOString().slice(0,10); }
function weekdayBR(s){ try{ const [Y,M,D]=s.split('-').map(Number); const d=new Date(Y, M-1, D); return d.toLocaleDateString('pt-BR',{weekday:'long'}).replace(/^./, c=>c.toUpperCase()); }catch(e){ return ''; }}
function fmtBR(s){ if(!s) return ''; const a=s.split('-'); return (a.length===3)?`${a[2]}/${a[1]}/${a[0]}`:s; }
function parseYMD(s){ return new Date(s+'T00:00:00'); }
function betweenDates(inicio, fim){
  const dates=[]; let d=parseYMD(inicio), end=parseYMD(fim);
  for(; d<=end; d=new Date(d.getTime()+86400000)) dates.push(ymd(d));
  return dates;
}

// ==== Importação de contratos (bloco ISA_PET_DADOS) ====

// Converte o campo "Idade" do formulário em data de nascimento (YYYY-MM-DD)
// - Se for "10" ou "10 anos" -> 01/01/(anoAtual - 10)
// - Se for "20/02/2014" ou "20-02-2014" -> 2014-02-20
// - Se for "2014-02-20" -> mantém como está (ajusta zeros à esquerda)
function parseNascimentoFromIdade(idadeStr){
  const s = (idadeStr || '').trim();
  if (!s) return '';

  // Formato dd/mm/aaaa ou dd-mm-aaaa
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m){
    let dia   = m[1].padStart(2, '0');
    let mes   = m[2].padStart(2, '0');
    let ano   = m[3];
    if (ano.length === 2){
      // Regra simples: 00–49 => 2000+, 50–99 => 1900+
      const n = parseInt(ano, 10);
      ano = (n >= 50 ? '19' : '20') + ano;
    }
    return `${ano}-${mes}-${dia}`;
  }

  // Formato ISO já (yyyy-mm-dd)
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m){
    const ano  = m[1];
    const mes  = m[2].padStart(2, '0');
    const dia  = m[3].padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
  }

  // Caso mais comum: só número de anos ("10", "10 anos", etc.)
  const mAno = s.match(/(\d{1,2})/);
  if (!mAno) return '';

  const anos = parseInt(mAno[1], 10);
  if (!Number.isFinite(anos) || anos < 0 || anos > 40){
    return '';
  }

  const hoje = new Date();
  const anoNasc = hoje.getFullYear() - anos;
  return `${anoNasc}-01-01`;
}

// Lê o bloco ISA_PET_DADOS e devolve { tutor, pets }
// Lê o bloco ISA_PET_DADOS e devolve { tutor, pets }
function parseIsaPetDados(raw){
  if (!raw) return null;

  // Se o usuário colar o contrato inteiro, tenta isolar só o bloco
  const m = raw.match(/ISA_PET_DADOS([\s\S]*?)FIM/);
  let text = raw;
  if (m) text = m[1];

  // Normaliza quebras de linha:
  // - remove \r
  // - qualquer \n que NÃO seja seguido de TUTOR| ou PET| vira espaço
  text = text.replace(/\r/g, '');
  text = text.replace(/\n(?!\s*(TUTOR|PET|HOSPEDAGEM)\|)/g, ' ');

  const linhas = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('===='));

  let tutor = null;
  const pets = [];
  let hospedagem = null;

  const normalize = (s) => (s || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const isNegacaoLivre = (txt) => {
  const t = normalize((txt || '').trim());
  if (!t) return true;

  const clean = t
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Respostas comuns de "não tem"
  const negs = new Set([
    'nao', 'não', 'n', 'nn',
    'nenhum', 'nenhuma', 'nada',
    'sem', 'sem alergia', 'sem alergias',
    'sem doenca', 'sem doencas', 'sem doenças',
    'nao tem', 'não tem',
    'nao possui', 'não possui',
    'nao apresenta', 'não apresenta'
  ]);

  if (negs.has(clean)) return true;

  if (clean.startsWith('nao tem') || clean.startsWith('não tem')) return true;
  if (clean.startsWith('sem ')) return true;

  return false;
};

  for (const linha of linhas){
    const partes = linha.split('|');
    if (!partes.length) continue;

    const tipo = (partes[0] || '').trim().toUpperCase();

    // TUTOR|Nome|CPF|Endereço|CEP|Telefone|Email|Vet
    if (tipo === 'TUTOR'){
      tutor = {
        nome:        (partes[1] || '').trim(),
        cpf:         (partes[2] || '').trim(),
        documento:   (partes[2] || '').trim(),
        endereco:    (partes[3] || '').trim(),
        cep:         (partes[4] || '').trim(),
        telefone:    (partes[5] || '').trim(),
        email:       (partes[6] || '').trim(),
        contatoVet:  (partes[7] || '').trim(),
        cidade:      '',
        observacao:  '', // sem "Importado de contrato"
      };
    }

    // PET|Nome|Espécie|Raça|Idade|Sexo|Peso|Castrado?|Alergias?|Doenças?
    else if (tipo === 'PET'){
      const nome = (partes[1] || '').trim();
      if (!nome) continue; // ignora pets vazios

      const especie     = (partes[2] || '').trim();
      const raca        = (partes[3] || '').trim();
      const idadeStr    = (partes[4] || '').trim();
      const sexoRaw     = (partes[5] || '').trim();
      const peso        = (partes[6] || '').trim(); // guardado pra uso futuro, se quiser
const castradoStr = (partes[7] || '').trim();

// === Suporta 2 formatos de linha PET ===
// FORMATO A (antigo):
// PET|Nome|Espécie|Raça|Idade|Sexo|Peso|Castrado?|AlergiasTexto?|DoençasTexto?
//
// FORMATO B (novo - com flags + textos):
// PET|Nome|Espécie|Raça|Idade|Sexo|Peso|Castrado?|Alergias(Sim/Nao)|Doencas(Sim/Nao)|Cuidados(Sim/Nao)|AlergiasTexto|DoencasTexto|CuidadosTexto

const v8  = (partes[8]  || '').trim();
const v9  = (partes[9]  || '').trim();
const v10 = (partes[10] || '').trim();
const v11 = (partes[11] || '').trim();
const v12 = (partes[12] || '').trim();
const v13 = (partes[13] || '').trim();

const isSimNao = (s) => {
  const n = normalize(s);
  return n === 'sim' || n === 'nao' || n === 'não';
};

let alergiasFlag = false, doencasFlag = false, cuidadosFlag = false;
let alergiasTexto = '', doencasTexto = '', cuidadosTexto = '';

// Se parecer o formato novo (campos 8 e 9 como Sim/Não), usa o novo
if (isSimNao(v8) && isSimNao(v9)) {
  alergiasFlag  = normalize(v8).includes('sim');
  doencasFlag   = normalize(v9).includes('sim');
  cuidadosFlag  = normalize(v10).includes('sim');

  alergiasTexto = v11;
  doencasTexto  = v12;
  cuidadosTexto = v13;
} else {
  // Formato antigo: textos diretos
  // PET|...|Castrado?|AlergiasTexto?|DoencasTexto?|CuidadosTexto?
  // Pode vir com pipes extras vazios (ex: Sim|||texto), então o "Cuidados" pode cair em [11], [12]...
  alergiasTexto = v8;
  doencasTexto  = v9;

  // pega tudo a partir do índice 10 como "Cuidados" (se vier deslocado, ainda assim entra)
  const resto = (partes.slice(10).join('|') || '').trim();
  cuidadosTexto = resto;

  alergiasFlag  = !!alergiasTexto;
  doencasFlag   = !!doencasTexto;
  cuidadosFlag  = !!cuidadosTexto;
}


const nascimento = parseNascimentoFromIdade(idadeStr);

// Conversão Macho/Fêmea → M/F (pro select do sistema)
let sexo = '';
const sxNorm = normalize(sexoRaw);
if (sxNorm.startsWith('m')) sexo = 'M';
else if (sxNorm.startsWith('f')) sexo = 'F';
else sexo = ''; // deixa vazio se vier algo estranho

const castradoBool = normalize(castradoStr).includes('sim');

// === FILTRO: se cliente escreveu "não/nao/nenhuma/sem..." então ignora ===
if (isNegacaoLivre(alergiasTexto)) alergiasTexto = '';
if (isNegacaoLivre(doencasTexto))  doencasTexto  = '';
if (isNegacaoLivre(cuidadosTexto)) cuidadosTexto = '';

// Se o texto ficou vazio, garante flag = false.
// Se veio texto de verdade, garante flag = true (mesmo que o cliente tenha marcado errado no form).
alergiasFlag = !!alergiasTexto;
doencasFlag  = !!doencasTexto;
cuidadosFlag = !!cuidadosTexto;

pets.push({
  tutorId:       null, // vamos preencher depois
  nome,
  especie,
  raca,
  sexo,
  nascimento,
  doencasFlag,
  doencasTexto,
  alergiasFlag,
  alergiasTexto,
  cuidadosFlag,
  cuidadosTexto,
  castrado:      castradoBool,
});
    }
	
    else if (tipo === 'HOSPEDAGEM') {
      // HOSPEDAGEM|02/02/2026|18:00:00|03/02/2026|19:00:00|R$ 180|Observações...
      const dataEntradaRaw = (partes[1] || '').trim();
      const horaEntradaRaw = (partes[2] || '').trim();
      const dataSaidaRaw   = (partes[3] || '').trim();
      const horaSaidaRaw   = (partes[4] || '').trim();
      const valorRaw       = (partes[5] || '').trim();

// Observação pode ter '|' (raro) e pode ter sido “juntada” com espaços por causa do replace acima
let obsRaw = (partes.slice(6).join('|') || '').trim();

// Remove qualquer sujeira de separador do contrato (==== / ==== FIM ====)
obsRaw = obsRaw
  .replace(/====\s*FIM\s*====/gi, '')
  .replace(/====/g, '')
  .trim();

// Se ficou vazio, deixa realmente vazio (sem traços, sem nada)
if (!obsRaw) obsRaw = '';

      const toISODateAny = (s) => {
        const v = (s || '').trim();
        if (!v) return '';
        // dd/mm/aaaa
        let m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
        // yyyy-mm-dd
        m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
        return '';
      };

      const onlyTime = (s) => {
        const v = (s || '').trim();
        if (!v) return '';
        // aceita HH:MM ou HH:MM:SS
        let m = v.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
        if (!m) return '';
        const hh = m[1].padStart(2,'0');
        const mm = m[2];
        return `${hh}:${mm}`;
      };

      const parseMoneyBR = (s) => {
        const v = (s || '').toString().replace(/[^\d,.-]/g, '').trim();
        if (!v) return 0;
        // Se tiver vírgula, assume decimal BR
        if (v.includes(',')) {
          const n = Number(v.replace(/\./g,'').replace(',', '.'));
          return Number.isFinite(n) ? n : 0;
        }
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      };

      // garante ISO nas datas (o sistema funciona melhor assim)
      const dataEntradaISO = toISODateAny(dataEntradaRaw);
      const dataSaidaISO   = toISODateAny(dataSaidaRaw);

      // salva em parsed.hospedagem
      // (a função hoje retorna { tutor, pets }, vamos ampliar para incluir hospedagem)
      if (!this.__isaTmp) this.__isaTmp = {};
      this.__isaTmp.hospedagem = {
        dataEntrada: dataEntradaISO,
        horaEntrada: onlyTime(horaEntradaRaw),
        dataSaida:   dataSaidaISO,
        horaSaida:   onlyTime(horaSaidaRaw),
        valor:       parseMoneyBR(valorRaw),
        observacao:  obsRaw,
      };
    }

  }

// usa a hospedagem que já foi montada no parse (ou, se você estiver usando __isaTmp, reaproveita)
hospedagem = hospedagem || ((this.__isaTmp && this.__isaTmp.hospedagem) ? this.__isaTmp.hospedagem : null);
if (this.__isaTmp) this.__isaTmp = null;
return { tutor, pets, hospedagem };

}

// ==== Importação segura: evitar duplicados e confirmar atualizações ====

function normDigits(v){
  return (v || '').toString().replace(/\D/g, '');
}
function normText(v){
  return (v || '')
    .toString()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

// Mostra diferenças campo a campo: "campo: 'antes' -> 'depois'"
function diffFields(oldObj, newObj, fields){
  const diffs = [];
  for (const f of fields){
    const a = (oldObj?.[f] ?? '').toString().trim();
    const b = (newObj?.[f] ?? '').toString().trim();

    // regra: só considera mudança se o NOVO vier preenchido e for diferente
    if (b && a !== b){
      diffs.push({ field: f, before: a, after: b });
    }
  }
  return diffs;
}

function prettyFieldName(f){
  const map = {
    nome: 'Nome',
    cpf: 'CPF',
    documento: 'CPF',
    telefone: 'Telefone',
    email: 'E-mail',
    cep: 'CEP',
    cidade: 'Cidade',
    endereco: 'Endereço',
    contatoVet: 'Contato veterinário',
    observacao: 'Observação',

    // pet
    especie: 'Espécie',
    raca: 'Raça',
    sexo: 'Sexo',
    nascimento: 'Nascimento',
    castrado: 'Castrado',
    doencasTexto: 'Doenças',
    alergiasTexto: 'Alergias',
    cuidadosTexto: 'Cuidados',
  };
  return map[f] || f;
}

function formatDiffBlock(title, diffs){
  if (!diffs.length) return `${title}\n(sem alterações)\n`;
  let s = `${title}\n`;
  for (const d of diffs){
    s += `- ${prettyFieldName(d.field)}: "${d.before || '-'}"  →  "${d.after}"\n`;
  }
  return s + '\n';
}

// Encontra tutor existente por CPF (prioridade) ou por nome+telefone (fallback)
async function findExistingTutor(tutorData){
  const all = await DB.list('clientes');

  const cpfNew = normDigits(tutorData?.cpf || tutorData?.documento);
  if (cpfNew){
    const byCpf = all.find(c => normDigits(c.cpf || c.documento) === cpfNew);
    if (byCpf) return byCpf;
  }

  const nomeNew = normText(tutorData?.nome);
  const telNew = normDigits(tutorData?.telefone);
  if (nomeNew && telNew){
    const byNomeTel = all.find(c =>
      normText(c.nome) === nomeNew && normDigits(c.telefone) === telNew
    );
    if (byNomeTel) return byNomeTel;
  }

  return null;
}

// Encontra pet existente do tutor pelo "nome + espécie + raça" (bem prático pra evitar duplicar)
async function findExistingPetForTutor(tutorId, petData){
  const pets = await DB.list('pets');
  const alvoNome = normText(petData?.nome);
  const alvoEsp = normText(petData?.especie);
  const alvoRaca = normText(petData?.raca);

  return pets.find(p =>
    Number(p.tutorId) === Number(tutorId) &&
    normText(p.nome) === alvoNome &&
    normText(p.especie) === alvoEsp &&
    normText(p.raca) === alvoRaca
  ) || null;
}


// ==== Máscaras e validação (telefone e CPF) ====

// Formata telefone brasileiro enquanto digita
function formatPhoneBR(value){
  let v = (value || '').replace(/\D/g, '');   // só dígitos
  v = v.slice(0, 11);                         // máximo 11 dígitos

  if (v.length <= 10) {
    // (99) 9999-9999
    return v
      .replace(/^(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{4})(\d)/, '$1-$2');
  } else {
    // (99) 99999-9999
    return v
      .replace(/^(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{5})(\d)/, '$1-$2');
  }
}

// Formata CPF enquanto digita
function formatCPF(value){
  let v = (value || '').replace(/\D/g, '');   // só dígitos
  v = v.slice(0, 11);                         // máximo 11 dígitos

  if (v.length <= 3) return v;
  if (v.length <= 6) return v.replace(/^(\d{3})(\d+)/, '$1.$2');
  if (v.length <= 9) return v.replace(/^(\d{3})(\d{3})(\d+)/, '$1.$2.$3');
  return v.replace(/^(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
}

// Validação de CPF (padrão Receita)
function isValidCPF(cpf){
  // mantém só dígitos
  cpf = (cpf || '').replace(/\D/g, '');

  if (!cpf || cpf.length !== 11) return false;

  // rejeita sequências iguais tipo 00000000000, 11111111111...
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  let soma = 0, resto;

  // 1º dígito verificador
  for (let i = 1; i <= 9; i++) {
    soma += parseInt(cpf.substring(i-1, i), 10) * (11 - i);
  }
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(cpf.substring(9, 10), 10)) return false;

  // 2º dígito verificador
  soma = 0;
  for (let i = 1; i <= 10; i++) {
    soma += parseInt(cpf.substring(i-1, i), 10) * (12 - i);
  }
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(cpf.substring(10, 11), 10)) return false;

  return true;
}

// ==== CLIENTES ====
async function renderClientes(){
  const view = document.getElementById('view');
  view.innerHTML = `
  <div class="grid">
    <div class="panel">
      <h2>Novo Tutor</h2>
      ${Input('Nome', 'cli_nome')}
      <div class="row">
        ${Input('Telefone', 'cli_tel')}
        ${Input('Email', 'cli_email')}
      </div>
      <div class="row">
        ${Input('CPF', 'cli_cpf')}
        ${Input('CEP', 'cli_cep')}
      </div>
      ${Input('Cidade', 'cli_cidade')}
      ${Input('Endereço', 'cli_endereco')}
      ${Input('Contato veterinário', 'cli_contato_vet')}
      ${TextArea('Observação', 'cli_obs', { style:'min-height:120px' })}
      <div class="space"></div>
      <div class="flex">
        <button class="btn btn-primary" id="cli_salvar">Salvar</button>
        <button class="btn btn-outline" id="cli_limpar">Limpar</button>
      </div>
    </div>
    <div class="panel">
      <div class="flex"><h2>Lista de Tutores</h2><div class="right"></div></div>
      <div class="search">
        <input id="cli_busca" placeholder="Buscar por Nome, Telefone ou CPF" />
        <button class="btn btn-ghost" id="cli_buscar">Buscar</button>
      </div>
      <div class="space"></div>
      <div class="list-scroll"><table><thead><tr>
        <th>ID</th><th>Nome</th><th>Contato</th><th>CPF</th><th>Cidade</th><th>Ações</th>
      </tr></thead><tbody id="cli_tbody"></tbody></table></div>
    </div>
  </div>`;
  
// ========= Auto-preenchimento de endereço pelo CEP =========
const cepInput     = document.getElementById('cli_cep');       // campo CEP
const endInput     = document.getElementById('cli_endereco');  // campo Endereço
const cidadeInput  = document.getElementById('cli_cidade');    // campo Cidade (se existir)

if (cepInput) {
  cepInput.addEventListener('blur', async () => {
    let cep = (cepInput.value || '').replace(/\D/g, ''); // mantém só números

    // CEP deve conter exatamente 8 dígitos
    if (cep.length !== 8) return;

    try {
      const resp = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      if (!resp.ok) return;

      const data = await resp.json();
      if (data.erro) {
        console.warn('CEP não encontrado no ViaCEP');
        return;
      }

      // Rua + Bairro no mesmo campo Endereço
      const logradouro = data.logradouro || '';
      const bairro = data.bairro || '';

      let endTexto = logradouro;
      if (bairro) endTexto = `${endTexto} - ${bairro}`;

      if (endInput && endTexto) {
        endInput.value = endTexto;
      }

      // Cidade (Ex.: Indaiatuba - SP)
      const cidade = data.localidade || '';
      const uf = data.uf || '';
      const cidadeTexto = [cidade, uf].filter(Boolean).join(' - ');

      if (cidadeInput && cidadeTexto) {
        cidadeInput.value = cidadeTexto;
      }

    } catch (e) {
      console.error('Erro ao consultar CEP:', e);
    }
  });
}
// ========= FIM auto CEP =========

  // ========= Máscaras de telefone e CPF =========
  const telInput = document.getElementById('cli_tel');
  if (telInput) {
    telInput.addEventListener('input', (e) => {
      e.target.value = formatPhoneBR(e.target.value);
    });
  }

  const cpfInput = document.getElementById('cli_cpf');
  if (cpfInput) {
    // aplica máscara enquanto digita
    cpfInput.addEventListener('input', (e) => {
      e.target.value = formatCPF(e.target.value);
    });

    // valida CPF quando sai do campo
    cpfInput.addEventListener('blur', (e) => {
      const raw = (e.target.value || '').replace(/\D/g, '');
      if (raw && !isValidCPF(raw)) {
        toast('CPF inválido', false);
        // opcional: volta o foco pro campo
        e.target.focus();
      }
    });
  }
  // ========= FIM máscaras =========

  document.getElementById('cli_salvar').onclick = async () => {
    const get = id => document.getElementById(id);

    // 1) valida campos obrigatórios
    const obrigatorios = [
      { id: 'cli_nome',     label: 'Nome' },
      { id: 'cli_tel',      label: 'Telefone' },
      { id: 'cli_cpf',      label: 'CPF' },
      { id: 'cli_email',    label: 'Email' },
      { id: 'cli_cep',      label: 'CEP' },
      { id: 'cli_cidade',   label: 'Cidade' },
      { id: 'cli_endereco', label: 'Endereço' },
    ];

    for (const campo of obrigatorios) {
      const el = get(campo.id);
      if (!el || !el.value.trim()) {
        toast(`O campo ${campo.label} não pode ficar vazio`, false);
        if (el) el.focus();
        return;
      }
    }

    // 2) valida CPF (formato/conteúdo)
    const cpfValor = get('cli_cpf').value || '';
    const cpfNumeros = cpfValor.replace(/\D/g, '');
    if (cpfNumeros && !isValidCPF(cpfNumeros)) {
      toast('CPF inválido', false);
      get('cli_cpf').focus();
      return;
    }

    // 3) monta o registro
    const rec = {
      nome:        get('cli_nome').value.trim(),
      telefone:    get('cli_tel').value.trim(),
      email:       get('cli_email').value.trim(),
      documento:   get('cli_cpf').value.trim(),
      cpf:         get('cli_cpf').value.trim(),
      cep:         get('cli_cep').value.trim(),
      cidade:      get('cli_cidade').value.trim(),
      endereco:    get('cli_endereco').value.trim(),
      contatoVet:  get('cli_contato_vet').value.trim(),
      observacao:  get('cli_obs').value.trim(),
    };

    const id = await DB.add('clientes', rec);
    await DB.add('logs', {
      at: new Date().toISOString(),
      action: 'create',
      entity: 'cliente',
      entityId: id,
      note: `Criado ${rec.nome}`,
    });
    toast('Cliente salvo');
    renderClientes();
  };

  document.getElementById('cli_limpar').onclick = ()=>renderClientes();
  document.getElementById('cli_buscar').onclick = ()=>loadClientes(document.getElementById('cli_busca').value.trim());
  loadClientes('');
}
async function loadClientes(q) {
  const tbody = document.getElementById('cli_tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  // Busca TODOS os clientes, sem filtro no DB
  const all = await DB.list('clientes');

  // Termo digitado
  const termo = (q || '').trim().toLowerCase();
  const termoNum = termo.replace(/\D/g, ''); // só dígitos (para tel/cpf)

  let list = all;

  // Se tiver algo digitado, filtra por NOME, TELEFONE ou CPF
  if (termo) {
    list = all.filter(c => {
      const nome = (c.nome || '').toLowerCase();

      const tel = c.telefone || '';
      const telNum = tel.replace(/\D/g, '');

      const cpf = c.cpf || c.documento || '';
      const cpfLower = cpf.toLowerCase();
      const cpfNum = cpf.replace(/\D/g, '');

      let okNome = false;
      let okTel = false;
      let okCpf = false;

      // 1) Nome contém o texto digitado
      if (nome && nome.includes(termo)) {
        okNome = true;
      }

      // 2) Telefone: compara só dígitos (pode digitar só números)
      if (termoNum) {
        if (telNum && telNum.includes(termoNum)) {
          okTel = true;
        }
      }

      // 3) CPF:
      //    - se digitar com pontos/traços, cai no includes normal (cpfLower.includes(termo))
      //    - se digitar só números, compara contra cpfNum
      if (cpfLower && cpfLower.includes(termo)) {
        okCpf = true;
      }
      if (termoNum) {
        if (cpfNum && cpfNum.includes(termoNum)) {
          okCpf = true;
        }
      }

      return okNome || okTel || okCpf;
    });
  }

  // Ordena por nome
  list.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));

  // Monta a tabela
  for (const c of list) {
    const contato = [c.telefone || '', c.email || ''].filter(Boolean).join(' / ');
    const cpf = c.cpf || c.documento || '';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${c.id}</td>
      <td>${c.nome || ''}</td>
      <td>${contato}</td>
      <td>${cpf}</td>
      <td>${c.cidade || ''}</td>
      <td class="flex">
        <button class="btn btn-ghost" data-edit="${c.id}">Editar</button>
        <button class="btn btn-danger" data-del="${c.id}">Excluir</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  $all('[data-edit]').forEach(b => b.onclick = () => editCliente(b.getAttribute('data-edit')));
  $all('[data-del]').forEach(b => b.onclick = () => delCliente(b.getAttribute('data-del')));
}


async function editCliente(id){
  const c = await DB.get('clientes', id);
  if (!c) return toast('Cliente não encontrado', false);
  document.getElementById('cli_nome').value = c.nome||'';
  document.getElementById('cli_tel').value = c.telefone||'';
  document.getElementById('cli_email').value = c.email||'';
  document.getElementById('cli_cpf').value = c.cpf||c.documento||'';
  document.getElementById('cli_cep').value = c.cep||'';
  document.getElementById('cli_cidade').value = c.cidade||'';
  document.getElementById('cli_endereco').value = c.endereco||'';
  document.getElementById('cli_contato_vet').value = c.contatoVet||'';
  document.getElementById('cli_obs').value = c.observacao||'';
  const salvar = document.getElementById('cli_salvar');
  salvar.textContent = 'Atualizar';
  salvar.onclick = async () => {
    const get = id => document.getElementById(id);

    // 1) valida campos obrigatórios
    const obrigatorios = [
      { id: 'cli_nome',     label: 'Nome' },
      { id: 'cli_tel',      label: 'Telefone' },
      { id: 'cli_cpf',      label: 'CPF' },
      { id: 'cli_email',    label: 'Email' },
      { id: 'cli_cep',      label: 'CEP' },
      { id: 'cli_cidade',   label: 'Cidade' },
      { id: 'cli_endereco', label: 'Endereço' },
    ];

    for (const campo of obrigatorios) {
      const el = get(campo.id);
      if (!el || !el.value.trim()) {
        toast(`O campo ${campo.label} não pode ficar vazio`, false);
        if (el) el.focus();
        return;
      }
    }

    // 2) valida CPF
    const cpfValor = get('cli_cpf').value || '';
    const cpfNumeros = cpfValor.replace(/\D/g, '');
    if (cpfNumeros && !isValidCPF(cpfNumeros)) {
      toast('CPF inválido', false);
      get('cli_cpf').focus();
      return;
    }

    // 3) atualiza campos
    c.nome       = get('cli_nome').value.trim();
    c.telefone   = get('cli_tel').value.trim();
    c.email      = get('cli_email').value.trim();
    c.documento  = get('cli_cpf').value.trim();
    c.cpf        = get('cli_cpf').value.trim();
    c.cep        = get('cli_cep').value.trim();
    c.cidade     = get('cli_cidade').value.trim();
    c.endereco   = get('cli_endereco').value.trim();
    c.contatoVet = get('cli_contato_vet').value.trim();
    c.observacao = get('cli_obs').value.trim();

    await DB.put('clientes', c);
    await DB.add('logs', {
      at: new Date().toISOString(),
      action: 'update',
      entity: 'cliente',
      entityId: c.id,
      note: `Atualizado ${c.nome}`,
    });
    toast('Cliente atualizado');
    renderClientes();
  };
}
async function delCliente(id){
  const c = await DB.get('clientes', id);
  if (!confirm(`Excluir cliente ${c?.nome||id}?`)) return;
  await DB.delete('clientes', id);
  await DB.add('logs', { at:new Date().toISOString(), action:'delete', entity:'cliente', entityId:Number(id), note:`Excluído` });
  toast('Cliente excluído'); loadClientes('');
}

// ==== PETS ====
async function renderPets(){
  const clientes = await DB.list('clientes');
  const clientesOrdenados = clientes.slice().sort((a,b)=>(a.nome||'').localeCompare(b.nome||''));
  const view = document.getElementById('view');
  view.innerHTML = `
  <div class="grid">
    <div class="panel" style="padding:18px;">
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:14px;">
        <div>
          <h2 style="margin:0;">Novo Pet</h2>
          <div style="font-size:13px; color:#6b6280; margin-top:4px;">
            Cadastre ou edite o pet com dados básicos, saúde e vacinação.
          </div>
        </div>
        <div style="
          padding:6px 10px;
          border-radius:999px;
          background:#f3ecff;
          border:1px solid #dfcffd;
          color:#5b3ea8;
          font-size:12px;
          font-weight:700;
        ">
          Cadastro interno
        </div>
      </div>

      <div style="
        border:1px solid #e7dbff;
        border-radius:16px;
        padding:14px;
        background:linear-gradient(180deg, #fcfaff 0%, #f8f4ff 100%);
        margin-bottom:14px;
      ">
        <div style="font-weight:800; font-size:14px; margin-bottom:10px; color:#4f3b86;">
          Tutor responsável
        </div>

        <div class="field" style="position:relative; margin-bottom:0;">
          <label for="pet_tutor_input">Tutor</label>
          <input id="pet_tutor_input" placeholder="Digite para buscar o tutor..." autocomplete="off" />
          <div style="font-size:12px; color:#7b728f; margin-top:6px;">
            Comece digitando o nome do tutor para selecionar.
          </div>
          <div id="pet_tutor_dropdown" class="dropdown-list" style="
            position:absolute;
            z-index:999;
            background:white;
            border:1px solid #d9c8fb;
            border-radius:10px;
            width:100%;
            max-height:180px;
            overflow-y:auto;
            display:none;
            box-shadow:0 10px 26px rgba(91,62,168,.12);
          "></div>

          <div id="pet_tutor_status" style="
            margin-top:10px;
            display:none;
            padding:10px 12px;
            border:1px solid #d9c8fb;
            border-radius:12px;
            background:#ffffff;
            color:#4f3b86;
            font-size:13px;
            font-weight:700;
          "></div>

          <div id="pet_edit_status" style="
            margin-top:10px;
            display:none;
            padding:10px 12px;
            border:1px solid #f5d38a;
            border-radius:12px;
            background:#fff8e8;
            color:#7a5600;
            font-size:13px;
            font-weight:700;
          "></div>
        </div>
      </div>

      <div style="
        border:1px solid #ece3ff;
        border-radius:16px;
        padding:14px;
        background:#fff;
        margin-bottom:14px;
      ">
        <div style="font-weight:800; font-size:14px; margin-bottom:12px; color:#4f3b86;">
          Identificação do pet
        </div>

        ${Input('Nome', 'pet_nome')}

        <div class="row">
          ${Select('Espécie', 'pet_especie_sel', [
            {value:'',label:'Selecione...'},
            {value:'Cachorro',label:'Cachorro'},
            {value:'Gato',label:'Gato'},
            {value:'Outro',label:'Outro'},
          ])}
          ${Input('Espécie (quando "Outro")', 'pet_especie_outro')}
        </div>

        <div class="row">
          <div class="field">
            <label for="pet_raca">Raça</label>
            <input id="pet_raca" list="racas_list" placeholder="Digite ou selecione a raça" />
            <datalist id="racas_list"></datalist>
          </div>
          <div class="field">
            ${Select('Sexo', 'pet_sexo', [
              {value:'', label:'Selecione...'},
              {value:'M', label:'M'},
              {value:'F', label:'F'}
            ])}
          </div>
        </div>

        ${Input('Nascimento (AAAA-MM-DD)', 'pet_nasc', 'date')}

        <div style="
          margin-top:10px;
          padding:10px 12px;
          border:1px solid #ede5ff;
          border-radius:12px;
          background:#faf7ff;
        ">
          <label class="checkbox-inline" style="
            display:inline-flex;
            align-items:center;
            justify-content:flex-start;
            gap:8px;
            margin:0;
            font-weight:700;
            color:#42365f;
          ">
            <input id="pet_castrado" type="checkbox" style="margin:0; transform:translateY(1px);" />
            <span>Pet castrado</span>
          </label>
        </div>
      </div>

      <div style="
        border:1px solid #ece3ff;
        border-radius:16px;
        padding:14px;
        background:#fff;
        margin-bottom:14px;
      ">
        <div style="font-weight:800; font-size:14px; margin-bottom:12px; color:#4f3b86;">
          Saúde e cuidados
        </div>

        <div class="row">
          ${Select('Doenças', 'pet_doencas_sel', [{value:'Nao',label:'Não'},{value:'Sim',label:'Sim'}])}
          ${Select('Alergias', 'pet_alergias_sel', [{value:'Nao',label:'Não'},{value:'Sim',label:'Sim'}])}
          ${Select('Cuidados', 'pet_cuidados_sel', [{value:'Nao',label:'Não'},{value:'Sim',label:'Sim'}])}
        </div>

        <div id="grp_doencas">${TextArea('Descrever Doenças (se "Sim")', 'pet_doencas_txt')}</div>
        <div id="grp_alergias">${TextArea('Descrever Alergias (se "Sim")', 'pet_alergias_txt')}</div>
        <div id="grp_cuidados">${TextArea('Descrever Cuidados (se "Sim")', 'pet_cuidados_txt')}</div>
      </div>

      <div style="
        border:1px solid #e4d7ff;
        border-radius:16px;
        padding:14px;
        background:linear-gradient(180deg, #fcfaff 0%, #f8f4ff 100%);
        margin-bottom:14px;
      ">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-bottom:12px;">
          <div>
            <h3 style="margin:0; font-size:16px; color:#4f3b86;">Vacinas e proteção</h3>
            <div style="font-size:12px; color:#7b728f; margin-top:4px;">
              Preencha apenas os itens que estiverem marcados.
            </div>
          </div>
        </div>

        <div style="display:grid; gap:12px;">

          <div style="
            border:1px solid #dccbfd;
            border-radius:14px;
            padding:14px;
            background:#fff;
            box-shadow:0 4px 12px rgba(91,62,168,.04);
          ">
            <label class="checkbox-inline" style="display:inline-flex; align-items:center; gap:8px; margin-bottom:10px; font-weight:700; color:#42365f;">
              <input id="pet_vacina_viral" type="checkbox" />
              <span>Vacina viral</span>
            </label>

            <div id="pet_grp_vacina_viral">
              <div class="row">
                ${Select('Tipo', 'pet_vacina_viral_tipo', [
                  {value:'',label:'Selecione...'},
                  {value:'V8',label:'V8'},
                  {value:'V10',label:'V10'}
                ])}
                ${Select('Mês', 'pet_vacina_viral_mes', [
                  {value:'',label:'Mês...'},
                  {value:'1',label:'Janeiro'},
                  {value:'2',label:'Fevereiro'},
                  {value:'3',label:'Março'},
                  {value:'4',label:'Abril'},
                  {value:'5',label:'Maio'},
                  {value:'6',label:'Junho'},
                  {value:'7',label:'Julho'},
                  {value:'8',label:'Agosto'},
                  {value:'9',label:'Setembro'},
                  {value:'10',label:'Outubro'},
                  {value:'11',label:'Novembro'},
                  {value:'12',label:'Dezembro'}
                ])}
                ${Input('Ano', 'pet_vacina_viral_ano')}
              </div>
            </div>
          </div>

          <div style="
            border:1px solid #dccbfd;
            border-radius:14px;
            padding:14px;
            background:#fff;
            box-shadow:0 4px 12px rgba(91,62,168,.04);
          ">
            <label class="checkbox-inline" style="display:inline-flex; align-items:center; gap:8px; margin-bottom:10px; font-weight:700; color:#42365f;">
              <input id="pet_vacina_antirrabica" type="checkbox" />
              <span>Vacina antirrábica</span>
            </label>

            <div id="pet_grp_vacina_antirrabica">
              <div class="row">
                ${Select('Mês', 'pet_vacina_antirrabica_mes', [
                  {value:'',label:'Mês...'},
                  {value:'1',label:'Janeiro'},
                  {value:'2',label:'Fevereiro'},
                  {value:'3',label:'Março'},
                  {value:'4',label:'Abril'},
                  {value:'5',label:'Maio'},
                  {value:'6',label:'Junho'},
                  {value:'7',label:'Julho'},
                  {value:'8',label:'Agosto'},
                  {value:'9',label:'Setembro'},
                  {value:'10',label:'Outubro'},
                  {value:'11',label:'Novembro'},
                  {value:'12',label:'Dezembro'}
                ])}
                ${Input('Ano', 'pet_vacina_antirrabica_ano')}
              </div>
            </div>
          </div>

          <div style="
            border:1px solid #dccbfd;
            border-radius:14px;
            padding:14px;
            background:#fff;
            box-shadow:0 4px 12px rgba(91,62,168,.04);
          ">
            <label class="checkbox-inline" style="display:inline-flex; align-items:center; gap:8px; margin-bottom:10px; font-weight:700; color:#42365f;">
              <input id="pet_antipulga" type="checkbox" />
              <span>Antipulga / coleira</span>
            </label>

            <div id="pet_grp_antipulga">
              <div class="row">
                ${Select('Tipo', 'pet_antipulga_tipo', [
                  {value:'',label:'Selecione...'},
                  {value:'Comprimido',label:'Comprimido'},
                  {value:'Pipeta',label:'Pipeta'},
                  {value:'Spray',label:'Spray'},
                  {value:'Coleira',label:'Coleira'},
                  {value:'Outro',label:'Outro'}
                ])}
                ${Select('Mês', 'pet_antipulga_mes', [
                  {value:'',label:'Mês...'},
                  {value:'1',label:'Janeiro'},
                  {value:'2',label:'Fevereiro'},
                  {value:'3',label:'Março'},
                  {value:'4',label:'Abril'},
                  {value:'5',label:'Maio'},
                  {value:'6',label:'Junho'},
                  {value:'7',label:'Julho'},
                  {value:'8',label:'Agosto'},
                  {value:'9',label:'Setembro'},
                  {value:'10',label:'Outubro'},
                  {value:'11',label:'Novembro'},
                  {value:'12',label:'Dezembro'}
                ])}
                ${Input('Ano', 'pet_antipulga_ano')}
              </div>
            </div>
          </div>

        </div>
      </div>

      <div class="space"></div>

      <div class="flex" style="gap:10px; flex-wrap:wrap;">
        <button class="btn btn-primary" id="pet_salvar">Salvar</button>
        <button class="btn btn-outline" id="pet_limpar">Limpar</button>
      </div>
    </div>

    <div class="panel" style="padding:18px;">
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap;">
        <div>
          <h2 style="margin:0;">Lista de Pets</h2>
          <div style="font-size:13px; color:#6b6280; margin-top:4px;">
            Busque rapidamente por nome, raça, espécie ou tutor.
          </div>
        </div>

        <div id="pet_total_badge" style="
          padding:6px 10px;
          border-radius:999px;
          background:#f3ecff;
          border:1px solid #dfcffd;
          color:#5b3ea8;
          font-size:12px;
          font-weight:700;
        ">
          0 pets
        </div>
      </div>

      <div class="search" style="margin-top:14px;">
        <input id="pet_busca" placeholder="Buscar por nome do pet, raça, espécie ou tutor..." />
        <button class="btn btn-ghost" id="pet_buscar">Buscar</button>
      </div>

      <div class="space"></div>

      <div class="list-scroll" style="
        border:1px solid #eee6ff;
        border-radius:14px;
        overflow:hidden;
        background:#fff;
      ">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Nome</th>
              <th>Espécie</th>
              <th>Raça</th>
              <th>Tutor</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody id="pet_tbody"></tbody>
        </table>
      </div>
    </div>
  </div>`;

  // ==== Tutor com busca por nome (Pets) ====
const tutorInput = document.getElementById('pet_tutor_input');
const dropdown = document.getElementById('pet_tutor_dropdown');
const tutorStatus = document.getElementById('pet_tutor_status');
const editStatus = document.getElementById('pet_edit_status');

function setTutorStatus(nome = '', id = null){
  if (!tutorStatus) return;

  if (nome && id) {
    tutorStatus.style.display = 'block';
    tutorStatus.innerHTML = `Tutor selecionado: <strong>${nome}</strong> <span style="opacity:.75;">(ID ${id})</span>`;
  } else {
    tutorStatus.style.display = 'none';
    tutorStatus.innerHTML = '';
  }
}

function setEditStatus(texto = ''){
  if (!editStatus) return;

  if (texto) {
    editStatus.style.display = 'block';
    editStatus.textContent = texto;
  } else {
    editStatus.style.display = 'none';
    editStatus.textContent = '';
  }
}

// guardamos selecionado
let selectedTutorId = null;

// função para renderizar a lista
function showTutorsFiltered(filtro='') {
  dropdown.innerHTML = '';
  filtro = filtro.toLowerCase();

  const filtrados = clientesOrdenados.filter(c => 
    c.nome.toLowerCase().includes(filtro)
  );

  filtrados.forEach(c => {
    const opt = document.createElement('div');
    opt.textContent = c.nome;
    opt.style.padding = '6px 10px';
    opt.style.cursor = 'pointer';

opt.onclick = () => {
  tutorInput.value = c.nome;
  selectedTutorId = c.id;
  dropdown.style.display = 'none';
  setTutorStatus(c.nome, c.id);
};

    opt.onmouseenter = () => opt.style.background = '#eee';
    opt.onmouseleave = () => opt.style.background = '#fff';

    dropdown.appendChild(opt);
  });

  dropdown.style.display = filtrados.length ? 'block' : 'none';
}

// quando digitar → filtra
tutorInput.addEventListener('input', () => {
  selectedTutorId = null; // reset
  setTutorStatus('', null);
  showTutorsFiltered(tutorInput.value.trim());
});

// se focar sem nada → mostra todos
tutorInput.addEventListener('focus', () => {
  showTutorsFiltered(tutorInput.value.trim());
});

// clique fora → fecha dropdown
document.addEventListener('click', (e) => {
  if (!tutorInput.contains(e.target) && !dropdown.contains(e.target)) {
    dropdown.style.display = 'none';
  }
});

  // ==== Raças por espécie (para o campo com datalist) ====
  const racasCachorro = [
    'SRD (Sem raça definida)',
    'Akita',
    'Beagle',
    'Buldogue Francês',
    'Buldogue Inglês',
    'Border Collie',
    'Boxer',
    'Chihuahua',
    'Cocker Spaniel',
    'Dachshund (Salsicha)',
    'Dálmata',
    'Dobermann',
    'Golden Retriever',
    'Labrador Retriever',
    'Lhasa Apso',
    'Maltês',
    'Pastor Alemão',
    'Pastor Shetland',
    'Pinscher',
    'Pitbull',
    'Poodle',
    'Pug',
    'Rottweiler',
    'Schnauzer',
    'Shih Tzu',
    'Spitz Alemão (Lulu da Pomerânia)',
    'Yorkshire Terrier'
  ];

  const racasGato = [
    'SRD (Sem raça definida)',
    'Siamês',
    'Persa',
    'Maine Coon',
    'Ragdoll',
    'Angorá',
    'Sphynx',
    'British Shorthair',
    'Bengal',
    'Exótico',
    'Norueguês da Floresta',
    'American Shorthair',
    'Russian Blue'
  ];

  const racasListEl = document.getElementById('racas_list');
  const especieSelEl = document.getElementById('pet_especie_sel');
  const racaInputEl = document.getElementById('pet_raca');

  function preencherRacasPorEspecie() {
    const especie = especieSelEl.value;
    racasListEl.innerHTML = '';

    let racas = [];
    if (especie === 'Cachorro') {
      racas = racasCachorro;
    } else if (especie === 'Gato') {
      racas = racasGato;
    } else if (especie === 'Outro') {
      racas = ['Outra espécie'];
    }

    racas.forEach(nome => {
      const opt = document.createElement('option');
      opt.value = nome;
      racasListEl.appendChild(opt);
    });
  }

  // sempre que mudar a espécie, refaz a lista de raças
  especieSelEl.addEventListener('change', () => {
    preencherRacasPorEspecie();
  });

  // primeira carga (quando abre a tela)
  preencherRacasPorEspecie();

  const updateEspecieOutro = () => {
    const sel = document.getElementById('pet_especie_sel').value;
    const outro = document.getElementById('pet_especie_outro');
    outro.disabled = (sel !== 'Outro');
    if (sel !== 'Outro') outro.value='';
  };
  const updateCondTexts = () => {
    const showWrap = (wrapId, cond)=>{ const el=document.getElementById(wrapId); if(el) el.style.display = cond?'block':'none'; };
    showWrap('grp_doencas', document.getElementById('pet_doencas_sel').value==='Sim');
    showWrap('grp_alergias', document.getElementById('pet_alergias_sel').value==='Sim');
    showWrap('grp_cuidados', document.getElementById('pet_cuidados_sel').value==='Sim');
  };
    const updateVacinaBlocks = () => {
    const showWrap = (wrapId, cond) => {
      const el = document.getElementById(wrapId);
      if (el) el.style.display = cond ? 'block' : 'none';
    };

    showWrap('pet_grp_vacina_viral', document.getElementById('pet_vacina_viral')?.checked);
    showWrap('pet_grp_vacina_antirrabica', document.getElementById('pet_vacina_antirrabica')?.checked);
    showWrap('pet_grp_antipulga', document.getElementById('pet_antipulga')?.checked);
  };
  document.getElementById('pet_especie_sel').onchange = updateEspecieOutro;
  ['pet_doencas_sel','pet_alergias_sel','pet_cuidados_sel'].forEach(id => {
    document.getElementById(id).onchange = updateCondTexts;
  });

  ['pet_vacina_viral','pet_vacina_antirrabica','pet_antipulga'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.onchange = updateVacinaBlocks;
  });

  updateEspecieOutro();
  updateCondTexts();
  updateVacinaBlocks();

  document.getElementById('pet_salvar').onclick = async () => {
    const get = id => document.getElementById(id);

    // 1) Tutor obrigatório
    const tutorId = Number(selectedTutorId);
    if (!tutorId) {
      toast('O campo Tutor não pode ficar vazio', false);
      get('pet_tutor_input').focus();
      return;
    }

    // 2) Campos obrigatórios
    const obrigatorios = [
      { id: 'pet_nome',       label: 'Nome' },
      { id: 'pet_especie_sel',label: 'Espécie' },
      { id: 'pet_raca',       label: 'Raça' },
      { id: 'pet_sexo',       label: 'Sexo' },
      { id: 'pet_nasc',       label: 'Nascimento' },
    ];

    for (const campo of obrigatorios) {
      const el = get(campo.id);
      if (!el) continue;

      let valor = el.value;
      // para inputs, tira espaços
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        valor = valor.trim();
      }

      if (!valor) {
        toast(`O campo ${campo.label} não pode ficar vazio`, false);
        el.focus();
        return;
      }
    }

    // 3) Se espécie for "Outro", o texto de espécie também é obrigatório
    const especieSel = get('pet_especie_sel').value;
    let especieOutro = get('pet_especie_outro').value.trim();
    if (especieSel === 'Outro' && !especieOutro) {
      toast('O campo Espécie (quando "Outro") não pode ficar vazio', false);
      get('pet_especie_outro').focus();
      return;
    }

    const especie = (especieSel === 'Outro') ? especieOutro : especieSel;

    // 4) Monta o registro
    const rec = {
      tutorId,
      nome:       get('pet_nome').value.trim(),
      especie,
      raca:       get('pet_raca').value.trim(),
      sexo:       get('pet_sexo').value,
      nascimento: get('pet_nasc').value,

      doencasFlag:   get('pet_doencas_sel').value === 'Sim',
      doencasTexto:  get('pet_doencas_txt').value.trim(),
      alergiasFlag:  get('pet_alergias_sel').value === 'Sim',
      alergiasTexto: get('pet_alergias_txt').value.trim(),
      cuidadosFlag:  get('pet_cuidados_sel').value === 'Sim',
      cuidadosTexto: get('pet_cuidados_txt').value.trim(),

      castrado:      get('pet_castrado').checked,

      vacinaViral:      get('pet_vacina_viral').checked,
      vacinaViralTipo:  get('pet_vacina_viral_tipo').value,
      vacinaViralMes:   get('pet_vacina_viral_mes').value || null,
      vacinaViralAno:   get('pet_vacina_viral_ano').value.trim() || null,

      vacinaAntirrabica:     get('pet_vacina_antirrabica').checked,
      vacinaAntirrabicaMes:  get('pet_vacina_antirrabica_mes').value || null,
      vacinaAntirrabicaAno:  get('pet_vacina_antirrabica_ano').value.trim() || null,

      antipulga:      get('pet_antipulga').checked,
      antipulgaTipo:  get('pet_antipulga_tipo').value,
      antipulgaMes:   get('pet_antipulga_mes').value || null,
      antipulgaAno:   get('pet_antipulga_ano').value.trim() || null,
    };

    const id = await DB.add('pets', rec);
    await DB.add('logs', {
      at: new Date().toISOString(),
      action: '...reate',
      entity: 'pet',
      entityId: id,
      note: `Criado ${rec.nome}`,
    });
    toast('Pet salvo');
    renderPets();
  };

  document.getElementById('pet_limpar').onclick = ()=>renderPets();
  document.getElementById('pet_buscar').onclick = ()=>loadPets(document.getElementById('pet_busca').value.trim());
  loadPets('');
}
async function loadPets(q){
  const tbody = document.getElementById('pet_tbody');
  const badge = document.getElementById('pet_total_badge');

  if (!tbody) return;
  tbody.innerHTML = '';

  const pets = await DB.list('pets');
  const clientes = await DB.list('clientes');
  const byId = Object.fromEntries(clientes.map(c => [c.id, c]));

  const termo = (q || '').trim().toLowerCase();

  let list = pets;

  if (termo) {
    list = pets.filter(p => {
      const tutorNome = String(byId[p.tutorId]?.nome || '').toLowerCase();
      const nome = String(p.nome || '').toLowerCase();
      const especie = String(p.especie || '').toLowerCase();
      const raca = String(p.raca || '').toLowerCase();

      const texto = `${nome} ${especie} ${raca} ${tutorNome}`.toLowerCase();
      return texto.includes(termo);
    });
  }

  list.sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || '')));

  if (badge) {
    const total = list.length;
    badge.textContent = `${total} pet${total !== 1 ? 's' : ''}`;
  }

  if (!list.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td colspan="6" style="padding:18px;">
        <div style="
          border:1px dashed #d9c8fb;
          border-radius:14px;
          padding:18px;
          background:#fcfaff;
          text-align:center;
          color:#6b6280;
        ">
          <div style="font-weight:800; color:#4f3b86; margin-bottom:4px;">
            Nenhum pet encontrado
          </div>
          <div style="font-size:13px;">
            ${termo ? 'Tente buscar por outro nome, raça, espécie ou tutor.' : 'Ainda não existem pets cadastrados.'}
          </div>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
    return;
  }

  for (const p of list) {
    const tutorNome = byId[p.tutorId]?.nome || p.tutorId || '';
    const especie = p.especie || '';
    const raca = p.raca || '';

    const vacinaViral = !!(p.vacinaViral ?? p.vacina_viral);
    const vacinaAntirrabica = !!(p.vacinaAntirrabica ?? p.vacina_antirrabica);
    const antipulga = !!(p.antipulga ?? p.antipulga);

    const chips = [];
    if (vacinaViral) chips.push('<span style="display:inline-block; padding:2px 8px; border-radius:999px; background:#efe7ff; color:#5b3ea8; font-size:11px; font-weight:700;">Viral</span>');
    if (vacinaAntirrabica) chips.push('<span style="display:inline-block; padding:2px 8px; border-radius:999px; background:#e8f7ff; color:#11607a; font-size:11px; font-weight:700;">Antirrábica</span>');
    if (antipulga) chips.push('<span style="display:inline-block; padding:2px 8px; border-radius:999px; background:#eefbf1; color:#1f7a38; font-size:11px; font-weight:700;">Antipulga</span>');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.id}</td>
      <td>
        <div style="font-weight:800; color:#2f2447;">${p.nome || ''}</div>
        <div style="font-size:12px; color:#7b728f; margin-top:4px;">
          ${chips.length ? chips.join(' ') : '<span style="opacity:.7;">Sem vacinas/proteções marcadas</span>'}
        </div>
      </td>
      <td>${especie}</td>
      <td>${raca}</td>
      <td>${tutorNome}</td>
      <td class="flex">
        <button class="btn btn-ghost" data-edit="${p.id}">Editar</button>
        <button class="btn btn-danger" data-del="${p.id}">Excluir</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  $all('[data-edit]').forEach(b => b.onclick = () => editPet(b.getAttribute('data-edit')));
  $all('[data-del]').forEach(b => b.onclick = () => delPet(b.getAttribute('data-del')));
}
async function editPet(id){
	id = Number(id);
  const p = await DB.get('pets', id); if (!p) return toast('Pet não encontrado', false);
  // Preenche o tutor no campo novo (input com busca)
const tutor = await DB.get('clientes', p.tutorId);
document.getElementById('pet_tutor_input').value = tutor?.nome || '';
const tutorStatus = document.getElementById('pet_tutor_status');
if (tutorStatus && tutor?.nome && p.tutorId) {
  tutorStatus.style.display = 'block';
  tutorStatus.innerHTML = `Tutor selecionado: <strong>${tutor.nome}</strong> <span style="opacity:.75;">(ID ${p.tutorId})</span>`;
}

const editStatus = document.getElementById('pet_edit_status');
if (editStatus) {
  editStatus.style.display = 'block';
  editStatus.textContent = `Modo edição: você está editando o pet "${p.nome || ''}" (ID ${p.id}).`;
}

// Atualiza o ID selecionado (mesma lógica do dropdown)
try { selectedTutorId = p.tutorId; } catch (e) {}
const dd = document.getElementById('pet_tutor_dropdown');
if (dd) dd.style.display = 'none';
  document.getElementById('pet_nome').value = p.nome||'';
  const known=['Cachorro','Gato'];
  if (known.includes(p.especie)) { document.getElementById('pet_especie_sel').value = p.especie; document.getElementById('pet_especie_outro').value=''; }
  else { document.getElementById('pet_especie_sel').value='Outro'; document.getElementById('pet_especie_outro').value=p.especie||''; }
  document.getElementById('pet_raca').value = p.raca||'';
  document.getElementById('pet_sexo').value = p.sexo||'';
  document.getElementById('pet_nasc').value = p.nascimento||'';
  document.getElementById('pet_doencas_sel').value = p.doencasFlag?'Sim':'Nao';
  document.getElementById('pet_alergias_sel').value = p.alergiasFlag?'Sim':'Nao';
  document.getElementById('pet_cuidados_sel').value = p.cuidadosFlag?'Sim':'Nao';
  document.getElementById('pet_doencas_txt').value = p.doencasTexto||'';
  document.getElementById('pet_alergias_txt').value = p.alergiasTexto||'';
  document.getElementById('pet_cuidados_txt').value = p.cuidadosTexto||'';
  document.getElementById('pet_castrado').checked = !!p.castrado;
  document.getElementById('pet_vacina_viral').checked =
    !!(p.vacinaViral ?? p.vacina_viral);
  document.getElementById('pet_vacina_viral_tipo').value =
    p.vacinaViralTipo ?? p.vacina_viral_tipo ?? '';
  document.getElementById('pet_vacina_viral_mes').value =
    p.vacinaViralMes ?? p.vacina_viral_mes ?? '';
  document.getElementById('pet_vacina_viral_ano').value =
    p.vacinaViralAno ?? p.vacina_viral_ano ?? '';

  document.getElementById('pet_vacina_antirrabica').checked =
    !!(p.vacinaAntirrabica ?? p.vacina_antirrabica);
  document.getElementById('pet_vacina_antirrabica_mes').value =
    p.vacinaAntirrabicaMes ?? p.vacina_antirrabica_mes ?? '';
  document.getElementById('pet_vacina_antirrabica_ano').value =
    p.vacinaAntirrabicaAno ?? p.vacina_antirrabica_ano ?? '';

  document.getElementById('pet_antipulga').checked =
    !!(p.antipulga);
  document.getElementById('pet_antipulga_tipo').value =
    p.antipulgaTipo ?? p.antipulga_tipo ?? '';
  document.getElementById('pet_antipulga_mes').value =
    p.antipulgaMes ?? p.antipulga_mes ?? '';
  document.getElementById('pet_antipulga_ano').value =
    p.antipulgaAno ?? p.antipulga_ano ?? '';
  const ev = new Event('change');
  document.getElementById('pet_especie_sel').dispatchEvent(ev);
  ['pet_doencas_sel','pet_alergias_sel','pet_cuidados_sel'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.dispatchEvent(ev);
  });
  ['pet_vacina_viral','pet_vacina_antirrabica','pet_antipulga'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.dispatchEvent(ev);
  });
  const salvar = document.getElementById('pet_salvar');
  salvar.textContent = 'Atualizar';
  const limpar = document.getElementById('pet_limpar');
if (limpar) limpar.textContent = 'Cancelar edição';
  
  salvar.onclick = async () => {
    const get = id => document.getElementById(id);

    // 1) Tutor obrigatório
        p.tutorId = Number(selectedTutorId);
    if (!p.tutorId) {
      toast('O campo Tutor não pode ficar vazio', false);
      get('pet_tutor_input').focus();
      return;
    }

    // 2) Campos obrigatórios
    const obrigatorios = [
      { id: 'pet_nome',       label: 'Nome' },
      { id: 'pet_especie_sel',label: 'Espécie' },
      { id: 'pet_raca',       label: 'Raça' },
      { id: 'pet_sexo',       label: 'Sexo' },
      { id: 'pet_nasc',       label: 'Nascimento' },
    ];

    for (const campo of obrigatorios) {
      const el = get(campo.id);
      if (!el) continue;

      let valor = el.value;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        valor = valor.trim();
      }

      if (!valor) {
        toast(`O campo ${campo.label} não pode ficar vazio`, false);
        el.focus();
        return;
      }
    }

    // 3) Espécie "Outro" exige texto
    const especieSel = get('pet_especie_sel').value;
    let especieOutro = get('pet_especie_outro').value.trim();
    if (especieSel === 'Outro' && !especieOutro) {
      toast('O campo Espécie (quando "Outro") não pode ficar vazio', false);
      get('pet_especie_outro').focus();
      return;
    }

    const especie = (especieSel === 'Outro') ? especieOutro : especieSel;

    // 4) Atualiza campos no objeto p
    p.nome        = get('pet_nome').value.trim();
    p.especie     = especie;
    p.raca        = get('pet_raca').value.trim();
    p.sexo        = get('pet_sexo').value;
    p.nascimento  = get('pet_nasc').value;
    p.doencasFlag = get('pet_doencas_sel').value === 'Sim';
    p.doencasTexto= get('pet_doencas_txt').value.trim();
    p.alergiasFlag= get('pet_alergias_sel').value === 'Sim';
    p.alergiasTexto = get('pet_alergias_txt').value.trim();
    p.cuidadosFlag  = get('pet_cuidados_sel').value === 'Sim';
    p.cuidadosTexto = get('pet_cuidados_txt').value.trim();
    p.castrado    = get('pet_castrado').checked;
	
	p.vacinaViral = get('pet_vacina_viral').checked;
    p.vacinaViralTipo = get('pet_vacina_viral_tipo').value;
    p.vacinaViralMes = get('pet_vacina_viral_mes').value || null;
    p.vacinaViralAno = get('pet_vacina_viral_ano').value.trim() || null;

    p.vacinaAntirrabica = get('pet_vacina_antirrabica').checked;
    p.vacinaAntirrabicaMes = get('pet_vacina_antirrabica_mes').value || null;
    p.vacinaAntirrabicaAno = get('pet_vacina_antirrabica_ano').value.trim() || null;

    p.antipulga = get('pet_antipulga').checked;
    p.antipulgaTipo = get('pet_antipulga_tipo').value;
    p.antipulgaMes = get('pet_antipulga_mes').value || null;
    p.antipulgaAno = get('pet_antipulga_ano').value.trim() || null;

    await DB.put('pets', p);
    await DB.add('logs', {
      at: new Date().toISOString(),
      action: '...e',
      entity: 'pet',
      entityId: p.id,
      note: `Atualizado ${p.nome}`,
    });
    toast('Pet atualizado');
    renderPets();
  };
}

async function delPet(id){
	id = Number(id);
  const p=await DB.get('pets', id);
  if (!confirm(`Excluir pet ${p?.nome||id}?`)) return;
  await DB.delete('pets', id);
  await DB.add('logs', { at:new Date().toISOString(), action:'delete', entity:'pet', entityId:Number(id), note:`Excluído` });
  toast('Pet excluído'); loadPets('');
}

let selectedHospTutorId = null; // tutor selecionado na tela de HOSPEDAGEM

// ==== HOSPEDAGEM ====
async function renderHosp(){
  const clientes = await DB.list('clientes');
  const clientesOrdenados = clientes.slice().sort((a,b)=>(a.nome||'').localeCompare(b.nome||''));
  const pets = await DB.list('pets');
  const byTutor = pets.reduce((acc,p)=>{ (acc[p.tutorId]=acc[p.tutorId]||[]).push(p); return acc; },{});
  const view = document.getElementById('view');
  view.innerHTML = `
  <div class="grid">
    <div class="panel">
      <h2>Nova Hospedagem</h2>
<div class="field" style="position:relative;">
  <label for="h_tutor_input">Tutor</label>
  <input id="h_tutor_input" placeholder="Digite para buscar..." autocomplete="off" />
  <div id="h_tutor_dropdown" class="dropdown-list" style="
    position:absolute;
    z-index:999;
    background:white;
    border:1px solid #ccc;
    border-radius:6px;
    width:100%;
    max-height:180px;
    overflow-y:auto;
    display:none;
  "></div>
</div>
      <label>Pets</label>
      <div id="h_pets_box"></div>
      <div class="row">
        ${Input('Data de Entrada', 'h_data_in', 'date')}
        ${Input('Data de Saída', 'h_data_out', 'date')}
      </div>
      <div class="row">
        ${Input('Check-in (hora)', 'h_hora_in', 'time')}
        ${Input('Check-out (hora)', 'h_hora_out', 'time')}
      </div>
      ${Input('Valor (R$)', 'h_valor', 'number', { step:'0.01', min:'0' })}
      ${TextArea('Observação', 'h_obs')}
      <div class="row">
        ${Select('Status', 'h_status', [{value:'agendada',label:'Agendada'},{value:'checkin',label:'Check-in feito'},{value:'checkout',label:'Check-out feito'},])}
      </div>
      <div class="space"></div>
      <div class="flex">
        <button class="btn btn-primary" id="h_salvar">Salvar</button>
        <button class="btn btn-outline" id="h_limpar">Limpar</button>
      </div>
    </div>
    <div class="panel">
      <div class="flex"><h2>Hospedagens</h2><div class="right"></div></div>
      <div class="search">
        <input id="h_busca" placeholder="Buscar por Tutor, Pet, Status..." />
        <button class="btn btn-ghost" id="h_buscar">Buscar</button>
      </div>
      <div class="space"></div>
      <div class="list-scroll"><table><thead><tr>
        <th>ID</th><th>Período</th><th>Tutor & Pets</th><th>Valor</th><th>Contrato</th><th>Status</th><th>Ações</th>
      </tr></thead><tbody id="h_tbody"></tbody></table></div>
    </div>
  </div>`;

const hTutorInput = document.getElementById('h_tutor_input');
const hTutorDropdown = document.getElementById('h_tutor_dropdown');

selectedHospTutorId = null;

function showHospTutorsFiltered(filtro='') {
  hTutorDropdown.innerHTML = '';
  filtro = filtro.toLowerCase();

  const filtrados = clientesOrdenados.filter(c => 
    c.nome.toLowerCase().includes(filtro)
  );

  filtrados.forEach(c => {
    const opt = document.createElement('div');
    opt.textContent = c.nome;
    opt.style.padding = '6px 10px';
    opt.style.cursor = 'pointer';

    opt.onclick = () => {
      hTutorInput.value = c.nome;
      selectedHospTutorId = c.id;
      hTutorDropdown.style.display = 'none';
      loadHospPetsForTutor();
    };

    opt.onmouseenter = () => opt.style.background = '#eee';
    opt.onmouseleave = () => opt.style.background = '#fff';

    hTutorDropdown.appendChild(opt);
  });

  hTutorDropdown.style.display = filtrados.length ? 'block' : 'none';
}

// digitar → filtrar
hTutorInput.addEventListener('input', () => {
  selectedHospTutorId = null;
  showHospTutorsFiltered(hTutorInput.value.trim());
  clearHospPets();
});

// focou → mostra tudo
hTutorInput.addEventListener('focus', () => {
  showHospTutorsFiltered(hTutorInput.value.trim());
});

// clique fora → fecha dropdown
document.addEventListener('click', (e) => {
  if (!hTutorInput.contains(e.target) && !hTutorDropdown.contains(e.target)) {
    hTutorDropdown.style.display = 'none';
  }
});
  // ====== PETS VINCULADOS AO TUTOR (NOVA VERSÃO) ======
  function clearHospPets(){
    const box = document.getElementById('h_pets_box');
    if (box) box.innerHTML = '';
  }

  function loadHospPetsForTutor(){
    const box = document.getElementById('h_pets_box');
    if (!box) return;

    box.innerHTML = '';

    // usamos o ID do tutor escolhido no combobox
    const tutorId = selectedHospTutorId;
    if (!tutorId) return;

    const lista = (byTutor[tutorId] || [])
      .slice()
      .sort((a,b)=>(a.nome||'').localeCompare(b.nome||''));

    lista.forEach(p => {
      const lbl = document.createElement('label');
      lbl.className = 'chk-inline';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.name = 'h_pet';
      cb.value = p.id;

      lbl.appendChild(cb);
      lbl.appendChild(document.createTextNode(' ' + p.nome));
      box.appendChild(lbl);
    });
  }

  document.getElementById('h_salvar').onclick = async () => {
    const get = id => document.getElementById(id);

const tutorId = Number(selectedHospTutorId);
    const petIds      = Array.from(document.querySelectorAll('input[name="h_pet"]:checked')).map(cb => Number(cb.value));
    const dataEntrada = get('h_data_in').value;
    const dataSaida   = get('h_data_out').value;
    const horaEntrada = get('h_hora_in').value;
    const horaSaida   = get('h_hora_out').value;
    const valorStr    = (get('h_valor').value || '').toString().trim();
    const status      = get('h_status').value;

    // Tutor obrigatório
    if (!tutorId) {
      toast('O campo Tutor não pode ficar vazio', false);
      hTutorInput.focus();
      return;
    }

    // Pelo menos um pet
    if (!petIds.length) {
      toast('Selecione pelo menos um pet', false);
      const first = document.querySelector('input[name="h_pet"]');
      if (first) first.focus();
      return;
    }

    // Datas obrigatórias
    if (!dataEntrada) {
      toast('O campo Data de entrada não pode ficar vazio', false);
      get('h_data_in').focus();
      return;
    }
    if (!dataSaida) {
      toast('O campo Data de saída não pode ficar vazio', false);
      get('h_data_out').focus();
      return;
    }

    // Horas obrigatórias
    if (!horaEntrada) {
      toast('O campo Hora de entrada não pode ficar vazio', false);
      get('h_hora_in').focus();
      return;
    }
    if (!horaSaida) {
      toast('O campo Hora de saída não pode ficar vazio', false);
      get('h_hora_out').focus();
      return;
    }

    // Valor obrigatório
    if (!valorStr) {
      toast('O campo Valor não pode ficar vazio', false);
      get('h_valor').focus();
      return;
    }

    // Status obrigatório
    if (!status) {
      toast('O campo Status não pode ficar vazio', false);
      get('h_status').focus();
      return;
    }

    const rec = {
      tutorId,
      petIds,
      dataEntrada,
      dataSaida,
      horaEntrada,
      horaSaida,
      valor: Number(valorStr || 0),
      status: status || 'agendada',
      observacao: get('h_obs').value.trim(),
      nota: (get('h_obs').value || '').trim(),
    };

    const id = await DB.add('hospedagens', rec);
    await DB.add('logs', {
      at: new Date().toISOString(),
      action: '...Id',
      entity: 'hospedagem',
      entityId: id,
      note: `Tutor #${tutorId} Pets ${rec.petIds.join(',')}`,
    });
	
    toast('Hospedagem salva');
	
	// ✅ gera link do contrato automaticamente
try {
  await gerarLinkContrato("hospedagem", id);
} catch (e) {
  console.warn("Falha ao gerar contrato:", e);
  toast("Hospedagem salva, mas não gerou link: " + (e?.message || e), false);
}

    renderHosp();
  };

  document.getElementById('h_limpar').onclick = ()=>renderHosp();
  document.getElementById('h_buscar').onclick = ()=>loadHosp(document.getElementById('h_busca').value.trim());
  loadHosp('');
}
async function loadHosp(q){
  const tbody = document.getElementById('h_tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  
    // ✅ Otimização:
  // - sem busca: carrega só os últimos N (rápido)
  // - com busca: carrega tudo (pra pesquisa funcionar em 100% dos dados)
  const LIMITE_SEM_BUSCA = 250;

  let all = [];
  if (!q) {
    // pega os mais recentes (por id desc) sem baixar tudo
    all = await DB.page('hospedagens', { offset: 0, limit: LIMITE_SEM_BUSCA, orderBy: 'id', ascending: false });
  } else {
    // busca precisa considerar o banco inteiro
    all = await DB.list('hospedagens');
  }
  const clientes = await DB.list('clientes');
  const byCli = Object.fromEntries(clientes.map(c => [c.id, c]));
  const pets = await DB.list('pets');
  const byPet = Object.fromEntries(pets.map(p => [p.id, p]));

// ✅ contratos (para pintar status do "Contrato")
// (não pode quebrar a lista se a tabela/policy der erro)
let contratos = [];
try {
  contratos = await DB.list('contratos');
} catch (e) {
  console.warn("Aviso: não foi possível carregar contratos (lista continua mesmo assim).", e);
  contratos = [];
}

  // pega o contrato mais recente por (kind|ref_id)
const byContrato = {};
for (const c of (contratos || [])) {
  const ref = (c.ref_id ?? c.refId ?? c.refID); // ✅ pega o nome certo vindo do Supabase
  const key = `${c.kind}|${ref}`;
  if (!byContrato[key] || Number(c.id) > Number(byContrato[key].id)) {
    byContrato[key] = c;
  }
}

  let list = all;

  // se tiver texto de busca, filtra por Tutor, Pet e Período
  if (q) {
    const qLower = String(q).toLowerCase();
    list = all.filter(h => {
      const tutorName = (byCli[h.tutorId]?.nome || '').toLowerCase();
      const petNamesStr = (h.petIds || [])
        .map(id => byPet[id]?.nome || '')
        .join(', ')
        .toLowerCase();

      const dIn  = h.dataEntrada || '';
      const dOut = h.dataSaida   || '';

      // datas em ISO e em BR
      const periodoStr = (
        dIn + ' ' +
        dOut + ' ' +
        (fmtBR(dIn)  || '') + ' ' +
        (fmtBR(dOut) || '')
      ).toLowerCase();

      const statusStr = String(h.status || '').toLowerCase();
      const idStr     = String(h.id || '');

      return (
        tutorName.includes(qLower) ||
        petNamesStr.includes(qLower) ||
        periodoStr.includes(qLower) ||
        statusStr.includes(qLower) ||
        idStr.includes(qLower)
      );
    });
  }

  // monta tabela
  for (const h of list.sort((a,b)=>String(a.dataEntrada).localeCompare(String(b.dataEntrada)))) {
    const tutor = byCli[h.tutorId]?.nome || ('Tutor #'+h.tutorId);
    const petNames = (h.petIds||[]).map(id=>byPet[id]?.nome||('#'+id)).join(', ');
    const tr = document.createElement('tr');
	const ckey = `hospedagem|${h.id}`;
const c = byContrato[ckey];

let contratoClass = 'tag-red';
let contratoTitle = 'Contrato NÃO gerado (clique para pegar/gerar o link)';

if (c) {
  if (__isAcceptedContract(c)) {
    contratoClass = 'tag-green';
    contratoTitle = 'Contrato ACEITO (clique para copiar/pegar o link)';
  } else {
    contratoClass = 'tag-yellow';
    contratoTitle = 'Contrato PENDENTE (clique para copiar/pegar o link)';
  }
}
tr.innerHTML = `<td>${h.id}</td>
  <td>${fmtBR(h.dataEntrada)} → ${fmtBR(h.dataSaida)}</td>
  <td><strong>${tutor}</strong> — ${petNames}</td>
  <td>${fmtMoney(h.valor)}</td>

  <td>
    <span class="tag ${contratoClass}" data-contrato="${h.id}" title="${contratoTitle}" style="cursor:pointer;">
      Contrato
    </span>
  </td>

  <td>
    <span class="tag ${getStatusTagClass(h.status)}">${h.status || ''}</span>
    ${h.nota && h.nota.trim() ? ' <span title="Tem observações">📝</span>' : ''}
  </td>

  <td class="flex">
    <button class="btn btn-ghost" data-edit="${h.id}">Editar</button>
    <button class="btn btn-danger" data-del="${h.id}">Excluir</button>
  </td>`;
    tbody.appendChild(tr);
  }

  $all('[data-edit]').forEach(b=>b.onclick=()=>editHosp(b.getAttribute('data-edit')));
  $all('[data-del]').forEach(b=>b.onclick=()=>delHosp(b.getAttribute('data-del')));
$all('[data-contrato]').forEach(b => b.onclick = async () => {
  const id = Number(b.getAttribute('data-contrato'));
  try{
    await showContractLink('hospedagem', id);

    // repinta a lista depois de fechar (caso o contrato tenha sido aceito)
    const q = document.getElementById('h_search')?.value || '';
    await loadHosp(q);
  } catch(e){
    console.error(e);
    toast('Não consegui abrir o contrato. Veja o console.', false);
  }
});
}

async function delHosp(id){
  const h = await DB.get('hospedagens', id);
  if (!confirm(`Excluir hospedagem ${h?.id}?`)) return;
  await DB.delete('hospedagens', id);
  // Excluir pagamentos associados a essa hospedagem
const payList = await DB.list('pagamentos');
for (const p of payList.filter(p => p.refKind === 'hospedagem' && p.refId === Number(id))) {
  await DB.delete('pagamentos', p.id);
}
  await DB.add('logs', { at:new Date().toISOString(), action:'delete', entity:'hospedagem', entityId:Number(id), note:`Excluída` });
  toast('Hospedagem excluída');
  loadHosp('');
}

async function editHosp(id){
  const h = await DB.get('hospedagens', id);
  if (!h) return toast('Hospedagem não encontrada', false);

  // Renderiza a tela de hospedagem do zero
  await renderHosp();

  // Recarrega clientes e pets para montar tutor + pets
  const clientes = await DB.list('clientes');
  const pets     = await DB.list('pets');
  const byTutor  = pets.reduce((acc,p)=>{
    (acc[p.tutorId] = acc[p.tutorId] || []).push(p);
    return acc;
  },{});

  const hTutorInput = document.getElementById('h_tutor_input');
  const box         = document.getElementById('h_pets_box');

  // Preenche tutor no campo novo e seta a variável global
  selectedHospTutorId = h.tutorId || 0;
  if (hTutorInput){
    const cli = clientes.find(c => c.id === h.tutorId);
    hTutorInput.value = cli ? (cli.nome || '') : '';
  }

  // Monta a lista de pets do tutor e marca os já escolhidos
  box.innerHTML = '';
  const listaPets = (byTutor[h.tutorId] || [])
    .slice()
    .sort((a,b)=>(a.nome||'').localeCompare(b.nome||''));

  listaPets.forEach(p => {
    const lbl = document.createElement('label');
    lbl.className = 'chk-inline';

    const cb = document.createElement('input');
    cb.type  = 'checkbox';
    cb.name  = 'h_pet';
    cb.value = p.id;
    if ((h.petIds || []).includes(p.id)) cb.checked = true;

    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(' ' + p.nome));
    box.appendChild(lbl);
  });

  // Preenche os outros campos
  document.getElementById('h_data_in').value  = h.dataEntrada || '';
  document.getElementById('h_data_out').value = h.dataSaida   || '';
  document.getElementById('h_hora_in').value  = h.horaEntrada || '';
  document.getElementById('h_hora_out').value = h.horaSaida   || '';
  document.getElementById('h_valor').value    = h.valor || 0;
  document.getElementById('h_status').value   = h.status || 'agendada';
  document.getElementById('h_obs').value      = (h.nota ?? h.observacao ?? '');

  // Troca o botão Salvar para atualizar
  const salvar = document.getElementById('h_salvar');
  salvar.textContent = 'Atualizar';
  salvar.onclick = async () => {
    const get = id => document.getElementById(id);

    const tutorId     = Number(selectedHospTutorId || 0);
    const petIds      = Array.from(document.querySelectorAll('input[name="h_pet"]:checked')).map(cb => Number(cb.value));
    const dataEntrada = get('h_data_in').value;
    const dataSaida   = get('h_data_out').value;
    const horaEntrada = get('h_hora_in').value;
    const horaSaida   = get('h_hora_out').value;
    const valorStr    = (get('h_valor').value || '').toString().trim();
    const status      = get('h_status').value;

    // Tutor obrigatório
    if (!tutorId) {
      toast('O campo Tutor não pode ficar vazio', false);
      if (hTutorInput) hTutorInput.focus();
      return;
    }

    // Pelo menos um pet
    if (!petIds.length) {
      toast('Selecione pelo menos um pet', false);
      const first = document.querySelector('input[name="h_pet"]');
      if (first) first.focus();
      return;
    }

    // Datas obrigatórias
    if (!dataEntrada) {
      toast('O campo Data de entrada não pode ficar vazio', false);
      get('h_data_in').focus();
      return;
    }
    if (!dataSaida) {
      toast('O campo Data de saída não pode ficar vazio', false);
      get('h_data_out').focus();
      return;
    }

    // Horas obrigatórias
    if (!horaEntrada) {
      toast('O campo Hora de entrada não pode ficar vazio', false);
      get('h_hora_in').focus();
      return;
    }
    if (!horaSaida) {
      toast('O campo Hora de saída não pode ficar vazio', false);
      get('h_hora_out').focus();
      return;
    }

    // Valor obrigatório
    if (!valorStr) {
      toast('O campo Valor não pode ficar vazio', false);
      get('h_valor').focus();
      return;
    }

    // Status obrigatório
    if (!status) {
      toast('O campo Status não pode ficar vazio', false);
      get('h_status').focus();
      return;
    }

    // Atualiza o objeto h
    h.tutorId     = tutorId;
    h.petIds      = petIds;
    h.dataEntrada = dataEntrada;
    h.dataSaida   = dataSaida;
    h.horaEntrada = horaEntrada;
    h.horaSaida   = horaSaida;
    h.valor       = Number(valorStr || 0);
    h.status      = status || 'agendada';
    h.observacao  = get('h_obs').value.trim();
    h.nota        = (get('h_obs').value || '').trim();

    await DB.put('hospedagens', h);
    await DB.add('logs', {
      at: new Date().toISOString(),
      action: 'update',
      entity: 'hospedagem',
      entityId: h.id,
      note: `Atualizada`,
    });
    toast('Hospedagem atualizada');
    renderHosp();
  };
}

let selectedCrecheTutorId = null;   // tutor selecionado na tela de CRECHE

// ==== CRECHE ====
async function renderCreche(prefill = null){
  const clientes = await DB.list('clientes');
  const clientesOrdenados = clientes.slice().sort((a,b)=>(a.nome||'').localeCompare(b.nome||''));
  const pets = await DB.list('pets');
  const byTutor = pets.reduce((acc,p)=>{ (acc[p.tutorId]=acc[p.tutorId]||[]).push(p); return acc; },{});
  const today = new Date();
  const ym = (d)=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
  const view = document.getElementById('view');
  view.innerHTML = `
  <div class="grid">
    <div class="panel">
      <h2>Nova Agenda de Creche</h2>
      <div class="field" style="position:relative;">
        <label for="c_tutor_input">Tutor</label>
        <input id="c_tutor_input" placeholder="Digite para buscar..." autocomplete="off" />
        <div id="c_tutor_dropdown" class="dropdown-list" style="
          position:absolute;
          z-index:999;
          background:white;
          border:1px solid #ccc;
          border-radius:6px;
          width:100%;
          max-height:180px;
          overflow-y:auto;
          display:none;
        "></div>
      </div>
      <label>Pets</label>
      <div id="c_pets_box"></div>
      ${Select('Frequência semanal - Segunda a Domingo', 'c_freq', [{value:'1',label:'1x por semana'},{value:'2',label:'2x por semana'},{value:'3',label:'3x por semana'},{value:'4',label:'4x por semana'},{value:'5',label:'5x por semana'},{value:'6',label:'6x por semana'},{value:'7',label:'7x por semana'},{value:'ALE',label:'Aleatório'}])}
      ${Input('Valor (R$) para o período', 'c_valor', 'number', { step:'0.01', min:'0' })}
      ${Select('Status', 'c_status', [
    {value:'Agendado',label:'Agendado'},
    {value:'checkin',label:'Check-in feito'},
    {value:'checkout',label:'Check-out feito'}
])}
      ${TextArea('Observações', 'c_obs')}
	  <div class="row">
        ${Input('Entrada padrão (hora)', 'c_hora_in', 'time')}
        ${Input('Saída padrão (hora)', 'c_hora_out', 'time')}
      </div>
      <div class="flex">
        <button class="btn btn-outline" id="c_prev">◀ Mês anterior</button>
        <div class="right"></div>
        <strong id="c_label_mes"></strong>
        <div class="right"></div>
        <button class="btn btn-outline" id="c_next">Próximo mês ▶</button>
      </div>
      <div class="cal-head"><div>Dom</div><div>Seg</div><div>Ter</div><div>Qua</div><div>Qui</div><div>Sex</div><div>Sáb</div></div>
      <div id="c_calendar" class="calendar"></div>
      <div class="space"></div>
      <div class="panel">
        <h3>Dias selecionados</h3>
        <div id="c_days_list" class="mono"></div>
      </div>
      <div class="space"></div>
      <div class="flex">
        <button class="btn btn-primary" id="c_salvar">Salvar agenda</button>
        <button class="btn btn-outline" id="c_limpar">Limpar</button>
      </div>
    </div>
    <div class="panel">
      <div class="flex"><h2>Agendas de Creche</h2><div class="right"></div></div>
      <div class="search">
        <input id="c_busca" type="text" placeholder="Buscar por Tutor, Pet ou Mês..." />
        <button class="btn btn-ghost" id="c_buscar">Buscar</button>
      </div>
      <div class="space"></div>
      <div class="list-scroll"><table><thead><tr>
        <th>ID</th><th>Mês</th><th>Tutor & Pets</th><th>Dias</th><th>Valor</th><th>Contrato</th><th>Status</th><th>Ações</th>
      </tr></thead><tbody id="c_tbody"></tbody></table></div>
    </div>
  </div>`;

  // ==== Tutor com busca em um único campo (Creche) ====
  const cTutorInput    = document.getElementById('c_tutor_input');
  const cTutorDropdown = document.getElementById('c_tutor_dropdown');

  // carrega pets do tutor selecionado
  function loadPetsForTutor() {
    const tutorId = Number(selectedCrecheTutorId || 0);
    const box = document.getElementById('c_pets_box'); 
    box.innerHTML = '';

    if (!tutorId) return;

    const petsDoTutor = (byTutor[tutorId] || []).slice().sort((a,b)=>(a.nome||'').localeCompare(b.nome||''));
    if (!petsDoTutor.length) {
      box.textContent = 'Nenhum pet cadastrado para este tutor.';
      return;
    }

    petsDoTutor.forEach(p => {
      const lbl = document.createElement('label');
      lbl.className = 'chk-inline';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.name = 'c_pet';
      cb.value = p.id;

      lbl.appendChild(cb);
      lbl.appendChild(document.createTextNode(` ${p.nome}`));
      box.appendChild(lbl);
    });
  }

  function showCrecheTutorsFiltered(filtro = '') {
    if (!cTutorDropdown) return;

    cTutorDropdown.innerHTML = '';
    const termo = (filtro || '').toLowerCase();

    const filtrados = clientesOrdenados.filter(c =>
      (c.nome || '').toLowerCase().includes(termo)
    );

    filtrados.forEach(c => {
      const opt = document.createElement('div');
      opt.textContent = c.nome || '';
      opt.style.padding = '6px 10px';
      opt.style.cursor  = 'pointer';

      opt.onclick = () => {
        cTutorInput.value = c.nome || '';
        selectedCrecheTutorId = c.id;
        cTutorDropdown.style.display = 'none';
        loadPetsForTutor();
      };

      opt.onmouseenter = () => opt.style.background = '#eee';
      opt.onmouseleave = () => opt.style.background = '#fff';

      cTutorDropdown.appendChild(opt);
    });

    cTutorDropdown.style.display = filtrados.length ? 'block' : 'none';
  }

  if (cTutorInput) {
    // começa sem tutor selecionado
    selectedCrecheTutorId = null;

    // digitar → filtrar
    cTutorInput.addEventListener('input', () => {
      selectedCrecheTutorId = null;
      const box = document.getElementById('c_pets_box');
      if (box) box.innerHTML = '';
      showCrecheTutorsFiltered(cTutorInput.value.trim());
    });

    // focar → mostrar todos
    cTutorInput.addEventListener('focus', () => {
      showCrecheTutorsFiltered(cTutorInput.value.trim());
    });

    // clique fora → esconder dropdown
    document.addEventListener('click', (e) => {
      if (!cTutorInput.contains(e.target) && !cTutorDropdown.contains(e.target)) {
        cTutorDropdown.style.display = 'none';
      }
    });
  }

  let current = new Date(today.getFullYear(), today.getMonth(), 1);
  const selection = {};
  if (prefill && prefill.dias) {
    for (const d of prefill.dias) {
      selection[d.data] = { entrada: d.entrada || '', saida: d.saida || '' };
    }
  } // date -> {entrada,saida}

  function repaint(){
    document.getElementById('c_label_mes').textContent = current.toLocaleString('pt-BR', { month:'long', year:'numeric' });
    const cal = document.getElementById('c_calendar'); cal.innerHTML='';
    const start = new Date(current.getFullYear(), current.getMonth(), 1);
    const end = new Date(current.getFullYear(), current.getMonth()+1, 0);
    const firstWeekday = start.getDay();
    for (let i=0;i<firstWeekday;i++){ const d=document.createElement('div'); cal.appendChild(d); }
    for (let d=1; d<=end.getDate(); d++){
      const dateStr = `${current.getFullYear()}-${String(current.getMonth()+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const cell = document.createElement('div'); cell.className='day'; cell.textContent=d;
      const todayStr = new Date().toISOString().slice(0,10);
      if (dateStr < todayStr) cell.classList.add('disabled');
      if (selection[dateStr]) cell.classList.add('selected');
      cell.onclick = ()=>{
        if (cell.classList.contains('disabled')) return;

        // Se já está selecionado, permite remover normalmente
        if (selection[dateStr]) {
          delete selection[dateStr];
          repaint();
          renderDaysList();
          return;
        }

        // Vai ADICIONAR um dia novo:
        // exige que os horários padrão estejam preenchidos
        const horaIn  = document.getElementById('c_hora_in').value || '';
        const horaOut = document.getElementById('c_hora_out').value || '';

        if (!horaIn || !horaOut) {
          toast('Preencha os horários padrão de entrada e saída antes de selecionar os dias', false);
          if (!horaIn) {
            document.getElementById('c_hora_in').focus();
          } else {
            document.getElementById('c_hora_out').focus();
          }
          return;
        }

        // Regra da frequência semanal (1x, 2x, ... por semana)
        const freqSel = (document.getElementById('c_freq')?.value) || 'ALE';
        const freqNum = parseInt(freqSel, 10);

        if (!isNaN(freqNum) && freqNum > 0) {
          // Calcula a semana (segunda até domingo) do dia que está sendo selecionado
          const [Y, M, D] = dateStr.split('-').map(Number);
          const dataAtual = new Date(Y, M - 1, D);
          const diaSemana = dataAtual.getDay(); // 0 = domingo, 1 = segunda, ...

          // Encontra a segunda-feira da semana (referência: segunda até domingo)
          const diffParaSegunda = (diaSemana + 6) % 7; // segunda=1 -> 0, domingo=0 -> 6
          const segunda = new Date(dataAtual);
          segunda.setDate(dataAtual.getDate() - diffParaSegunda);

          const domingo = new Date(segunda);
          domingo.setDate(segunda.getDate() + 6);

          // Conta quantos dias já estão selecionados nessa semana
          let countSemana = 0;
          for (const chave of Object.keys(selection)) {
            const [y2, m2, d2] = chave.split('-').map(Number);
            const dataSel = new Date(y2, m2 - 1, d2);
            if (dataSel >= segunda && dataSel <= domingo) {
              countSemana++;
            }
          }

          if (countSemana >= freqNum) {
            toast(`Para a frequência selecionada (${freqNum}x por semana), você só pode selecionar ${freqNum} dia(s) entre segunda e domingo`, false);
            return;
          }
        }

        // se passou pelas validações, usa os horários padrão
        selection[dateStr] = { entrada: horaIn, saida: horaOut };

        repaint();
        renderDaysList();
      };
      cal.appendChild(cell);
    }
    renderDaysList();
  }
  function renderDaysList(){
    const list = Object.keys(selection).sort();
    const cont = document.getElementById('c_days_list'); cont.innerHTML='';
    if (list.length===0){ cont.textContent = '(Nenhum dia selecionado)'; return; }
    for (const d of list){
      const row = document.createElement('div');
	  
    // Converte "d" (YYYY-MM-DD) para dia da semana + data BR
    const [Y, M, D] = (d || "").split('-').map(Number);
    const dateObj = new Date(Y, M - 1, D);

    // Dia da semana em pt-BR (ex.: "quinta-feira")
    let weekday = dateObj.toLocaleDateString('pt-BR', { weekday: 'long' });
    // Deixa a primeira letra maiúscula
    weekday = weekday.charAt(0).toUpperCase() + weekday.slice(1);

    // Data no formato DD/MM/YYYY
    const dataBR = dateObj.toLocaleDateString('pt-BR');

    // Monta a linha final
    row.innerHTML = `<strong>${weekday} — ${dataBR}</strong> — Entrada: <input type="time" id="in_${d}"> Saída: <input type="time" id="out_${d}"> <button class="btn btn-ghost" data-del="${d}">Remover</button>`;

      cont.appendChild(row);
      document.getElementById(`in_${d}`).value = selection[d].entrada||'';
      document.getElementById(`out_${d}`).value = selection[d].saida||'';
      document.getElementById(`in_${d}`).onchange = (e)=> selection[d].entrada = e.target.value;
      document.getElementById(`out_${d}`).onchange = (e)=> selection[d].saida = e.target.value;
    }
    $all('[data-del]').forEach(b=>b.onclick=()=>{ delete selection[b.getAttribute('data-del')]; repaint(); });
  }

  document.getElementById('c_prev').onclick = ()=>{ current = new Date(current.getFullYear(), current.getMonth()-1, 1); repaint(); };
  document.getElementById('c_next').onclick = ()=>{ current = new Date(current.getFullYear(), current.getMonth()+1, 1); repaint(); };
  repaint();

  document.getElementById('c_limpar').onclick = ()=>renderCreche();

  document.getElementById('c_salvar').onclick = async () => {
    const get       = id => document.getElementById(id);
    const tutorId   = Number(selectedCrecheTutorId || 0);
    const petIds    = Array.from(document.querySelectorAll('input[name="c_pet"]:checked')).map(cb => Number(cb.value));
    const valorStr  = (get('c_valor').value || '').toString().trim();

    // === VALIDAÇÕES OBRIGATÓRIAS ===

    // Tutor obrigatório
    if (!tutorId) {
      toast('O campo Tutor não pode ficar vazio', false);
      const inp = document.getElementById('c_tutor_input');
      if (inp) inp.focus();
      return;
    }

    // Pelo menos um pet
    if (!petIds.length) {
      toast('Selecione pelo menos um pet', false);
      const first = document.querySelector('input[name="c_pet"]');
      if (first) first.focus();
      return;
    }

    // Valor obrigatório
    if (!valorStr) {
      toast('O campo Valor não pode ficar vazio', false);
      get('c_valor').focus();
      return;
    }

    // === FIM VALIDAÇÕES OBRIGATÓRIAS ===

    const dias = Object.keys(selection).sort().map(d => ({
      data: d,
      entrada: selection[d].entrada || '',
      saida: selection[d].saida || ''
    }));

    if (dias.length === 0) {
      toast('Selecione ao menos um dia no calendário', false);
      return;
    }

    const rec = {
      tutorId,
      petIds,
      valor: Number(valorStr || 0),
      status: get('c_status').value || 'Agendado',
      freq: (get('c_freq')?.value) || 'ALE',
      mesRef: ym(current),
      dias,
      nota: (get('c_obs').value || '').trim()
    };

    const id = await DB.add('creches', rec);

    await DB.add('logs', {
      at: new Date().toISOString(),
      action: 'create',
      entity: 'creche',
      entityId: id,
      note: `Tutor #${tutorId} com ${dias.length} dias`
    });

    toast('Agenda de creche salva');

    // ✅ gera link do contrato automaticamente para creche
    try {
      await gerarLinkContrato("creche", id);
    } catch (e) {
      console.warn("Falha ao gerar contrato da creche:", e);
      toast("Creche salva, mas não gerou link: " + (e?.message || e), false);
    }

    renderCreche();
  };

  // Busca de agendas de creche
  const cBuscaInput = document.getElementById('c_busca');
  const cBuscarBtn  = document.getElementById('c_buscar');

  if (cBuscarBtn && cBuscaInput) {
    cBuscarBtn.onclick = () => {
      const termo = cBuscaInput.value.trim();
      loadCreches(termo);
    };
  }

  // Carrega tudo inicialmente (sem filtro)
  loadCreches('');
}


async function loadCreches(q){
  const tbody = document.getElementById('c_tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  // ✅ Otimização:
  // - sem busca: carrega só os últimos N (rápido)
  // - com busca: carrega tudo (pra pesquisa funcionar em 100% dos dados)
  const LIMITE_SEM_BUSCA = 250;

  let todas = [];
  if (!q) {
    // pega as mais recentes (por id desc) sem baixar tudo
    todas = await DB.page('creches', { offset: 0, limit: LIMITE_SEM_BUSCA, orderBy: 'id', ascending: false });
  } else {
    // busca precisa considerar o banco inteiro
    todas = await DB.list('creches');
  }

  // mapas de clientes e pets para pegar nomes
  const clientes = await DB.list('clientes');
  const byCli = Object.fromEntries(clientes.map(c => [c.id, c]));

  const pets = await DB.list('pets');
  const byPet = Object.fromEntries(pets.map(p => [p.id, p]));
  
  // ✅ contratos (para pintar status do "Contrato")
let contratos = [];
try {
  contratos = await DB.list('contratos');
} catch (e) {
  console.warn("Aviso: não foi possível carregar contratos da creche.", e);
  contratos = [];
}

// pega o contrato mais recente por (kind|ref_id)
const byContrato = {};
for (const c of (contratos || [])) {
  const ref = (c.ref_id ?? c.refId ?? c.refID);
  const key = `${c.kind}|${ref}`;
  if (!byContrato[key] || Number(c.id) > Number(byContrato[key].id)) {
    byContrato[key] = c;
  }
}

  const termo = (q || '').trim().toLowerCase();

  let list = todas;

  // Se tiver texto digitado, filtra por:
  // - Nome do tutor
  // - Nome dos pets
  // - Mês de referência (mesRef)
  // - Status
  // - Observação (nota)
  if (termo) {
    list = todas.filter(c => {
      const tutorNome = byCli[c.tutorId]?.nome || ('Tutor #' + c.tutorId);
      const petNames = (c.petIds || []).map(id => byPet[id]?.nome || ('#' + id)).join(', ');
      const mes = String(c.mesRef || '');
      const status = String(c.status || '');
      const nota = String(c.nota || '');

      const texto = (tutorNome + ' ' + petNames + ' ' + mes + ' ' + status + ' ' + nota).toLowerCase();
      return texto.includes(termo);
    });
  }

  // ordena por mesRef
  list.sort((a, b) => String(a.mesRef || '').localeCompare(String(b.mesRef || '')));

  for (const c of list) {
    const tutor = byCli[c.tutorId]?.nome || ('Tutor #'+c.tutorId);
    const petNames = (c.petIds || []).map(id => byPet[id]?.nome || ('#'+id)).join(', ');
    const diasCount = (c.dias || []).length;

    // Formata o mês: de "2025-11" para "11-2025"
    let mesRefBR = '';
    if (c.mesRef) {
      const parts = String(c.mesRef).split('-');
      if (parts.length === 2) {
        const ano = parts[0];
        const mes = parts[1];
        mesRefBR = `${mes}-${ano}`; // MM-AAAA
      } else {
        mesRefBR = c.mesRef;
      }
    }

    const tr = document.createElement('tr');
const ckey = `creche|${c.id}`;
const contrato = byContrato[ckey];

let contratoClass = 'tag-red';
let contratoTitle = 'Contrato NÃO gerado (clique para gerar/abrir o link)';

if (contrato) {
  const exp = (contrato.expires_at ?? contrato.expiresAt ?? null);
  const expMs = exp ? new Date(exp).getTime() : 0;
  const expired = expMs ? (Date.now() > expMs) : false;

  const aceito =
    contrato?.status === 'aceito' ||
    contrato?.accepted_at ||
    contrato?.acceptedAt;

  if (aceito) {
    contratoClass = 'tag-green';
    contratoTitle = 'Contrato ACEITO (clique para abrir)';
  } else if (expired || contrato?.status === 'expirado') {
    contratoClass = 'tag-yellow';
    contratoTitle = 'Contrato expirado (clique para gerar novo link)';
  } else {
    contratoClass = 'tag-yellow';
    contratoTitle = 'Contrato pendente (clique para abrir/copiar)';
  }
}

tr.innerHTML = `
  <td>${c.id}</td>
  <td>${mesRefBR}</td>
  <td><strong>${tutor}</strong> — ${petNames}</td>
  <td>${diasCount}</td>
  <td>${fmtMoney(c.valor || 0)}</td>

  <td>
    <span class="tag ${contratoClass}" data-contrato-creche="${c.id}" title="${contratoTitle}" style="cursor:pointer;">
      Contrato
    </span>
  </td>

  <td>
<span class="tag ${getStatusTagClass(c.status)}" style="padding:2px 6px">
  ${c.status || 'Agendado'}
</span>
    ${c.nota && c.nota.trim() ? ' <span title="Tem observações">📝</span>' : ''}
  </td>

  <td class="flex">
    <button class="btn btn-ghost" data-edit="${c.id}">Editar</button>
    <button class="btn btn-danger" data-del="${c.id}">Excluir</button>
  </td>
`;
    tbody.appendChild(tr);
  }

  // ações dos botões — agora só Editar e Excluir
$all('[data-del]').forEach(b => b.onclick = () => delCreche(b.getAttribute('data-del')));
$all('[data-edit]').forEach(b => b.onclick = () => editCreche(b.getAttribute('data-edit')));

$all('[data-contrato-creche]').forEach(b => b.onclick = async () => {
  const id = Number(b.getAttribute('data-contrato-creche'));
  try {
    await showContractLink('creche', id);

    const qAtual = document.getElementById('c_busca')?.value || '';
    await loadCreches(qAtual);
  } catch (e) {
    console.error(e);
    toast('Não consegui abrir o contrato da creche. Veja o console.', false);
  }
});
}

async function delCreche(id){
  if (!confirm(`Excluir agenda de creche #${id}?`)) return;
  await DB.delete('creches', id);
  // Excluir pagamentos associados a essa creche
const payList = await DB.list('pagamentos');
for (const p of payList.filter(p => p.refKind === 'creche' && p.refId === Number(id))) {
  await DB.delete('pagamentos', p.id);
}
  await DB.add('logs', { at:new Date().toISOString(), action:'delete', entity:'creche', entityId:Number(id), note:`Excluída` });
  toast('Agenda excluída'); loadCreches();
}
async function editCreche(id) {
  const c = await DB.get('creches', id);
  if (!c) return toast('Agenda não encontrada', false);

  // Render com prefill dos dias/horários
  await renderCreche(c);

// depois que a tela foi montada
const obsEl = document.getElementById('c_obs');
if (obsEl) obsEl.value = (c.nota ?? c.observacao ?? '');

  // 1) Preenche tutor no novo campo
  const tutorInput = document.getElementById('c_tutor_input');
  const clientes = await DB.list('clientes');
  const petsAll  = await DB.list('pets');
  const byTutor  = petsAll.reduce((acc, p) => {
    (acc[p.tutorId] = acc[p.tutorId] || []).push(p);
    return acc;
  }, {});

  selectedCrecheTutorId = c.tutorId || 0;

  if (tutorInput) {
    const cli = clientes.find(cli => cli.id === c.tutorId);
    tutorInput.value = cli ? (cli.nome || '') : '';
  }

  // 2) Recarrega lista de pets do tutor
  const box = document.getElementById('c_pets_box');
  box.innerHTML = '';
  for (const p of (byTutor[c.tutorId] || []).sort((a,b)=>(a.nome||'').localeCompare(b.nome||''))) {
    const lbl = document.createElement('label');
    lbl.className = 'chk-inline';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.name = 'c_pet';
    cb.value = p.id;

    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(` ${p.nome}`));
    box.appendChild(lbl);
  }


  // 3) Marca selecionados
  const selectedIds = (c.petIds || []).map(Number);
  document.querySelectorAll('input[name="c_pet"]').forEach(cb => {
    cb.checked = selectedIds.includes(Number(cb.value));
  });

  // 4) Dados gerais
  document.getElementById('c_valor').value = c.valor || 0;
  document.getElementById('c_status').value = c.status || 'Agendado';
  document.getElementById('c_freq').value = c.freq || 'ALE';

  // 5) Horários padrão (usa moda)
  (function setDefaultTimesFromMostFrequent() {
    const entradas = (c.dias || []).map(d => d.entrada).filter(Boolean);
    const saidas   = (c.dias || []).map(d => d.saida).filter(Boolean);
    const mode = (arr) => {
      if (!arr.length) return '';
      const m = new Map();
      for (const v of arr) m.set(v, (m.get(v) || 0) + 1);
      let best = '', bestC = -1;
      for (const [v, cnt] of m.entries()) { if (cnt > bestC) { best = v; bestC = cnt; } }
      return best;
    };
    document.getElementById('c_hora_in').value  = mode(entradas) || '';
    document.getElementById('c_hora_out').value = mode(saidas)   || '';
  })();

  // 6) Salvar -> Atualizar
  const salvarBtn = document.getElementById('c_salvar');
  salvarBtn.textContent = 'Atualizar agenda';
  salvarBtn.onclick = async () => {
    const get     = id => document.getElementById(id);
    const tutorId = Number(selectedCrecheTutorId || 0);
    const petIds  = Array.from(document.querySelectorAll('input[name="c_pet"]:checked')).map(cb => Number(cb.value));
    const valorStr = (get('c_valor').value || '').toString().trim();
    const status  = get('c_status').value;
    const freq    = get('c_freq').value;

    // === VALIDAÇÕES OBRIGATÓRIAS (EDIÇÃO) ===

    if (!tutorId) {
      toast('O campo Tutor não pode ficar vazio', false);
      get('c_tutor').focus();
      return;
    }

    if (!petIds.length) {
      toast('Selecione pelo menos um pet', false);
      get('c_pets').focus();
      return;
    }

    if (!valorStr) {
      toast('O campo Valor não pode ficar vazio', false);
      get('c_valor').focus();
      return;
    }

    // === FIM VALIDAÇÕES OBRIGATÓRIAS (EDIÇÃO) ===

    const valor = Number(valorStr || 0);

    const dias = [];
    document.querySelectorAll('#c_days_list > div').forEach(row => {
      const date    = row.querySelector('[data-del]').getAttribute('data-del');
      const entrada = document.getElementById(`in_${date}`).value;
      const saida   = document.getElementById(`out_${date}`).value;
      dias.push({ data: date, entrada, saida });
    });

    await DB.put('creches', {
      ...c,
      tutorId,
      petIds,
      valor,
      status,
      freq,
      dias,
      nota:        (get('c_obs')?.value || '').trim(),
      observacao:  (get('c_obs')?.value || '').trim(),
    });

    await DB.add('logs', {
      at: new Date().toISOString(),
      action: 'update_creche',
      entity: 'creches',
      entityId: c.id,
      note: `Atualização creche #${c.id}`
    });
    toast('Agenda atualizada com sucesso');
    renderCreche();
  };
}


// ==== CHECK-IN / CHECK-OUT ====
async function renderCheckin(){
  const view = document.getElementById('view');
  view.innerHTML = `
  <div class="panel">
    <div class="flex">
      <h2>Agenda — próximos 7 dias</h2>
      <div class="right"></div>
      <button class="btn btn-outline" id="ck_prev">◀ Semana anterior</button>
      <button class="btn btn-outline" id="ck_next">Próxima semana ▶</button>
      <button class="btn btn-primary" id="ck_mes_btn">📅 Ver visão mensal</button>
      <button class="btn btn-outline" id="ck_resumo_btn">📊 Resumo de agendamentos</button>
    </div>
    <div id="pend_alert" class="alert-warn" style="display:none; margin:8px 0;">⚠️ Existem agendamentos com pagamento pendente.</div>
    <div id="ck_list"></div>
  </div>
  <div id="monthly_container"></div>`;


// ——— MODAL (overlay) para ficha do PET + observações do agendamento ———
if (!document.getElementById('pet_overlay')) {
  const modal = document.createElement('div');
  modal.id = 'pet_overlay';
  modal.style.cssText = `
    position:fixed; inset:0; display:none; align-items:center; justify-content:center;
    background:rgba(0,0,0,0.35); z-index:9999; padding:16px;
  `;
  modal.innerHTML = `
    <div id="pet_overlay_card" style="
      background:var(--panel); color:var(--text); min-width:320px; max-width:560px; width:100%;
      border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,.3); overflow:hidden;">
            <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px; background:#ede4ff; border-bottom:1px solid #ddcdfc; color:var(--text);">
        <strong>Ficha do Pet & Observações</strong>
        <button id="pet_overlay_close" class="btn btn-ghost">Fechar</button>
      </div>
      <div id="pet_overlay_body" style="padding:12px; max-height:70vh; overflow:auto;"></div>
      <div style="padding:12px; display:flex; gap:8px; justify-content:flex-end;">
        <button id="pet_overlay_save" class="btn btn-primary">Salvar observações</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

// ——— MODAL (overlay) para ficha do TUTOR ———
if (!document.getElementById('tutor_overlay')) {
  const modal = document.createElement('div');
  modal.id = 'tutor_overlay';
  modal.style.cssText = `
    position:fixed; inset:0; display:none; align-items:center; justify-content:center;
    background:rgba(0,0,0,0.35); z-index:9999; padding:16px;
  `;
  modal.innerHTML = `
    <div id="tutor_overlay_card" style="
      background:var(--panel); color:var(--text); min-width:320px; max-width:560px; width:100%;
      border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,.3); overflow:hidden;">
      <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px;
                  background:#ede4ff; border-bottom:1px solid #ddcdfc; color:var(--text);">
        <strong>Ficha do Tutor</strong>
        <button id="tutor_overlay_close" class="btn btn-ghost">Fechar</button>
      </div>
      <div id="tutor_overlay_body" style="padding:12px; max-height:70vh; overflow:auto;"></div>
    </div>
  `;
  document.body.appendChild(modal);
}

// ——— MODAL (overlay) para LINK DO CONTRATO ———
if (!document.getElementById('contrato_overlay')) {
  const modal = document.createElement('div');
  modal.id = 'contrato_overlay';
  modal.style.cssText = `
    position:fixed; inset:0; display:none; align-items:center; justify-content:center;
    background:rgba(0,0,0,0.35); z-index:99999; padding:16px;
  `;
  modal.innerHTML = `
    <div style="
      background:var(--panel); color:var(--text); min-width:320px; max-width:640px; width:100%;
      border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,0.35); overflow:hidden;">
      <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px;
                  background:#ede4ff; border-bottom:1px solid #ddcdfc; color:var(--text);">
        <strong id="contrato_overlay_title">Contrato</strong>
        <button id="contrato_overlay_close" class="btn btn-ghost">Fechar</button>
      </div>

      <div id="contrato_overlay_body" style="padding:12px; max-height:70vh; overflow:auto;"></div>

      <div style="padding:12px; display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap;">
        <button id="contrato_overlay_copy" class="btn btn-primary">Copiar link</button>
        <button id="contrato_overlay_open" class="btn btn-outline">Abrir</button>
        <button id="contrato_overlay_ok" class="btn btn-ghost">Fechar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => { modal.style.display = 'none'; };
  document.getElementById('contrato_overlay_close').onclick = close;
  document.getElementById('contrato_overlay_ok').onclick = close;
}

// abre o overlay com dados
async function openContratoOverlay({ title, url, expiresAt, statusText }){
    // ✅ garante que o modal exista (se ainda não foi criado)
  if (!document.getElementById('contrato_overlay')) {
    createContratoOverlay();
  }
  const modal = document.getElementById('contrato_overlay');
  const body  = document.getElementById('contrato_overlay_body');
  const ttl   = document.getElementById('contrato_overlay_title');
  const btnCopy = document.getElementById('contrato_overlay_copy');
  const btnOpen = document.getElementById('contrato_overlay_open');

  ttl.textContent = title || 'Contrato';

  const expTxt = expiresAt ? new Date(expiresAt).toLocaleString() : '—';

  body.innerHTML = `
    <div style="display:flex; gap:10px; flex-wrap:wrap;">
      <span class="tag">${statusText || 'Contrato gerado'}</span>
      <span class="tag">Expira em: <strong>${expTxt}</strong></span>
    </div>

    <div style="margin-top:10px;">
      <label style="margin:0 0 6px 0;">Link do contrato</label>
      <textarea id="contrato_overlay_link" readonly style="min-height:80px;">${url || ''}</textarea>
      <div class="muted-sm" style="margin-top:6px;">Você pode copiar e mandar para o cliente quando quiser.</div>
    </div>
  `;

  btnCopy.onclick = async () => {
    try { await navigator.clipboard.writeText(url); } catch(e) {}
    toast("Link copiado!");
  };

  btnOpen.onclick = () => {
    if (url) window.open(url, '_blank');
  };

  modal.style.display = 'flex';
}

  let start = new Date();
  function weekStart(d){ const x=new Date(d); return new Date(x.getFullYear(),x.getMonth(),x.getDate()); }
async function paintWeek(){
  console.error('DEBUG W1: paintWeek entrou');

  const begin = weekStart(start);
  const days = []; for(let i=0;i<7;i++){ days.push(new Date(begin.getTime()+i*86400000)); }

  const html = await agendaHtml(days[0], days[6]);

  console.error('DEBUG W2: agendaHtml gerou HTML len=', (html || '').length);

  document.getElementById('ck_list').innerHTML = html;

  console.error('DEBUG W3: ck_list atualizado no DOM');

  bindCheckButtons();
  updatePendenciasAlert();
}
    
	async function refreshAgendaUI(){
    // repinta a semana atual
    await paintWeek();
    await updatePendenciasAlert();

    // se a visão mensal estiver aberta, repinta também
    if (monthlyLoaded && typeof repaintMonth === 'function') {
      await repaintMonth();
      await updatePendenciasAlert();
    }
  }
  
  window.refreshAgendaUI = refreshAgendaUI;
  
  // ✅ deixa disponível fora do renderCheckin (abrirPagamento / ajustarPagamento)
window.refreshAgendaUI = refreshAgendaUI;
  
  document.getElementById('ck_prev').onclick = ()=>{ start = new Date(start.getTime()-7*86400000); paintWeek(); };
  document.getElementById('ck_next').onclick = ()=>{ start = new Date(start.getTime()+7*86400000); paintWeek(); };
  document.getElementById('ck_resumo_btn').onclick = openResumoAgendamentos;
  
  let monthlyLoaded = false;
    let repaintMonth = null;
  document.getElementById('ck_mes_btn').onclick = async ()=>{
    const cont = document.getElementById('monthly_container');
    if (!monthlyLoaded){
      cont.innerHTML = `
      <div class="panel">
        <div class="flex"><h2>Visão mensal</h2><div class="right"></div>
          <button class="btn btn-outline" id="mo_prev">◀ Mês anterior</button>
          <button class="btn btn-outline" id="mo_next">Próximo mês ▶</button>
        </div>
        <div id="mo_label" class="mono"></div>
        <div id="mo_days"></div>
      </div>`;
      monthlyLoaded = true;
      bindMonth();
    }
    cont.scrollIntoView({behavior:'smooth'});
  };

  function bindMonth(){
    let current = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    async function paintMonth(){
      document.getElementById('mo_label').textContent = current.toLocaleString('pt-BR', {month:'long',year:'numeric'});
      const startM = new Date(current.getFullYear(), current.getMonth(), 1);
      const endM = new Date(current.getFullYear(), current.getMonth()+1, 0);
      const html = await agendaHtml(startM, endM);
      document.getElementById('mo_days').innerHTML = html;
      bindCheckButtons();
      updatePendenciasAlert();
      bindCheckButtons();
      updatePendenciasAlert();
    }
	
	    // 👇 nova linha: guarda a função pra ser usada depois
    repaintMonth = paintMonth;
	
    document.getElementById('mo_prev').onclick = ()=>{ current = new Date(current.getFullYear(), current.getMonth()-1, 1); paintMonth(); };
    document.getElementById('mo_next').onclick = ()=>{ current = new Date(current.getFullYear(), current.getMonth()+1, 1); paintMonth(); };
    paintMonth();
  }
  
  // ✅ Refresh global da agenda (sem precisar F5)
  // - Repinta a semana (ck_list)
  // - Se a visão mensal estiver aberta, repinta também (mo_days)
  // - Mantém a posição do scroll
window.__refreshCheckin = async () => {

  console.log('DEBUG 4: __refreshCheckin INICIO');

  const y = window.scrollY || document.documentElement.scrollTop || 0;

  await paintWeek();

  console.log('DEBUG 5: paintWeek FINALIZOU');

  const moDays = document.getElementById('mo_days');
  if (moDays && typeof repaintMonth === 'function') {
    await repaintMonth();
    console.log('DEBUG 6: repaintMonth FINALIZOU');
  }

  window.scrollTo(0, y);

  console.log('DEBUG 7: __refreshCheckin FINAL');
};

  
function bindCheckButtons(){
  // Check-in
  document.querySelectorAll('[data-checkin]').forEach(b=>{
b.onclick = async ()=>{
  if (b.disabled) return;
  b.disabled = true;
  const txt = b.textContent;
  b.textContent = 'Salvando...';

try {
  const [kind, idStr] = b.getAttribute('data-checkin').split('|');
  await abrirPagamento('checkin', kind, Number(idStr));

  // ✅ 1) Tenta repintar a agenda (se funcionar, os botões somem pela regra do status)
  if (typeof window.__refreshCheckin === 'function') {
    await window.__refreshCheckin();
  } else if (typeof window.refreshAgendaUI === 'function') {
    await window.refreshAgendaUI();
  } else {
    await renderCheckin();
  }

  // ✅ 2) Fallback "à prova de bala": remove o botão clicado na hora
  // (mesmo se por algum motivo o repaint não refletir)
  if (b && b.isConnected) {
    b.remove();
  }
} finally {
  // se a tela repintou, esse botão nem existe mais;
  // se não repintou, voltamos o estado normal
  if (b && b.isConnected) {
    b.disabled = false;
    b.textContent = txt;
  }
}
};
  });

  // Check-out
  document.querySelectorAll('[data-checkout]').forEach(b=>{
b.onclick = async ()=>{
  if (b.disabled) return;
  b.disabled = true;
  const txt = b.textContent;
  b.textContent = 'Salvando...';

try {
  const [kind, idStr] = b.getAttribute('data-checkout').split('|');
  await abrirPagamento('checkout', kind, Number(idStr));

  // ✅ 1) Tenta repintar a agenda
  if (typeof window.__refreshCheckin === 'function') {
    await window.__refreshCheckin();
  } else if (typeof window.refreshAgendaUI === 'function') {
    await window.refreshAgendaUI();
  } else {
    await renderCheckin();
  }

  // ✅ 2) Fallback: remove o botão clicado
  if (b && b.isConnected) {
    b.remove();
  }
} finally {
  if (b && b.isConnected) {
    b.disabled = false;
    b.textContent = txt;
  }
}
};
  });

  // Ajuste de pagamento
document.querySelectorAll('[data-ajuste]').forEach(b=>{
  b.onclick = async ()=>{
    const [kind, idStr] = b.getAttribute('data-ajuste').split('|');
    await ajustarPagamento(kind, Number(idStr));

    // ✅ tenta repintar
    if (typeof window.__refreshCheckin === 'function') {
      await window.__refreshCheckin();
    } else if (typeof window.refreshAgendaUI === 'function') {
      await window.refreshAgendaUI();
    } else {
      await renderCheckin();
    }

    // fallback: remove botão de ajuste clicado
    if (b && b.isConnected) b.remove();
  };
});
  
  // Abrir ficha do pet (modal)
  document.querySelectorAll('.pet-link').forEach(a=>{
    a.onclick = async (ev)=>{
      ev.preventDefault();
      const petId = Number(a.getAttribute('data-pet'));
      const [kind, refIdStr] = (a.getAttribute('data-ref')||'|').split('|');
      const refId = Number(refIdStr||0);
      await openPetCard(petId, kind, refId);
    };
  });

  // Abrir ficha do tutor (modal)
  document.querySelectorAll('.tutor-link').forEach(a=>{
    a.onclick = async (ev)=>{
      ev.preventDefault();
      const tutorId = Number(a.getAttribute('data-tutor'));
      if (!tutorId) return;
      await openTutorCard(tutorId);
    };
  });
}


async function openPetCard(petId, kind, refId){
  const modal = document.getElementById('pet_overlay');
  const body  = document.getElementById('pet_overlay_body');
  const btnClose = document.getElementById('pet_overlay_close');
  const btnSave  = document.getElementById('pet_overlay_save');
  if (!modal || !body) return;

  // Dados do pet
  const pet = await DB.get('pets', petId);
  if (!pet) { toast('Pet não encontrado', false); return; }

  // Tutor
  const tutor = await DB.get('clientes', pet.tutorId||0);

  // Agendamento (para armazenar/editar observações)
  const coll = (kind === 'hospedagem') ? 'hospedagens' : 'creches';
  const ag   = await DB.get(coll, refId);
  if (!ag) { toast('Agendamento não encontrado', false); return; }

  // Campo de observação do agendamento (string)
  const notaAtual = String(ag.nota ?? ag.observacao ?? '');

  const fmtBool = v => v ? 'Sim' : 'Não';
  const safe = s => (s||'').toString();

  body.innerHTML = `
    <div class="mono" style="font-size:13px; line-height:1.5;">
      <div><strong>Pet:</strong> ${safe(pet.nome)} (#${pet.id})</div>
      <div><strong>Tutor:</strong> ${safe(tutor?.nome||('Tutor #'+(pet.tutorId||'')))}</div>
      <hr style="border:none; border-top:1px solid #1f2937; margin:8px 0;">
      <div><strong>Espécie:</strong> ${safe(pet.especie||'')}</div>
      <div><strong>Raça:</strong> ${safe(pet.raca||'')}</div>
      <div><strong>Sexo:</strong> ${safe(pet.sexo||'')}</div>
      <div><strong>Nasc.:</strong> ${safe(pet.nascimento||'')}</div>
      <div><strong>Castrado:</strong> ${fmtBool(!!pet.castrado)}</div>
      <div><strong>Doenças:</strong> ${fmtBool(!!pet.doencasFlag)} ${pet.doencasFlag && pet.doencasTexto ? ('— '+safe(pet.doencasTexto)) : ''}</div>
      <div><strong>Alergias:</strong> ${fmtBool(!!pet.alergiasFlag)} ${pet.alergiasFlag && pet.alergiasTexto ? ('— '+safe(pet.alergiasTexto)) : ''}</div>
      <div><strong>Cuidados:</strong> ${fmtBool(!!pet.cuidadosFlag)} ${pet.cuidadosFlag && pet.cuidadosTexto ? ('— '+safe(pet.cuidadosTexto)) : ''}</div>

      <hr style="border:none; border-top:1px solid #1f2937; margin:8px 10px 8px 0;">

      <div style="margin:6px 0 4px;"><strong>Observações do agendamento (#${refId}, ${kind}):</strong></div>
      <textarea id="ag_nota_text" style="width:100%; min-height:110px; resize:vertical;">${safe(notaAtual)}</textarea>
      <div class="muted-sm" style="margin-top:6px;">Use este campo para anotações de check-in/check-out. Você pode editar a qualquer momento.</div>
    </div>
  `;

  btnClose.onclick = ()=>{ modal.style.display='none'; };
  btnSave.onclick  = async ()=>{
    const txt = document.getElementById('ag_nota_text')?.value || '';
    const fresh = await DB.get(coll, refId);
    if (!fresh) { toast('Agendamento não encontrado', false); return; }
    fresh.nota = txt;
	fresh.observacao = txt; // espelho para compatibilidade
    await DB.put(coll, fresh);
    await DB.add('logs', { at:new Date().toISOString(), action:'update_note', entity:coll, entityId:refId, note:`Observação atualizada` });
toast('Observações salvas');
modal.style.display='none';

// Guarda a posição atual da rolagem
const y = window.scrollY || document.documentElement.scrollTop || 0;

    // Sempre repinta a semana (lista dos próximos 7 dias)
await paintWeek();

    // Se a visão mensal estiver montada na tela, repinta também
    const moDays = document.getElementById('mo_days');
    if (moDays && typeof repaintMonth === 'function') {
      await repaintMonth();
    }

// Restaura a posição da página
window.scrollTo(0, y);
};


  modal.style.display = 'flex';
}

async function openTutorCard(tutorId){
  const modal = document.getElementById('tutor_overlay');
  const body  = document.getElementById('tutor_overlay_body');
  const btnClose = document.getElementById('tutor_overlay_close');
  if (!modal || !body) return;

  const tutor = await DB.get('clientes', tutorId);
  if (!tutor) { toast('Tutor não encontrado', false); return; }

  const safe = s => (s || '').toString();

  body.innerHTML = `
    <div class="mono" style="font-size:13px; line-height:1.5;">
      <div><strong>Nome:</strong> ${safe(tutor.nome)}</div>
      <div><strong>Telefone:</strong> ${safe(tutor.telefone)}</div>
      <div><strong>Email:</strong> ${safe(tutor.email)}</div>
      <div><strong>CPF:</strong> ${safe(tutor.cpf || tutor.documento || '')}</div>
      <hr style="border:none; border-top:1px solid #1f2937; margin:8px 0;">
      <div><strong>Cidade:</strong> ${safe(tutor.cidade)}</div>
      <div><strong>Endereço:</strong> ${safe(tutor.endereco)}</div>
      <div><strong>Contato veterinário:</strong> ${safe(tutor.contatoVet)}</div>
      <div><strong>Observações:</strong> ${safe(tutor.observacao)}</div>
    </div>
  `;

  btnClose.onclick = ()=>{ modal.style.display='none'; };
  modal.style.display = 'flex';
}

async function openResumoAgendamentos(){
  // Cria o overlay uma vez só
  let modal = document.getElementById('resumo_overlay');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'resumo_overlay';
    Object.assign(modal.style, {
      position: 'fixed',
      inset: '0',
      background: 'rgba(0,0,0,0.35)',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '9999',
      padding: '16px'
    });

    modal.innerHTML = `
      <div id="resumo_overlay_card" style="background:#ffffff; color:#111827; min-width:320px; max-width:780px; width:100%; border-radius:16px; box-shadow:0 10px 30px rgba(15,23,42,0.35); overflow:hidden;">
        <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:#ede4ff; border-bottom:1px solid #ddcdfc;">
          <strong>Resumo de agendamentos</strong>
          <button id="resumo_overlay_close" class="btn btn-ghost">Fechar</button>
        </div>
        <div id="resumo_overlay_body" style="padding:12px; max-height:75vh; overflow:auto;"></div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const body = document.getElementById('resumo_overlay_body');
  const btnClose = document.getElementById('resumo_overlay_close');
  if (!body || !btnClose) return;

  const hoje = new Date();
  const hojeISO = hoje.toISOString().slice(0, 10);
  const mesAtualISO = hoje.toISOString().slice(0, 7); // YYYY-MM

  // Monta os filtros
  body.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:12px; margin-bottom:10px;">
      <div style="display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end;">
        <div>
          <label class="label">Mês (MM-AAAA)</label>
          <input type="month" id="resumo_mes" class="input" value="${mesAtualISO}">
        </div>
        <div>
          <label class="label">Período - De (DD-MM-AAAA)</label>
          <input type="date" id="resumo_de" class="input">
        </div>
        <div>
          <label class="label">Até (DD-MM-AAAA)</label>
          <input type="date" id="resumo_ate" class="input">
        </div>
      </div>

      <div style="display:flex; flex-wrap:wrap; gap:8px;">
        <button id="resumo_hoje"   class="btn btn-outline">Hoje</button>
        <button id="resumo_semana" class="btn btn-outline">Semana atual</button>
        <button id="resumo_gerar"  class="btn btn-primary">Gerar resumo</button>
      </div>
    </div>

    <div id="resumo_resultado" style="border-top:1px solid #e5e7eb; padding-top:10px; margin-top:4px; font-size:0.9rem;"></div>
  `;

  btnClose.onclick = ()=>{ modal.style.display = 'none'; };

  const mesInput  = document.getElementById('resumo_mes');
  const deInput   = document.getElementById('resumo_de');
  const ateInput  = document.getElementById('resumo_ate');
  const btnHoje   = document.getElementById('resumo_hoje');
  const btnSemana = document.getElementById('resumo_semana');
  const btnGerar  = document.getElementById('resumo_gerar');
  const divRes    = document.getElementById('resumo_resultado');

  const fmtDiaISO = (d)=> d.toISOString().slice(0,10);

  // Sempre que mudar o MÊS, atualiza o período De/Até para o mês inteiro
  mesInput.onchange = ()=>{
    const mesVal = mesInput.value; // YYYY-MM
    if (!mesVal){
      // se apagar o mês, limpa o período
      deInput.value  = '';
      ateInput.value = '';
      return;
    }

    const [y, m] = mesVal.split('-').map(Number);
    const d1 = new Date(y, m - 1, 1);   // primeiro dia
    const d2 = new Date(y, m, 0);       // último dia do mês

    deInput.value  = fmtDiaISO(d1);
    ateInput.value = fmtDiaISO(d2);
  };

  // Botão HOJE
btnHoje.onclick = ()=>{
  deInput.value  = hojeISO;
  ateInput.value = hojeISO;
  // Limpa o mês para permitir escolher novamente depois
  mesInput.value = '';
};


  // Botão SEMANA ATUAL
  btnSemana.onclick = ()=>{
    const agora = new Date();
    const dow = agora.getDay();            // 0 = domingo, 1 = segunda, ...
    const diffSeg = (dow + 6) % 7;         // transforma em 0=segunda
    const seg = new Date(agora);
    seg.setDate(agora.getDate() - diffSeg);
    const dom = new Date(seg);
    dom.setDate(seg.getDate() + 6);
    const deISO = fmtDiaISO(seg);
    const ateISO = fmtDiaISO(dom);
    deInput.value  = deISO;
    ateInput.value = ateISO;
	// Limpa o mês para você poder selecionar de novo
    mesInput.value = '';
  };

  // Botão GERAR RESUMO
  btnGerar.onclick = async ()=>{
    let fromISO, toISO;

    const mesVal = mesInput.value;
    const deVal  = deInput.value;
    const ateVal = ateInput.value;

    // 1) SE tiver período (De/Até), ele manda nesse filtro
    if (deVal) {
      fromISO = deVal;
      toISO   = ateVal || deVal;

    // 2) Se não tiver período, mas tiver MÊS, usa o mês inteiro
    } else if (mesVal) {
      const [y, m] = mesVal.split('-').map(Number);
      const d1 = new Date(y, m - 1, 1);
      const d2 = new Date(y, m, 0); // último dia do mês
      fromISO = fmtDiaISO(d1);
      toISO   = fmtDiaISO(d2);

    // 3) Nenhum filtro preenchido
    } else {
      toast('Preencha o mês ou a data inicial', false);
      return;
    }

    divRes.innerHTML = 'Carregando resumo...';
    const html = await buildResumoPeriodo(fromISO, toISO);
    divRes.innerHTML = html;
  };

  // Quando abrir o modal:
  // - garante que o período De/Até está alinhado com o mês atual
  mesInput.onchange();

  modal.style.display = 'flex';

  // Já gera automaticamente para o mês atual
  btnGerar.click();

}

async function buildResumoPeriodo(fromISO, toISO){
  // fromISO / toISO vêm no formato YYYY-MM-DD
  const [clientes, pets, hospedagens, creches] = await Promise.all([
    DB.list('clientes'),
    DB.list('pets'),
    DB.list('hospedagens'),
    DB.list('creches')
  ]);

  const byCli = Object.fromEntries(clientes.map(c => [c.id, c]));
  const byPet = Object.fromEntries(pets.map(p => [p.id, p]));

  // Helper para exibir DD-MM-AAAA
  const fmtBRHifen = iso => {
    if (!iso) return '';
    const [y,m,d] = iso.split('-');
    return `${d}-${m}-${y}`;
  };

  // === HOSPEDAGENS no período ===
  const hospInRange = hospedagens.filter(h => {
    if (!h.dataEntrada || !h.dataSaida) return false;
    // como está tudo em YYYY-MM-DD, comparação de string funciona
    if (h.dataSaida < fromISO) return false;
    if (h.dataEntrada > toISO) return false;
    return true;
  });

  // === CRECHES que têm pelo menos 1 dia no período ===
  const crechesInRange = [];
  for (const c of creches){
    const diasPeriodo = (c.dias || []).filter(d => d.data >= fromISO && d.data <= toISO);
    if (!diasPeriodo.length) continue;
    crechesInRange.push({ ...c, diasPeriodo });
  }

  // Totais gerais
  const setPets = new Set();
  hospInRange.forEach(h => (h.petIds || []).forEach(id => setPets.add(id)));
  crechesInRange.forEach(c => (c.petIds || []).forEach(id => setPets.add(id)));
  const totalPets = setPets.size;

  // Contagem por espécie (Cachorro, Gato, Outro)
  let qtCachorro = 0;
  let qtGato     = 0;
  let qtOutro    = 0;

  for (const id of setPets) {
    const pet = byPet[id];
    if (!pet) continue;

    const especie = (pet.especie || '').toLowerCase();

    if (especie === 'cachorro') {
      qtCachorro++;
    } else if (especie === 'gato') {
      qtGato++;
    } else {
      qtOutro++;
    }
  }

  const detalhesPets = [];
  if (qtCachorro) detalhesPets.push(`${qtCachorro} - cachorro`);
  if (qtGato)      detalhesPets.push(`${qtGato} - gato`);
  if (qtOutro)     detalhesPets.push(`${qtOutro} - outro`);

  const detalhesPetsStr = detalhesPets.length ? ` (${detalhesPets.join(', ')})` : '';

  const somaHosp   = hospInRange.reduce((acc,h)=> acc + Number(h.valor || h.valorTotal || 0), 0);
  const somaCreche = crechesInRange.reduce((acc,c)=> acc + Number(c.valor || 0), 0);

  let html = '';

  html += `<div style="margin-bottom:10px;">Período considerado: <strong>${fmtBRHifen(fromISO)}</strong> até <strong>${fmtBRHifen(toISO)}</strong></div>`;

  html += `
    <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px; font-size:13px;">
      <div class="tag">Hospedagens: <strong>${hospInRange.length}</strong> — ${fmtMoney(somaHosp)}</div>
      <div class="tag">Creches: <strong>${crechesInRange.length}</strong> — ${fmtMoney(somaCreche)}</div>
<div class="tag">Pets atendidos: <strong>${totalPets}</strong>${detalhesPetsStr}</div>
    </div>
  `;

  // ===== Lista de HOSPEDAGENS =====
  html += `<h4 style="margin:6px 0;">Hospedagens</h4>`;
  if (!hospInRange.length){
    html += `<div class="muted-sm">Nenhuma hospedagem neste período.</div>`;
  } else {
    html += `
      <div class="list-scroll" style="max-height:220px; overflow:auto;">
        <table style="width:100%; border-collapse:collapse;">
          <colgroup>
            <col style="width:1%;">   <!-- ID -->
            <col style="width:14%;">  <!-- Período -->
            <col style="width:25%;">  <!-- Tutor & Pets -->
            <col style="width:12%;">  <!-- Valor -->
            <col style="width:12%;">  <!-- Status -->
            <col style="width:10%;">  <!-- Pagamento -->
          </colgroup>
          <thead>
            <tr>
              <th>ID</th>
              <th>Período</th>
              <th>Tutor &amp; Pets</th>
              <th>Valor</th>
              <th>Status</th>
              <th>Pagamento</th>
            </tr>
          </thead>
          <tbody>
    `;

    const hospSorted = [...hospInRange].sort((a, b) => {
      const da = String(a.dataEntrada || '');
      const db = String(b.dataEntrada || '');
      return da.localeCompare(db);  // ordem crescente por data de entrada
    });

    for (const h of hospSorted){
      const tutor = byCli[h.tutorId] || {};
      const tutorNome = tutor.nome || `Tutor #${h.tutorId}`;

      // Agrupa os nomes dos pets por espécie e adiciona os emojis
      const nomesPets = (() => {
        const nomesDog = [];
        const nomesCat = [];
        const nomesOutro = [];

        for (const pid of (h.petIds || [])){
          const p = byPet[pid];
          const nome = p?.nome || `Pet #${pid}`;
          const especieNorm = (p?.especie || '').toString().trim().toLowerCase();

          if (especieNorm.startsWith('cachorro') || especieNorm.startsWith('cão') || especieNorm.startsWith('cao')){
            nomesDog.push(nome);
          } else if (especieNorm.startsWith('gato')){
            nomesCat.push(nome);
          } else {
            nomesOutro.push(nome);
          }
        }

        const partes = [];
        if (nomesDog.length)   partes.push(`🐶 ${nomesDog.join(', ')}`);
        if (nomesCat.length)   partes.push(`🐱 ${nomesCat.join(', ')}`);
        if (nomesOutro.length) partes.push(`🐾 ${nomesOutro.join(', ')}`);

        return partes.join(' — ');
      })();

      const periodo = `${fmtBRHifen(h.dataEntrada)} → ${fmtBRHifen(h.dataSaida)}`;
      const valorBase = Number(h.valor || h.valorTotal || 0);
      const valor = fmtMoney(valorBase);

      // Status (checkin / checkout / concluído) + ícone
      const status = (h.status || '').toString();
      const statusIcon =
        status === 'checkin'
          ? '✔️ '
          : (status === 'checkout' || status === 'Concluído')
            ? '❌ '
            : '';

      const pago = Number(h.pago || 0);
      const faltando = Math.max(0, valorBase - pago);

      const pagStr = faltando > 0
        ? `Pendente ${fmtMoney(faltando)}`
        : (pago > 0 ? 'Quitado' : '-');

      // Ícone de pendência no pagamento
      const pagIcon = faltando > 0 ? '⚠️ ' : '';

      // Verifica se é uma adaptação
      // (procura "adaptação" ou "adaptacao" na observação, sem diferença de maiúsculo/minúsculo)
      const obsText = (h.observacao || h.nota || '').toString().toLowerCase();
      const isAdaptacao =
        obsText.includes('adaptação') ||
        obsText.includes('adaptacao');

      // Se for adaptação, criamos um selinho amarelo
      const adaptacaoBadge = isAdaptacao
        ? `<br><span class="tag tag-yellow">Adaptação</span>`
        : '';

      html += `
        <tr>
          <td>#${h.id}</td>
          <td>${periodo}</td>
          <td>${tutorNome}<br><span class="muted-sm">${nomesPets}</span>${adaptacaoBadge}</td>
          <td>${valor}</td>
          <td>${statusIcon}${status}</td>
          <td>${pagIcon}${pagStr}</td>
        </tr>
      `;
    }


    html += `
          </tbody>
        </table>
      </div>
    `;
  }

  // ===== Lista de CRECHES =====
  html += `<h4 style="margin:12px 0 6px;">Creches</h4>`;
  if (!crechesInRange.length){
    html += `<div class="muted-sm">Nenhuma creche neste período.</div>`;
  } else {
    html += `
      <div class="list-scroll" style="max-height:220px; overflow:auto;">
        <table class="resumo-creche-table" style="width:100%; border-collapse:collapse;">
          <colgroup>
            <col style="width:1%;">   <!-- ID -->
            <col style="width:14%;">  <!-- Período -->
            <col style="width:17%;">  <!-- Tutor & Pets -->
			<col style="width:2%;">  <!-- Dias por Semana -->
            <col style="width:12%;">  <!-- Valor -->
            <col style="width:13%;">  <!-- Status -->
            <col style="width:10%;">  <!-- Pagamento -->
          </colgroup>
          <thead>
            <tr>
              <th>ID</th>
              <th>Período</th>
              <th>Tutor &amp; Pets</th>
			  <th>Dias por Semana</th>
              <th>Valor</th>
              <th>Status</th>
              <th>Pagamento</th>
            </tr>
          </thead>
          <tbody>
    `;
	
  const crechesSorted = [...crechesInRange].sort((a, b) => {
    const diasA = (a.dias || []).map(d => String(d.data || '')).filter(Boolean).sort();
    const diasB = (b.dias || []).map(d => String(d.data || '')).filter(Boolean).sort();
    const aFirst = diasA[0] || '';
    const bFirst = diasB[0] || '';
    return String(aFirst).localeCompare(String(bFirst));
  });


    for (const c of crechesSorted){
      const tutor = byCli[c.tutorId] || {};
      const tutorNome = tutor.nome || `Tutor #${c.tutorId}`;

      // Agrupa os nomes dos pets por espécie e adiciona os emojis
      const nomesPets = (() => {
        const nomesDog = [];
        const nomesCat = [];
        const nomesOutro = [];

        for (const pid of (c.petIds || [])){
          const p = byPet[pid];
          const nome = p?.nome || `Pet #${pid}`;
          const especieNorm = (p?.especie || '').toString().trim().toLowerCase();

          if (especieNorm.startsWith('cachorro') || especieNorm.startsWith('cão') || especieNorm.startsWith('cao')){
            nomesDog.push(nome);
          } else if (especieNorm.startsWith('gato')){
            nomesCat.push(nome);
          } else {
            nomesOutro.push(nome);
          }
        }

        const partes = [];
        if (nomesDog.length)   partes.push(`🐶 ${nomesDog.join(', ')}`);
        if (nomesCat.length)   partes.push(`🐱 ${nomesCat.join(', ')}`);
        if (nomesOutro.length) partes.push(`🐾 ${nomesOutro.join(', ')}`);

        return partes.join(' — ');
      })();

      // TODOS os dias da agenda de creche (para mostrar período global + lista completa)
      const diasAllArr = (c.dias || [])
        .map(d => String(d.data || ''))
        .filter(Boolean)
        .sort();

    // Apenas os dias que caem dentro do período filtrado (para "Dias por semana")
    const diasPeriodoArr = (c.diasPeriodo || [])
      .map(d => String(d.data || ''))
      .filter(Boolean)
      .sort();

    const firstAllIso = diasAllArr[0] || '';
    const lastAllIso  = diasAllArr[diasAllArr.length - 1] || firstAllIso;

    const periodoStr = firstAllIso
      ? `${fmtBRHifen(firstAllIso)} → ${fmtBRHifen(lastAllIso)}`
      : '';

    const diasLista = diasAllArr
      .map(iso => {
        const partes = iso.split('-');
        const diaNum = partes[2] ? Number(partes[2]) : '';
        return diaNum ? String(diaNum) : '';
      })
      .filter(Boolean)
      .join('-');

    const qtdDiasPeriodo = diasPeriodoArr.length;
      const valorBase = Number(c.valor || 0);
      const valor     = fmtMoney(valorBase);

      // Status com ícone (✔️ para checkin, ❌ para checkout/Concluído)
      const statusRaw  = c.status || 'Agendado';
      const statusText = statusRaw.toString();
      const statusIcon =
        statusText === 'checkin'
          ? '✔️ '
          : (statusText === 'checkout' || statusText === 'Concluído')
            ? '❌ '
            : '';

      const pago     = Number(c.pago || 0);
      const faltando = Math.max(0, valorBase - pago);

      // Pagamento com ícone de pendente (⚠️) quando faltar valor
      const pagStr = faltando > 0
        ? `Pendente ${fmtMoney(faltando)}`
        : (pago > 0 ? 'Quitado' : '-');

      const pagIcon = faltando > 0 ? '⚠️ ' : '';

      html += `
        <tr>
          <td>#${c.id}</td>
          <td>
            ${periodoStr}
            ${diasLista ? `<br><span class="muted-sm">(${diasLista})</span>` : ''}
          </td>
          <td>${tutorNome}<br><span class="muted-sm">${nomesPets}</span></td>
          <td>${qtdDiasPeriodo}</td>
          <td>${valor}</td>
          <td>${statusIcon}${statusText}</td>
          <td>${pagIcon}${pagStr}</td>
        </tr>
      `;
    }

    html += `
          </tbody>
        </table>
      </div>
    `;
  }

  return html;
}


async function agendaHtml(fromDate, toDate){
    const todayStr = ymd(new Date());

    const from = ymd(fromDate), to = ymd(toDate);
    const clientes = await DB.list('clientes'); const byCli = Object.fromEntries(clientes.map(c=>[c.id,c]));
    const pets = await DB.list('pets'); const byPet = Object.fromEntries(pets.map(p=>[p.id,p]));
    const hs = await DB.list('hospedagens'); const cs = await DB.list('creches');
    const map = {}; // map[day] = { creche:[], hosp:[] }

    function pushDay(day, type, payload){
      if(!map[day]) map[day] = { creche:[], hosp:[] };
      if(type==='Creche') map[day].creche.push(payload); else map[day].hosp.push(payload);
    }

    function dateDiffDays(a,b){ const A=new Date(a), B=new Date(b); return Math.round((B-A)/86400000)+1; }
    for (const h of hs){
      const totalDays = dateDiffDays(h.dataEntrada, h.dataSaida);
      const seq = betweenDates(h.dataEntrada, h.dataSaida);
      for (const d of seq){
        if (d>=from && d<=to){
          const first = d===h.dataEntrada, last = d===h.dataSaida;
pushDay(d, 'Hospedagem', {
  tutorId: h.tutorId,
  petIds: h.petIds || [],
  horaIn: first ? h.horaEntrada : null,
  horaOut: last ? h.horaSaida : null,
  first,
  last,
  totalDays,
  dataEntrada: h.dataEntrada,
  dataSaida: h.dataSaida,
  valorTotal: Number(h.valorTotal || h.valor || 0),
  refId: h.id,
  kind: 'hospedagem',
  status: h.status || '',
  pago: Number(h.pago || 0),
  pendente: !!h.pendente,                 // 👈 vírgula aqui
  nota: h.nota || h.observacao || '',
  observacao: h.observacao || h.nota || '',
});


        }
      }
    }

    // CRECHES – um registro por dia da agenda
    for (const c of cs){
      const status = c.status || 'Agendado';
      const dias = c.dias || [];
      const totalDays = dias.length;

      for (let i = 0; i < dias.length; i++){
        const dia = dias[i];
        const d = dia.data;
        if (d >= from && d <= to){
          const first = (i === 0);
          const last  = (i === dias.length - 1);

          pushDay(d, 'Creche', {
            tutorId: c.tutorId,
            petIds: c.petIds || [],
            horaIn: dia.entrada || null,
            horaOut: dia.saida || null,
            first,
            last,
            totalDays,
            valorTotal: c.valor || 0,
            refId: c.id,
            kind: 'creche',
            status: status,
            pago: Number(c.pago || 0),
            pendente: !!c.pendente,                 // 👈 vírgula aqui
            nota: c.nota || c.observacao || '',
            observacao: c.observacao || c.nota || '',
          });
        }
      }
    }


    const days = []; let d = parseYMD(from);
    while (ymd(d) <= to){ days.push(ymd(d)); d = new Date(d.getTime()+86400000); }
    let out='';
    
    for (const day of days){
      out += `<div class="day-block"><div class="muted">${weekdayBR(day)} — ${fmtBR(day)}</div>`;
      const rec = map[day] || {creche:[], hosp:[]};

const hospCount = rec.hosp.length;
const creCount  = rec.creche.length;

// conjunto com todos os pets no dia (hospedagem + creche)
const petsSet = new Set();
rec.hosp.forEach(h => (h.petIds || []).forEach(id => petsSet.add(id)));
rec.creche.forEach(c => (c.petIds || []).forEach(id => petsSet.add(id)));
const petsTotal = petsSet.size;

// quebra por espécie (cachorro / gato / outro)
let nCachorro = 0, nGato = 0, nOutro = 0;
petsSet.forEach(pid => {
  const especieRaw = (byPet[pid]?.especie || '').toString().toLowerCase();

  if (!especieRaw) {
    nOutro++;
  } else if (
    especieRaw.includes('cachorro') ||
    especieRaw.includes('cão') ||
    especieRaw.includes('cao') ||
    especieRaw.includes('dog')
  ) {
    nCachorro++;
  } else if (especieRaw.includes('gato')) {
    nGato++;
  } else {
    nOutro++;
  }
});

// texto extra de espécies: (1 - cachorro, 2 - gato, 1 - outro)
let especiesTexto = '';
if (petsTotal > 0) {
  especiesTexto = ` (${nCachorro} - cachorro, ${nGato} - gato, ${nOutro} - outro)`;
}

out += `<div class="muted-sm" style="margin:4px 0 8px 0">
  Resumo: ${hospCount} hospedagem${hospCount!==1?'s':''},
  ${creCount} creche${creCount!==1?'s':''},
  ${petsTotal} pet${petsTotal!==1?'s':''} no total${especiesTexto}
</div>`;


      // Hospedagens do dia
      if ((rec.hosp || []).length) {
        out += `<div class="sec-title sec-hosp">Hospedagem</div>`;

        // Agrupa por tutor (um bloco por tutor)
        const byTutorH = {};
        for (const it of rec.hosp) {
          const t = it.tutorId;
          if (!byTutorH[t]) byTutorH[t] = { petIds: new Set(), rows: [] };
          (it.petIds || []).forEach(id => byTutorH[t].petIds.add(id));
          byTutorH[t].rows.push(it);
        }

        for (const [tutorId, info] of Object.entries(byTutorH)) {
          const tutor = byCli[tutorId]?.nome || ('Tutor #' + tutorId);

          // Considera sempre a primeira reserva (normalmente é uma só por tutor/pet no dia)
          const r0 = info.rows[0] || {};

  // Agrupa por espécie para montar:
  // 🐶 cachorro1, cachorro2 - 🐱 gato1 - 🐾 outro1
  const nomesPorEspecie = {
    cachorro: [],
    gato: [],
    outro: []
  };

  Array.from(info.petIds).forEach(pid => {
    const pet  = byPet[pid];
    const nome = pet?.nome || ('#' + pid);

    const especieRaw = (pet?.especie || '').toString().toLowerCase();
    let chave = 'outro';

    if (
      especieRaw.includes('cachorro') ||
      especieRaw.includes('cão') ||
      especieRaw.includes('cao') ||
      especieRaw.includes('dog')
    ) {
      chave = 'cachorro';
    } else if (especieRaw.includes('gato')) {
      chave = 'gato';
    }

    const link = `<a href="#" class="pet-link" data-pet="${pid}" data-ref="${r0.kind}|${r0.refId}">${nome}</a>`;
    nomesPorEspecie[chave].push(link);
  });

  const grupos = [];
  if (nomesPorEspecie.cachorro.length) {
    grupos.push(`🐶 ${nomesPorEspecie.cachorro.join(', ')}`);
  }
  if (nomesPorEspecie.gato.length) {
    grupos.push(`🐱 ${nomesPorEspecie.gato.join(', ')}`);
  }
  if (nomesPorEspecie.outro.length) {
    grupos.push(`🐾 ${nomesPorEspecie.outro.join(', ')}`);
  }

  const petNames = grupos.join(' - ');

          const inDate  = String(r0.dataEntrada || '').slice(0, 10);
          const outDate = String(r0.dataSaida   || '').slice(0, 10);
          const sameDay = (inDate && outDate && inDate === outDate);

          const isEntrada = (day === inDate);
          const isSaida   = (day === outDate);

          // Monta texto extra (horários, dias, valor, pendência)
          const extra = [];
          if (isEntrada && r0.horaIn)  extra.push(`${r0.horaIn} entrada`);
          if (isSaida   && r0.horaOut) extra.push(`${r0.horaOut} saída`);

          // total de dias da hospedagem (campo totalDays que vem do pushDay)
          const totalDays = Number(r0.totalDays || 0);
          if (totalDays > 0) {
            extra.push(`${totalDays} dia${totalDays > 1 ? 's' : ''} no total`);
          }

          const valorTotal = Number(r0.valorTotal || r0.valor || 0);
          if (valorTotal > 0) {
            extra.push(`Valor total R$ ${valorTotal.toFixed(2).replace('.', ',')}`);
          }
          const pago = Number(r0.pago || 0);
          const faltando = Math.max(0, valorTotal - pago);
          if (r0.pendente && faltando > 0) {
            extra.push(`Pendente ${fmtMoney(faltando)}`);
          }

          // Ícones de status (igual Check-in/Out)
          const icons = [];
          if (r0.status === 'checkin')  icons.push('✔️');
          if (r0.status === 'checkout') icons.push('❌');
          if (r0.pendente)             icons.push('⚠️');
          const iconPrefix = icons.join('');

          // Botões de check-in / check-out + ajuste
          let controls = '';
          const canClick = (day <= todayStr) ? '' : 'disabled';

          const statusStr  = String(r0.status || '').toLowerCase();
          const jaCheckout = (statusStr === 'checkout');
          const jaCheckin  = (statusStr === 'checkin' || jaCheckout);

          if (sameDay) {
            // Hospedagem entra e sai no MESMO dia
            if (!jaCheckin) {
              controls += ` <button class="btn btn-success btn-sm" data-checkin="${r0.kind}|${r0.refId}" ${canClick}>Check-in</button>`;
            }
            if (!jaCheckout) {
              controls += ` <button class="btn btn-warn btn-sm" data-checkout="${r0.kind}|${r0.refId}" ${canClick}>Check-out</button>`;
            }
          } else {
            // Vários dias
            if (isEntrada && !jaCheckin) {
              controls += ` <button class="btn btn-success btn-sm" data-checkin="${r0.kind}|${r0.refId}" ${canClick}>Check-in</button>`;
            }
            if (isSaida && !jaCheckout) {
              controls += ` <button class="btn btn-warn btn-sm" data-checkout="${r0.kind}|${r0.refId}" ${canClick}>Check-out</button>`;
            }
          }


          // Botão pequeno para ajustar apenas o pagamento
          if (valorTotal > 0) {
            controls += ` <button class="btn btn-ghost btn-xs" data-ajuste="${r0.kind}|${r0.refId}">Ajustar pagamento</button>`;
          }

          const tailExtra = extra.length
            ? ` — <span class="muted-sm">${extra.join(' — ')}</span>`
            : '';

// Observação / Nota (usamos para mostrar o ícone e detectar "adaptação")
const noteRaw = String(r0.nota ?? r0.observacao ?? '');

// Ícone de anotação (se tiver qualquer observação)
const hasNote = !!noteRaw.trim();
const noteIcon = hasNote
  ? ' <span class="note-flag" title="Observações deste agendamento">📝</span>'
  : '';

// === SELINHO DE ADAPTAÇÃO (Hospedagem no Check-in) ===
// Normaliza: minúsculo + remove acentos (adaptação / adaptacao / ADAPTAÇÃO etc)
const noteNorm = noteRaw
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, ''); // remove acentos

const isAdaptacao = noteNorm.includes('adaptacao');

const adaptBadge = isAdaptacao
  ? `<span style="
      display:inline-block;
      padding:2px 8px;
      border-radius:999px;
      background:#fde68a;
      border:1px solid #f59e0b;
      color:#92400e;
      font-size:12px;
      font-weight:700;
      margin-right:6px;
      vertical-align:middle;
    ">ADAPTAÇÃO</span>`
  : '';

// IMPORTANTÍSSIMO: aqui é onde o selo entra no HTML (antes do 🐶/🐱 do petNames)
out += `<div>${iconPrefix ? iconPrefix + ' ' : ''}${adaptBadge}<strong>${petNames}</strong>${noteIcon} — Tutor: <a href="#" class="tutor-link" data-tutor="${tutorId}"><strong>${tutor}</strong></a>${tailExtra}${controls}</div>`;

        }
      }



      if ((rec.creche||[]).length){
        out += `<div class="sec-title sec-creche">Creche</div>`;
        const byTutorC = {};
        for (const it of rec.creche){
          const t = it.tutorId;
          if (!byTutorC[t]) byTutorC[t] = { petIds: new Set(), rows: [] };
          (it.petIds||[]).forEach(id=>byTutorC[t].petIds.add(id));
          byTutorC[t].rows.push(it);
        }

        // Precompute tutor meta from cs (dias e frequência da agenda)
        const tutorCrecheInfo = {};
        for (const c of cs){
          const t = c.tutorId;
          if (!tutorCrecheInfo[t]) tutorCrecheInfo[t] = { days: [], freq: c.freq || 'ALE' };
          if (!tutorCrecheInfo[t].freq && c.freq) tutorCrecheInfo[t].freq = c.freq;
          (c.dias||[]).forEach(d => tutorCrecheInfo[t].days.push(d.data));
        }

        for (const [tutorId, info] of Object.entries(byTutorC)){
          const tutor = byCli[tutorId]?.nome || ('Tutor #'+tutorId);
          const r0 = info.rows[0] || {};          
		  
  // Agrupa por espécie para montar:
  // 🐶 cachorro1, cachorro2 - 🐱 gato1 - 🐾 outro1
  const nomesPorEspecie = {
    cachorro: [],
    gato: [],
    outro: []
  };

  Array.from(info.petIds).forEach(pid => {
    const pet  = byPet[pid];
    const nome = pet?.nome || ('#' + pid);

    const especieRaw = (pet?.especie || '').toString().toLowerCase();
    let chave = 'outro';

    if (
      especieRaw.includes('cachorro') ||
      especieRaw.includes('cão') ||
      especieRaw.includes('cao') ||
      especieRaw.includes('dog')
    ) {
      chave = 'cachorro';
    } else if (especieRaw.includes('gato')) {
      chave = 'gato';
    }

    const link = `<a href="#" class="pet-link" data-pet="${pid}" data-ref="${r0.kind}|${r0.refId}">${nome}</a>`;
    nomesPorEspecie[chave].push(link);
  });

  const grupos = [];
  if (nomesPorEspecie.cachorro.length) {
    grupos.push(`🐶 ${nomesPorEspecie.cachorro.join(', ')}`);
  }
  if (nomesPorEspecie.gato.length) {
    grupos.push(`🐱 ${nomesPorEspecie.gato.join(', ')}`);
  }
  if (nomesPorEspecie.outro.length) {
    grupos.push(`🐾 ${nomesPorEspecie.outro.join(', ')}`);
  }

  const petNames = grupos.join(' - ');

          const times = [r0.horaIn, r0.horaOut].filter(Boolean).join(' → ');

          // --- META DA CRECHE / POSIÇÃO DO DIA ---
          const meta = tutorCrecheInfo[tutorId] || { days:[], freq:'ALE' };
          const daysAll = meta.days.slice().sort();          // todos os dias dessa agenda (para esse tutor)
          const total   = daysAll.length;

          // Por padrão, considera o primeiro/último dia com base em todas as datas
          let isFirst = false;
          let isLast  = false;
          if (total > 0) {
            isFirst = (day === daysAll[0]);
            isLast  = (day === daysAll[total - 1]);
          }

          // Se o registro do dia trouxer flags `first` / `last`,
          // usamos elas com prioridade (primeiro/último dia DAQUELE agendamento)
          if (r0 && r0.kind === 'creche' && (typeof r0.first === 'boolean' || typeof r0.last === 'boolean')) {
            if (typeof r0.first === 'boolean') isFirst = !!r0.first;
            if (typeof r0.last === 'boolean')  isLast  = !!r0.last;
          }

          const freqStr = String(meta.freq || '').toUpperCase();   // ex: "2", "3", "ALE"
          const isRandom = (freqStr === 'ALE');


    // Mapa de semanas → quais dias caem em cada semana (semana = segunda a domingo)
    const weekMap = {};
    // Usamos um Set para garantir que não haja datas duplicadas
    const uniqueDays = Array.from(new Set(daysAll));
    for (const dStr of uniqueDays) {
      const [Y,M,D] = dStr.split('-').map(Number);
      const dt = new Date(Y, M-1, D);
      const dow = dt.getDay();        // 0=Domingo, 1=Segunda, ..., 6=Sábado
      const diffToMonday = (dow + 6) % 7; // 0 p/ segunda, 6 p/ domingo
      const monday = new Date(dt);
      monday.setDate(dt.getDate() - diffToMonday);
      const wKey = monday.toISOString().slice(0,10); // identificador da semana (data da segunda)
      if (!weekMap[wKey]) weekMap[wKey] = [];
      weekMap[wKey].push(dStr);
    }

    // Posição global (Dia N/Total)
    let diaN = null;
    if (total > 0) {
      const idxGlobal = uniqueDays.indexOf(day);
      if (idxGlobal >= 0) diaN = idxGlobal + 1;
    }

    // Posição dentro da semana (Semana N/TotalSemana) — baseado só nos dias dessa creche na semana
    let diaSemanaN = null;
    let totalSemana = 0;
    if (total > 0) {
      const [yCur,mCur,dCur] = day.split('-').map(Number);
      const dtCur = new Date(yCur, mCur-1, dCur);
      const dowCur = dtCur.getDay();
      const diffToMondayCur = (dowCur + 6) % 7;
      const mondayCur = new Date(dtCur);
      mondayCur.setDate(dtCur.getDate() - diffToMondayCur);
      const wKeyCur = mondayCur.toISOString().slice(0,10);

      const listWeek = (weekMap[wKeyCur] || []).slice().sort();
      totalSemana = listWeek.length;           // quantos dias de creche nessa semana
      const idxWeek = listWeek.indexOf(day);
      if (idxWeek >= 0) diaSemanaN = idxWeek + 1;  // 1º, 2º, 3º dia dessa semana
    }


          const valorTotal = Number(r0.valorTotal || r0.valor || 0);
          const valorTexto = valorTotal.toFixed(2).replace('.', ',');

          // Monta o texto do sufixo (dia / semana / freq / valor)
          const parts = [];

          if (isFirst) parts.push('Primeiro dia');
          if (isLast)  parts.push('Último dia');

          if (diaN && total) {
            // Ex: Dia 3/10
            parts.push(`Dia ${diaN}/${total}`);
          }

          // Para frequências numéricas (2x semana, 3x semana, etc.)
          if (!isRandom && diaSemanaN && totalSemana) {
            // Ex: Semana 1/2 — 2x por semana
            parts.push(`Semana ${diaSemanaN}/${totalSemana} — ${freqStr}x por semana`);
          }

          // Para ALE ou caso especial, ainda mostra o total de dias
          if (isRandom && total) {
            // Ex: Total de 10 dias agendados
            parts.push(`Total de ${total} dias agendados`);
          }

          // Valor total só no primeiro e último dia (para não poluir todos os dias)
          if (valorTotal > 0 && (isFirst || isLast)) {
            parts.push(`Valor total R$ ${valorTexto}`);
          }

          let suffix = '';
          if (parts.length) {
            suffix = ' — <span class="muted-sm">' + parts.join(' — ') + '</span>';
          }


          // --- BOTÕES (check-in / check-out / ajuste) ---
          let controls = '';
          const canClick = (day <= todayStr) ? '' : 'disabled';
          const statusStr = String(r0.status || '').toLowerCase();
          const jaCheckin = (statusStr === 'checkin');
          const jaCheckout = (statusStr === 'checkout' || statusStr === 'concluído');

          // Check-in só no primeiro dia da agenda
          if (isFirst && !jaCheckin && (statusStr === '' || statusStr === 'agendado')) {
            controls += ` <button class="btn btn-success btn-sm" data-checkin="${r0.kind}|${r0.refId}" ${canClick}>Check-in</button>`;
          }

          // Check-out só no último dia da agenda
          if (isLast && !jaCheckout && (statusStr === '' || statusStr === 'agendado' || statusStr === 'checkin')) {
            controls += ` <button class="btn btn-warn btn-sm" data-checkout="${r0.kind}|${r0.refId}" ${canClick}>Check-out</button>`;
          }

          // Botão pequeno para ajustar APENAS o pagamento
          if (valorTotal > 0) {
            controls += ` <button class="btn btn-ghost btn-xs" data-ajuste="${r0.kind}|${r0.refId}">Ajustar pagamento</button>`;
          }

          // --- ÍCONES E PENDÊNCIA ---
          const icons = [];
          if (r0.status === 'checkin') icons.push('✔️');
          if (r0.status === 'checkout' || r0.status === 'Concluído') icons.push('❌');
          if (r0.pendente === true) icons.push('⚠️');

          const iconPrefix = icons.join('');
          const pago = Number(r0.pago || 0);
          const faltando = Math.max(0, valorTotal - pago);

          let pendStr = '';
          if ((r0.pendente || faltando > 0) && faltando > 0) {
            pendStr = ` — <span class="muted-sm">Pendente ${fmtMoney(faltando)}</span>`;
          }
		  
const hasNote = !!String(r0.nota ?? r0.observacao ?? '').trim();
const noteIcon = hasNote
  ? ' <span class="note-flag" title="Observações deste agendamento">📝</span>'
  : '';

out += `<div>${iconPrefix ? iconPrefix+' ' : ''}<strong>${petNames}</strong>${noteIcon} — Tutor: <a href="#" class="tutor-link" data-tutor="${tutorId}"><strong>${tutor}</strong></a>${times?` — <span class="muted-sm">${times}</span>`:''}${suffix}${pendStr}${controls}</div>`;

        }
      }


      if (!(rec.hosp||[]).length && !(rec.creche||[]).length){
        out += `<div class="muted">—</div>`;
      }
      out += `</div>`;
    }

    return out;
  }

  await paintWeek();
}


async function abrirPagamento(tipo, kind, refId){
  // 1) Pergunta quanto FOI RECEBIDO AGORA, em reais
  let valorStr = prompt(`Valor recebido AGORA no ${tipo} (R$):`, '0');
  if (valorStr === null) return;

  // Aceita vírgula ou ponto
  valorStr = String(valorStr).replace(',', '.').trim();
  const valorPagoAgora = Number(valorStr);

  if (isNaN(valorPagoAgora) || valorPagoAgora < 0) {
    toast('Informe um valor numérico válido (0 ou mais)', false);
    return;
  }

  const coll = (kind === 'hospedagem') ? 'hospedagens' : 'creches';
  const rec = await DB.get(coll, refId);
  if (!rec) {
    toast('Registro não encontrado', false);
    return;
  }

  // 2) Calcula total pago com esse recebimento
  const valorBase  = Number(rec.valorTotal || rec.valor || 0);
  const pagoAtual  = Number(rec.pago || 0);
  const novoTotalPago = Math.min(valorBase, pagoAtual + valorPagoAgora);

  rec.pago = novoTotalPago;

  const faltando = Math.max(0, valorBase - novoTotalPago);
  rec.pendente = faltando > 0;

  // 3) Atualiza status (checkin / checkout)
  const statusAtual = String(rec.status || '').toLowerCase();

  if (tipo === 'checkin') {
    // Qualquer coisa que NÃO seja 'checkout' vira 'checkin'
    if (statusAtual !== 'checkout') {
      rec.status = 'checkin';
    }
  } else {
    // No checkout sempre marcamos como 'checkout'
    rec.status = 'checkout';
  }


  await DB.put(coll, rec);

  // 4) Atualiza/Cria 1 linha consolidada em PAGAMENTOS (sempre com o TOTAL pago)
  const todosPag = await DB.list('pagamentos');
  let pay = todosPag.find(p => p.refKind === kind && p.refId === refId);

  const hoje = new Date().toISOString().slice(0, 10);
try {
  if (!pay) {
    pay = {
      refKind:   kind,
      refId:     refId,
      valor:     novoTotalPago,
      metodo:    (tipo === 'checkin' ? 'checkin' : 'checkout'),
      data:      hoje,
    };
    await DB.add('pagamentos', pay);
  } else {
    pay.valor      = novoTotalPago;
    pay.metodo     = (tipo === 'checkin' ? 'checkin' : 'checkout');
    pay.data       = hoje;
    await DB.put('pagamentos', pay);
  }
  } catch (e) {
  console.error('ERRO salvando pagamentos:', e);
  toast('Salvou o check-in/out, mas falhou salvar em Pagamentos (ver console).', false);
}

  // 5) Log bonitinho
  await DB.add('logs', {
    at: new Date().toISOString(),
    action: `${tipo}_payment`,
    entity: coll.slice(0, -1),
    entityId: refId,
    note: `${kind} #${refId} — recebido agora ${fmtMoney(valorPagoAgora)} — total pago ${fmtMoney(novoTotalPago)}`
  });

toast(`${tipo === 'checkin' ? 'Check-in' : 'Check-out'} registrado`);

console.error('DEBUG A: salvar terminou, status que eu acabei de setar =', rec.status, 'coll=', coll, 'id=', rec.id);

// confirmação no banco (pega direto por id)
const fresh = await DB.get(coll, refId);
console.error('DEBUG B: status vindo do DB.get logo após salvar =', fresh && fresh.status);

// dá um micro tempo pro Supabase refletir (muito raro, mas elimina 100% dúvida)
await new Promise(r => setTimeout(r, 200));

console.error('DEBUG C: chamando refresh... window.__refreshCheckin =', typeof window.__refreshCheckin);

if (typeof window.__refreshCheckin === 'function') {
  await window.__refreshCheckin();
  console.error('DEBUG D: refresh finalizou');
} else {
  await renderCheckin();
  console.error('DEBUG D: renderCheckin finalizou');
}
}

async function ajustarPagamento(kind, refId){
  // 1) Pergunta o TOTAL que deve constar como pago
  let valorStr = prompt('Valor TOTAL já pago (R$):', '0');
  if (valorStr === null) return;

  valorStr = String(valorStr).replace(',', '.').trim();
  let novoTotalPago = Number(valorStr);
  if (isNaN(novoTotalPago) || novoTotalPago < 0) {
    toast('Informe um valor numérico válido (0 ou mais)', false);
    return;
  }

  const coll = (kind === 'hospedagem') ? 'hospedagens' : 'creches';
  const rec = await DB.get(coll, refId);
  if (!rec) {
    toast('Registro não encontrado', false);
    return;
  }

  const valorBase = Number(rec.valorTotal || rec.valor || 0);
  // Nunca deixa passar do valor total da reserva
  novoTotalPago = Math.min(valorBase, novoTotalPago);

  // 2) Atualiza o registro principal
  rec.pago = novoTotalPago;
  const faltando = Math.max(0, valorBase - novoTotalPago);
  rec.pendente = faltando > 0;

  // Não mexe no status (checkin/checkout/Concluído)
  await DB.put(coll, rec);

  // 3) Atualiza/Cria 1 linha consolidada em PAGAMENTOS
  const todosPag = await DB.list('pagamentos');
  let pay = todosPag.find(p => p.refKind === kind && p.refId === refId);

  const hoje = new Date().toISOString().slice(0, 10);
  try {
  if (!pay) {
    pay = {
      refKind:   kind,
      refId:     refId,
      valor:     novoTotalPago,
      metodo:    'ajuste',
      data:      hoje,
    };
    await DB.add('pagamentos', pay);
  } else {
    pay.valor      = novoTotalPago;
    pay.metodo     = 'ajuste';
    pay.data       = hoje;
    await DB.put('pagamentos', pay);
	}
	} catch (e) {
  console.error('ERRO salvando pagamentos (ajuste):', e);
  toast('Ajuste aplicado, mas falhou salvar em Pagamentos (ver console).', false);
  }

  // 4) Log
  await DB.add('logs', {
    at: new Date().toISOString(),
    action: 'ajuste_pagamento',
    entity: coll.slice(0, -1),
    entityId: refId,
    note: `${kind} #${refId} — ajuste para total pago ${fmtMoney(novoTotalPago)}`
  });

toast('Pagamento ajustado');

// ✅ Atualiza a tela na hora (sem F5)
if (typeof window.__refreshCheckin === 'function') {
  await window.__refreshCheckin();
} else {
  await renderCheckin();
}
}


async function updatePendenciasAlert(){
  const el = document.getElementById('pend_alert');
  if (!el) return;
  const hs = await DB.list('hospedagens');
  const cs = await DB.list('creches');
  const pend = hs.some(h=>h.pendente) || cs.some(c=>c.pendente);
  el.style.display = pend ? 'block' : 'none';
}
// ==== PAGAMENTOS ====
async function renderPagamentos(){
  const view = document.getElementById('view');
  view.innerHTML = `
  <div class="panel">
    <div class="flex">
      <h2>Pagamentos</h2>
      <div class="right"></div>
    </div>

    <div class="row" style="margin-bottom:8px;">
      ${Input('Início', 'pay_inicio', 'date')}
      ${Input('Fim', 'pay_fim', 'date')}
      <div style="display:flex; align-items:flex-end; gap:4px; padding:0 4px 4px 4px;">
        <button class="btn btn-primary" id="pay_filtrar">Filtrar</button>
        <button class="btn btn-outline" id="pay_mes_atual">Mês atual</button>
      </div>
    </div>

    <div class="space"></div>

    <h3>Hospedagens</h3>
    <div class="list-scroll">
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Ref (Tutor — Pets)</th>
            <th>Valor total</th>
            <th>Pago</th>
            <th>Faltando</th>
            <th>Situação</th>
          </tr>
        </thead>
        <tbody id="pay_tbody_hosp"></tbody>
      </table>
    </div>

    <div class="space"></div>

    <h3>Creche</h3>
    <div class="list-scroll">
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Ref (Tutor — Pets)</th>
            <th>Valor total</th>
            <th>Pago</th>
            <th>Faltando</th>
            <th>Situação</th>
          </tr>
        </thead>
        <tbody id="pay_tbody_creche"></tbody>
      </table>
    </div>

    <div class="space"></div>
    <div class="mono">
      Total Hospedagem: <span id="pay_total_hosp">R$ 0,00</span><br/>
      Total Creche: <span id="pay_total_creche">R$ 0,00</span><br/>
      <strong>Total Geral: <span id="pay_total_geral">R$ 0,00</span></strong>
    </div>
  </div>`;

  const btnFiltrar = document.getElementById('pay_filtrar');
  const btnMesAtual = document.getElementById('pay_mes_atual');

  btnFiltrar.onclick = () => {
    const ini = document.getElementById('pay_inicio').value || null;
    const fim = document.getElementById('pay_fim').value || null;
    loadPagamentos(ini, fim, false);
  };

  btnMesAtual.onclick = () => {
    loadPagamentos(null, null, true);
  };

  // Carrega mês atual ao abrir
  loadPagamentos(null, null, true);
}

async function loadPagamentos(inicio = null, fim = null, resetInputs = false){
  const tbodyHosp = document.getElementById('pay_tbody_hosp');
  const tbodyCre = document.getElementById('pay_tbody_creche');
  if (!tbodyHosp || !tbodyCre) return;

  tbodyHosp.innerHTML = '';
  tbodyCre.innerHTML = '';

  const elTotHosp = document.getElementById('pay_total_hosp');
  const elTotCre = document.getElementById('pay_total_creche');
  const elTotGeral = document.getElementById('pay_total_geral');

  // Define intervalo de datas
  let dataIni = inicio;
  let dataFim = fim;

  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth(); // 0-11

  if (!dataIni && !dataFim) {
    const first = new Date(ano, mes, 1);
    const last = new Date(ano, mes + 1, 0);
    dataIni = ymd(first);
    dataFim = ymd(last);
  } else {
    if (!dataIni && dataFim) dataIni = '0001-01-01';
    if (dataIni && !dataFim) dataFim = '9999-12-31';
  }

  // Atualiza os inputs quando for mês atual ou quando ainda estiverem vazios
  const inpIni = document.getElementById('pay_inicio');
  const inpFim = document.getElementById('pay_fim');
  if (inpIni && (resetInputs || !inpIni.value)) inpIni.value = dataIni;
  if (inpFim && (resetInputs || !inpFim.value)) inpFim.value = dataFim;

  const list = await DB.list('pagamentos');

  // Agrupa por refKind + refId (uma linha por hospedagem/creche – já estava assim)
  const grouped = {};
  for (const p of list) {
    const key = `${p.refKind || ''}|${p.refId || ''}`;
    const existing = grouped[key];
    if (!existing) {
      grouped[key] = p;
    } else {
      const dNew = String(p.data || '');
      const dOld = String(existing.data || '');
      if (dNew > dOld || (dNew === dOld && (p.id || 0) > (existing.id || 0))) {
        grouped[key] = p;
      }
    }
  }

// ====== Agora sim: cria "items" a partir do grouped e filtra por período ======
const items = Object.values(grouped)
  .filter(p => {
    const d = String(p.data || '');
    return d >= dataIni && d <= dataFim;
  })
  .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')) || ((b.id || 0) - (a.id || 0)));

// Se não tiver nada no período, já mostra totais zerados e sai
if (!items.length) {
  if (elTotHosp) elTotHosp.textContent = fmtMoney(0);
  if (elTotCre) elTotCre.textContent = fmtMoney(0);
  if (elTotGeral) elTotGeral.textContent = fmtMoney(0);
  return;
}

// Clientes e pets pode continuar pegando "tudo" (normalmente é bem leve)
const [clientes, pets] = await Promise.all([
  DB.list('clientes'),
  DB.list('pets'),
]);

const byCli = Object.fromEntries(clientes.map(c => [c.id, c]));
const byPet = Object.fromEntries(pets.map(p => [p.id, p]));

// Pega apenas as hospedagens/creches necessárias (por ID), COM BASE EM "items"
const hospIds = [...new Set(
  items.filter(p => (p.refKind || '') === 'hospedagem').map(p => Number(p.refId || 0)).filter(Boolean)
)];
const crecheIds = [...new Set(
  items.filter(p => (p.refKind || '') === 'creche').map(p => Number(p.refId || 0)).filter(Boolean)
)];

// Busca em lote (bem mais leve do que DB.list de tudo)
const [hospedagensNeed, crechesNeed] = await Promise.all([
  hospIds.length ? DB.getMany('hospedagens', hospIds) : Promise.resolve([]),
  crecheIds.length ? DB.getMany('creches', crecheIds) : Promise.resolve([]),
]);

const byHosp = Object.fromEntries(hospedagensNeed.map(h => [h.id, h]));
const byCre  = Object.fromEntries(crechesNeed.map(c => [c.id, c]));

  let totHosp = 0;
  let totCre = 0;

  for (const p of items) {
    const isHosp = (p.refKind === 'hospedagem');
    const rid = Number(p.refId || 0);
const rec = isHosp ? byHosp[rid] : byCre[rid];
    if (!rec) continue;

    const tutor = byCli[rec.tutorId]?.nome || (`Tutor #${rec.tutorId}`);
    const petNames = (rec.petIds || []).map(
      id => byPet[id]?.nome || ('#'+id)
    ).join(', ');
    const refName = `${tutor} — ${petNames}`;

    const valorBase = Number(rec.valorTotal || rec.valor || 0);
    const pago = Number(rec.pago || p.valor || 0);
    const faltando = Math.max(0, valorBase - pago);

    const icons = [];
    if (rec.status === 'checkin') icons.push('✔️');
    if (rec.status === 'checkout' || rec.status === 'Concluído') icons.push('❌');
    if (rec.pendente) icons.push('⚠️');

    const situacao = `${icons.join(' ')} ${faltando > 0 ? 'Pendente' : 'Pago'}`.trim();

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${fmtBR(p.data || '')}</td>
      <td>${refName}</td>
      <td>${fmtMoney(valorBase)}</td>
      <td>${fmtMoney(pago)}</td>
      <td>${faltando > 0 ? fmtMoney(faltando) : '—'}</td>
      <td>${situacao}</td>
    `;

    if (isHosp) {
      tbodyHosp.appendChild(tr);
      totHosp += pago;
    } else {
      tbodyCre.appendChild(tr);
      totCre += pago;
    }
  }

  if (elTotHosp) elTotHosp.textContent = fmtMoney(totHosp);
  if (elTotCre) elTotCre.textContent = fmtMoney(totCre);
  if (elTotGeral) elTotGeral.textContent = fmtMoney(totHosp + totCre);
}


async function receberPagamento(kind, refId){
  const valorStr = prompt('Valor recebido (R$):', '0'); if (valorStr==null) return;
  const metodo = prompt('Método (dinheiro, pix, cartão):', 'pix')||'pix';
  const valor = Number(valorStr||0);
  const payId = await DB.add('pagamentos', { refKind:kind, refId, valor, metodo, data:new Date().toISOString().slice(0,10) });
  await DB.add('logs', { at:new Date().toISOString(), action:'payment', entity:'pagamento', entityId:payId, note:`${kind} #${refId} — ${fmtMoney(valor)} (${metodo})` });
  toast('Pagamento registrado'); renderPagamentos();
}

// ==== PRÉ-CADASTROS ====
let __preCadOffset = 0;
const __PRE_CAD_PAGE = 100;

function preCadStatusTag(status){
  const s = String(status || '').toLowerCase();

  if (s === 'aprovado') {
    return `<span class="tag tag-green">Aprovado</span>`;
  }
  if (s === 'rejeitado') {
    return `<span class="tag tag-red">Rejeitado</span>`;
  }
  return `<span class="tag tag-yellow">Pendente</span>`;
}

function preCadFmtDate(dt){
  if (!dt) return '';
  try{
    return new Date(dt).toLocaleString('pt-BR');
  }catch(e){
    return dt;
  }
}

async function renderPreCadastros(){
  const view = document.getElementById('view');

  view.innerHTML = `
    <div class="panel">
      <div class="flex">
        <h2>Pré-cadastros recebidos</h2>
        <div class="right" style="display:flex; gap:8px; align-items:center;">
          <button class="btn btn-outline" id="pre_refresh">Atualizar</button>
        </div>
      </div>

      <div class="muted-sm" style="margin-bottom:10px;">
        Aqui aparecem os cadastros enviados pelo formulário público antes da aprovação final.
      </div>

      <div class="list-scroll">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Data</th>
              <th>Nome</th>
              <th>CPF</th>
              <th>Telefone</th>
              <th>Pets</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody id="pre_tbody">
            <tr>
              <td colspan="8" class="muted-sm">Carregando pré-cadastros...</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style="display:flex; justify-content:flex-end; margin-top:10px;">
        <button class="btn btn-outline" id="pre_more">Carregar mais</button>
      </div>
    </div>
  `;

  const btnRefresh = document.getElementById('pre_refresh');
  const btnMore = document.getElementById('pre_more');

  if (btnRefresh) btnRefresh.onclick = () => loadPreCadastros(true);
  if (btnMore) btnMore.onclick = () => loadPreCadastros(false);

  loadPreCadastros(true);
}

async function loadPreCadastros(reset = false){
  const tbody = document.getElementById('pre_tbody');
  const btnMore = document.getElementById('pre_more');
  if (!tbody) return;

  if (reset) {
    tbody.innerHTML = '';
    __preCadOffset = 0;
  }

  let rows = [];
  let pets = [];

  try{
    rows = await DB.page('pre_cadastros', {
      limit: __PRE_CAD_PAGE,
      offset: __preCadOffset,
      orderBy: 'created_at',
      ascending: false
    });

    pets = await DB.list('pre_cadastro_pets');
  }catch(e){
    console.error('Erro ao carregar pré-cadastros:', e);
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="color:#991b1b;">
          Erro ao carregar pré-cadastros. Veja o console.
        </td>
      </tr>
    `;
    if (btnMore) btnMore.style.display = 'none';
    return;
  }

  if (reset && !rows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="muted-sm">Nenhum pré-cadastro encontrado.</td>
      </tr>
    `;
    if (btnMore) btnMore.style.display = 'none';
    return;
  }

  const petsCountByPreId = {};
  for (const p of (pets || [])) {
    const preId = Number(p.preCadastroId ?? p.pre_cadastro_id ?? 0);
    if (!preId) continue;
    petsCountByPreId[preId] = (petsCountByPreId[preId] || 0) + 1;
  }

  for (const r of rows) {
    const tr = document.createElement('tr');

    const qtdPets = petsCountByPreId[Number(r.id)] || 0;

    tr.innerHTML = `
      <td>${r.id ?? ''}</td>
      <td>${preCadFmtDate(r.createdAt || r.created_at)}</td>
      <td>${r.nome || ''}</td>
      <td>${r.cpf || ''}</td>
      <td>${r.telefone || ''}</td>
      <td style="text-align:center;">${qtdPets}</td>
      <td>${preCadStatusTag(r.status)}</td>
      <td class="flex">
        <button class="btn btn-ghost" data-pre-open="${r.id}">Abrir</button>
      </td>
    `;

    tbody.appendChild(tr);
  }

  __preCadOffset += rows.length;

  if (btnMore) {
    btnMore.style.display = rows.length < __PRE_CAD_PAGE ? 'none' : '';
  }

  $all('[data-pre-open]').forEach(b => {
    b.onclick = async () => {
      const id = Number(b.getAttribute('data-pre-open'));
      await openPreCadastroDetails(id);
    };
  });
}

function preCadText(v){
  return (v ?? '').toString().trim();
}

function preCadYesNo(v){
  return v ? 'Sim' : 'Não';
}

function preCadFmtBirth(v){
  if (!v) return '';
  try{
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) {
      return fmtBR(String(v));
    }
    return new Date(v).toLocaleDateString('pt-BR');
  }catch(e){
    return String(v);
  }
}

function preCadField(label, value){
  const val = preCadText(value) || '—';
  return `
    <div style="display:flex; flex-direction:column; gap:4px;">
      <div class="muted-sm" style="font-weight:700;">${uiEscapeHtml(label)}</div>
      <div style="
        min-height:42px;
        padding:10px 12px;
        border:1px solid #d4bbff;
        border-radius:12px;
        background:#fff;
        line-height:1.35;
      ">${uiEscapeHtml(val)}</div>
    </div>
  `;
}

function preCadPetCardHtml(p, idx){
  const vacinas = [];

  if (p.vacinaViral || p.vacina_viral) {
    const tipoViral = String(p.vacinaViralTipo ?? p.vacina_viral_tipo ?? '').trim() || '—';
    const mesViral = String(p.vacinaViralMes ?? p.vacina_viral_mes ?? '').trim() || '—';
    const anoViral = String(p.vacinaViralAno ?? p.vacina_viral_ano ?? '').trim() || '—';
    vacinas.push(`Vacina viral (${tipoViral}): ${mesViral}/${anoViral}`);
  }

  if (p.vacinaAntirrabica || p.vacina_antirrabica) {
    vacinas.push(`Antirrábica: ${String(p.vacinaAntirrabicaMes ?? p.vacina_antirrabica_mes ?? '').trim() || '—'}/${String(p.vacinaAntirrabicaAno ?? p.vacina_antirrabica_ano ?? '').trim() || '—'}`);
  }

  if (p.antipulga) {
    const tipoAntiPulga = String(p.antipulgaTipo ?? p.antipulga_tipo ?? '').trim() || '—';
    const mesAntiPulga = String(p.antipulgaMes ?? p.antipulga_mes ?? '').trim() || '—';
    const anoAntiPulga = String(p.antipulgaAno ?? p.antipulga_ano ?? '').trim() || '—';
    vacinas.push(`Antipulga (${tipoAntiPulga}): ${mesAntiPulga}/${anoAntiPulga}`);
  }

  const alimentacaoTipo = p.alimentacaoTipo ?? p.alimentacao_tipo ?? '';
  const alimentacaoTexto = p.alimentacaoTexto ?? p.alimentacao_texto ?? '';

  return `
    <div style="
      border:1px solid #d4bbff;
      border-radius:14px;
      padding:12px;
      background:#fff;
      margin-top:10px;
    ">
      <div style="
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:12px;
        margin-bottom:12px;
        flex-wrap:wrap;
        padding:12px;
        border:1px solid #eadcff;
        border-radius:12px;
        background:linear-gradient(180deg,#fcfaff 0%, #f6efff 100%);
      ">
        <div style="min-width:220px; flex:1;">
          <div style="
            display:inline-flex;
            align-items:center;
            gap:6px;
            padding:4px 10px;
            border-radius:999px;
            background:#ede4ff;
            border:1px solid #d9c2ff;
            color:#6b21a8;
            font-size:11px;
            font-weight:900;
            margin-bottom:8px;
          ">
            PET ${idx + 1}
          </div>

          <div style="
            font-weight:900;
            font-size:18px;
            line-height:1.15;
            color:#111827;
            margin-bottom:4px;
          ">
            ${uiEscapeHtml(preCadText(p.nome) || 'Sem nome')}
          </div>

          <div class="muted-sm" style="line-height:1.4;">
            <strong>Raça:</strong> ${uiEscapeHtml(preCadText(p.raca) || '—')}
            &nbsp;•&nbsp;
            <strong>Nascimento:</strong> ${uiEscapeHtml(preCadText(p.nascimento) || '—')}
          </div>
        </div>

        <div style="
          display:flex;
          gap:8px;
          flex-wrap:wrap;
          align-items:center;
          justify-content:flex-end;
        ">
          <span class="tag">${uiEscapeHtml(preCadText(p.especie) || 'Sem espécie')}</span>
          <span class="tag">${uiEscapeHtml(preCadText(p.sexo) || 'Sem sexo')}</span>
          <span class="tag ${p.castrado ? 'tag-green' : 'tag-yellow'}">
            ${p.castrado ? 'Castrado' : 'Não castrado'}
          </span>
        </div>
      </div>

      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:10px;">
        ${preCadField('Nome', p.nome)}
        ${preCadField('Espécie', p.especie)}
        ${preCadField('Raça', p.raca)}
        ${preCadField('Sexo', p.sexo)}
        ${preCadField('Nascimento', preCadFmtBirth(p.nascimento))}
        ${preCadField('Peso', p.peso)}
        ${preCadField('Castrado', preCadYesNo(p.castrado))}
        ${preCadField('Alergias', preCadYesNo(p.alergiasFlag ?? p.alergias_flag))}
        ${preCadField('Texto alergias', p.alergiasTexto ?? p.alergias_texto)}
        ${preCadField('Doenças', preCadYesNo(p.doencasFlag ?? p.doencas_flag))}
        ${preCadField('Texto doenças', p.doencasTexto ?? p.doencas_texto)}
        ${preCadField('Cuidados especiais', preCadYesNo(p.cuidadosFlag ?? p.cuidados_flag))}
        ${preCadField('Texto cuidados', p.cuidadosTexto ?? p.cuidados_texto)}
        ${preCadField('Tipo de alimentação', alimentacaoTipo)}
        ${preCadField('Detalhes da alimentação', alimentacaoTexto)}
        ${preCadField('Vacinas', vacinas.length ? vacinas.join(' | ') : '—')}
      </div>
    </div>
  `;
}

function preCadAttr(v){
  return uiEscapeHtml((v ?? '').toString());
}

function preCadInputEdit(label, id, value, type='text', extra=''){
  return `
    <div style="display:flex; flex-direction:column; gap:4px;">
      <label for="${preCadAttr(id)}" class="muted-sm" style="font-weight:700;">${uiEscapeHtml(label)}</label>
      <input
        id="${preCadAttr(id)}"
        type="${preCadAttr(type)}"
        value="${preCadAttr(value)}"
        ${extra || ''}
        style="
          min-height:42px;
          padding:10px 12px;
          border:1px solid #d4bbff;
          border-radius:12px;
          background:#fff;
        "
      />
    </div>
  `;
}

function preCadTextareaEdit(label, id, value, rows=3){
  return `
    <div style="display:flex; flex-direction:column; gap:4px;">
      <label for="${preCadAttr(id)}" class="muted-sm" style="font-weight:700;">${uiEscapeHtml(label)}</label>
      <textarea
        id="${preCadAttr(id)}"
        rows="${Number(rows) || 3}"
        style="
          min-height:84px;
          padding:10px 12px;
          border:1px solid #d4bbff;
          border-radius:12px;
          background:#fff;
          resize:vertical;
        "
      >${preCadAttr(value)}</textarea>
    </div>
  `;
}

function preCadSelectYesNo(label, id, value){
  const sim = value ? 'selected' : '';
  const nao = !value ? 'selected' : '';
  return `
    <div style="display:flex; flex-direction:column; gap:4px;">
      <label for="${preCadAttr(id)}" class="muted-sm" style="font-weight:700;">${uiEscapeHtml(label)}</label>
      <select
        id="${preCadAttr(id)}"
        style="
          min-height:42px;
          padding:10px 12px;
          border:1px solid #d4bbff;
          border-radius:12px;
          background:#fff;
        "
      >
        <option value="Nao" ${nao}>Não</option>
        <option value="Sim" ${sim}>Sim</option>
      </select>
    </div>
  `;
}

function preCadPetEditorHtml(p, idx){
  const pid = Number(p.id || 0);
  const prefix = `prepet_${pid}_`;

  return `
    <div style="
      border:1px solid #d4bbff;
      border-radius:14px;
      padding:12px;
      background:#fff;
      margin-top:10px;
    ">
      <div style="
        display:flex;
        align-items:flex-start;
        justify-content:space-between;
        gap:12px;
        margin-bottom:12px;
        flex-wrap:wrap;
        padding:12px;
        border:1px solid #eadcff;
        border-radius:12px;
        background:linear-gradient(180deg,#fcfaff 0%, #f6efff 100%);
      ">
        <div style="min-width:220px; flex:1;">
          <div style="
            display:inline-flex;
            align-items:center;
            gap:6px;
            padding:4px 10px;
            border-radius:999px;
            background:#ede4ff;
            border:1px solid #d9c2ff;
            color:#6b21a8;
            font-size:11px;
            font-weight:900;
            margin-bottom:8px;
          ">
            PET ${idx + 1}
          </div>

          <div style="
            font-weight:900;
            font-size:18px;
            line-height:1.15;
            color:#111827;
            margin-bottom:4px;
          ">
            ${uiEscapeHtml(preCadText(p.nome) || 'Sem nome')}
          </div>

          <div class="muted-sm" style="line-height:1.4;">
            <strong>Raça:</strong> ${uiEscapeHtml(preCadText(p.raca) || '—')}
            &nbsp;•&nbsp;
            <strong>Nascimento:</strong> ${uiEscapeHtml(preCadText(p.nascimento) || '—')}
          </div>
        </div>

        <div style="
          display:flex;
          gap:8px;
          flex-wrap:wrap;
          align-items:center;
          justify-content:flex-end;
        ">
          <span class="tag">${uiEscapeHtml(preCadText(p.especie) || 'Sem espécie')}</span>
          <span class="tag">${uiEscapeHtml(preCadText(p.sexo) || 'Sem sexo')}</span>
          <span class="tag ${p.castrado ? 'tag-green' : 'tag-yellow'}">
            ${p.castrado ? 'Castrado' : 'Não castrado'}
          </span>
        </div>
      </div>

      <div id="${prefix}status_cards" style="
        display:flex;
        gap:8px;
        flex-wrap:wrap;
        margin:-2px 0 12px 0;
      ">
        <span id="${prefix}badge_alergias" class="tag ${(p.alergiasFlag ?? p.alergias_flag) ? 'tag-red' : 'tag-green'}">
          ${(p.alergiasFlag ?? p.alergias_flag) ? 'Alergias: Sim' : 'Alergias: Não'}
        </span>

        <span id="${prefix}badge_doencas" class="tag ${(p.doencasFlag ?? p.doencas_flag) ? 'tag-red' : 'tag-green'}">
          ${(p.doencasFlag ?? p.doencas_flag) ? 'Doenças: Sim' : 'Doenças: Não'}
        </span>

        <span id="${prefix}badge_cuidados" class="tag ${(p.cuidadosFlag ?? p.cuidados_flag) ? 'tag-red' : 'tag-green'}">
          ${(p.cuidadosFlag ?? p.cuidados_flag) ? 'Cuidados: Sim' : 'Cuidados: Não'}
        </span>
      </div>

<div class="row">
  <div class="col">
    ${preCadInputEdit('Nome', prefix + 'nome', p.nome || '')}
  </div>
  <div class="col">
    ${preCadInputEdit('Espécie', prefix + 'especie', p.especie || '')}
  </div>
</div>

<div class="row">
  <div class="col">
    ${preCadInputEdit('Raça', prefix + 'raca', p.raca || '')}
  </div>
  <div class="col">
    ${preCadInputEdit('Sexo', prefix + 'sexo', p.sexo || '')}
  </div>
</div>

<div class="row">
  <div class="col">
    ${preCadInputEdit('Nascimento', prefix + 'nascimento', p.nascimento || '', 'date')}
  </div>
  <div class="col">
    ${preCadInputEdit('Peso', prefix + 'peso', p.peso || '', 'number', 'step="0.1" min="0"')}
  </div>
  <div class="col">
    ${preCadSelectYesNo('Castrado', prefix + 'castrado', !!p.castrado)}
  </div>
</div>

<div class="row">
  <div class="col">
    ${preCadSelectYesNo('Alergias', prefix + 'alergias_flag', !!(p.alergiasFlag ?? p.alergias_flag))}
  </div>
  <div class="col">
    ${preCadSelectYesNo('Doenças', prefix + 'doencas_flag', !!(p.doencasFlag ?? p.doencas_flag))}
  </div>
  <div class="col">
    ${preCadSelectYesNo('Cuidados especiais', prefix + 'cuidados_flag', !!(p.cuidadosFlag ?? p.cuidados_flag))}
  </div>
</div>

<div class="row" id="${prefix}wrap_alergias_texto">
  <div class="col">
    ${preCadTextareaEdit('Texto alergias', prefix + 'alergias_texto', p.alergiasTexto ?? p.alergias_texto ?? '', 2)}
  </div>
</div>

<div class="row" id="${prefix}wrap_doencas_texto">
  <div class="col">
    ${preCadTextareaEdit('Texto doenças', prefix + 'doencas_texto', p.doencasTexto ?? p.doencas_texto ?? '', 2)}
  </div>
</div>

<div class="row" id="${prefix}wrap_cuidados_texto">
  <div class="col">
    ${preCadTextareaEdit('Texto cuidados', prefix + 'cuidados_texto', p.cuidadosTexto ?? p.cuidados_texto ?? '', 2)}
  </div>
</div>

<div class="row">
  <div class="col">
    ${preCadInputEdit('Tipo de alimentação', prefix + 'alimentacao_tipo', p.alimentacaoTipo ?? p.alimentacao_tipo ?? '')}
  </div>
</div>

<div class="row" id="${prefix}wrap_alimentacao_texto">
  <div class="col">
    ${preCadTextareaEdit('Detalhes da alimentação', prefix + 'alimentacao_texto', p.alimentacaoTexto ?? p.alimentacao_texto ?? '', 2)}
  </div>
</div>

      <div style="
        margin-top:10px;
        padding:12px;
        border:1px solid #d4bbff;
        border-radius:12px;
        background:#faf7ff;
      ">
        <div style="
          font-weight:900;
          font-size:13px;
          margin-bottom:10px;
          color:#6b21a8;
        ">
          Vacinas e proteção
        </div>

        <div style="
          border:1px solid #e7d8ff;
          border-radius:12px;
          background:#ffffff;
          padding:10px;
          margin-bottom:10px;
        ">
          <div style="
            font-weight:800;
            font-size:12px;
            margin-bottom:8px;
            color:#7c3aed;
          ">
            Vacina viral
          </div>

          <div class="row">
            <div class="col">
              ${preCadSelectYesNo('Vacina viral em dia', prefix + 'vacina_viral', !!(p.vacinaViral ?? p.vacina_viral))}
            </div>
            <div class="col">
              ${preCadInputEdit('Tipo da vacina viral (V8 ou V10)', prefix + 'vacina_viral_tipo', p.vacinaViralTipo ?? p.vacina_viral_tipo ?? '')}
            </div>
          </div>

          <div class="row">
            <div class="col">
              ${preCadInputEdit('Mês da vacina viral', prefix + 'vacina_viral_mes', p.vacinaViralMes ?? p.vacina_viral_mes ?? '', 'number', 'min="1" max="12"')}
            </div>
            <div class="col">
              ${preCadInputEdit('Ano da vacina viral', prefix + 'vacina_viral_ano', p.vacinaViralAno ?? p.vacina_viral_ano ?? '', 'number', 'min="2000" max="2100"')}
            </div>
          </div>
        </div>

        <div style="
          border:1px solid #e7d8ff;
          border-radius:12px;
          background:#ffffff;
          padding:10px;
          margin-bottom:10px;
        ">
          <div style="
            font-weight:800;
            font-size:12px;
            margin-bottom:8px;
            color:#7c3aed;
          ">
            Antirrábica
          </div>

          <div class="row">
            <div class="col">
              ${preCadSelectYesNo('Antirrábica em dia', prefix + 'vacina_antirrabica', !!(p.vacinaAntirrabica ?? p.vacina_antirrabica))}
            </div>
            <div class="col">
              ${preCadInputEdit('Mês da antirrábica', prefix + 'vacina_antirrabica_mes', p.vacinaAntirrabicaMes ?? p.vacina_antirrabica_mes ?? '', 'number', 'min="1" max="12"')}
            </div>
            <div class="col">
              ${preCadInputEdit('Ano da antirrábica', prefix + 'vacina_antirrabica_ano', p.vacinaAntirrabicaAno ?? p.vacina_antirrabica_ano ?? '', 'number', 'min="2000" max="2100"')}
            </div>
          </div>
        </div>

        <div style="
          border:1px solid #e7d8ff;
          border-radius:12px;
          background:#ffffff;
          padding:10px;
        ">
          <div style="
            font-weight:800;
            font-size:12px;
            margin-bottom:8px;
            color:#7c3aed;
          ">
            Antipulga / coleira
          </div>

          <div class="row">
            <div class="col">
              ${preCadSelectYesNo('Antipulga em dia', prefix + 'antipulga', !!p.antipulga)}
            </div>
            <div class="col">
              ${preCadInputEdit('Tipo do antipulga', prefix + 'antipulga_tipo', p.antipulgaTipo ?? p.antipulga_tipo ?? '')}
            </div>
          </div>

          <div class="row">
            <div class="col">
              ${preCadInputEdit('Mês do antipulga', prefix + 'antipulga_mes', p.antipulgaMes ?? p.antipulga_mes ?? '', 'number', 'min="1" max="12"')}
            </div>
            <div class="col">
              ${preCadInputEdit('Ano do antipulga', prefix + 'antipulga_ano', p.antipulgaAno ?? p.antipulga_ano ?? '', 'number', 'min="2000" max="2100"')}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function preCadSyncPetConditionalFields(pid){
  const prefix = `prepet_${Number(pid)}_`;

  const getEl = (suffix) => document.getElementById(prefix + suffix);
  const getWrap = (suffix) => document.getElementById(prefix + 'wrap_' + suffix);

  const alergiasSel = getEl('alergias_flag');
  const doencasSel = getEl('doencas_flag');
  const cuidadosSel = getEl('cuidados_flag');
  const alimentacaoTipoEl = getEl('alimentacao_tipo');

  const alergiasTxt = getEl('alergias_texto');
  const doencasTxt = getEl('doencas_texto');
  const cuidadosTxt = getEl('cuidados_texto');
  const alimentacaoTxt = getEl('alimentacao_texto');
    
	const badgeAlergias = getEl('badge_alergias');
  const badgeDoencas = getEl('badge_doencas');
  const badgeCuidados = getEl('badge_cuidados');

  const wrapAlergias = getWrap('alergias_texto');
  const wrapDoencas = getWrap('doencas_texto');
  const wrapCuidados = getWrap('cuidados_texto');
  const wrapAlimentacao = getWrap('alimentacao_texto');

  const isSim = (el) => el && String(el.value) === 'Sim';

  const tipoAlimentacao = (alimentacaoTipoEl?.value || '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const mostrarAlergias = isSim(alergiasSel);
  const mostrarDoencas = isSim(doencasSel);
  const mostrarCuidados = isSim(cuidadosSel);

  // esconde detalhes quando for "ração" ou "racao"
  const mostrarAlimentacao =
    !!tipoAlimentacao &&
    tipoAlimentacao !== 'racao' &&
    tipoAlimentacao !== 'ração';

  if (wrapAlergias) wrapAlergias.style.display = mostrarAlergias ? '' : 'none';
  if (wrapDoencas) wrapDoencas.style.display = mostrarDoencas ? '' : 'none';
  if (wrapCuidados) wrapCuidados.style.display = mostrarCuidados ? '' : 'none';
  if (wrapAlimentacao) wrapAlimentacao.style.display = mostrarAlimentacao ? '' : 'none';

  if (badgeAlergias) {
    badgeAlergias.className = 'tag ' + (mostrarAlergias ? 'tag-red' : 'tag-green');
    badgeAlergias.textContent = mostrarAlergias ? 'Alergias: Sim' : 'Alergias: Não';
  }

  if (badgeDoencas) {
    badgeDoencas.className = 'tag ' + (mostrarDoencas ? 'tag-red' : 'tag-green');
    badgeDoencas.textContent = mostrarDoencas ? 'Doenças: Sim' : 'Doenças: Não';
  }

  if (badgeCuidados) {
    badgeCuidados.className = 'tag ' + (mostrarCuidados ? 'tag-red' : 'tag-green');
    badgeCuidados.textContent = mostrarCuidados ? 'Cuidados: Sim' : 'Cuidados: Não';
  }

  // limpa os campos escondidos para não salvar texto antigo sem querer
  if (!mostrarAlergias && alergiasTxt) alergiasTxt.value = '';
  if (!mostrarDoencas && doencasTxt) doencasTxt.value = '';
  if (!mostrarCuidados && cuidadosTxt) cuidadosTxt.value = '';
  if (!mostrarAlimentacao && alimentacaoTxt) alimentacaoTxt.value = '';
}

async function savePreCadastroDetails(id){
  if (!id) return;

  let pre = null;
  let pets = [];

  try{
    pre = await DB.get('pre_cadastros', id);
    pets = await DB.list('pre_cadastro_pets');
  }catch(e){
    console.error('Erro ao buscar dados para salvar pré-cadastro:', e);
    toast('Erro ao preparar o salvamento do pré-cadastro.', false);
    return;
  }

  if (!pre) {
    toast('Pré-cadastro não encontrado para salvar.', false);
    return;
  }

  const getVal = (id) => {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
  };

  const getBool = (id) => {
    const el = document.getElementById(id);
    if (!el) return false;
    return String(el.value) === 'Sim';
  };

  const nome = getVal('pre_nome');
  const cpf = getVal('pre_cpf');
  const telefone = getVal('pre_tel');
  const email = getVal('pre_email');
  const cep = getVal('pre_cep');
  const cidade = getVal('pre_cidade');
  const endereco = getVal('pre_endereco');
  const contatoVet = getVal('pre_contato_vet');
  const observacao = getVal('pre_observacao');
  const reviewNotes = getVal('pre_review_notes');

  if (!nome) {
    toast('O nome do tutor não pode ficar vazio.', false);
    const el = document.getElementById('pre_nome');
    if (el) el.focus();
    return;
  }

  const cpfNum = (cpf || '').replace(/\D/g, '');
  if (!cpfNum) {
    toast('O CPF do tutor não pode ficar vazio.', false);
    const el = document.getElementById('pre_cpf');
    if (el) el.focus();
    return;
  }

  if (!isValidCPF(cpfNum)) {
    toast('CPF inválido.', false);
    const el = document.getElementById('pre_cpf');
    if (el) el.focus();
    return;
  }

  pre.nome = nome;
  pre.cpf = formatCPF(cpfNum);
  pre.telefone = telefone;
  pre.email = email;
  pre.cep = cep;
  pre.cidade = cidade;
  pre.endereco = endereco;
  pre.contato_vet = contatoVet;
  pre.observacao = observacao;
  pre.review_notes = reviewNotes;

  try{
    await DB.put('pre_cadastros', pre);

    const petsDoPre = (pets || [])
      .filter(p => Number(p.preCadastroId ?? p.pre_cadastro_id) === Number(id))
      .sort((a,b) => Number(a.id || 0) - Number(b.id || 0));

    for (const p of petsDoPre) {
      const pid = Number(p.id || 0);
      const prefix = `prepet_${pid}_`;

      const nomePet = getVal(prefix + 'nome');
      if (!nomePet) {
        toast(`O nome do pet ID ${pid} não pode ficar vazio.`, false);
        const el = document.getElementById(prefix + 'nome');
        if (el) el.focus();
        return;
      }

      p.nome = nomePet;
      p.especie = getVal(prefix + 'especie');
      p.raca = getVal(prefix + 'raca');
      p.sexo = getVal(prefix + 'sexo');
      p.nascimento = getVal(prefix + 'nascimento') || null;

      const pesoTxt = getVal(prefix + 'peso');
      p.peso = pesoTxt ? Number(pesoTxt) : null;

      p.castrado = getBool(prefix + 'castrado');

      p.alergias_flag = getBool(prefix + 'alergias_flag');
      p.alergias_texto = getVal(prefix + 'alergias_texto');

      p.doencas_flag = getBool(prefix + 'doencas_flag');
      p.doencas_texto = getVal(prefix + 'doencas_texto');

      p.cuidados_flag = getBool(prefix + 'cuidados_flag');
      p.cuidados_texto = getVal(prefix + 'cuidados_texto');

      p.alimentacao_tipo = getVal(prefix + 'alimentacao_tipo');
      p.alimentacao_texto = getVal(prefix + 'alimentacao_texto');
	  
	        p.vacina_viral = getBool(prefix + 'vacina_viral');
      p.vacina_viral_tipo = getVal(prefix + 'vacina_viral_tipo');
      p.vacina_viral_mes = getVal(prefix + 'vacina_viral_mes') || null;
      p.vacina_viral_ano = getVal(prefix + 'vacina_viral_ano') || null;

      p.vacina_antirrabica = getBool(prefix + 'vacina_antirrabica');
      p.vacina_antirrabica_mes = getVal(prefix + 'vacina_antirrabica_mes') || null;
      p.vacina_antirrabica_ano = getVal(prefix + 'vacina_antirrabica_ano') || null;

      p.antipulga = getBool(prefix + 'antipulga');
      p.antipulga_tipo = getVal(prefix + 'antipulga_tipo');
      p.antipulga_mes = getVal(prefix + 'antipulga_mes') || null;
      p.antipulga_ano = getVal(prefix + 'antipulga_ano') || null;

      await DB.put('pre_cadastro_pets', p);
    }

    await DB.add('logs', {
      at: new Date().toISOString(),
      action: 'update',
      entity: 'pre_cadastro',
      entityId: Number(id),
      note: `Pré-cadastro revisado manualmente`
    });

    toast('Pré-cadastro atualizado com sucesso.');
    await loadPreCadastros(true);
    await openPreCadastroDetails(id);
  }catch(e){
    console.error('Erro ao salvar pré-cadastro:', e);
    const msg = e?.message || e?.error_description || 'Erro ao salvar as alterações do pré-cadastro.';
    toast(msg, false);
  }
}

async function preCadMarkStatus(id, status){
  if (!id) return false;

  let pre = null;
  try{
    pre = await DB.get('pre_cadastros', id);
  }catch(e){
    console.error('Erro ao carregar pré-cadastro para mudar status:', e);
    toast('Erro ao carregar o pré-cadastro.', false);
    return false;
  }

  if (!pre) {
    toast('Pré-cadastro não encontrado.', false);
    return false;
  }

  try{
    pre.status = status;
    pre.reviewed_at = new Date().toISOString();

    await DB.put('pre_cadastros', pre);

    await DB.add('logs', {
      at: new Date().toISOString(),
      action: 'update',
      entity: 'pre_cadastro',
      entityId: Number(id),
      note: `Status alterado para ${status}`
    });

    return true;
  }catch(e){
    console.error('Erro ao alterar status do pré-cadastro:', e);
    toast(e?.message || 'Erro ao alterar o status do pré-cadastro.', false);
    return false;
  }
}

async function rejectPreCadastro(id){
const ok = await uiConfirm(
  'Deseja realmente REJEITAR este pré-cadastro?\n\nEle ficará salvo no histórico com status "rejeitado".',
  'Rejeitar pré-cadastro',
  { okText: 'Rejeitar', cancelText: 'Cancelar' }
);
  if (!ok) return;

  const done = await preCadMarkStatus(id, 'rejeitado');
  if (!done) return;

  toast('Pré-cadastro rejeitado com sucesso.');
  const modal = document.getElementById('precad_modal');
  if (modal) modal.remove();
  await loadPreCadastros(true);
}

async function deletePreCadastro(id){
const ok = await uiConfirm(
  'Deseja realmente EXCLUIR este pré-cadastro?\n\nEssa ação apagará também os pets vinculados e não poderá ser desfeita.',
  'Excluir pré-cadastro',
  { okText: 'Excluir', cancelText: 'Cancelar' }
);
  if (!ok) return;

  try{
    const pets = await DB.list('pre_cadastro_pets');
    const petsDoPre = (pets || []).filter(p => Number(p.preCadastroId ?? p.pre_cadastro_id) === Number(id));

    for (const p of petsDoPre) {
      await DB.delete('pre_cadastro_pets', p.id);
    }

    await DB.delete('pre_cadastros', id);

    await DB.add('logs', {
      at: new Date().toISOString(),
      action: 'delete',
      entity: 'pre_cadastro',
      entityId: Number(id),
      note: `Pré-cadastro excluído manualmente`
    });

    toast('Pré-cadastro excluído com sucesso.');

    const modal = document.getElementById('precad_modal');
    if (modal) modal.remove();

    await loadPreCadastros(true);
  }catch(e){
    console.error('Erro ao excluir pré-cadastro:', e);
    toast(e?.message || 'Erro ao excluir o pré-cadastro.', false);
  }
}

async function approvePreCadastro(id){
const ok = await uiConfirm(
  'Deseja APROVAR este pré-cadastro agora?\n\nO sistema vai criar ou atualizar o tutor e os pets no cadastro principal.',
  'Aprovar pré-cadastro',
  { okText: 'Aprovar', cancelText: 'Cancelar' }
);
  if (!ok) return;

  let pre = null;
  let pets = [];

  try{
    pre = await DB.get('pre_cadastros', id);
    pets = await DB.list('pre_cadastro_pets');
  }catch(e){
    console.error('Erro ao carregar dados para aprovação:', e);
    toast('Erro ao carregar os dados para aprovação.', false);
    return;
  }

  if (!pre) {
    toast('Pré-cadastro não encontrado.', false);
    return;
  }

  const petsDoPre = (pets || [])
    .filter(p => Number(p.preCadastroId ?? p.pre_cadastro_id) === Number(id))
    .sort((a,b) => Number(a.id || 0) - Number(b.id || 0));

  if (!pre.nome || !pre.cpf) {
    toast('O pré-cadastro precisa ter pelo menos Nome e CPF para ser aprovado.', false);
    return;
  }

  try{
    const tutorData = {
      nome: (pre.nome || '').trim(),
      telefone: (pre.telefone || '').trim(),
      email: (pre.email || '').trim(),
      documento: (pre.cpf || '').trim(),
      cpf: (pre.cpf || '').trim(),
      cep: (pre.cep || '').trim(),
      cidade: (pre.cidade || '').trim(),
      endereco: (pre.endereco || '').trim(),
      contatoVet: (pre.contato_vet || pre.contatoVet || '').trim(),
      observacao: (pre.observacao || '').trim(),
    };

    let tutorId = null;
    const existingTutor = await findExistingTutor(tutorData);

    if (existingTutor){
      const updatedTutor = { ...existingTutor };

      const tutorFields = ['nome','telefone','email','documento','cpf','cep','cidade','endereco','contatoVet','observacao'];
      for (const f of tutorFields){
        const val = (tutorData[f] ?? '').toString().trim();
        if (val) updatedTutor[f] = tutorData[f];
      }

      await DB.put('clientes', updatedTutor);

      await DB.add('logs', {
        at: new Date().toISOString(),
        action: 'update',
        entity: 'cliente',
        entityId: Number(updatedTutor.id),
        note: `Atualizado via aprovação de pré-cadastro #${id}`
      });

      tutorId = Number(updatedTutor.id);
    } else {
      tutorId = await DB.add('clientes', tutorData);

      await DB.add('logs', {
        at: new Date().toISOString(),
        action: 'create',
        entity: 'cliente',
        entityId: Number(tutorId),
        note: `Criado via aprovação de pré-cadastro #${id}`
      });
    }

    for (const p of petsDoPre){
      const petData = {
        tutorId: Number(tutorId),
        nome: (p.nome || '').trim(),
        especie: (p.especie || '').trim(),
        raca: (p.raca || '').trim(),
        sexo: (p.sexo || '').trim(),
        nascimento: p.nascimento || '',
        castrado: !!p.castrado,

        doencasFlag: !!(p.doencas_flag ?? p.doencasFlag),
        doencasTexto: (p.doencas_texto ?? p.doencasTexto ?? '').trim(),

        alergiasFlag: !!(p.alergias_flag ?? p.alergiasFlag),
        alergiasTexto: (p.alergias_texto ?? p.alergiasTexto ?? '').trim(),

        cuidadosFlag: !!(p.cuidados_flag ?? p.cuidadosFlag),
        cuidadosTexto: (p.cuidados_texto ?? p.cuidadosTexto ?? '').trim(),

        vacinaViral: !!(p.vacina_viral ?? p.vacinaViral),
        vacinaViralTipo: (p.vacina_viral_tipo ?? p.vacinaViralTipo ?? '').trim(),
        vacinaViralMes: (p.vacina_viral_mes ?? p.vacinaViralMes ?? '') || null,
        vacinaViralAno: (p.vacina_viral_ano ?? p.vacinaViralAno ?? '') || null,

        vacinaAntirrabica: !!(p.vacina_antirrabica ?? p.vacinaAntirrabica),
        vacinaAntirrabicaMes: (p.vacina_antirrabica_mes ?? p.vacinaAntirrabicaMes ?? '') || null,
        vacinaAntirrabicaAno: (p.vacina_antirrabica_ano ?? p.vacinaAntirrabicaAno ?? '') || null,

        antipulga: !!p.antipulga,
        antipulgaTipo: (p.antipulga_tipo ?? p.antipulgaTipo ?? '').trim(),
        antipulgaMes: (p.antipulga_mes ?? p.antipulgaMes ?? '') || null,
        antipulgaAno: (p.antipulga_ano ?? p.antipulgaAno ?? '') || null,
      };

      if (!petData.nome) continue;

      const existingPet = await findExistingPetForTutor(tutorId, petData);

      if (existingPet){
        const updatedPet = { ...existingPet };

        const petFields = [
          'nome','especie','raca','sexo','nascimento',
          'castrado',
          'doencasFlag','doencasTexto',
          'alergiasFlag','alergiasTexto',
          'cuidadosFlag','cuidadosTexto',
          'vacinaViral','vacinaViralTipo','vacinaViralMes','vacinaViralAno',
          'vacinaAntirrabica','vacinaAntirrabicaMes','vacinaAntirrabicaAno',
          'antipulga','antipulgaTipo','antipulgaMes','antipulgaAno'
        ];

        for (const f of petFields){
          const val = petData[f];

          if (typeof val === 'boolean') {
            updatedPet[f] = val;
          } else if (val !== null && val !== undefined && String(val).trim() !== '') {
            updatedPet[f] = val;
          }
        }

        await DB.put('pets', updatedPet);

        await DB.add('logs', {
          at: new Date().toISOString(),
          action: 'update',
          entity: 'pet',
          entityId: Number(updatedPet.id),
          note: `Atualizado via aprovação de pré-cadastro #${id}: ${updatedPet.nome || ''}`
        });
      } else {
        const newPetId = await DB.add('pets', petData);

        await DB.add('logs', {
          at: new Date().toISOString(),
          action: 'create',
          entity: 'pet',
          entityId: Number(newPetId),
          note: `Criado via aprovação de pré-cadastro #${id}: ${petData.nome || ''}`
        });
      }
    }

    const updatedPre = { ...pre };
    updatedPre.status = 'aprovado';
    updatedPre.reviewed_at = new Date().toISOString();

    const reviewAtual = (updatedPre.review_notes || '').trim();
    const complemento = `Aprovado e integrado ao cadastro principal em ${new Date().toLocaleString('pt-BR')}`;
    updatedPre.review_notes = reviewAtual ? `${reviewAtual}\n${complemento}` : complemento;

    await DB.put('pre_cadastros', updatedPre);

    await DB.add('logs', {
      at: new Date().toISOString(),
      action: 'approve',
      entity: 'pre_cadastro',
      entityId: Number(id),
      note: `Pré-cadastro aprovado`
    });

    toast('Pré-cadastro aprovado com sucesso.');

    const modal = document.getElementById('precad_modal');
    if (modal) modal.remove();

    await loadPreCadastros(true);
  }catch(e){
    console.error('Erro ao aprovar pré-cadastro:', e);
    toast(e?.message || 'Erro ao aprovar o pré-cadastro.', false);
  }
}

async function openPreCadastroDetails(id){
  if (!id) return;

  let pre = null;
  let pets = [];

  try{
    pre = await DB.get('pre_cadastros', id);
    pets = await DB.list('pre_cadastro_pets');
  }catch(e){
    console.error('Erro ao abrir detalhes do pré-cadastro:', e);
    toast('Erro ao abrir os detalhes do pré-cadastro.', false);
    return;
  }

  if (!pre) {
    toast('Pré-cadastro não encontrado.', false);
    return;
  }

  const petsDoPre = (pets || [])
    .filter(p => Number(p.preCadastroId ?? p.pre_cadastro_id) === Number(id))
    .sort((a,b) => Number(a.id || 0) - Number(b.id || 0));

  const old = document.getElementById('precad_modal');
  if (old) old.remove();

  const overlay = document.createElement('div');
  overlay.id = 'precad_modal';
  overlay.style.cssText = `
    position:fixed; inset:0; z-index:99999;
    display:flex; align-items:center; justify-content:center;
    padding:16px;
    background:rgba(0,0,0,.55);
  `;

  const box = document.createElement('div');
  box.style.cssText = `
    width:min(1100px, 100%);
    max-height:min(88vh, 900px);
    overflow:auto;
    background: var(--bg);
    color: var(--text);
    border: 1px solid #d4bbff;
    border-radius: 14px;
    box-shadow: 0 18px 40px rgba(0,0,0,.25);
    padding: 14px;
  `;

  box.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px; flex-wrap:wrap;">
      <div>
        <div style="font-weight:900; font-size:18px;">Pré-cadastro #${uiEscapeHtml(String(pre.id || id))}</div>
        <div class="muted-sm" style="margin-top:4px;">
          Recebido em ${uiEscapeHtml(preCadFmtDate(pre.createdAt || pre.created_at) || '—')}
        </div>
      </div>

      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        ${preCadStatusTag(pre.status)}
        <button id="pre_close_x" class="btn btn-ghost" style="padding:6px 10px;">✕</button>
      </div>
    </div>

<div class="panel" style="margin-bottom:12px;">
  <div style="font-weight:900; font-size:15px; margin-bottom:10px;">Dados do tutor</div>

  <div class="row">
    <div class="col-2">
      ${preCadInputEdit('Nome', 'pre_nome', pre.nome || '')}
    </div>
    <div class="col">
      ${preCadInputEdit('CPF', 'pre_cpf', pre.cpf || '')}
    </div>
  </div>

  <div class="row">
    <div class="col">
      ${preCadInputEdit('Telefone', 'pre_tel', pre.telefone || '')}
    </div>
    <div class="col">
      ${preCadInputEdit('E-mail', 'pre_email', pre.email || '', 'email')}
    </div>
  </div>

  <div class="row">
    <div class="col">
      ${preCadInputEdit('CEP', 'pre_cep', pre.cep || '')}
    </div>
    <div class="col">
      ${preCadInputEdit('Cidade', 'pre_cidade', pre.cidade || '')}
    </div>
  </div>

  <div class="row">
    <div class="col-2">
      ${preCadInputEdit('Endereço', 'pre_endereco', pre.endereco || '')}
    </div>
    <div class="col">
      ${preCadInputEdit('Contato veterinário', 'pre_contato_vet', pre.contatoVet ?? pre.contato_vet ?? '')}
    </div>
  </div>

  <div class="row">
    <div class="col">
      ${preCadInputEdit('Status', 'pre_status_view', pre.status || '', 'text', 'readonly')}
    </div>
    <div class="col">
      ${preCadInputEdit('Revisado em', 'pre_reviewed_view', preCadFmtDate(pre.reviewedAt || pre.reviewed_at) || '', 'text', 'readonly')}
    </div>
  </div>

  <div class="row">
    <div class="col">
      ${preCadTextareaEdit('Observação do tutor', 'pre_observacao', pre.observacao || '', 3)}
    </div>
    <div class="col">
      ${preCadTextareaEdit('Notas internas', 'pre_review_notes', pre.reviewNotes ?? pre.review_notes ?? '', 3)}
    </div>
  </div>
</div>

    <div class="panel">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:10px;">
        <div style="font-weight:900; font-size:15px;">
          Pets vinculados (${petsDoPre.length})
        </div>
      </div>

      ${
        petsDoPre.length
          ? petsDoPre.map((p, idx) => preCadPetEditorHtml(p, idx)).join('')
          : `<div class="muted-sm">Nenhum pet vinculado a este pré-cadastro.</div>`
      }
    </div>

    <div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap; margin-top:12px;">
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button id="pre_approve" class="btn btn-primary">Aprovar</button>
        <button id="pre_reject" class="btn btn-outline">Rejeitar</button>
        <button id="pre_delete" class="btn btn-danger">Excluir</button>
      </div>

      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button id="pre_save" class="btn btn-primary">Salvar alterações</button>
        <button id="pre_close" class="btn btn-outline">Fechar</button>
      </div>
    </div>
  `;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const close = () => {
    try { overlay.remove(); } catch(e){}
  };

  const btnClose = box.querySelector('#pre_close');
  const btnCloseX = box.querySelector('#pre_close_x');
  const btnSave = box.querySelector('#pre_save');
  const btnApprove = box.querySelector('#pre_approve');
  const btnReject = box.querySelector('#pre_reject');
  const btnDelete = box.querySelector('#pre_delete');
  const cpfInput = box.querySelector('#pre_cpf');
  const telInput = box.querySelector('#pre_tel');

  if (cpfInput) {
    cpfInput.addEventListener('input', (e) => {
      e.target.value = formatCPF(e.target.value);
    });
  }

  if (telInput) {
    telInput.addEventListener('input', (e) => {
      e.target.value = formatPhoneBR(e.target.value);
    });
  }
  
    for (const p of petsDoPre) {
    const pid = Number(p.id || 0);
    const prefix = `prepet_${pid}_`;

    const alergiasSel = box.querySelector('#' + prefix + 'alergias_flag');
    const doencasSel = box.querySelector('#' + prefix + 'doencas_flag');
    const cuidadosSel = box.querySelector('#' + prefix + 'cuidados_flag');
    const alimentacaoTipoEl = box.querySelector('#' + prefix + 'alimentacao_tipo');

    preCadSyncPetConditionalFields(pid);

    if (alergiasSel) {
      alergiasSel.addEventListener('change', () => preCadSyncPetConditionalFields(pid));
    }

    if (doencasSel) {
      doencasSel.addEventListener('change', () => preCadSyncPetConditionalFields(pid));
    }

    if (cuidadosSel) {
      cuidadosSel.addEventListener('change', () => preCadSyncPetConditionalFields(pid));
    }

    if (alimentacaoTipoEl) {
      alimentacaoTipoEl.addEventListener('input', () => preCadSyncPetConditionalFields(pid));
      alimentacaoTipoEl.addEventListener('change', () => preCadSyncPetConditionalFields(pid));
    }
  }

  if (btnClose) btnClose.onclick = close;
  if (btnCloseX) btnCloseX.onclick = close;

  if (btnApprove) {
    btnApprove.onclick = async () => {
      btnApprove.disabled = true;
      const oldTxt = btnApprove.textContent;
      btnApprove.textContent = 'Aprovando...';
      try{
        await approvePreCadastro(id);
      } finally {
        if (btnApprove && btnApprove.isConnected) {
          btnApprove.disabled = false;
          btnApprove.textContent = oldTxt;
        }
      }
    };
  }

  if (btnReject) {
    btnReject.onclick = async () => {
      btnReject.disabled = true;
      const oldTxt = btnReject.textContent;
      btnReject.textContent = 'Rejeitando...';
      try{
        await rejectPreCadastro(id);
      } finally {
        if (btnReject && btnReject.isConnected) {
          btnReject.disabled = false;
          btnReject.textContent = oldTxt;
        }
      }
    };
  }

  if (btnDelete) {
    btnDelete.onclick = async () => {
      btnDelete.disabled = true;
      const oldTxt = btnDelete.textContent;
      btnDelete.textContent = 'Excluindo...';
      try{
        await deletePreCadastro(id);
      } finally {
        if (btnDelete && btnDelete.isConnected) {
          btnDelete.disabled = false;
          btnDelete.textContent = oldTxt;
        }
      }
    };
  }

  if (btnSave) {
    btnSave.onclick = async () => {
      btnSave.disabled = true;
      const oldTxt = btnSave.textContent;
      btnSave.textContent = 'Salvando...';
      try{
        await savePreCadastroDetails(id);
      } finally {
        if (btnSave && btnSave.isConnected) {
          btnSave.disabled = false;
          btnSave.textContent = oldTxt;
        }
      }
    };
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  window.addEventListener('keydown', function esc(e){
    if (e.key === 'Escape') {
      window.removeEventListener('keydown', esc);
      close();
    }
  });
}

// ==== LOGS ====
let __logsOffset = 0;
let __logsQuery = '';
const __LOGS_PAGE = 200;

async function renderLogs(){
  const view = document.getElementById('view');
  view.innerHTML = `
  <div class="panel">
    <div class="flex">
      <h2>Logs do Sistema</h2>
      <div class="right" style="display:flex; gap:8px; align-items:center;">
        <input id="log_q" placeholder="Buscar (ação, entidade, nota)..." style="min-width:240px" />
        <button class="btn btn-outline" id="log_search">Buscar</button>
        <button class="btn btn-ghost" id="log_clear">Limpar</button>
      </div>
    </div>

    <div class="list-scroll">
      <table>
        <thead><tr>
          <th>Quando</th><th>Ação</th><th>Entidade</th><th>ID</th><th>Nota</th>
        </tr></thead>
        <tbody id="log_tbody"></tbody>
      </table>
    </div>

    <div style="display:flex; justify-content:flex-end; margin-top:10px;">
      <button class="btn btn-outline" id="log_more">Carregar mais</button>
    </div>
  </div>`;

  // binds
  const inp = document.getElementById('log_q');
  const btnSearch = document.getElementById('log_search');
  const btnClear = document.getElementById('log_clear');
  const btnMore = document.getElementById('log_more');

  if (btnSearch) btnSearch.onclick = () => {
    __logsQuery = (inp?.value || '').trim();
    loadLogs(true);
  };

  if (btnClear) btnClear.onclick = () => {
    __logsQuery = '';
    if (inp) inp.value = '';
    loadLogs(true);
  };

  if (inp) inp.onkeydown = (e) => {
    if (e.key === 'Enter') {
      __logsQuery = (inp.value || '').trim();
      loadLogs(true);
    }
  };

  if (btnMore) btnMore.onclick = () => loadLogs(false);

  // primeira carga
  loadLogs(true);
}

async function loadLogs(reset){
  const tbody = document.getElementById('log_tbody');
  const btnMore = document.getElementById('log_more');
  if (!tbody) return;

  if (reset) {
    tbody.innerHTML = '';
    __logsOffset = 0;
  }

  // Pagina do banco (ordenando pelo "at" desc)
  const page = await DB.page('logs', {
    limit: __LOGS_PAGE,
    offset: __logsOffset,
    orderBy: 'at',
    ascending: false,
    query: __logsQuery
  });

  __logsOffset += page.length;

  for (const l of page) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="mono">${l.at}</td><td>${l.action}</td><td>${l.entity}</td><td>${l.entityId||''}</td><td>${l.note||''}</td>`;
    tbody.appendChild(tr);
  }

  // Se veio menos que o limite, não tem mais para carregar
  if (btnMore) {
    btnMore.disabled = (page.length < __LOGS_PAGE);
    btnMore.textContent = btnMore.disabled ? 'Sem mais logs' : 'Carregar mais';
  }
}

function parseMoneyBR(v){
  if (v == null) return 0;
  let s = String(v).trim();
  if (!s) return 0;
  // remove "R$" e espaços
  s = s.replace(/r\$\s*/i, '');
  // troca . milhar e , decimal
  s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function toISODateAny(s){
  s = (s || '').trim();
  if (!s) return '';
  // dd/mm/aaaa ou dd-mm-aaaa
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m){
    let dd = m[1].padStart(2,'0');
    let mm = m[2].padStart(2,'0');
    let yy = m[3];
    if (yy.length === 2) yy = (parseInt(yy,10) >= 50 ? '19' : '20') + yy;
    return `${yy}-${mm}-${dd}`;
  }
  // yyyy-mm-dd
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  return '';
}

function openHospedagemEditorModal(initial){
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,.55);
      display:flex; align-items:center; justify-content:center;
      z-index:9999; padding:16px;
    `;

    const box = document.createElement('div');
	box.id = 'he_modal';
box.style.cssText = `
  width:min(720px, 96vw);
  background: var(--bg);
  color: var(--text);
  border: 1px solid #d4bbff;
  border-radius: 14px;
  box-shadow: 0 18px 60px rgba(0,0,0,.35);
  padding: 16px;
`;


    const safe = (x)=>String(x??'');
    const dIn  = safe(initial?.dataEntrada||'');
    const hIn  = safe(initial?.horaEntrada||'');
    const dOut = safe(initial?.dataSaida||'');
    const hOut = safe(initial?.horaSaida||'');
const val  = safe(
  (initial?.valorRaw ?? initial?.valor ?? '')
);
const obs  = safe(
  (initial?.obs ?? initial?.observacao ?? '')
);

    box.innerHTML = `
	<style>
  #he_modal label.muted-sm{
    color: var(--text) !important;
    opacity: 1 !important;
    font-weight: 700;
  }
  #he_modal .muted-sm{
    opacity: 1 !important;
  }
</style>

      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
        <div style="font-weight:800; font-size:16px;">Confirmar / editar Hospedagem</div>
        <button id="he_cancel" class="btn btn-danger" style="padding:6px 10px;">Cancelar</button>
      </div>

      <div style="margin-top:12px; display:grid; grid-template-columns:1fr 1fr; gap:10px;">
        <label class="muted-sm">Data de entrada
          <input id="he_din" class="input" placeholder="dd/mm/aaaa ou yyyy-mm-dd" value="${dIn}">
        </label>
        <label class="muted-sm">Hora de entrada
          <input id="he_hin" class="input" placeholder="ex: 09:00" value="${hIn}">
        </label>
        <label class="muted-sm">Data de saída
          <input id="he_dout" class="input" placeholder="dd/mm/aaaa ou yyyy-mm-dd" value="${dOut}">
        </label>
        <label class="muted-sm">Hora de saída
          <input id="he_hout" class="input" placeholder="ex: 18:00" value="${hOut}">
        </label>
        <label class="muted-sm" style="grid-column:1 / -1;">Valor (R$)
          <input id="he_val" class="input" placeholder="ex: 350 ou 350,00" value="${val}">
        </label>
        <label class="muted-sm" style="grid-column:1 / -1;">Observações
          <textarea id="he_obs" class="input" style="min-height:90px; resize:vertical;" placeholder="Observações adicionais...">${obs}</textarea>
        </label>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:12px;">
        <button id="he_ok" class="btn btn-success">Confirmar e salvar</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const close = (v)=>{ overlay.remove(); resolve(v); };

    overlay.querySelector('#he_cancel').onclick = ()=>close(null);
    overlay.onclick = (e)=>{ if (e.target === overlay) close(null); };

    overlay.querySelector('#he_ok').onclick = ()=>{
      const dataEntrada = overlay.querySelector('#he_din').value.trim();
      const horaEntrada = overlay.querySelector('#he_hin').value.trim();
      const dataSaida   = overlay.querySelector('#he_dout').value.trim();
      const horaSaida   = overlay.querySelector('#he_hout').value.trim();
      const valorRaw    = overlay.querySelector('#he_val').value.trim();
      const obs         = overlay.querySelector('#he_obs').value.trim();

      // valida datas minimamente
      const dinISO  = toISODateAny(dataEntrada);
      const doutISO = toISODateAny(dataSaida);
      if (!dinISO || !doutISO){
        toast('Datas inválidas. Use dd/mm/aaaa ou yyyy-mm-dd', false);
        return;
      }

close({
  // devolve no formato que o salvamento espera
  dataEntrada: dinISO,
  horaEntrada: horaEntrada ? horaEntrada.slice(0,5) : '',
  dataSaida: doutISO,
  horaSaida: horaSaida ? horaSaida.slice(0,5) : '',
  valor: parseMoneyBR(valorRaw),
  obs
});
    };
  });
}


// ==== BACKUP & SOBRE ====
function renderBackup(){
  const view = document.getElementById('view');
  view.innerHTML = `
  <div class="grid">
    <div class="panel">
      <h2>Exportar Backup</h2>
      <p class="muted">Gera um arquivo JSON com todos os dados.</p>
      <button class="btn btn-primary" id="btn_export">Exportar</button>
    </div>
    <div class="panel">
      <h2>Importar Backup</h2>
      <p class="muted">Substitui <strong>todos</strong> os dados.</p>
      <input type="file" id="file_import" accept="application/json" />
      <div class="space"></div>
      <button class="btn btn-warn" id="btn_import">Importar</button>
    </div>
    <div class="panel">
      <h2>Importar dados de contrato</h2>
      <p class="muted">
        Cole abaixo o bloco <code>ISA_PET_DADOS</code> que aparece no final do contrato
        (linhas iniciando com <strong>TUTOR|</strong> e <strong>PET|</strong>).
      </p>
      <textarea id="contrato_raw" rows="10"
        placeholder="Cole aqui o texto contendo TUTOR| e PET| ..."></textarea>
      <div class="space"></div>
      <button class="btn" id="btn_import_contrato">Importar tutor e pets</button>
      <p class="muted-sm">
        Dica: abra o PDF ou o Google Docs, selecione apenas o bloco ISA_PET_DADOS, copie e cole aqui.
      </p>
    </div>
  </div>`;

  // Exportar backup (igual antes)
  document.getElementById('btn_export').onclick = async () => {
    const data = await DB.export();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `isapet-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Backup exportado');
  };

  // Importar backup (igual antes)
  document.getElementById('btn_import').onclick = async () => {
    const f = document.getElementById('file_import').files[0];
    if (!f) return toast('Selecione um arquivo', false);
    try {
      const json = JSON.parse(await f.text());
      await DB.import(json);
      await DB.add('logs', {
        at: new Date().toISOString(),
        action: 'import',
        entity: 'backup',
        note: 'Importação concluída',
      });
      toast('Importado com sucesso');
      renderView('checkin');
    } catch(e){
      console.error(e);
      toast('Arquivo inválido', false);
    }
  };


// Alert bonito (1 botão)
function uiAlert(message, title = 'Aviso'){
  return uiConfirm(message, title, { okText: 'OK', showCancel: false });
}

// Confirm bonito (OK/Cancelar)
// Retorna Promise<boolean> (true = OK, false = Cancelar)
function uiConfirm(message, title = 'Confirmação', opts = {}){
  const {
    okText = 'OK',
    cancelText = 'Cancelar',
    showCancel = true,
  } = opts;

  return new Promise((resolve) => {
    // remove modal anterior se existir
    const old = document.getElementById('sys_modal');
    if (old) old.remove();

    const previouslyFocused = document.activeElement;

    const overlay = document.createElement('div');
    overlay.id = 'sys_modal';
    overlay.style.cssText = `
      position:fixed; inset:0; z-index:99999;
      display:flex; align-items:center; justify-content:center;
      padding:16px;
      background:rgba(0,0,0,.55);
    `;

    const box = document.createElement('div');
    box.style.cssText = `
      width:min(560px, 100%);
      max-height: min(78vh, 720px);
      overflow:auto;
      background: var(--bg);
      color: var(--text);
      border: 1px solid #d4bbff;
      border-radius: 14px;
      box-shadow: 0 18px 40px rgba(0,0,0,.25);
      padding: 14px;
    `;

    box.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px;">
        <div style="font-weight:900; font-size:15px;">${uiEscapeHtml(title)}</div>
        <button id="sys_close" class="btn btn-ghost" style="padding:6px 10px;">✕</button>
      </div>

      <div style="
        white-space:pre-wrap;
        line-height:1.35;
        font-size:14px;
        padding:10px 10px;
        border-radius:12px;
        background: rgba(124,58,237,.08);
        border: 1px solid #d4bbff;
      ">${uiEscapeHtml(message)}</div>

      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:12px; position:sticky; bottom:0; padding-top:10px; background: var(--bg);">
        ${showCancel ? `<button id="sys_cancel" class="btn btn-danger" style="padding:10px 14px; border-radius:10px;">${uiEscapeHtml(cancelText)}</button>` : ''}
        <button id="sys_ok" class="btn btn-primary" style="padding:10px 16px; border-radius:10px; font-weight:800;">
          ${uiEscapeHtml(okText)}
        </button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    let done = false;

    const escHandler = (ev) => {
      if (ev.key === 'Escape') cancel();
    };

    const cleanup = () => {
      // evita “fechar duas vezes”
      if (done) return;
      done = true;

      window.removeEventListener('keydown', escHandler);
      try { overlay.remove(); } catch(e) {}

      // devolve foco para o elemento anterior (ajuda no tablet/navegação)
      try {
        if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
      } catch(e) {}
    };

    const ok = () => { cleanup(); resolve(true); };
    const cancel = () => { cleanup(); resolve(false); };

    // botões
    box.querySelector('#sys_ok').onclick = ok;

    const btnCancel = box.querySelector('#sys_cancel');
    if (btnCancel) btnCancel.onclick = cancel;

    box.querySelector('#sys_close').onclick = cancel;

    // clicar fora fecha como "cancelar"
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cancel();
    });

    // tecla ESC fecha como "cancelar"
    window.addEventListener('keydown', escHandler);

    // foco inicial no OK (melhor UX)
    try { box.querySelector('#sys_ok')?.focus(); } catch(e) {}
  });
}

function formatDateBR(d){
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const aa = d.getFullYear();
  return `${dd}/${mm}/${aa}`;
}

function formatExpiryBR(expiresAt){
  if (!expiresAt) return '(sem data)';

  const exp = new Date(expiresAt);
  const expMid = new Date(exp.getFullYear(), exp.getMonth(), exp.getDate()).getTime();
  const now = new Date();
  const nowMid = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  const diffDays = Math.round((expMid - nowMid) / 86400000); // 24*60*60*1000
  const dt = formatDateBR(exp);

  if (diffDays > 1) return `em ${diffDays} dias (${dt})`;
  if (diffDays === 1) return `amanhã (${dt})`;
  if (diffDays === 0) return `hoje (${dt})`;
  if (diffDays === -1) return `expirou ontem (${dt})`;
  return `expirado há ${Math.abs(diffDays)} dias (${dt})`;
}


  // Importar dados do contrato (novo)
  const btnContrato = document.getElementById('btn_import_contrato');
  if (btnContrato){
    btnContrato.onclick = async () => {
      const txtEl = document.getElementById('contrato_raw');
      const txt = (txtEl.value || '').trim();
      if (!txt){
        return toast('Cole o texto do contrato no campo acima', false);
      }

try {
  const parsed = parseIsaPetDados(txt);

  if (!parsed || !parsed.tutor){
    return toast('Não encontrei dados válidos. Verifique se o bloco ISA_PET_DADOS está completo.', false);
  }

        // 1) Prepara tutor e tenta completar cidade pelo CEP
        const tutorData = { ...parsed.tutor };

        if (tutorData && tutorData.cep) {
          let cep = (tutorData.cep || '').replace(/\D/g, '');
          if (cep.length === 8) {
            try {
              const resp = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
              if (resp.ok) {
                const data = await resp.json();
                if (!data.erro) {
                  const cidade = data.localidade || '';
                  const uf = data.uf || '';
                  const cidadeTexto = [cidade, uf].filter(Boolean).join(' - ');
                  if (cidadeTexto) {
                    tutorData.cidade = cidadeTexto;
                  }
                }
              }
            } catch(e){
              console.error('Erro ao completar cidade via CEP na importação:', e);
            toast('Erro ao importar dados do contrato', false);
			}
          }
        }

        // 2) Verifica se o tutor já existe (CPF primeiro)
        const existingTutor = await findExistingTutor(tutorData);

        // Campos do tutor que vamos permitir atualizar (quando vierem preenchidos)
        const tutorFields = ['nome','cpf','documento','telefone','email','cep','cidade','endereco','contatoVet','observacao'];

        let tutorId = null;

        if (existingTutor){
          const diffsTutor = diffFields(existingTutor, tutorData, tutorFields);

          // Mostra resumo + confirma
          let msg = '';
          msg += `⚠️ Já existe um tutor com esse CPF/dados.\n\n`;
          msg += `Tutor atual (ID ${existingTutor.id}): ${existingTutor.nome || ''}\n`;
          msg += `CPF atual: ${(existingTutor.cpf || existingTutor.documento || '')}\n\n`;
          msg += formatDiffBlock('Diferenças encontradas (Tutor):', diffsTutor);
          msg += `Deseja ATUALIZAR o cadastro existente com os dados novos?\n\n`;
          msg += `OK = Atualiza\nCancelar = Mantém como está`;

          let wantUpdateTutor = false;

if (!diffsTutor.length) {
  const nomeTutorOk = (existingTutor.nome || tutorData.nome || '').trim() || `ID ${existingTutor.id}`;
  await uiAlert(`✅ Tutor: ${nomeTutorOk} já existe e os dados estão 100% atualizados.\nNenhuma alteração foi feita.`, 'Importação');
} else {
  wantUpdateTutor = await uiConfirm(msg, 'Atualizar tutor?', { okText: 'Atualizar', cancelText: 'Manter como está' });
}


          if (wantUpdateTutor && diffsTutor.length){
            const updated = { ...existingTutor };

            // atualiza somente campos que vieram preenchidos (não apaga nada antigo)
            for (const f of tutorFields){
              const val = (tutorData?.[f] ?? '').toString().trim();
              if (val) updated[f] = tutorData[f];
            }

            await DB.put('clientes', updated);
            await DB.add('logs', {
              at: new Date().toISOString(),
              action: 'update',
              entity: 'cliente',
              entityId: existingTutor.id,
              note: `Atualizado via importação: ${updated.nome || ''}`,
            });
          }

          tutorId = existingTutor.id;

} else {
  // ✅ CONFIRMAÇÃO ANTES DA PRIMEIRA IMPORTAÇÃO (novo tutor)
  const petsPreview = (parsed.pets || []).filter(p => (p.nome || '').trim());
  let msgNovo = '';
  msgNovo += `🆕 Novo cadastro será CRIADO no sistema.\n\n`;

  // Tutor
  msgNovo += `TUTOR:\n`;
  msgNovo += `• Nome: ${tutorData.nome || ''}\n`;
  msgNovo += `• CPF: ${tutorData.cpf || tutorData.documento || ''}\n`;
  msgNovo += `• Telefone: ${tutorData.telefone || ''}\n`;
  msgNovo += `• E-mail: ${tutorData.email || ''}\n`;
  msgNovo += `• CEP: ${tutorData.cep || ''}\n`;
  msgNovo += `• Cidade: ${tutorData.cidade || ''}\n`;
  msgNovo += `• Endereço: ${tutorData.endereco || ''}\n`;
  msgNovo += `• Vet: ${tutorData.contatoVet || ''}\n`;
  msgNovo += `\n`;

  // Pets
  msgNovo += `PETS (${petsPreview.length}):\n`;
  if (!petsPreview.length){
    msgNovo += `• (Nenhum pet válido encontrado)\n`;
  } else {
    petsPreview.forEach((p, idx) => {
      msgNovo += `\n${idx+1}) ${p.nome || ''}\n`;
      msgNovo += `   • Espécie: ${p.especie || ''}\n`;
      msgNovo += `   • Raça: ${p.raca || ''}\n`;
      msgNovo += `   • Sexo: ${p.sexo || ''}\n`;
      msgNovo += `   • Nasc.: ${p.nascimento || ''}\n`;
      msgNovo += `   • Castrado: ${p.castrado ? 'Sim' : 'Não'}\n`;
      msgNovo += `   • Alergias: ${p.alergiasFlag ? 'Sim' : 'Não'} ${p.alergiasTexto ? `(${p.alergiasTexto})` : ''}\n`;
      msgNovo += `   • Doenças: ${p.doencasFlag ? 'Sim' : 'Não'} ${p.doencasTexto ? `(${p.doencasTexto})` : ''}\n`;
      msgNovo += `   • Cuidados: ${p.cuidadosFlag ? 'Sim' : 'Não'} ${p.cuidadosTexto ? `(${p.cuidadosTexto})` : ''}\n`;
    });
  }

  msgNovo += `\n\nOK = Criar cadastro\nCancelar = Não importar nada`;

  const okCriar = await uiConfirm(msgNovo, 'Criar novo tutor?', { okText: 'Criar', cancelText: 'Cancelar' });
  if (!okCriar) {
    toast('Importação cancelada');
    return;
  }

  // Não existe: cria novo
  tutorId = await DB.add('clientes', tutorData);
  await DB.add('logs', {
    at: new Date().toISOString(),
    action: 'create',
    entity: 'cliente',
    entityId: tutorId,
    note: `Importado de contrato: ${tutorData.nome || ''}`,
  });
}

        // 3) Pets: evita duplicar e pergunta se quer atualizar quando existir
        let countPetsAdded = 0;
        let countPetsUpdated = 0;
        let countPetsSkipped = 0;

const petsAlreadyOkNames = [];

                const petFields = [
          'nome','especie','raca','sexo','nascimento',
          'castrado',
          'doencasFlag','doencasTexto',
          'alergiasFlag','alergiasTexto',
          'cuidadosFlag','cuidadosTexto',
          'vacinaViral','vacinaViralTipo','vacinaViralMes','vacinaViralAno',
          'vacinaAntirrabica','vacinaAntirrabicaMes','vacinaAntirrabicaAno',
          'antipulga','antipulgaTipo','antipulgaMes','antipulgaAno'
        ];
        const importedPetIds = [];

        for (const p of (parsed.pets || [])){

          p.tutorId = tutorId;

          const existingPet = await findExistingPetForTutor(tutorId, p);

          if (!existingPet){
            const petId = await DB.add('pets', p);
			importedPetIds.push(petId);
            await DB.add('logs', {
              at: new Date().toISOString(),
              action: 'create',
              entity: 'pet',
              entityId: petId,
              note: `Importado de contrato: ${p.nome || ''}`,
            });
            countPetsAdded++;
            continue;
          }

          // Pet já existe: checa diferenças
          const diffsPet = diffFields(existingPet, p, petFields);

if (!diffsPet.length){
  importedPetIds.push(existingPet.id);
  countPetsSkipped++;

  const nomePetOk = (existingPet.nome || p.nome || '').trim();
  if (nomePetOk) petsAlreadyOkNames.push(nomePetOk);

  continue;
}

          let msgPet = '';
          msgPet += `⚠️ Pet já cadastrado para este tutor.\n\n`;
          msgPet += `Pet atual (ID ${existingPet.id}): ${existingPet.nome || ''}\n\n`;
          msgPet += formatDiffBlock('Diferenças encontradas (Pet):', diffsPet);
          msgPet += `Deseja ATUALIZAR este pet com os dados novos?\n\n`;
          msgPet += `OK = Atualiza\nCancelar = Mantém como está`;

          const wantUpdatePet = await uiConfirm(msgPet, 'Atualizar pet?', { okText: 'Atualizar', cancelText: 'Manter como está' });

          if (wantUpdatePet){
            const updatedPet = { ...existingPet };

            for (const f of petFields){
              const val = (p?.[f] ?? '');
              // aqui a gente atualiza se vier definido (inclusive boolean)
              if (val !== '' && val !== null && val !== undefined){
                updatedPet[f] = p[f];
              }
            }

            await DB.put('pets', updatedPet);
            await DB.add('logs', {
              at: new Date().toISOString(),
              action: 'update',
              entity: 'pet',
              entityId: existingPet.id,
              note: `Atualizado via importação: ${updatedPet.nome || ''}`,
            });

            countPetsUpdated++;
          } else {
            countPetsSkipped++;
          }
		  importedPetIds.push(existingPet.id);
        }

// ✅ Se existirem pets que já estavam 100% OK, mostra um aviso bonitinho
if (petsAlreadyOkNames.length){
  const lista = petsAlreadyOkNames.slice(0, 4).join(', ');
  const extra = petsAlreadyOkNames.length > 4 ? ` (+${petsAlreadyOkNames.length - 4})` : '';
  await uiAlert(
    `✅ Pet(s): ${lista}${extra}\nJá existe(m) e os dados estão 100% atualizados.\nNenhuma alteração foi feita.`,
    'Importação'
  );
}


// 4) Hospedagem (se veio no texto) - abre editor, evita duplicar e salva/atualiza
let hospId = null;

if (parsed.hospedagem && importedPetIds.length){
  const edited = await openHospedagemEditorModal(parsed.hospedagem);

  if (!edited){
    toast('Hospedagem não foi importada (cancelado na confirmação).');
  } else {

    const rec = {
      tutorId: Number(tutorId),
      petIds: importedPetIds.map(Number).filter(Boolean),
      dataEntrada: edited.dataEntrada,   // yyyy-mm-dd (modal já entrega assim)
      dataSaida:   edited.dataSaida,     // yyyy-mm-dd
      horaEntrada: edited.horaEntrada,   // HH:MM
      horaSaida:   edited.horaSaida,     // HH:MM
      valor: Number(edited.valor || 0),
      status: 'agendada',
      observacao: (edited.obs || '').trim(),
      nota: (edited.obs || '').trim(),
    };

    // ---------- anti-duplicação ----------
    const sameSet = (a, b) => {
      const A = (a || []).map(Number).filter(Boolean).sort((x,y)=>x-y);
      const B = (b || []).map(Number).filter(Boolean).sort((x,y)=>x-y);
      if (A.length !== B.length) return false;
      for (let i=0;i<A.length;i++) if (A[i] !== B[i]) return false;
      return true;
    };

    const allHosp = await DB.list('hospedagens');

    const existingHosp = allHosp.find(h =>
      Number(h.tutorId) === rec.tutorId &&
      (h.dataEntrada || '') === (rec.dataEntrada || '') &&
      (h.dataSaida || '') === (rec.dataSaida || '') &&
      sameSet(h.petIds, rec.petIds)
    ) || null;

    if (existingHosp){
      // se já existe, mostra e pergunta se quer atualizar
      const diffs = [];
      const cmp = (f, label) => {
        const before = (existingHosp?.[f] ?? '').toString().trim();
        const after  = (rec?.[f] ?? '').toString().trim();
        if (after && before !== after) diffs.push({ label, before, after, field: f });
      };

      cmp('horaEntrada', 'Hora entrada');
      cmp('horaSaida',   'Hora saída');
      if ((rec.valor ?? 0) !== (existingHosp.valor ?? 0)){
        diffs.push({ label:'Valor', before: existingHosp.valor ?? 0, after: rec.valor ?? 0, field:'valor' });
      }
      cmp('observacao',  'Observação');

if (!diffs.length){
  const nomeTutorHosp = (tutorData?.nome || '').trim() || `Tutor ID ${tutorId}`;
  const de = rec.dataEntrada || '-';
  const ate = rec.dataSaida || '-';
await uiAlert(`✅ Hospedagem: ${nomeTutorHosp} (${de} → ${ate})\nJá existe e está 100% igual.\nNão foi duplicada.`, 'Importação');
} else {
        let msg = '⚠️ Já existe uma hospedagem IGUAL (mesmo tutor/pets/datas).\n\n';
        msg += 'Diferenças encontradas:\n';
        diffs.forEach(d => msg += `- ${d.label}: "${d.before || '-'}" → "${d.after}"\n`);
        msg += '\nDeseja ATUALIZAR a hospedagem existente?\nOK = Atualiza | Cancelar = Mantém';

const wantUpdate = await uiConfirm(msg, 'Atualizar hospedagem?', { okText: 'Atualizar', cancelText: 'Manter como está' });

        if (wantUpdate){
          const updated = { ...existingHosp, ...rec, id: existingHosp.id };
          await DB.put('hospedagens', updated);

          await DB.add('logs', {
            at: new Date().toISOString(),
            action: 'update',
            entity: 'hospedagem',
            entityId: existingHosp.id,
            note: 'Atualizado via importação',
          });

          hospId = existingHosp.id;
          toast(`Hospedagem atualizada (ID ${existingHosp.id}).`);
        } else {
          toast('Hospedagem mantida sem alteração.');
        }
      }

    } else {
      // cria nova
      hospId = await DB.add('hospedagens', rec);

      await DB.add('logs', {
        at: new Date().toISOString(),
        action: 'create',
        entity: 'hospedagem',
        entityId: hospId,
        note: `Hospedagem importada (tutor ${tutorId})`,
      });

      toast(`Hospedagem criada com sucesso (ID ${hospId}).`);
    }
  }
}
		

if (countPetsAdded === 0 && countPetsUpdated === 0 && countPetsSkipped > 0) {
  toast(`Importação: nenhum dado mudou. Tutor ID ${tutorId}. Pets mantidos ${countPetsSkipped}.` + (hospId ? ` Hospedagem #${hospId}.` : ''));
} else {
  toast(`Importação concluída. Tutor ID ${tutorId}. Pets: adicionados ${countPetsAdded}, atualizados ${countPetsUpdated}, mantidos ${countPetsSkipped}.` + (hospId ? ` Hospedagem #${hospId}.` : ''));
}

        txtEl.value = '';

      } catch(e){
        console.error(e);
        toast('Erro ao importar dados do contrato', false);
      }
    };
  }
}



async function renderSobre(){
  const view = document.getElementById('view');
  view.innerHTML = `
  <div class="panel">
    <h2>Sobre (v3)</h2>
    <p>Versão com <strong>Hospedagem</strong> (múltiplos pets), <strong>Creche</strong> (calendário com dias e horários por dia) e <strong>Check-in/Out</strong> (agenda semanal e mensal). Dados 100% offline.</p>
    <p>Dica: a agenda agrupa múltiplos pets na mesma linha e mostra o <strong>nome do tutor</strong> uma única vez.</p>
    <button class="btn btn-primary" id="run_tests">Rodar testes rápidos</button>
    <pre id="tests" class="mono"></pre>
  </div>`;
  document.getElementById('run_tests').onclick = runTests;
}
async function runTests(){
  const out=[]; const assert=(c,m)=>out.push(`${c?'✅':'❌'} ${m}`);
  try{
    const cid = await DB.add('clientes', { nome:'Cliente Teste', documento:'000', cidade:'Cidade' });
    const p1 = await DB.add('pets', { tutorId:cid, nome:'Rex' });
    const p2 = await DB.add('pets', { tutorId:cid, nome:'Nina' });
    assert(!!cid&&!!p1&&!!p2, 'Cliente + 2 pets criados');
    const hid = await DB.add('hospedagens', { tutorId:cid, petIds:[p1,p2], dataEntrada:'2025-10-20', dataSaida:'2025-10-22', valor: 300 });
    assert(!!hid, 'Hospedagem salva');
    const crid = await DB.add('creches', { tutorId:cid, petIds:[p1,p2], mesRef:'2025-10', dias:[{data:'2025-10-21',entrada:'09:00',saida:'18:00'},{data:'2025-10-23',entrada:'09:00',saida:'18:00'}] });
    assert(!!crid, 'Creche salva');
    const hs = await DB.list('hospedagens'); const cs = await DB.list('creches');
    assert(hs.length>0 && cs.length>0, 'Dados disponíveis para agenda');
    await DB.delete('creches', crid);
    await DB.delete('hospedagens', hid);
    await DB.delete('pets', p1); await DB.delete('pets', p2);
    await DB.delete('clientes', cid);
    document.getElementById('tests').textContent = out.join('\n');
    toast('Testes OK');
  } catch(e){
    document.getElementById('tests').textContent = out.join('\n') + '\nErro: ' + e.message;
    toast('Falha nos testes', false);
  }
}

async function setCrecheStatus(id, status){
  const c = await DB.get('creches', id); if (!c) return toast('Agenda não encontrada', false);
  c.status = status;
  await DB.put('creches', c);
  await DB.add('logs', { at:new Date().toISOString(), action:'update', entity:'creche', entityId:c.id, note:`Status: ${status}` });
  toast('Status atualizado');
  loadCreches();
}
