/**
 * STOCK-LIGHT — DriveService.js
 * 
 * Módulo de Custodia Documental, Hashing Canónico y Extracción de Texto en Servidor.
 * Garantiza que la única fuente de verdad autoritativa para crear movimientos de stock
 * sea el archivo PDF original almacenado y auditado en Google Drive.
 * 
 * Responsabilidades:
 * 1. Recibir Blob PDF original.
 * 2. Calcular SHA-256 directamente desde blob.getBytes() en el servidor.
 * 3. Gestionar/configurar la carpeta de custodia (DRIVE_FOLDER_ID / STOCK_LIGHT_UPLOADS).
 * 4. Almacenar el archivo PDF físico íntegro en Google Drive.
 * 5. Generar driveFileId real inmutable emitido por Google Drive.
 * 6. Recuperar y verificar la integridad de archivos por driveFileId.
 * 7. Extraer texto representativo canónico en servidor (Vectorial / OCR Fallback).
 * 
 * Contrato Futuro Documentado:
 * confirmarDocumentoPorDriveId(driveFileId, usuario)
 * Pasos que ejecutará el servidor:
 * 1. Recuperar archivo por driveFileId desde Google Drive.
 * 2. Verificar existencia y estado en Drive (no en papelera).
 * 3. Obtener su contenido binario (Blob).
 * 4. Calcular de forma infalsificable el SHA-256 en servidor.
 * 5. Extraer texto canónico en servidor (serverRawText).
 * 6. Re-parsear mediante DocumentParserRegistry.
 * 7. Validar mediante DocumentValidator y MaestroResolver.
 * 8. Comprobar deduplicación contra la hoja DOCUMENTOS.
 * 9. Solo si el estado es 'VALIDO', invocar MovementService.
 */

// Importaciones condicionales para entorno Node.js / Testing (aisladas sin 'var' para evitar colisiones en Apps Script V8)
if (typeof require !== 'undefined') {
  const confMod = require('./Config');
  global.getDriveFolderIdConfig = global.getDriveFolderIdConfig || confMod.getDriveFolderIdConfig;
  global.setDriveFolderIdConfig = global.setDriveFolderIdConfig || confMod.setDriveFolderIdConfig;
}

/**
 * Extracción vectorial nativa de streams de texto en objetos PDF (Crystal Reports).
 * Procesa streams comprimidos con FlateDecode y extrae tokens Tj / TJ.
 * 
 * @param {Uint8Array|Buffer|number[]} bytes 
 * @returns {string} Texto extraído de los streams vectoriales
 */
function extractPdfVectorialStreams(bytes) {
  if (!bytes) return '';
  
  // En entorno Node.js se utiliza zlib nativo
  if (typeof require !== 'undefined') {
    try {
      const zlib = require('zlib');
      const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      const str = buf.toString('latin1');
      const textChunks = [];
      const streamRegex = /stream\r?\n?([\s\S]*?)(?:\r?\n)?endstream/g;
      let match;

      while ((match = streamRegex.exec(str)) !== null) {
        const rawStream = Buffer.from(match[1], 'latin1');
        let decompressed;
        try {
          decompressed = zlib.inflateSync(rawStream);
        } catch (e1) {
          try {
            decompressed = zlib.inflateRawSync(rawStream);
          } catch (e2) {
            continue;
          }
        }

        if (decompressed) {
          const content = decompressed.toString('latin1');
          
          // 1. Operador (texto) Tj
          const tjRegex = /\(([^)]*)\)\s*Tj/g;
          let tjMatch;
          while ((tjMatch = tjRegex.exec(content)) !== null) {
            textChunks.push(tjMatch[1]);
          }

          // 2. Operador [(t) (e) (x) (t) ...] TJ
          const bigTjRegex = /\[(.*?)\]\s*TJ/g;
          let bigTjMatch;
          while ((bigTjMatch = bigTjRegex.exec(content)) !== null) {
            const inner = bigTjMatch[1];
            const parts = inner.match(/\(([^)]*)\)/g);
            if (parts) {
              textChunks.push(parts.map(p => p.slice(1, -1)).join(''));
            }
          }
        }
      }

      return textChunks.join('\n');
    } catch (err) {
      // Si falla la extracción nativa por streams, continuar a fallback
    }
  }

  return '';
}

/**
 * Extracción de texto mediante Google Drive API / Google Docs OCR en Google Apps Script.
 * Convierte temporalmente el Blob a un Google Doc, extrae el texto y elimina el archivo temporal.
 * 
 * @param {GoogleAppsScript.Base.Blob} blob 
 * @param {Object} options 
 * @returns {string} Texto extraído vía OCR/Docs
 */
function extractViaDriveDocsOcr(blob, options = {}) {
  const drive = options.driveAdvancedService || (typeof Drive !== 'undefined' ? Drive : null);
  const docApp = options.documentApp || (typeof DocumentApp !== 'undefined' ? DocumentApp : null);

  if (drive && drive.Files && docApp) {
    const resource = {
      title: 'TEMP_OCR_EXTRACT_' + Date.now(),
      mimeType: 'application/vnd.google-apps.document'
    };

    let docFile = null;
    try {
      docFile = drive.Files.insert(resource, blob, { ocr: true, ocrLanguage: 'es' });
      const doc = docApp.openById(docFile.id);
      return doc.getBody().getText();
    } finally {
      if (docFile && docFile.id) {
        try {
          drive.Files.remove(docFile.id);
        } catch (cleanupErr) {
          // Ignorar fallo de borrado del temporal para no interrumpir el flujo
        }
      }
    }
  }

  return '';
}

class DriveService {
  /**
   * @param {Object} [options]
   * @param {Object} [options.driveApp] - Inyección de DriveApp (para testing o entorno controlado)
   * @param {Object} [options.propertiesService] - Inyección de PropertiesService
   * @param {string} [options.driveFolderId] - ID de carpeta explícito
   * @param {Function} [options.textExtractor] - Extractor de texto personalizado
   */
  constructor(options = {}) {
    this._options = options;
    this._driveApp = options.driveApp || (typeof DriveApp !== 'undefined' ? DriveApp : null);
  }

  /**
   * Obtiene la instancia de DriveApp activa.
   */
  getDriveApp() {
    if (!this._driveApp) {
      if (typeof DriveApp !== 'undefined') {
        this._driveApp = DriveApp;
      } else {
        throw new Error('DriveApp no está disponible en este entorno de ejecución.');
      }
    }
    return this._driveApp;
  }

  /**
   * Calcula el hash SHA-256 directamente a partir de los bytes reales del Blob.
   * En Apps Script utiliza Utilities.computeDigest.
   * En Node.js utiliza el módulo nativo crypto.
   * 
   * @param {Object} blob - Objeto Blob con método getBytes()
   * @returns {string} Hash SHA-256 en formato hexadecimal minúscula (64 caracteres)
   */
  computeSha256(blob) {
    if (!blob || typeof blob.getBytes !== 'function') {
      throw new Error('El objeto proporcionado no es un Blob válido o carece del método getBytes().');
    }

    const rawBytes = blob.getBytes();
    if (!rawBytes || rawBytes.length === 0) {
      throw new Error('El Blob proporcionado está vacío (0 bytes). No se puede calcular SHA-256.');
    }

    // 1. Google Apps Script nativo
    if (typeof Utilities !== 'undefined' && typeof Utilities.computeDigest === 'function') {
      const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, rawBytes);
      return digest.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
    }

    // 2. Node.js nativo para testing y backend
    if (typeof require !== 'undefined') {
      const crypto = require('crypto');
      const buf = Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes);
      return crypto.createHash('sha256').update(buf).digest('hex');
    }

    throw new Error('No se encontró un proveedor criptográfico (Utilities o crypto) para calcular SHA-256.');
  }

  /**
   * Obtiene o aprovisiona la carpeta de almacenamiento de STOCK-LIGHT en Google Drive.
   * 1. Consulta DRIVE_FOLDER_ID en ScriptProperties / opciones.
   * 2. Si no existe, busca la carpeta por nombre 'STOCK_LIGHT_UPLOADS'.
   * 3. Si no existe, la crea en Drive y persiste su ID.
   * 
   * @returns {Object} Instancia de Folder de Google Drive
   */
  getStorageFolder() {
    const driveApp = this.getDriveApp();
    const configuredFolderId = getDriveFolderIdConfig(this._options);

    if (configuredFolderId) {
      try {
        const folder = driveApp.getFolderById(configuredFolderId);
        if (folder) return folder;
      } catch (err) {
        // Carpeta no accesible con el ID configurado, intentar resolver o recrear
      }
    }

    // Buscar si ya existe la carpeta 'STOCK_LIGHT_UPLOADS'
    if (typeof driveApp.getFoldersByName === 'function') {
      const folders = driveApp.getFoldersByName('STOCK_LIGHT_UPLOADS');
      if (folders.hasNext && folders.hasNext()) {
        const existingFolder = folders.next();
        if (typeof setDriveFolderIdConfig === 'function') {
          try {
            setDriveFolderIdConfig(existingFolder.getId(), this._options);
          } catch (e) {}
        }
        return existingFolder;
      }
    }

    // Crear la carpeta si no existe
    if (typeof driveApp.createFolder === 'function') {
      const newFolder = driveApp.createFolder('STOCK_LIGHT_UPLOADS');
      if (typeof setDriveFolderIdConfig === 'function') {
        try {
          setDriveFolderIdConfig(newFolder.getId(), this._options);
        } catch (e) {}
      }
      return newFolder;
    }

    throw new Error('No se pudo resolver ni crear la carpeta de almacenamiento de Google Drive.');
  }

  /**
   * Guarda el archivo PDF original e íntegro en Google Drive y calcula su hash SHA-256.
   * 
   * @param {Object} blob - Blob con el contenido del PDF
   * @returns {Object} { file, driveFileId, sha256Hash, nombreArchivo, mimeType, tamanoBytes }
   */
  savePdf(blob) {
    if (!blob || typeof blob.getBytes !== 'function') {
      throw new Error('savePdf requiere un Blob válido.');
    }

    const fileName = blob.getName ? blob.getName() : 'documento.pdf';
    const mimeType = blob.getContentType ? blob.getContentType() : 'application/pdf';

    if (mimeType !== 'application/pdf' && !fileName.toLowerCase().endsWith('.pdf')) {
      throw new Error(`Tipo de archivo no admitido: '${mimeType}'. STOCK-LIGHT solo procesa documentos PDF.`);
    }

    const sha256Hash = this.computeSha256(blob);
    const folder = this.getStorageFolder();
    const file = folder.createFile(blob);
    const driveFileId = file.getId();

    return {
      file,
      driveFileId,
      sha256Hash,
      nombreArchivo: fileName,
      mimeType,
      tamanoBytes: blob.getBytes().length
    };
  }

  /**
   * Recupera un archivo PDF almacenado en Google Drive por su ID real.
   * 
   * @param {string} driveFileId 
   * @returns {Object} Instancia de File de Drive
   */
  getPdfFile(driveFileId) {
    if (!driveFileId || typeof driveFileId !== 'string' || driveFileId.trim() === '') {
      throw new Error('Se requiere un driveFileId válido no vacío para recuperar el archivo de Drive.');
    }

    const cleanId = driveFileId.trim();
    const driveApp = this.getDriveApp();
    let file = null;

    try {
      file = driveApp.getFileById(cleanId);
    } catch (err) {
      throw new Error(`Archivo no encontrado en Google Drive con ID: '${cleanId}'. Detalle: ${err.message}`);
    }

    if (!file) {
      throw new Error(`Archivo no encontrado en Google Drive con ID: '${cleanId}'.`);
    }

    if (typeof file.isTrashed === 'function' && file.isTrashed()) {
      throw new Error(`El archivo con ID '${cleanId}' se encuentra en la papelera de Google Drive.`);
    }

    return file;
  }

  /**
   * Extrae el texto canónico del PDF en el servidor.
   * Nivel 1: Extracción vectorial de streams (rápida, 0 cuotas, 100% fiel a Crystal Reports).
   * Nivel 2: Drive API OCR / Google Docs temporal (fallback para documentos escaneados/raster).
   * 
   * @param {Object} blobOrFile - Blob o File de Drive
   * @returns {string} serverRawText
   */
  extractServerText(blobOrFile) {
    if (this._options.textExtractor && typeof this._options.textExtractor === 'function') {
      return this._options.textExtractor(blobOrFile, this._options);
    }

    const blob = (blobOrFile && typeof blobOrFile.getBlob === 'function')
      ? blobOrFile.getBlob()
      : blobOrFile;

    if (!blob || typeof blob.getBytes !== 'function') {
      throw new Error('extractServerText requiere un Blob o File con método getBytes().');
    }

    const bytes = blob.getBytes();

    // Nivel 1: Extracción vectorial de streams de PDF
    const vecText = extractPdfVectorialStreams(bytes);
    if (vecText && vecText.trim().length > 50) {
      return vecText;
    }

    // Nivel 2: Google Docs / Drive API OCR
    const ocrText = extractViaDriveDocsOcr(blob, this._options);
    if (ocrText && ocrText.trim().length > 50) {
      return ocrText;
    }

    if (vecText && vecText.trim().length > 0) {
      return vecText;
    }

    throw new Error('No se pudo extraer texto legible del documento PDF en el servidor.');
  }

  /**
   * Flujo completo de ingesta de un PDF original en el servidor:
   * 1. Calcula SHA-256 desde bytes.
   * 2. Guarda el PDF en Google Drive (obtiene driveFileId real).
   * 3. Extrae texto canónico del servidor.
   * 4. Retorna el payload canónico listo para revisión/staging.
   * 
   * @param {Object} blob 
   * @returns {Object} Payload canónico de ingesta
   */
  ingestPdf(blob) {
    const saved = this.savePdf(blob);
    const serverRawText = this.extractServerText(blob);

    const lines = serverRawText.split(/\r?\n/).filter(l => l.trim() !== '');

    return {
      driveFileId: saved.driveFileId,
      sha256Hash: saved.sha256Hash,
      nombreArchivo: saved.nombreArchivo,
      mimeType: saved.mimeType,
      tamanoBytes: saved.tamanoBytes,
      serverRawText,
      metadatos: {
        fechaIngesta: new Date().toISOString(),
        longitudTexto: serverRawText.length,
        lineasTexto: lines.length
      }
    };
  }

  /**
   * Recupera un archivo de Drive por su ID y verifica su integridad criptográfica SHA-256.
   * Si se suministra expectedSha256 y no coincide, lanza una excepción de integridad.
   * 
   * @param {string} driveFileId 
   * @param {string} [expectedSha256] 
   * @returns {Object} { file, blob, driveFileId, sha256Hash, serverRawText }
   */
  retrieveAndVerify(driveFileId, expectedSha256 = null) {
    const file = this.getPdfFile(driveFileId);
    const blob = file.getBlob();
    const actualSha256 = this.computeSha256(blob);

    if (expectedSha256 && typeof expectedSha256 === 'string') {
      if (actualSha256.toLowerCase() !== expectedSha256.trim().toLowerCase()) {
        throw new Error(
          `Violación de integridad: El SHA-256 del archivo en Drive ('${actualSha256}') ` +
          `no coincide con el hash esperado ('${expectedSha256}'). El archivo ha sido alterado o sustituido.`
        );
      }
    }

    const serverRawText = this.extractServerText(blob);

    return {
      file,
      blob,
      driveFileId,
      sha256Hash: actualSha256,
      serverRawText
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DriveService,
    extractPdfVectorialStreams,
    extractViaDriveDocsOcr
  };
}
