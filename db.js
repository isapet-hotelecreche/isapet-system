// db.js v3 — adds hospedar (hospedagens) and creches; removes need for servicos store.
const DB_NAME = 'isapet-lite-db-v3-2';
const DB_VERSION = 2;
let db;
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('clientes')) {
        const s = db.createObjectStore('clientes', { keyPath:'id', autoIncrement:true });
        s.createIndex('nome','nome',{unique:false});
        s.createIndex('documento','documento',{unique:false});
      }
      if (!db.objectStoreNames.contains('pets')) {
        const s = db.createObjectStore('pets', { keyPath:'id', autoIncrement:true });
        s.createIndex('tutorId','tutorId',{unique:false});
        s.createIndex('nome','nome',{unique:false});
      }
      if (!db.objectStoreNames.contains('hospedagens')) {
        const s = db.createObjectStore('hospedagens', { keyPath:'id', autoIncrement:true });
        s.createIndex('tutorId','tutorId',{unique:false});
        s.createIndex('dataEntrada','dataEntrada',{unique:false});
        s.createIndex('dataSaida','dataSaida',{unique:false});
        s.createIndex('status','status',{unique:false});
      }
      if (!db.objectStoreNames.contains('creches')) {
        const s = db.createObjectStore('creches', { keyPath:'id', autoIncrement:true });
        s.createIndex('tutorId','tutorId',{unique:false});
        s.createIndex('mesRef','mesRef',{unique:false});
        s.createIndex('status','status',{unique:false});
      }
      if (!db.objectStoreNames.contains('pagamentos')) {
        const s = db.createObjectStore('pagamentos', { keyPath:'id', autoIncrement:true });
        s.createIndex('refKind','refKind',{unique:false});
        s.createIndex('refId','refId',{unique:false});
        s.createIndex('data','data',{unique:false});
      }
      if (!db.objectStoreNames.contains('logs')) {
        db.createObjectStore('logs', { keyPath:'id', autoIncrement:true });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = (e) => reject(e.target.error);
  });
}
const DB = {
  init: async () => { if(!db) await openDb(); },
  list: async (store, query) => {
    await DB.init();
    return new Promise((resolve, reject) => {
      const s = db.transaction([store], 'readonly').objectStore(store);
      const out = [];
      const req = s.openCursor();
      req.onsuccess = (e) => {
        const c = e.target.result;
        if (c) {
          const v = c.value;
          if (!query) out.push(v);
          else {
            const q = String(query).toLowerCase();
            if (JSON.stringify(v).toLowerCase().includes(q)) out.push(v);
          }
          c.continue();
        } else resolve(out);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  },
  get: async (store, id) => {
    await DB.init();
    return new Promise((resolve, reject) => {
      const req = db.transaction([store],'readonly').objectStore(store).get(Number(id));
      req.onsuccess = (e)=>resolve(e.target.result);
      req.onerror = (e)=>reject(e.target.error);
    });
  },
  add: async (store, rec) => {
    await DB.init();
    return new Promise((resolve, reject) => {
      const req = db.transaction([store],'readwrite').objectStore(store).add(rec);
      req.onsuccess = (e)=>resolve(e.target.result);
      req.onerror = (e)=>reject(e.target.error);
    });
  },
  put: async (store, rec) => {
    await DB.init();
    return new Promise((resolve, reject) => {
      const req = db.transaction([store],'readwrite').objectStore(store).put(rec);
      req.onsuccess = (e)=>resolve(e.target.result);
      req.onerror = (e)=>reject(e.target.error);
    });
  },
  delete: async (store, id) => {
    await DB.init();
    return new Promise((resolve, reject) => {
      const req = db.transaction([store],'readwrite').objectStore(store).delete(Number(id));
      req.onsuccess = ()=>resolve(true);
      req.onerror = (e)=>reject(e.target.error);
    });
  },
  export: async () => {
    await DB.init();
    const stores = ['clientes','pets','hospedagens','creches','pagamentos','logs'];
    const out = {};
    for (const s of stores) out[s] = await DB.list(s);
    return out;
  },
  import: async (json) => {
    await DB.init();
    const stores = ['clientes','pets','hospedagens','creches','pagamentos','logs'];
    const t = db.transaction(stores, 'readwrite');
    for (const s of stores) t.objectStore(s).clear();
    await new Promise(res=>{ t.oncomplete=res; });
    for (const [s, arr] of Object.entries(json)) {
      for (const it of (arr||[])) {
        const {id, ...rest} = it;
        await DB.add(s, rest);
      }
    }
  }
};
window.DB = DB;