
/* Offline storage foundation.
 * Local persistent storage and pending operations.
 * Does not modify existing sales or accounting logic.
 */
(function () {
  "use strict";

  const DB_NAME = "sales_system_offline";
  const DB_VERSION = 1;
  let databasePromise = null;

  function makeId() {
    if (window.crypto && crypto.randomUUID) {
      return crypto.randomUUID();
    }

    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      return (c === "x" ? r : (r & 3 | 8)).toString(16);
    });
  }

  function openDatabase() {
    if (databasePromise) return databasePromise;

    databasePromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error("المتصفح لا يدعم التخزين المحلي الدائم."));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = function (event) {
        const database = event.target.result;

        if (!database.objectStoreNames.contains("meta")) {
          database.createObjectStore("meta", { keyPath: "key" });
        }

        if (!database.objectStoreNames.contains("products")) {
          database.createObjectStore("products", { keyPath: "id" });
        }

        if (!database.objectStoreNames.contains("customers")) {
          database.createObjectStore("customers", { keyPath: "id" });
        }

        if (!database.objectStoreNames.contains("outbox")) {
          const store = database.createObjectStore("outbox", {
            keyPath: "operation_id"
          });

          store.createIndex("status", "status", { unique: false });
          store.createIndex("created_at", "created_at", { unique: false });
          store.createIndex("user_id", "user_id", { unique: false });
        }
      };

      request.onsuccess = function () {
        const database = request.result;

        database.onversionchange = function () {
          database.close();
          databasePromise = null;
        };

        resolve(database);
      };

      request.onerror = function () {
        databasePromise = null;
        reject(request.error || new Error("تعذر فتح قاعدة البيانات المحلية."));
      };

      request.onblocked = function () {
        reject(new Error("قاعدة البيانات المحلية مشغولة في نافذة أخرى."));
      };
    });

    return databasePromise;
  }

  async function getMeta(key) {
    const database = await openDatabase();

    return new Promise(function (resolve, reject) {
      const transaction = database.transaction("meta", "readonly");
      const request = transaction.objectStore("meta").get(key);

      request.onsuccess = function () {
        resolve(request.result ? request.result.value : null);
      };

      request.onerror = function () {
        reject(request.error);
      };
    });
  }

  async function setMeta(key, value) {
    const database = await openDatabase();

    return new Promise(function (resolve, reject) {
      const transaction = database.transaction("meta", "readwrite");

      transaction.objectStore("meta").put({
        key: key,
        value: value
      });

      transaction.oncomplete = function () {
        resolve(value);
      };

      transaction.onerror = function () {
        reject(transaction.error);
      };

      transaction.onabort = function () {
        reject(transaction.error || new Error("فشل الحفظ المحلي."));
      };
    });
  }
async function saveInvoiceNumberReservation(reservation) {
  if (
    !reservation ||
    !Number.isInteger(reservation.invoice_year) ||
    !Number.isSafeInteger(reservation.range_start) ||
    !Number.isSafeInteger(reservation.range_end) ||
    !Number.isSafeInteger(reservation.next_number) ||
    reservation.range_start <= 0 ||
    reservation.range_end < reservation.range_start ||
    reservation.next_number < reservation.range_start ||
    reservation.next_number > reservation.range_end
  ) {
    throw new Error("بيانات حجز أرقام الفواتير غير صحيحة.");
  }

  await setMeta("invoice_number_reservation", reservation);

  return reservation;
}
  async function completeInvoiceNumberReservation(reservation) {
  if (
    !reservation ||
    typeof reservation.reservation_id !== "string" ||
    !Number.isInteger(reservation.invoice_year) ||
    !Number.isSafeInteger(reservation.range_start) ||
    !Number.isSafeInteger(reservation.range_end) ||
    reservation.range_start <= 0 ||
    reservation.range_end < reservation.range_start
  ) {
    throw new Error("بيانات حجز أرقام الفواتير غير صحيحة.");
  }

  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("meta", "readwrite");
    const store = tx.objectStore("meta");

    let localError = null;

    const request = store.get("invoice_number_reservation");

    request.onsuccess = () => {
      const current = request.result?.value;

      // الحجز نفسه موجود: لا نعيد العداد إلى البداية
      if (
        current &&
        current.reservation_id === reservation.reservation_id
      ) {
        store.delete("invoice_reservation_request_id");
        return;
      }

      // لا نستبدل حجزاً ما زالت فيه أرقام غير مستخدمة
      if (
  current &&
  current.invoice_year === reservation.invoice_year &&
  Number.isSafeInteger(current.next_number) &&
  current.next_number <= current.range_end
) {
        localError = new Error(
          "لا يمكن استبدال حجز ما زالت فيه أرقام غير مستخدمة."
        );
        tx.abort();
        return;
      }

      store.put({
        key: "invoice_number_reservation",
        value: {
          ...reservation,
          next_number: reservation.range_start
        }
      });

      store.delete("invoice_reservation_request_id");
    };

    tx.oncomplete = () => resolve(true);

    tx.onerror = () => {
      reject(
        localError ||
        tx.error ||
        new Error("تعذر حفظ حجز أرقام الفواتير.")
      );
    };

    tx.onabort = () => {
      reject(
        localError ||
        tx.error ||
        new Error("تم إلغاء حفظ الحجز.")
      );
    };
  });
}
async function getInvoiceNumberReservation() {
  return await getMeta("invoice_number_reservation");
}
  async function getInvoiceReservationRequestId() {
  return await getMeta("invoice_reservation_request_id");
}

async function saveInvoiceReservationRequestId(requestId) {
  if (
    typeof requestId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
  ) {
    throw new Error("معرف طلب الحجز غير صحيح.");
  }

  await setMeta("invoice_reservation_request_id", requestId);

  return requestId;
}
  async function getOrCreateInvoiceReservationRequestId() {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("meta", "readwrite");
    const store = tx.objectStore("meta");

    let requestId = null;

    const request = store.get("invoice_reservation_request_id");

    request.onsuccess = () => {
      const existing = request.result?.value;

      if (
        typeof existing === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)
      ) {
        requestId = existing;
      } else {
        requestId = makeId();

        store.put({
          key: "invoice_reservation_request_id",
          value: requestId
        });
      }
    };

    tx.oncomplete = () => resolve(requestId);

    tx.onerror = () => {
      reject(tx.error || new Error("تعذر إنشاء معرف طلب الحجز."));
    };

    tx.onabort = () => {
      reject(tx.error || new Error("تم إلغاء إنشاء معرف طلب الحجز."));
    };
  });
}
  async function takeNextInvoiceNumber() {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("meta", "readwrite");
    const store = tx.objectStore("meta");

    let allocatedNumber = null;
    let allocationError = null;

    const request = store.get("invoice_number_reservation");

    request.onsuccess = () => {
      const reservation = request.result?.value;

      if (!reservation) {
        allocationError = new Error(
          "لا يوجد نطاق أرقام فواتير محجوز لهذا الجهاز."
        );
        return;
      }

      if (reservation.next_number > reservation.range_end) {
        allocationError = new Error(
          "انتهت الأرقام المحجوزة لهذا الجهاز."
        );
        return;
      }

      allocatedNumber = reservation.next_number;

      reservation.next_number += 1;

      store.put({
        key: "invoice_number_reservation",
        value: reservation
      });
    };

    tx.oncomplete = () => {
      if (allocationError) {
        reject(allocationError);
      } else {
        resolve(allocatedNumber);
      }
    };

    tx.onerror = () => {
      reject(tx.error || new Error("تعذر تخصيص رقم الفاتورة."));
    };

    tx.onabort = () => {
      reject(tx.error || allocationError || new Error("تم إلغاء تخصيص الرقم."));
    };
  });
}
  async function getDeviceId() {
    let id = await getMeta("device_id");

    if (!id) {
      id = makeId();
      await setMeta("device_id", id);
    }

    return id;
  }

  async function cacheRows(storeName, rows) {
    if (!["products", "customers"].includes(storeName)) {
      throw new Error("نوع البيانات غير مسموح.");
    }

    if (!Array.isArray(rows)) {
      throw new Error("قائمة البيانات غير صحيحة.");
    }

    const database = await openDatabase();

    return new Promise(function (resolve, reject) {
      const transaction = database.transaction(storeName, "readwrite");
      const store = transaction.objectStore(storeName);

      rows.forEach(function (row) {
        if (row && row.id !== undefined && row.id !== null) {
          store.put(row);
        }
      });

      transaction.oncomplete = function () {
        resolve(rows.length);
      };

      transaction.onerror = function () {
        reject(transaction.error);
      };

      transaction.onabort = function () {
        reject(transaction.error || new Error("فشل تحديث البيانات المحلية."));
      };
    });
  }

  async function getCachedRows(storeName) {
    if (!["products", "customers"].includes(storeName)) {
      throw new Error("نوع البيانات غير مسموح.");
    }

    const database = await openDatabase();

    return new Promise(function (resolve, reject) {
      const transaction = database.transaction(storeName, "readonly");
      const request = transaction.objectStore(storeName).getAll();

      request.onsuccess = function () {
        resolve(request.result || []);
      };

      request.onerror = function () {
        reject(request.error);
      };
    });
  }

  async function enqueueOperation(input) {
    if (!input || typeof input.type !== "string" || !input.type.trim()) {
      throw new Error("نوع العملية مطلوب.");
    }

    const deviceId = await getDeviceId();

    const operation = {
      operation_id: input.operationId || makeId(),
      type: input.type.trim(),
      payload: input.payload == null ? {} : input.payload,
      user_id: input.userId || null,
      device_id: deviceId,
      status: "pending",
      created_at: new Date().toISOString(),
      attempt_count: 0,
      last_error: null
    };

    const database = await openDatabase();

    return new Promise(function (resolve, reject) {
      const transaction = database.transaction("outbox", "readwrite");

      transaction.objectStore("outbox").add(operation);

      transaction.oncomplete = function () {
        resolve(operation);
      };

      transaction.onerror = function () {
        reject(transaction.error || new Error("تعذر حفظ العملية."));
      };

      transaction.onabort = function () {
        reject(transaction.error || new Error("أُلغيت عملية الحفظ."));
      };
    });
  }

  async function listOperations(status, limit) {
    const database = await openDatabase();

    return new Promise(function (resolve, reject) {
      const transaction = database.transaction("outbox", "readonly");
      const store = transaction.objectStore("outbox");

      const request = status
        ? store.index("status").getAll(status)
        : store.getAll();

      request.onsuccess = function () {
        const rows = request.result || [];

        rows.sort(function (a, b) {
          return a.created_at.localeCompare(b.created_at);
        });

        resolve(
          Number.isInteger(limit) && limit > 0
            ? rows.slice(0, limit)
            : rows
        );
      };

      request.onerror = function () {
        reject(request.error);
      };
    });
  }

  async function updateOperation(operationId, changes) {
    const database = await openDatabase();

    return new Promise(function (resolve, reject) {
      const transaction = database.transaction("outbox", "readwrite");
      const store = transaction.objectStore("outbox");
      const request = store.get(operationId);

      request.onsuccess = function () {
        if (!request.result) {
          reject(new Error("العملية غير موجودة."));
          return;
        }

        store.put(Object.assign({}, request.result, changes));
      };

      request.onerror = function () {
        reject(request.error);
      };

      transaction.oncomplete = function () {
        resolve(true);
      };

      transaction.onerror = function () {
        reject(transaction.error);
      };

      transaction.onabort = function () {
        reject(transaction.error || new Error("فشل تحديث العملية."));
      };
    });
  }

  async function changeAttempt(operationId, status, errorMessage) {
    const rows = await listOperations();
    const current = rows.find(function (row) {
      return row.operation_id === operationId;
    });

    if (!current) {
      throw new Error("العملية غير موجودة.");
    }

    return updateOperation(operationId, {
      status: status,
      attempt_count: current.attempt_count + 1,
      last_error: errorMessage || null
    });
  }

  async function markSyncing(operationId) {
  return updateOperation(operationId, {
    status: "syncing",
    syncing_at: new Date().toISOString(),
    last_error: null
  });
}

  async function markPending(operationId, errorMessage) {
    return changeAttempt(operationId, "pending", errorMessage);
  }

  async function markFailed(operationId, errorMessage) {
    return changeAttempt(
      operationId,
      "failed",
      errorMessage || "فشلت المزامنة."
    );
  }

  async function markCompleted(operationId, serverResult) {
    return updateOperation(operationId, {
      status: "completed",
      completed_at: new Date().toISOString(),
      server_result: serverResult == null ? null : serverResult,
      last_error: null
    });
  }

  async function countPending() {
    const pending = await listOperations("pending");
    const syncing = await listOperations("syncing");
    const failed = await listOperations("failed");

    return {
      pending: pending.length,
      syncing: syncing.length,
      failed: failed.length,
      total: pending.length + syncing.length + failed.length
    };
  }

window.OfflineStore = Object.freeze({
  open: openDatabase,
  getDeviceId,
  saveInvoiceNumberReservation,
  completeInvoiceNumberReservation,
  getInvoiceNumberReservation,
  getInvoiceReservationRequestId,
  getOrCreateInvoiceReservationRequestId,
  takeNextInvoiceNumber,
  cacheRows,
  getCachedRows,
  enqueueOperation,
  listOperations: listOperations,
  markSyncing: markSyncing,
  markPending: markPending,
  markFailed: markFailed,
  markCompleted: markCompleted,
  countPending: countPending
});
})();
