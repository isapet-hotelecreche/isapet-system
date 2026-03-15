// db.js v3.2 (patched)
// Mantém a mesma API do seu DB antigo:
// DB.init(), DB.list(), DB.get(), DB.add(), DB.put(), DB.delete(), DB.export(), DB.import()

const SUPABASE_URL = "https://siksojcleumugquntrgc.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_6KMGqcdP2m5A8vx46Ew--g_GU8giA2V";

const STORES = ["clientes","pets","hospedagens","creches","pagamentos","logs","contratos"];

let supa = null;

// ====== PERFORMANCE: init só 1 vez ======
let __dbInitPromise = null;
let __dbInited = false;

// guarda o “formato” real das colunas de cada tabela (camelCase vs snake_case)
// Ex.: tutorId OU tutor_id, petIds OU pet_ids, contatoVet OU contato_vet etc.
const tableShape = {}; // { clientes: {keys:Set, style:"camel"|"snake"|"unknown"} ... }

// ====== PERFORMANCE: cache em memória (TTL) ======
const __cache = {}; // ex: { clientes: { at: 123, rows: [...] } }
const __CACHE_TTL_MS = 2000; // 2s (pode ajustar)
function cacheGet(table){
  const c = __cache[table];
  if (!c) return null;
  if ((Date.now() - c.at) > __CACHE_TTL_MS) return null;
  return c.rows;
}
function cacheSet(table, rows){
  __cache[table] = { at: Date.now(), rows };
}
function cacheClear(table){
  if (table) delete __cache[table];
  else {
    for (const k of Object.keys(__cache)) delete __cache[k];
  }
}

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

function ensureSupabaseLoaded(){
  if (!window.supabase || !window.supabase.createClient) {
    throw new Error("Supabase JS não carregou. Confira se você adicionou o script do CDN antes do db.js no index.html.");
  }
}

function ensureClient(){
  ensureSupabaseLoaded();
  if (!supa) {
    supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      }
    });
  }
  return supa;
}

async function getSession(){
  const c = ensureClient();
  const { data, error } = await c.auth.getSession();
  if (error) throw error;
  return data.session || null;
}

async function signIn(email, password){
  const c = ensureClient();
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signOut(){
  const c = ensureClient();
  const { error } = await c.auth.signOut();
  if (error) throw error;
}

function uiEscape(s){
  return (s ?? "").toString()
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function ensureLoginOverlay(){
  if (document.getElementById("login_overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "login_overlay";
  overlay.style.cssText = `
    position:fixed; inset:0; z-index:999999;
    display:none; align-items:center; justify-content:center;
    padding:16px; background:rgba(0,0,0,.55);
  `;

  overlay.innerHTML = `
    <div style="
      width:min(520px, 100%);
      background:#ffffff;
      border-radius:16px;
      box-shadow:0 16px 40px rgba(0,0,0,.25);
      overflow:hidden;
      border:1px solid #d4bbff;
    ">
      <div style="padding:12px 14px; background:#ede4ff; border-bottom:1px solid #ddcdfc;">
        <strong>🔒 Login — Isa Pet (Online)</strong>
        <div style="font-size:12px; margin-top:4px; opacity:.85">
          Para acessar o sistema online, entre com seu e-mail e senha.
        </div>
      </div>

      <div style="padding:14px;">
        <label style="display:block; font-size:12px; font-weight:700; margin-top:8px;">E-mail</label>
        <input id="login_email" type="email" placeholder="seuemail@..." style="
          width:100%; padding:10px; border-radius:10px; border:1px solid #d4bbff; margin-top:6px;
        " />

        <label style="display:block; font-size:12px; font-weight:700; margin-top:10px;">Senha</label>
        <input id="login_pass" type="password" placeholder="••••••••" style="
          width:100%; padding:10px; border-radius:10px; border:1px solid #d4bbff; margin-top:6px;
        " />

        <div id="login_msg" style="margin-top:10px; font-size:12px; color:#7f1d1d; display:none;"></div>

        <div style="display:flex; gap:10px; margin-top:12px; align-items:center;">
          <button id="login_btn" style="
            padding:10px 12px; border:none; border-radius:10px;
            background:#7c3aed; color:#fff; font-weight:800; cursor:pointer;
          ">Entrar</button>

          <button id="logout_btn" style="
            padding:10px 12px; border:1px solid #d4bbff; border-radius:10px;
            background:#fff; color:#111827; font-weight:800; cursor:pointer;
            display:none;
          ">Sair</button>

          <div style="margin-left:auto; font-size:12px; opacity:.75;">
            Dica: use sempre o mesmo usuário (admin).
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const msg = overlay.querySelector("#login_msg");
  const btn = overlay.querySelector("#login_btn");
  const btnLogout = overlay.querySelector("#logout_btn");

  btn.onclick = async () => {
    msg.style.display = "none";
    const email = overlay.querySelector("#login_email").value.trim();
    const pass  = overlay.querySelector("#login_pass").value;

    if (!email || !pass) {
      msg.textContent = "Preencha e-mail e senha.";
      msg.style.display = "block";
      return;
    }

    try {
      btn.disabled = true;
      btn.textContent = "Entrando...";
      await signIn(email, pass);
      overlay.style.display = "none";
      if (window.toast) window.toast("Login OK ✅");
    } catch (e) {
      console.error(e);
      msg.textContent = "Falha no login. Confira e-mail/senha (ou crie o usuário no Supabase).";
      msg.style.display = "block";
    } finally {
      btn.disabled = false;
      btn.textContent = "Entrar";
    }
  };

  btnLogout.onclick = async () => {
    try {
      await signOut();
      if (window.toast) window.toast("Saiu do sistema");
      overlay.style.display = "flex";
    } catch (e) {
      console.error(e);
      if (window.toast) window.toast("Erro ao sair", false);
    }
  };
}

async function requireLogin(){
  ensureLoginOverlay();
  const overlay = document.getElementById("login_overlay");

  // se já tem sessão, não mostra login
  const session = await getSession();
  if (session) return true;

  // mostra e fica aguardando até logar
  overlay.style.display = "flex";

  // loop simples: a cada 600ms verifica se logou
  while (true) {
    await sleep(600);
    const s = await getSession();
    if (s) {
      overlay.style.display = "none";
      return true;
    }
  }
}

async function detectTableShape(table){
  const c = ensureClient();

  // Helper: testa se uma coluna existe (funciona mesmo com tabela vazia)
  async function hasCol(col){
    const { error } = await c.from(table).select(col).limit(1);
    return !error;
  }

  // pega 1 registro e olha as colunas que existem de verdade
  const { data, error } = await c.from(table).select("*").order("id", { ascending: true }).limit(1);
  if (error) throw error;

  const row = (data && data[0]) ? data[0] : {};
  const keys = new Set(Object.keys(row));

  let style = "unknown";

  // Se veio pelo menos um registro, decide pelo que apareceu
  if (keys.size){
    // ✅ inclui também "pagamentos" (refKind/refId ou ref_kind/ref_id)
    if (
      keys.has("tutorId") || keys.has("petIds") || keys.has("contatoVet") || keys.has("entityId") ||
      keys.has("refKind") || keys.has("refId")
    ) {
      style = "camel";
    }
    else if (
      keys.has("tutor_id") || keys.has("pet_ids") || keys.has("contato_vet") || keys.has("entity_id") ||
      keys.has("ref_kind") || keys.has("ref_id")
    ) {
      style = "snake";
    }
  } else {
    // Tabela vazia: “probe” por colunas conhecidas

    // logs
    if (await hasCol("entity_id")) style = "snake";
    else if (await hasCol("entityId")) style = "camel";

    // ✅ pagamentos (probe)
    else if (await hasCol("ref_kind") || await hasCol("ref_id")) style = "snake";
    else if (await hasCol("refKind") || await hasCol("refId")) style = "camel";

    // fallback genérico (outros casos)
    else if (await hasCol("tutor_id") || await hasCol("pet_ids") || await hasCol("contato_vet")) style = "snake";
    else if (await hasCol("tutorId") || await hasCol("petIds") || await hasCol("contatoVet")) style = "camel";
  }

  tableShape[table] = { keys, style };
}


function toDb(table, rec){
  const shape = tableShape[table]?.style || "unknown";
  if (shape === "camel" || shape === "unknown") {
    // manda como está (campos camelCase iguais ao seu app)
    return { ...rec };
  }

  // shape snake_case: converte alguns campos conhecidos
  const out = { ...rec };

  // helper converter chave se existir
  function move(a, b){
    if (out[a] !== undefined && out[b] === undefined) {
      out[b] = out[a];
      delete out[a];
    }
  }

  // clientes
  move("contatoVet","contato_vet");

  // pets
  move("tutorId","tutor_id");
  move("doencasFlag","doencas_flag");
  move("doencasTexto","doencas_texto");
  move("alergiasFlag","alergias_flag");
  move("alergiasTexto","alergias_texto");
  move("cuidadosFlag","cuidados_flag");
  move("cuidadosTexto","cuidados_texto");

  move("vacinaViral","vacina_viral");
  move("vacinaViralTipo","vacina_viral_tipo");
  move("vacinaViralMes","vacina_viral_mes");
  move("vacinaViralAno","vacina_viral_ano");

  move("vacinaAntirrabica","vacina_antirrabica");
  move("vacinaAntirrabicaMes","vacina_antirrabica_mes");
  move("vacinaAntirrabicaAno","vacina_antirrabica_ano");

  move("antipulga","antipulga");
  move("antipulgaTipo","antipulga_tipo");
  move("antipulgaMes","antipulga_mes");
  move("antipulgaAno","antipulga_ano");

  // hospedagens
  move("tutorId","tutor_id");
  move("petIds","pet_ids");
  move("dataEntrada","data_entrada");
  move("dataSaida","data_saida");
  move("horaEntrada","hora_entrada");
  move("horaSaida","hora_saida");

  // creches
  move("tutorId","tutor_id");
  move("petIds","pet_ids");
  move("mesRef","mes_ref");
  move("diasPorSemana","dias_por_semana");

  // pagamentos
  move("refKind","ref_kind");
  move("refId","ref_id");

  // logs
  move("entityId","entity_id");

  return out;
}

function fromDb(table, row){
  const shape = tableShape[table]?.style || "unknown";
  if (shape === "camel" || shape === "unknown") {
    return { ...row };
  }

  const out = { ...row };

  function move(a, b){
    if (out[a] !== undefined && out[b] === undefined) {
      out[b] = out[a];
      delete out[a];
    }
  }

  // snake -> camel (inverso do toDb)
  move("contato_vet","contatoVet");

  move("tutor_id","tutorId");
  move("doencas_flag","doencasFlag");
  move("doencas_texto","doencasTexto");
  move("alergias_flag","alergiasFlag");
  move("alergias_texto","alergiasTexto");
  move("cuidados_flag","cuidadosFlag");
  move("cuidados_texto","cuidadosTexto");

  move("vacina_viral","vacinaViral");
  move("vacina_viral_tipo","vacinaViralTipo");
  move("vacina_viral_mes","vacinaViralMes");
  move("vacina_viral_ano","vacinaViralAno");

  move("vacina_antirrabica","vacinaAntirrabica");
  move("vacina_antirrabica_mes","vacinaAntirrabicaMes");
  move("vacina_antirrabica_ano","vacinaAntirrabicaAno");

  move("antipulga","antipulga");
  move("antipulga_tipo","antipulgaTipo");
  move("antipulga_mes","antipulgaMes");
  move("antipulga_ano","antipulgaAno");

  move("pet_ids","petIds");
  move("data_entrada","dataEntrada");
  move("data_saida","dataSaida");
  move("hora_entrada","horaEntrada");
  move("hora_saida","horaSaida");

  move("mes_ref","mesRef");
  move("dias_por_semana","diasPorSemana");

  move("ref_kind","refKind");
  move("ref_id","refId");

  move("entity_id","entityId");

  return out;
}

async function nextId(table){
  const c = ensureClient();
  const { data, error } = await c.from(table).select("id").order("id", { ascending:false }).limit(1);
  if (error) throw error;
  const maxId = (data && data[0] && Number(data[0].id)) ? Number(data[0].id) : 0;
  return maxId + 1;
}

async function supaList(table, query){
  // Cache só quando NÃO tem query (lista “normal”)
  if (!query) {
    const cached = cacheGet(table);
    if (cached) return cached;
  }

  const c = ensureClient();
  const { data, error } = await c.from(table).select("*").order("id", { ascending:true });
  if (error) throw error;

  let rows = (data || []).map(r => fromDb(table, r));

  if (query) {
    const q = String(query).toLowerCase();
    rows = rows.filter(r => JSON.stringify(r).toLowerCase().includes(q));
  } else {
    cacheSet(table, rows);
  }

  return rows;
}

// ====== NOVO: LISTAGEM PAGINADA (sem baixar tudo) ======
async function supaListPage(table, opts = {}){
  const c = ensureClient();

  const limit = Number(opts.limit || 200);
  const offset = Number(opts.offset || 0);

  // por padrão mantém compat com seu app
  const orderBy = (opts.orderBy || 'id').toString();
  const ascending = !!opts.ascending;

  const rawQuery = (opts.query ?? '').toString().trim();

  // range é inclusivo no Supabase: range(from, to)
  const from = offset;
  const to = offset + Math.max(0, limit - 1);

  // monta query
  let qb = c.from(table).select('*');

  // Filtro opcional (por enquanto vamos usar só em logs)
  // Se der qualquer erro de coluna/filtro, fazemos fallback sem filtro.
  if (rawQuery && table === 'logs') {
    // Supabase "or" usa vírgula como separador, então removemos vírgulas do termo
    const safeQ = rawQuery.replaceAll(',', ' ').trim();
    const pat = `%${safeQ}%`;
    qb = qb.or(`note.ilike.${pat},entity.ilike.${pat},action.ilike.${pat}`);
  }

  qb = qb.order(orderBy, { ascending }).range(from, to);

  let { data, error } = await qb;

  // fallback: se falhar por conta do filtro, tenta sem filtro
  if (error && rawQuery) {
    const retry = await c.from(table).select('*').order(orderBy, { ascending }).range(from, to);
    if (retry.error) throw retry.error;
    data = retry.data;
  } else if (error) {
    throw error;
  }

  return (data || []).map(r => fromDb(table, r));
}


async function supaGet(table, id){
  const c = ensureClient();
  const { data, error } = await c.from(table).select("*").eq("id", Number(id)).limit(1);
  if (error) throw error;
  const row = (data && data[0]) ? data[0] : null;
  return row ? fromDb(table, row) : null;
}

// ====== NOVO: GET MANY (busca vários IDs de uma vez) ======
async function supaGetMany(table, ids){
  const c = ensureClient();
  const arr = Array.isArray(ids) ? ids.map(n => Number(n)).filter(Boolean) : [];
  if (!arr.length) return [];

  const { data, error } = await c.from(table).select("*").in("id", arr);
  if (error) throw error;

  return (data || []).map(r => fromDb(table, r));
}

async function supaAdd(table, rec){
  const c = ensureClient();
  const row = { ...rec };

  // garante ID (seu app usa id numérico)
  if (!row.id) row.id = await nextId(table);

  const payload = toDb(table, row);

  const { error } = await c.from(table).insert(payload);
  if (error) throw error;
cacheClear(table);
  return row.id;
}

async function supaPut(table, rec){
  const c = ensureClient();
  if (!rec || !rec.id) throw new Error("put(): registro sem id");
  const payload = toDb(table, rec);

  const { error } = await c.from(table).update(payload).eq("id", Number(rec.id));
  if (error) throw error;
cacheClear(table);
  return rec.id;
}

async function supaDelete(table, id){
  const c = ensureClient();
  const { error } = await c.from(table).delete().eq("id", Number(id));
  if (error) throw error;
  cacheClear(table);
  return true;
}

async function supaExport(){
  const out = {};
  for (const t of STORES) out[t] = await supaList(t);
  return out;
}

async function supaImport(json){
  // IMPORTA sem apagar nada (para não correr risco de perda):
  // - se existir id, faz update (upsert manual)
  // - se não existir, cria com id novo
  if (!json || typeof json !== "object") throw new Error("import(): JSON inválido");
  for (const t of STORES) {
    const arr = Array.isArray(json[t]) ? json[t] : [];
    for (const rec of arr) {
      if (!rec) continue;
      const existing = rec.id ? await supaGet(t, rec.id) : null;
      if (existing) {
        await supaPut(t, { ...existing, ...rec });
      } else {
        await supaAdd(t, rec);
      }
    }
  }
}

const DB = {
init: async () => {
  // Se já inicializou, não faz nada
  if (__dbInited) return true;

  // Se já tem uma inicialização em andamento, aguarda ela
  if (__dbInitPromise) return __dbInitPromise;

  __dbInitPromise = (async () => {
    ensureClient();
    await requireLogin();

    // detecta o formato das colunas só 1 vez
    for (const t of STORES) {
      await detectTableShape(t);
    }

    __dbInited = true;
    return true;
  })();

  return __dbInitPromise;
},

  list: async (store, query) => {
    await DB.init();
    return supaList(store, query);
  },
  
    page: async (store, opts) => {
    await DB.init();
    return supaListPage(store, opts);
  },

  get: async (store, id) => {
    await DB.init();
    return supaGet(store, id);
  },
  
    getMany: async (store, ids) => {
    await DB.init();
    return supaGetMany(store, ids);
  },

  add: async (store, rec) => {
    await DB.init();
    return supaAdd(store, rec);
  },

  put: async (store, rec) => {
    await DB.init();
    return supaPut(store, rec);
  },

  delete: async (store, id) => {
    await DB.init();
    return supaDelete(store, id);
  },

  export: async () => {
    await DB.init();
    return supaExport();
  },

  import: async (json) => {
    await DB.init();
    return supaImport(json);
  },

  auth: {
    getSession,
    signIn,
    signOut,
  }
};

window.DB = DB;
