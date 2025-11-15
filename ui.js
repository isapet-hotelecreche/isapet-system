// ui.js v3
const Tabs = [
  { id:'checkin', label:'Check-in/Out' },
  { id:'clientes', label:'Tutor' },
  { id:'pets', label:'Pets' },
  { id:'hosp', label:'Hospedagem / Hotel' },
  { id:'creche', label:'Creche' },
  { id:'pagamentos', label:'Pagamentos' },
  { id:'logs', label:'Logs' },
  { id:'backup', label:'Importar/Exportar' },
  { id:'sobre', label:'Sobre/Testes' },
];
function $(sel, root=document){ return root.querySelector(sel); }
function $all(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }
function renderTabs(active='checkin'){
  const tabs = $('#tabs'); tabs.innerHTML = '';
  for (const t of Tabs) {
    const b = document.createElement('button');
    b.className = 'tab-btn' + (t.id===active?' active':'');
    b.textContent = t.label;
    b.onclick = ()=>renderView(t.id);
    tabs.appendChild(b);
  }
}
async function renderView(id='checkin'){
  renderTabs(id);
  const view = $('#view'); view.innerHTML = '';
  if (id==='checkin') return renderCheckin();
  if (id==='clientes') return renderClientes();
  if (id==='pets') return renderPets();
  if (id==='hosp') return renderHosp();
  if (id==='creche') return renderCreche();
  if (id==='pagamentos') return renderPagamentos();
  if (id==='logs') return renderLogs();
  if (id==='backup') return renderBackup();
  if (id==='sobre') return renderSobre();
}
function Input(label, id, type='text', attrs={}){
  return `<label for="${id}">${label}</label><input id="${id}" type="${type}" ${Object.entries(attrs).map(([k,v])=>`${k}="${v}"`).join(' ')} />`;
}
function Select(label, id, options, attrs={}){
  return `<label for="${id}">${label}</label><select id="${id}" ${Object.entries(attrs).map(([k,v])=>`${k}="${v}"`).join(' ')}>${options.map(o=>`<option value="${o.value}">${o.label}</option>`).join('')}</select>`;
}
function TextArea(label, id, attrs={}){
  return `<label for="${id}">${label}</label><textarea id="${id}" ${Object.entries(attrs).map(([k,v])=>`${k}="${v}"`).join(' ')}></textarea>`;
}
