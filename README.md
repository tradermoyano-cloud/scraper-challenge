# scraper-challenge

Scraper en TypeScript que consulta dos sitios web del Estado peruano por HTTP (sin abrir un navegador) y guarda los resultados en archivos.

| Sitio | Qué descarga | ¿Necesitas VPN? |
|-------|--------------|-----------------|
| **PJ** — Jurisprudencia del Poder Judicial | Listado + PDFs | **Sí** (salida de red desde Perú) |
| **OEFA** — Repositorio Digital | Listado + PDFs | **No** |

El objetivo del desafío es **PJ**. OEFA sirve para comprobar que el scraper funciona sin VPN.

**Forma recomendada de ejecutarlo:** Docker Compose. No hace falta instalar Node.js en tu máquina.

---

## Índice

1. [Requisitos](#1-requisitos)
2. [Obtener el código](#2-obtener-el-código)
3. [Camino A — Desafío con VPN (PJ)](#3-camino-a--desafío-con-vpn-pj)
4. [Camino B — Probar sin VPN (OEFA)](#4-camino-b--probar-sin-vpn-oefa)
5. [Dónde están los resultados](#5-dónde-están-los-resultados)
6. [Parámetros del scraper](#6-parámetros-del-scraper)
7. [Problemas frecuentes](#7-problemas-frecuentes)
8. [Ejecutar sin Docker (solo OEFA)](#8-ejecutar-sin-docker-solo-oefa)
9. [Estructura del código](#9-estructura-del-código)

---

## 1. Requisitos

- [Docker](https://docs.docker.com/engine/install/) con **Compose v2** (el comando `docker compose`, con espacio).
- Para **PJ**: nada más. El repositorio ya incluye en la carpeta `vpn/` el perfil OpenVPN, el certificado y las credenciales de prueba.

Comprueba que Docker responde:

```bash
docker --version
docker compose version
```

Si alguno de esos comandos falla, instala o actualiza Docker antes de seguir.

---

## 2. Obtener el código

```bash
git clone https://github.com/tradermoyano-cloud/scraper-challenge.git
cd scraper-challenge
```

Todos los comandos de este documento se ejecutan **desde esa carpeta**.

---

## 3. Camino A — Desafío con VPN (PJ)

El portal del Poder Judicial suele rechazar conexiones desde fuera de Perú. Por eso este camino levanta un contenedor VPN (TunnelBear, perfil Perú) y hace que el scraper salga por esa red.

Los archivos de `vpn/` ya vienen en el repo; **no** hace falta crear cuentas ni editar credenciales para la demo.

### Paso 1 — Encender la VPN

```bash
docker compose --profile pj up -d vpn
```

`--profile pj` activa los servicios del desafío PJ (VPN + scraper con VPN). `-d` los deja en segundo plano.

Sigue los logs hasta que la VPN termine de conectar:

```bash
docker logs -f scraper-challenge-vpn-1
```

Cuando aparezca la línea `Initialization Sequence Completed`, la VPN está lista. Pulsa **Ctrl+C**: solo dejas de ver los logs; el contenedor **sigue encendido**.

### Paso 2 — Ejecutar el scraper PJ

```bash
docker compose --profile pj run --rm scraper-pj
```

Qué hace por defecto: **demo acotada** — sitio PJ, 1 página, máximo 2 documentos, **con descarga de PDFs**, pausa de 1500 ms entre peticiones. No es un límite del scraper; solo un preset rápido (cupo VPN / entrega corta).

### Ampliar o cambiar la búsqueda

Con la VPN encendida (Paso 1), sustituye el comando por defecto y pasa los flags que necesites:

```bash
# Más páginas y documentos
docker compose --profile pj run --rm --entrypoint npm scraper-pj run scrape -- \
  --site pj --max-pages 5 --max-docs 20 --pdfs --delay 1500
```

```bash
# Sin tope de páginas ni documentos (recorre el listado hasta el final; puede tardar y gastar cupo VPN)
docker compose --profile pj run --rm --entrypoint npm scraper-pj run scrape -- \
  --site pj --pdfs --delay 1500
```

Filtros de búsqueda y el resto de opciones: [sección 6](#6-parámetros-del-scraper).

### Paso 3 — Revisar la salida

```bash
ls -lt output/
```

Busca la carpeta más reciente que empiece por `pj-`. Luego:

```bash
cat output/pj-<fecha>/summary.json
ls output/pj-<fecha>/pdfs/
```

Sustituye `pj-<fecha>` por el nombre real de la carpeta.

### Paso 4 — Apagar la VPN

```bash
docker compose --profile pj down
```

Detalle técnico del perfil OpenVPN: [`vpn/README.md`](vpn/README.md).

---

## 4. Camino B — Probar sin VPN (OEFA)

Úsalo para verificar que el entorno funciona. **No** enciendas la VPN ni uses el profile `pj`.

### Qué hace el comando por defecto

**Demo acotada** OEFA: 1 página, máximo 2 documentos, **con descarga de PDFs**, pausa de 600 ms entre peticiones.

### Pasos

1. Ejecuta:

```bash
docker compose run --rm scraper
```

La primera vez Docker construye la imagen; puede tardar unos minutos.

2. Mira qué se creó:

```bash
ls -lt output/
```

Debes ver una carpeta cuyo nombre empieza por `oefa-` (por ejemplo `oefa-2026-08-10T12-00-00-000Z`).

3. Abre el resumen y los PDFs:

```bash
cat output/oefa-<fecha>/summary.json
ls output/oefa-<fecha>/pdfs/
```

Sustituye `oefa-<fecha>` por el nombre exacto que mostró `ls`. En el JSON, `documentsExtracted` debería ser mayor que `0`.

---

## 5. Dónde están los resultados

Cada ejecución crea una carpeta nueva:

```text
output/<sitio>-<fecha-hora>/
```

Ejemplos: `output/oefa-2026-08-10T09-50-17-637Z/`, `output/pj-2026-08-10T09-51-31-157Z/`.

| Archivo o carpeta | Contenido |
|-------------------|-----------|
| `documents.jsonl` | Un documento por línea (JSON): metadatos extraídos del listado |
| `summary.json` | Totales de la corrida (documentos, PDFs, errores, etc.) |
| `pdfs/` | PDFs descargados en la corrida |
| `failed-pdfs.json` | Lista de PDFs que no se pudieron descargar (por ejemplo por error 429) |

Para listar corridas de más reciente a más antigua: `ls -lt output/`.

---

## 6. Parámetros del scraper

El programa se invoca así (dentro de Docker o con Node):

```text
npm run scrape -- [opciones]
```

| Parámetro | Qué controla | Valor por defecto | Notas |
|-----------|--------------|-------------------|--------|
| `--site pj` o `--site oefa` | Qué portal consultar | `oefa` | `pj` requiere VPN (Camino A) |
| `--max-pages N` | Cuántas páginas del listado recorrer como máximo | sin límite | Usa un número bajo en demos (p. ej. `1`) |
| `--max-docs N` | Cuántos documentos guardar como máximo | sin límite | Independiente de las páginas: corta al llegar a N |
| `--pdfs` | Descarga el PDF de cada documento | sí (activo) | Comportamiento por defecto de la entrega |
| `--delay MS` | Milisegundos de espera entre peticiones HTTP | `800` | Sube el valor si ves muchos 429 |
| `--retries N` | Reintentos cuando el servidor responde 429 u otro error recuperable | `5` | Tras agotarlos, el PDF falla y se anota en `failed-pdfs.json` |
| `--out DIR` | Carpeta donde escribir la salida | `output/<sitio>-<timestamp>` | Ruta relativa al directorio de trabajo |
| `--filter clave=valor` | Filtro de búsqueda del portal (se puede repetir) | ninguno | Ver claves PJ/OEFA más abajo |
| `--help` | Muestra la ayuda en consola | — | — |

### Valores que usan los servicios Docker (sin flags extra)

| Servicio | Comando efectivo | Notas |
|----------|------------------|--------|
| `scraper-pj` (Camino A) | `--site pj --max-pages 1 --max-docs 2 --pdfs --delay 1500` | **Demo acotada**, no el único modo |
| `scraper` (Camino B) | `--site oefa --max-pages 1 --max-docs 2 --pdfs --delay 600` | **Demo acotada** OEFA |

Si omites `--max-pages` y `--max-docs`, no hay tope de listado (el scraper puede seguir hasta agotar resultados).

### Cómo pasar parámetros distintos con Docker

Sustituye el comando por defecto con `--entrypoint npm` y tu lista de flags.

Para PJ, el servicio debe ser `scraper-pj` y el profile `pj` (la VPN debe estar encendida, Paso 1 del Camino A):

```bash
# PJ ampliado (ejemplo)
docker compose --profile pj run --rm --entrypoint npm scraper-pj run scrape -- \
  --site pj --max-pages 5 --max-docs 20 --pdfs --delay 1500
```

```bash
# PJ con texto y año (filtros)
docker compose --profile pj run --rm --entrypoint npm scraper-pj run scrape -- \
  --site pj --max-pages 3 --max-docs 10 --pdfs --delay 1500 \
  --filter q=homicidio --filter anio=2020
```

```bash
# OEFA: 1 página, 2 docs, con PDFs
docker compose run --rm --entrypoint npm scraper run scrape -- \
  --site oefa --max-pages 1 --max-docs 2 --pdfs --delay 600
```

### Filtros `--filter` por sitio

**PJ** (`--site pj`): `q` (texto libre), `anio`, `corte`, `distrito`, `especialidad`, `sala`.

**OEFA** (`--site oefa`): `expediente`, `administrado`, `unidad`, `sector`, `resolucion`.

### Errores 429 (demasiadas peticiones)

Si el servidor responde `429`, el scraper espera y reintenta hasta `--retries`. Si se agotan los intentos, registra el documento en `failed-pdfs.json` y sigue con el siguiente.

---

## 7. Problemas frecuentes

| Qué ves | Qué significa | Qué hacer |
|---------|---------------|-----------|
| `AUTH_FAILED` en logs de VPN | Credenciales rechazadas | Revisa `vpn/auth.txt` (email en la línea 1, password en la línea 2) |
| HTTP `403`, scrape vacío o VPN dudosa | La salida puede no estar en Perú | Espera a `Initialization Sequence Completed` y usa el diagnóstico de abajo |
| `ERROR: VPN not configured!` | Falta o está mal el perfil OpenVPN | Debe existir un único `.ovpn` sin espacios en el nombre (p. ej. `vpn/peru.ovpn`) |
| `documentsExtracted: 0` | El listado salió vacío o el portal falló | Vuelve a ejecutar; a veces la respuesta viene vacía |
| No encuentras la carpeta de salida | El nombre incluye fecha/hora exacta | Usa `ls -lt output/` y abre la carpeta concreta; no uses comodines a ciegas |
| Docker pide permisos o no encuentra Compose | Docker no está bien instalado o el usuario no está en el grupo `docker` | Revisa la instalación de Docker Desktop / Engine y Compose v2 |

### Diagnóstico local (solo si falla PJ)

No forma parte del Camino A de entrega. Úsalo en desarrollo si ves `403`, cero documentos o sospechas de la VPN:

```bash
docker compose --profile pj exec vpn sh -c \
  'wget -qO- https://ipinfo.io/country; echo; wget -S --spider https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/inicio.xhtml 2>&1 | head'
```

Esperado: línea `PE` y `HTTP/1.1 200`. Si no, revisa `docker logs scraper-challenge-vpn-1` antes de volver a lanzar `scraper-pj`.

---

## 8. Ejecutar sin Docker (solo OEFA)

Necesitas **Node.js 20 o superior** en tu máquina.

```bash
node -v          # debe mostrar v20.x o mayor
npm install
npm run demo:oefa
```

`demo:oefa` equivale a: sitio OEFA, 1 página, 2 documentos, con PDFs, delay 600 ms.

Para PJ, el camino soportado es el **Camino A** (Docker + VPN). No uses Node en el host como criterio de aceptación de PJ.

---

## 9. Estructura del código

```text
src/
  index.ts           Línea de comandos (lee los parámetros)
  scraper.ts         Orquesta paginación, límites y guardado
  http/client.ts     Cliente HTTP con cookies y reintentos ante 429
  sites/pj.ts        Adaptador del portal PJ
  sites/oefa.ts      Adaptador del portal OEFA
  pdf/downloader.ts  Descarga de PDFs
  storage/           Escritura de JSONL y summary
```

Más detalle de arquitectura: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Licencia

Uso educativo / desafío de scraping. Respeta los términos de uso de cada portal.
