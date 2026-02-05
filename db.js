// db.js — ONLINE (Supabase) compatível com o seu sistema atual
// Mantém a mesma API do seu DB antigo:
// DB.init(), DB.list(), DB.get(), DB.add(), DB.put(), DB.delete(), DB.export(), DB.import()

const SUPABASE_URL = "https://siksojcleumugquntrgc.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_6KMGqcdP2m5A8vx46Ew--g_GU8giA2V";

const STORES = ["clientes","pets","hospedagens","creches","pagamentos","logs"];

let supa = null;

// guarda o “formato” real das colunas de cada tabela (camelCase vs snake_case)
// Ex.: tutorId OU tutor_id, petIds OU pet_ids, contatoVet OU contato_vet etc.
const tableShape = {}; // { clientes: {keys:Set, style:"camel"|"snake"|"unknown"} ... }

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
  // pega 1 registro e olha as colunas que existem de verdade
  const { data, error } = await c.from(table).select("*").order("id", { ascending: true }).limit(1);
  if (error) throw error;

  const row = (data && data[0]) ? data[0] : {};
  const keys = new Set(Object.keys(row));

  let style = "unknown";
  // Heurística: se existir "tutorId" é camel. Se existir "tutor_id" é snake.
  if (keys.has("tutorId") || keys.has("petIds") || keys.has("contatoVet")) style = "camel";
  else if (keys.has("tutor_id") || keys.has("pet_ids") || keys.has("contato_vet")) style = "snake";

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
  const c = ensureClient();
  // Para manter a “busca” simples igual seu IndexedDB, buscamos tudo e filtramos no JS.
  // Com seu volume atual (bem pequeno) isso roda liso.
  const { data, error } = await c.from(table).select("*").order("id", { ascending:true });
  if (error) throw error;

  let rows = (data || []).map(r => fromDb(table, r));

  if (query) {
    const q = String(query).toLowerCase();
    rows = rows.filter(r => JSON.stringify(r).toLowerCase().includes(q));
  }

  return rows;
}

async function supaGet(table, id){
  const c = ensureClient();
  const { data, error } = await c.from(table).select("*").eq("id", Number(id)).limit(1);
  if (error) throw error;
  const row = (data && data[0]) ? data[0] : null;
  return row ? fromDb(table, row) : null;
}

async function supaAdd(table, rec){
  const c = ensureClient();
  const row = { ...rec };

  // garante ID (seu app usa id numérico)
  if (!row.id) row.id = await nextId(table);

  const payload = toDb(table, row);

  const { error } = await c.from(table).insert(payload);
  if (error) throw error;

  return row.id;
}

async function supaPut(table, rec){
  const c = ensureClient();
  if (!rec || !rec.id) throw new Error("put(): registro sem id");
  const payload = toDb(table, rec);

  const { error } = await c.from(table).update(payload).eq("id", Number(rec.id));
  if (error) throw error;

  return rec.id;
}

async function supaDelete(table, id){
  const c = ensureClient();
  const { error } = await c.from(table).delete().eq("id", Number(id));
  if (error) throw error;
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
    ensureClient();
    await requireLogin();

    // detecta o formato de colunas real do seu banco (camel vs snake)
    for (const t of STORES) {
      await detectTableShape(t);
    }

    return true;
  },

  list: async (store, query) => {
    await DB.init();
    return supaList(store, query);
  },

  get: async (store, id) => {
    await DB.init();
    return supaGet(store, id);
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
