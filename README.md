# Nuestro gran día 
Web gratuita (0 CAD) para que ~60 invitados compartan fotos de la boda escaneando un QR.
Sin apps, sin cuentas. Interfaz 100 % en español.

- Web pública: https://aguilar996.github.io/PhotoWeddingApp/
- Galería: https://aguilar996.github.io/PhotoWeddingApp/gallery.html
- Diagnóstico: añadir `?debug=1` a la URL (`?debug=0` lo oculta)

## Arquitectura
```
Teléfono → GitHub Pages (HTML/CSS/JS vanilla, sin build)
         → Google Apps Script Web App (/exec, "Ejecutar como: Yo", acceso: "Cualquier usuario")
         → Google Drive (carpeta privada) + Google Sheets (pestaña "uploads")
```

## Archivos
| Archivo | Función |
|---|---|
| index.html | Cámara, galería del teléfono, cola y subida |
| gallery.html | Galería pública (miniaturas de Drive) |
| test-api.html / js/api-test.js | Pruebas de conexión e idempotencia (9 pruebas) |
| stress.html / js/stress.js | Prueba de carga (teléfonos simulados) |
| js/config.js | URL del /exec (pública por diseño) |
| js/api.js | fetch POST text/plain + redirect follow + cancelación |
| js/camera.js | getUserMedia (environment + fallback), captura sin marco |
| js/queue.js | IndexedDB (fotos como ArrayBuffer) |
| js/photos.js | Validación por bytes, cola, subida automática, backoff+jitter, offline, pausa |
| js/gallery.js | Lista de la galería, miniaturas con alternativa |
| js/diagnostics.js | Modo ?debug=1 y captura de errores |
| css/*.css | Estilo editorial (marfil/taupe) |
| backend/Code.gs | Copia del Apps Script (fuente real: script.google.com, proyecto "Boda API") |

## Decisiones clave
- **CORS**: Apps Script no admite preflight → solo `POST` con `Content-Type: text/plain`, sin cabeceras propias, `credentials: "omit"`. Safari bloquea `application/json` (probado).
- **HEIC**: no se acepta. `accept="image/jpeg,image/png,image/webp"` hace que la Fototeca de iPhone convierta a JPEG. Tipo real validado por bytes en el teléfono y en el servidor.
- **Calidad**: la cámara en vivo da ~1440×1920; para resolución completa se recomienda «Tomar foto» (iPhone) / «Cámara» (Android) desde el botón de galería.
- **Idempotencia**: el uploadId (UUID v4) se reserva en la hoja bajo LockService ("receiving") → createFile (uploadId en el nombre) → "stored". Reintento con el mismo uploadId devuelve `duplicate:true` sin copia nueva.
- **Cola**: una subida a la vez por teléfono; backoff `min(60s, 2s·2^(n-1)) + jitter`; máx. 8 intentos; reanuda al volver online o al reabrir.
- **Barra de progreso**: estimada (XHR upload progress requiere preflight, que Apps Script no soporta).
- **Galería**: la carpeta de Drive manda. Lista en CacheService 60 s, sin candado. Fotos compartidas «Cualquiera con el enlace · Lector». Miniaturas: `drive.google.com/thumbnail?id=…&sz=w600`, alternativa `lh3.googleusercontent.com/d/ID=w600` (no oficiales).
- **Sin panel admin**: moderar = borrar en Drive (y vaciar papelera). Desaparece en ≤ 60 s.
- Las filas con deviceId `test-api` nunca aparecen en la galería.

## Configuración privada (Apps Script → Propiedades de script)
- `FOLDER_ID`: carpeta privada de Drive
- `SHEET_ID`: hoja con pestaña `uploads`
- Encabezados A–J: uploadId, fileId, receivedAt, filename, mimeType, bytes, status, deletedAt, deviceId, notes
- Permiso OAuth necesario: `https://www.googleapis.com/auth/drive` (si falla createFile: quitar acceso en myaccount.google.com/connections y reautorizar)

## Desplegar cambios del backend
Implementar → Gestionar implementaciones → ✏️ → Versión: **Nueva versión** → Implementar.
Guardar el código NO lo publica. Verificar con `/exec` → campo `version`.

## Funciones manuales en Apps Script
`setupCheck`, `galleryCheck`, `shareExisting`, `duplicateCheck`, `invalidateGallery`

## Actualizar la web
Editar en GitHub → Commit. Subir `?v=N` en index.html/gallery.html para evitar caché.
Ojo: al pegar código desde un chat, comprobar el final del archivo (ya se cortó una vez) y que no falten llamadas como `store["delete"]`.

## Estado de pruebas
✅ Cámara iPhone/Android · captura · selección múltiple · IndexedDB · CORS (normal y privado) · subida a Drive · registro en Sheets · idempotencia · modo avión y reconexión · galería · borrar en Drive · pausa/reanudar · carga 85 fotos desde 3 dispositivos sin fallos ni duplicados · QR
⚠️ Pendiente: prueba en Wi-Fi/datos del salón

## Antes de la boda
1. Borrar fotos de prueba en Drive (`stress-…`, pruebas) y filas de prueba en la hoja (no la fila 1).
2. `galleryCheck` → 0.
3. Probar QR impreso (papel mate, QR ≥ 5 cm).
