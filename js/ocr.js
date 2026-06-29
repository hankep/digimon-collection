// OCR-Engine-Wrapper für die Kamera-Schnellerfassung.
//
// Kapselt Tesseract.js: lädt die Lib beim ERSTEN Scan lazy vom CDN (nicht im
// Initial-Payload — die WASM/Lang-Daten sind mehrere MB) und hält EINEN Worker
// für die Session. Einzige Aufgabe: ein Canvas → erkannter Text.
//
// Bewusst minimal & isoliert: Wenn das OCR-Feature wieder rausfliegt, ist nur
// diese Datei + der Scan-Teil in ui-rapidentry.js betroffen.

(function () {
  const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
  // Nur die Zeichen, die in Karten-IDs vorkommen — schärft die Erkennung.
  const CHAR_WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-';

  let scriptPromise = null;
  let worker = null;
  let workerPromise = null;

  function loadScript() {
    if (window.Tesseract) return Promise.resolve();
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = TESS_URL;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { scriptPromise = null; reject(new Error('Tesseract.js konnte nicht geladen werden (offline?).')); };
      document.head.appendChild(s);
    });
    return scriptPromise;
  }

  // Lädt Lib + erzeugt/konfiguriert den Worker (idempotent, gibt denselben zurück).
  function ensureWorker() {
    if (worker) return Promise.resolve(worker);
    if (workerPromise) return workerPromise;
    workerPromise = (async () => {
      await loadScript();
      const w = await window.Tesseract.createWorker('eng');
      await w.setParameters({
        tessedit_char_whitelist: CHAR_WHITELIST,
        tessedit_pageseg_mode: '7' // PSM 7: eine einzelne Textzeile
      });
      worker = w;
      return w;
    })();
    workerPromise.catch(() => { workerPromise = null; }); // Fehler → erneuter Versuch möglich
    return workerPromise;
  }

  async function recognizeCanvas(canvas) {
    const w = await ensureWorker();
    const res = await w.recognize(canvas);
    const data = res && res.data ? res.data : {};
    return { text: data.text || '', confidence: data.confidence || 0 };
  }

  async function terminate() {
    try { if (worker) await worker.terminate(); } catch (e) { /* ignore */ }
    worker = null;
    workerPromise = null;
  }

  window.OCR = {
    ensureWorker,
    recognizeCanvas,
    terminate,
    get loaded() { return !!worker; }
  };
})();
