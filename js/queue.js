(function () {
  "use strict";

  var DB_NAME = "nuestro-gran-dia";
  var DB_VERSION = 1;
  var STORE = "photos";
  var dbPromise = null;

  function open() {
    if (dbPromise) { return dbPromise; }
    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error("IndexedDB no disponible"));
        return;
      }
      var req;
      try {
        req = window.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          var store = db.createObjectStore(STORE, { keyPath: "uploadId" });
          store.createIndex("createdAt", "createdAt", { unique: false });
        }
      };
      req.onsuccess = function () {
        var db = req.result;
        db.onversionchange = function () { db.close(); dbPromise = null; };
        db.onclose = function () { dbPromise = null; };
        resolve(db);
      };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error("IndexedDB bloqueado por otra pestaña")); };
    });
    dbPromise.catch(function () { dbPromise = null; });
    return dbPromise;
  }

  function run(mode, work) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx;
        try {
          tx = db.transaction(STORE, mode);
        } catch (e) {
          dbPromise = null;
          reject(e);
          return;
        }
        var result;
        work(tx.objectStore(STORE), function (value) { result = value; });
        tx.oncomplete = function () { resolve(result); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error || new Error("Transacción cancelada")); };
      });
    });
  }

  // Safari puede cerrar la conexión al volver de segundo plano: reintento único
  function runSafe(mode, work) {
    return run(mode, work).catch(function (err) {
      if (err && (err.name === "InvalidStateError" || err.name === "UnknownError")) {
        dbPromise = null;
        return run(mode, work);
      }
      throw err;
    });
  }

  window.PhotoQueue = {
    put: function (record) {
      return runSafe("readwrite", function (store) { store.put(record); });
    },

    get: function (uploadId) {
      return runSafe("readonly", function (store, set) {
        var r = store.get(uploadId);
        r.onsuccess = function () { set(r.result || null); };
      });
    },

    getAll: function () {
      return runSafe("readonly", function (store, set) {
        var r = store.index("createdAt").getAll();
        r.onsuccess = function () { set(r.result || []); };
      });
    },

    update: function (uploadId, changes) {
      return runSafe("readwrite", function (store, set) {
        var r = store.get(uploadId);
        r.onsuccess = function () {
          var rec = r.result;
          if (!rec) { set(null); return; }
          Object.keys(changes).forEach(function (k) { rec[k] = changes[k]; });
          rec.updatedAt = new Date().toISOString();
          store.put(rec);
          set(rec);
        };
      });
    },

    remove: function (uploadId) {
      return runSafe("readwrite", function (store) { store["delete"](uploadId); });
    },

    estimate: function () {
      if (navigator.storage && typeof navigator.storage.estimate === "function") {
        return navigator.storage.estimate().catch(function () { return null; });
      }
      return Promise.resolve(null);
    },

    persist: function () {
      if (navigator.storage && typeof navigator.storage.persist === "function") {
        return navigator.storage.persist().catch(function () { return false; });
      }
      return Promise.resolve(false);
    }
  };
})();
