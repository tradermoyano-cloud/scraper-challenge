# VPN TunnelBear (OpenVPN) — perfil Perú

Esta carpeta la usa **solo el Camino A (PJ)** del [README principal](../README.md).

El contenedor Compose `vpn` monta `./vpn` en `/vpn`. **No** configures VPN con NetworkManager en el host para este proyecto.

Si solo quieres probar el scraper **sin VPN**, usa el **Camino B (OEFA)** del README: `docker compose run --rm scraper`. No necesitas esta carpeta.

## 1. Archivos (ya en el repo)

| Archivo | Contenido |
|---------|-----------|
| `peru.ovpn` | Perfil OpenVPN Perú (**sin espacios** en el nombre) |
| `openvpn-server-ca.crt` | CA referenciada por el perfil |
| `auth.txt` | Credenciales de prueba TunnelBear (email + password) |
| `README.md` | Este archivo |

`peru.ovpn` usa:

```
auth-user-pass /vpn/auth.txt
cipher AES-256-CBC
```

(OpenVPN del contenedor es 2.4.9; no uses `data-ciphers`.)

Las credenciales en `auth.txt` están pensadas para que el evaluador no configure nada. Si el repo es público, conviene rotar la password TunnelBear cuando toque.

## 2. Arranque (entrega)

Flujo para el evaluador: VPN → scraper → apagar. Sin pasos de diagnóstico.

```bash
docker compose --profile pj up -d vpn
docker logs -f scraper-challenge-vpn-1   # esperar: Initialization Sequence Completed
```

```bash
docker compose --profile pj run --rm scraper-pj
```

```bash
docker compose --profile pj down
```

### Validación local (opcional)

Solo para desarrollo o si el scrape falla (`403`, 0 docs). **No** es requisito de la entrega:

```bash
docker compose --profile pj exec vpn sh -c \
  'wget -qO- https://ipinfo.io/country; echo; wget -S --spider https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/inicio.xhtml 2>&1 | head'
```

Esperado: `PE` y HTTP **200**.

## 3. Notas

- Cupo free TunnelBear es bajo: la demo Compose usa `--max-docs 2 --pdfs`.
- `AUTH_FAILED` → credenciales o cuenta TunnelBear; revisar `auth.txt`.
