// app.js v3 (patched)
document.addEventListener('DOMContentLoaded', ()=>renderView('checkin'));

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
  const options = clientes.map(c=>({ value:c.id, label: `${c.nome}` }));
  const view = document.getElementById('view');
  view.innerHTML = `
  <div class="grid">
    <div class="panel">
      <h2>Novo Pet</h2>
      ${Select('Tutor', 'pet_tutor', [{value:'',label:'Selecione...'}, ...options])}
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
      <div class="row">
        ${Select('Doenças', 'pet_doencas_sel', [{value:'Nao',label:'Não'},{value:'Sim',label:'Sim'}])}
        ${Select('Alergias', 'pet_alergias_sel', [{value:'Nao',label:'Não'},{value:'Sim',label:'Sim'}])}
        ${Select('Cuidados', 'pet_cuidados_sel', [{value:'Nao',label:'Não'},{value:'Sim',label:'Sim'}])}
      </div>
      <div id="grp_doencas">${TextArea('Descrever Doenças (se "Sim")', 'pet_doencas_txt')}</div>
      <div id="grp_alergias">${TextArea('Descrever Alergias (se "Sim")', 'pet_alergias_txt')}</div>
      <div id="grp_cuidados">${TextArea('Descrever Cuidados (se "Sim")', 'pet_cuidados_txt')}</div>
<div style="margin-bottom:10px;">
  <label class="checkbox-inline" style="display:inline-flex; align-items:center; justify-content:flex-start; gap:4px;">
    <span>Castrado</span>
    <input id="pet_castrado" type="checkbox" style="margin:0; transform:translateY(1px);" />
  </label>
</div>
      <div class="space"></div>
      <div class="flex">
        <button class="btn btn-primary" id="pet_salvar">Salvar</button>
        <button class="btn btn-outline" id="pet_limpar">Limpar</button>
      </div>
    </div>
    <div class="panel">
      <div class="flex"><h2>Lista de Pets</h2><div class="right"></div></div>
      <div class="search">
        <input id="pet_busca" placeholder="Buscar por Nome, Raça, Tutor..." />
        <button class="btn btn-ghost" id="pet_buscar">Buscar</button>
      </div>
      <div class="space"></div>
      <div class="list-scroll"><table><thead><tr>
        <th>ID</th><th>Nome</th><th>Espécie</th><th>Raça</th><th>Tutor</th><th>Ações</th>
      </tr></thead><tbody id="pet_tbody"></tbody></table></div>
    </div>
  </div>`;

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
  document.getElementById('pet_especie_sel').onchange = updateEspecieOutro;
  ['pet_doencas_sel','pet_alergias_sel','pet_cuidados_sel'].forEach(id=>document.getElementById(id).onchange=updateCondTexts);
  updateEspecieOutro(); updateCondTexts();

  document.getElementById('pet_salvar').onclick = async () => {
    const get = id => document.getElementById(id);

    // 1) Tutor obrigatório
    const tutorId = Number(get('pet_tutor').value);
    if (!tutorId) {
      toast('O campo Tutor não pode ficar vazio', false);
      get('pet_tutor').focus();
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
  const tbody = document.getElementById('pet_tbody'); tbody.innerHTML='';
  const list = await DB.list('pets', q);
  const clientes = await DB.list('clientes'); const byId = Object.fromEntries(clientes.map(c=>[c.id,c]));
  for (const p of list.sort((a,b)=>a.nome.localeCompare(b.nome))) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${p.id}</td><td>${p.nome}</td><td>${p.especie||''}</td><td>${p.raca||''}</td><td>${byId[p.tutorId]?.nome||p.tutorId}</td>
    <td class="flex"><button class="btn btn-ghost" data-edit="${p.id}">Editar</button><button class="btn btn-danger" data-del="${p.id}">Excluir</button></td>`;
    tbody.appendChild(tr);
  }
  $all('[data-edit]').forEach(b=>b.onclick=()=>editPet(b.getAttribute('data-edit')));
  $all('[data-del]').forEach(b=>b.onclick=()=>delPet(b.getAttribute('data-del')));
}
async function editPet(id){
  const p = await DB.get('pets', id); if (!p) return toast('Pet não encontrado', false);
  document.getElementById('pet_tutor').value = p.tutorId||'';
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
  const ev=new Event('change'); document.getElementById('pet_especie_sel').dispatchEvent(ev);
  ['pet_doencas_sel','pet_alergias_sel','pet_cuidados_sel'].forEach(id=>document.getElementById(id).dispatchEvent(ev));
  const salvar = document.getElementById('pet_salvar');
  salvar.textContent = 'Atualizar';
  salvar.onclick = async () => {
    const get = id => document.getElementById(id);

    // 1) Tutor obrigatório
    p.tutorId = Number(get('pet_tutor').value);
    if (!p.tutorId) {
      toast('O campo Tutor não pode ficar vazio', false);
      get('pet_tutor').focus();
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
  const p=await DB.get('pets', id);
  if (!confirm(`Excluir pet ${p?.nome||id}?`)) return;
  await DB.delete('pets', id);
  await DB.add('logs', { at:new Date().toISOString(), action:'delete', entity:'pet', entityId:Number(id), note:`Excluído` });
  toast('Pet excluído'); loadPets('');
}

// ==== HOSPEDAGEM ====
async function renderHosp(){
  const clientes = await DB.list('clientes');
  const pets = await DB.list('pets');
  const byTutor = pets.reduce((acc,p)=>{ (acc[p.tutorId]=acc[p.tutorId]||[]).push(p); return acc; },{});
  const view = document.getElementById('view');
  view.innerHTML = `
  <div class="grid">
    <div class="panel">
      <h2>Nova Hospedagem</h2>
      ${Select('Tutor', 'h_tutor', [{value:'',label:'Selecione...'}, ...clientes.map(c=>({value:c.id,label:`${c.nome}`}))])}
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
        <th>ID</th><th>Período</th><th>Tutor & Pets</th><th>Valor</th><th>Status</th><th>Ações</th>
      </tr></thead><tbody id="h_tbody"></tbody></table></div>
    </div>
  </div>`;

  function loadPetsForTutor(){
    const box = document.getElementById('h_pets_box'); 
    box.innerHTML = '';
    const tutorId = Number(document.getElementById('h_tutor').value||0);

    for (const p of (byTutor[tutorId]||[]).sort((a,b)=>a.nome.localeCompare(b.nome))) {
      const lbl = document.createElement('label');
      lbl.className = 'chk-inline';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.name = 'h_pet';
      cb.value = p.id;

      lbl.appendChild(cb);
      lbl.appendChild(document.createTextNode(` ${p.nome}`));
      box.appendChild(lbl);
    }
  }

  document.getElementById('h_tutor').onchange = loadPetsForTutor; loadPetsForTutor();

  document.getElementById('h_salvar').onclick = async () => {
    const get = id => document.getElementById(id);

    const tutorId     = Number(get('h_tutor').value || 0);
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
      get('h_tutor').focus();
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

  // carrega tudo
  const all = await DB.list('hospedagens');
  const clientes = await DB.list('clientes');
  const byCli = Object.fromEntries(clientes.map(c => [c.id, c]));
  const pets = await DB.list('pets');
  const byPet = Object.fromEntries(pets.map(p => [p.id, p]));

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
    tr.innerHTML = `<td>${h.id}</td>
      <td>${fmtBR(h.dataEntrada)} → ${fmtBR(h.dataSaida)}</td>
      <td><strong>${tutor}</strong> — ${petNames}</td>
      <td>${fmtMoney(h.valor)}</td>
      <td>
        <span class="tag">${h.status||''}</span>
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
  const h = await DB.get('hospedagens', id); if (!h) return toast('Hospedagem não encontrada', false);
  await renderHosp();
  const pets = await DB.list('pets');
  const byTutor = pets.reduce((acc,p)=>{ (acc[p.tutorId]=acc[p.tutorId]||[]).push(p); return acc; },{});
  function loadPetsForTutor(){
    const box = document.getElementById('h_pets_box'); 
    box.innerHTML = '';
    const tutorId = Number(document.getElementById('h_tutor').value||0);

    for (const p of (byTutor[tutorId]||[]).sort((a,b)=>a.nome.localeCompare(b.nome))) {
      const lbl = document.createElement('label');
      lbl.className = 'chk-inline';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.name = 'h_pet';
      cb.value = p.id;
      if ((h.petIds || []).includes(p.id)) cb.checked = true;

      lbl.appendChild(cb);
      lbl.appendChild(document.createTextNode(` ${p.nome}`));
      box.appendChild(lbl);
    }
  }
  
  document.getElementById('h_tutor').value = h.tutorId||'';
  document.getElementById('h_tutor').onchange = loadPetsForTutor; loadPetsForTutor();
  document.getElementById('h_data_in').value = h.dataEntrada||'';
  document.getElementById('h_data_out').value = h.dataSaida||'';
  document.getElementById('h_hora_in').value = h.horaEntrada||'';
  document.getElementById('h_hora_out').value = h.horaSaida||'';
  document.getElementById('h_valor').value = h.valor||0;
  document.getElementById('h_status').value = h.status||'agendada';
  document.getElementById('h_obs').value = (h.nota ?? h.observacao ?? '');
  const salvar = document.getElementById('h_salvar');
  salvar.textContent = 'Atualizar';
  salvar.onclick = async () => {
    const get = id => document.getElementById(id);

    const tutorId     = Number(get('h_tutor').value || 0);
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
      get('h_tutor').focus();
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
      action: '...date',
      entity: 'hospedagem',
      entityId: h.id,
      note: `Atualizada`,
    });
    toast('Hospedagem atualizada');
    renderHosp();
  };
}

// ==== CRECHE ====
async function renderCreche(prefill = null){
  const clientes = await DB.list('clientes');
  const pets = await DB.list('pets');
  const byTutor = pets.reduce((acc,p)=>{ (acc[p.tutorId]=acc[p.tutorId]||[]).push(p); return acc; },{});
  const today = new Date();
  const ym = (d)=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
  const view = document.getElementById('view');
  view.innerHTML = `
  <div class="grid">
    <div class="panel">
      <h2>Nova Agenda de Creche</h2>
      ${Select('Tutor', 'c_tutor', [{value:'',label:'Selecione...'}, ...clientes.map(c=>({value:c.id,label:`${c.nome}`}))])}
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
        <th>ID</th><th>Mês</th><th>Tutor & Pets</th><th>Dias</th><th>Valor</th><th>Status</th><th>Ações</th>
      </tr></thead><tbody id="c_tbody"></tbody></table></div>
    </div>
  </div>`;


  function loadPetsForTutor(){
    const box = document.getElementById('c_pets_box'); 
    box.innerHTML = '';
    const tutorId = Number(document.getElementById('c_tutor').value||0);

    for (const p of (byTutor[tutorId]||[]).sort((a,b)=>a.nome.localeCompare(b.nome))) {
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
  }

  document.getElementById('c_tutor').onchange = loadPetsForTutor; loadPetsForTutor();

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
    const get     = id => document.getElementById(id);
    const tutorId = Number(document.getElementById('c_tutor').value||0);
    const petIds  = Array.from(document.querySelectorAll('input[name="c_pet"]:checked')).map(cb => Number(cb.value));
    const valorStr = (get('c_valor').value || '').toString().trim();

    // === VALIDAÇÕES OBRIGATÓRIAS ===

    // Tutor obrigatório
    if (!tutorId) {
      toast('O campo Tutor não pode ficar vazio', false);
      get('c_tutor').focus();
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

    const dias = Object.keys(selection).sort().map(d=>({
      data:d,
      entrada: selection[d].entrada||'',
      saida: selection[d].saida||''
    }));
    if (dias.length===0) {
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
    renderCreche();
  };


  // Busca de agendas de creche
  const cBuscaInput  = document.getElementById('c_busca');
  const cBuscarBtn   = document.getElementById('c_buscar');

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

  // todas as agendas de creche
  const todas = await DB.list('creches');

  // mapas de clientes e pets para pegar nomes
  const clientes = await DB.list('clientes');
  const byCli = Object.fromEntries(clientes.map(c => [c.id, c]));

  const pets = await DB.list('pets');
  const byPet = Object.fromEntries(pets.map(p => [p.id, p]));

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
    tr.innerHTML = `
      <td>${c.id}</td>
      <td>${mesRefBR}</td>
      <td><strong>${tutor}</strong> — ${petNames}</td>
      <td>${diasCount}</td>
      <td>${fmtMoney(c.valor || 0)}</td>
      <td>
        <span class="tag ${c.status==='Concluído' ? 'tag-green' : (c.status==='Cancelado' ? 'tag-red' : 'tag-yellow')}" style="padding:2px 6px">
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

  // 1) Preenche tutor
  const tutorEl = document.getElementById('c_tutor');
  tutorEl.value = String(c.tutorId || '');

  // 2) Recarrega lista de pets do tutor (usa o loader padrão da tela)
  if (typeof loadPetsForTutor === 'function') {
    loadPetsForTutor();
  } else {
    // fallback: popula rapidamente (com checkboxes)
    const pets = await DB.list('pets');
    const byTutor = pets.reduce((acc, p) => { (acc[p.tutorId] = acc[p.tutorId] || []).push(p); return acc; }, {});
    const box = document.getElementById('c_pets_box');
    box.innerHTML = '';
    for (const p of (byTutor[c.tutorId] || []).sort((a,b)=>a.nome.localeCompare(b.nome))) {
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
    const tutorId = Number(document.getElementById('c_tutor').value || 0);
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

  let start = new Date();
  function weekStart(d){ const x=new Date(d); return new Date(x.getFullYear(),x.getMonth(),x.getDate()); }
  async function paintWeek(){
    const begin = weekStart(start);
    const days = []; for(let i=0;i<7;i++){ days.push(new Date(begin.getTime()+i*86400000)); }
    const html = await agendaHtml(days[0], days[6]);
    document.getElementById('ck_list').innerHTML = html;
    bindCheckButtons();
    updatePendenciasAlert();
  }
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

  
function bindCheckButtons(){
  // Check-in
  document.querySelectorAll('[data-checkin]').forEach(b=>{
    b.onclick = ()=>{
      const [kind, idStr] = b.getAttribute('data-checkin').split('|');
      abrirPagamento('checkin', kind, Number(idStr));
    };
  });

  // Check-out
  document.querySelectorAll('[data-checkout]').forEach(b=>{
    b.onclick = ()=>{
      const [kind, idStr] = b.getAttribute('data-checkout').split('|');
      abrirPagamento('checkout', kind, Number(idStr));
    };
  });

  // Ajuste de pagamento
  document.querySelectorAll('[data-ajuste]').forEach(b=>{
    b.onclick = ()=>{
      const [kind, idStr] = b.getAttribute('data-ajuste').split('|');
      ajustarPagamento(kind, Number(idStr));
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

  const somaHosp   = hospInRange.reduce((acc,h)=> acc + Number(h.valor || h.valorTotal || 0), 0);
  const somaCreche = crechesInRange.reduce((acc,c)=> acc + Number(c.valor || 0), 0);

  let html = '';

  html += `<div style="margin-bottom:10px;">Período considerado: <strong>${fmtBRHifen(fromISO)}</strong> até <strong>${fmtBRHifen(toISO)}</strong></div>`;

  html += `
    <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px; font-size:13px;">
      <div class="tag">Hospedagens: <strong>${hospInRange.length}</strong> — ${fmtMoney(somaHosp)}</div>
      <div class="tag">Creches: <strong>${crechesInRange.length}</strong> — ${fmtMoney(somaCreche)}</div>
      <div class="tag">Pets atendidos: <strong>${totalPets}</strong></div>
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
            <col style="width:22%;">  <!-- Período -->
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
      const nomesPets = (h.petIds || []).map(id => byPet[id]?.nome || `Pet #${id}`).join(', ');

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

      html += `
        <tr>
          <td>#${h.id}</td>
          <td>${periodo}</td>
          <td>${tutorNome}<br><span class="muted-sm">${nomesPets}</span></td>
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
        <table style="width:100%; border-collapse:collapse;">
          <colgroup>
            <col style="width:1%;">   <!-- ID -->
            <col style="width:22%;">  <!-- Período -->
            <col style="width:15%;">  <!-- Tutor & Pets -->
			<col style="width:10%;">  <!-- Dias por Semana -->
            <col style="width:12%;">  <!-- Valor -->
            <col style="width:12%;">  <!-- Status -->
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
      const nomesPets = (c.petIds || []).map(id => byPet[id]?.nome || `Pet #${id}`).join(', ');

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
      const creCount = rec.creche.length;
      const petsSet = new Set();
      rec.hosp.forEach(h=> (h.petIds||[]).forEach(id=>petsSet.add(id)));
      rec.creche.forEach(c=> (c.petIds||[]).forEach(id=>petsSet.add(id)));
      const petsTotal = petsSet.size;
      out += `<div class="muted-sm" style="margin:4px 0 8px 0">Resumo: ${hospCount} hospedagem${hospCount!==1?'s':''}, ${creCount} creche${creCount!==1?'s':''}, ${petsTotal} pet${petsTotal!==1?'s':''} no total</div>`;

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

          const petNames = Array.from(info.petIds).map(pid => {
            const nome = byPet[pid]?.nome || ('#' + pid);
            return `<a href="#" class="pet-link" data-pet="${pid}" data-ref="${r0.kind}|${r0.refId}">${nome}</a>`;
          }).join(', ');

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

          const hasNote = !!String(r0.nota ?? r0.observacao ?? '').trim();
          const noteIcon = hasNote
            ? ' <span class="note-flag" title="Observações deste agendamento">📝</span>'
            : '';

out += `<div>${iconPrefix ? iconPrefix + ' ' : ''}<strong>${petNames}</strong>${noteIcon} — Tutor: <a href="#" class="tutor-link" data-tutor="${tutorId}"><strong>${tutor}</strong></a>${tailExtra}${controls}</div>`;

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
		  
		  const petNames = Array.from(info.petIds).map(pid=>{
  const nome = byPet[pid]?.nome || ('#'+pid);
  return `<a href="#" class="pet-link" data-pet="${pid}" data-ref="${r0.kind}|${r0.refId}">${nome}</a>`;
}).join(', ');

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
  if (!pay) {
    pay = {
      refKind:   kind,
      refId:     refId,
      valor:     novoTotalPago,
      metodo:    (tipo === 'checkin' ? 'checkin' : 'checkout'),
      data:      hoje,
      tipoUltimo: tipo,
      percUltimo: null
    };
    await DB.add('pagamentos', pay);
  } else {
    pay.valor      = novoTotalPago;
    pay.metodo     = (tipo === 'checkin' ? 'checkin' : 'checkout');
    pay.data       = hoje;
    pay.tipoUltimo = tipo;
    pay.percUltimo = null;
    await DB.put('pagamentos', pay);
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
  renderCheckin();
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
  if (!pay) {
    pay = {
      refKind:   kind,
      refId:     refId,
      valor:     novoTotalPago,
      metodo:    'ajuste',
      data:      hoje,
      tipoUltimo: 'ajuste',
      percUltimo: null
    };
    await DB.add('pagamentos', pay);
  } else {
    pay.valor      = novoTotalPago;
    pay.metodo     = 'ajuste';
    pay.data       = hoje;
    pay.tipoUltimo = 'ajuste';
    pay.percUltimo = null;
    await DB.put('pagamentos', pay);
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
  renderCheckin();
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

  // Filtra pelo intervalo de datas do pagamento
  const items = Object.values(grouped)
    .filter(p => {
      if (!p.data) return false;
      const d = String(p.data);
      return d >= dataIni && d <= dataFim;
    })
    .sort((a,b)=>String(b.data||'').localeCompare(String(a.data||'')));

  const [clientes, pets, hospedagens, creches] = await Promise.all([
    DB.list('clientes'),
    DB.list('pets'),
    DB.list('hospedagens'),
    DB.list('creches')
  ]);

  const byCli = Object.fromEntries(clientes.map(c => [c.id, c]));
  const byPet = Object.fromEntries(pets.map(p => [p.id, p]));
  const byHosp = Object.fromEntries(hospedagens.map(h => [h.id, h]));
  const byCre = Object.fromEntries(creches.map(c => [c.id, c]));

  let totHosp = 0;
  let totCre = 0;

  for (const p of items) {
    const isHosp = (p.refKind === 'hospedagem');
    const rec = isHosp ? byHosp[p.refId] : byCre[p.refId];
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

// ==== LOGS ====
async function renderLogs(){
  const view = document.getElementById('view');
  view.innerHTML = `
  <div class="panel">
    <div class="flex"><h2>Logs do Sistema</h2><div class="right"></div></div>
    <div class="list-scroll"><table><thead><tr>
      <th>Quando</th><th>Ação</th><th>Entidade</th><th>ID</th><th>Nota</th>
    </tr></thead><tbody id="log_tbody"></tbody></table></div>
  </div>`;
  loadLogs();
}
async function loadLogs(){
  const tbody = document.getElementById('log_tbody'); tbody.innerHTML='';
  const list = await DB.list('logs');
  for (const l of list.sort((a,b)=>String(b.at).localeCompare(String(a.at)))) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="mono">${l.at}</td><td>${l.action}</td><td>${l.entity}</td><td>${l.entityId||''}</td><td>${l.note||''}</td>`;
    tbody.appendChild(tr);
  }
}

// ==== BACKUP & SOBRE ====
async function renderBackup(){
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
  </div>`;
  document.getElementById('btn_export').onclick = async () => {
    const data = await DB.export();
    const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `isapet-backup-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(a.href);
    toast('Backup exportado');
  };
  document.getElementById('btn_import').onclick = async () => {
    const f = document.getElementById('file_import').files[0];
    if (!f) return toast('Selecione um arquivo', false);
    try {
      const json = JSON.parse(await f.text()); await DB.import(json);
      await DB.add('logs', { at:new Date().toISOString(), action:'import', entity:'backup', note:'Importação concluída' });
      toast('Importado com sucesso'); renderView('checkin');
    } catch(e){ console.error(e); toast('Arquivo inválido', false); }
  };
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
