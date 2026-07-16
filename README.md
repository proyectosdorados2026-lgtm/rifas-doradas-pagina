# Sueños Dorados — Página pública

Landing estática de reserva online (Proyecto NMAX). Lista para desplegar en **Netlify**.

## Despliegue en Netlify

1. En [Netlify](https://app.netlify.com/) → **Add new site** → **Import an existing project**.
2. Conecta el repo: `https://github.com/geiner28/sue-os-dorados-pagina`
3. Configuración:
   - **Build command:** `exit 0` (o déjalo vacío; ya está en `netlify.toml`)
   - **Publish directory:** `.` (raíz del repo)
4. Deploy. La home es `index.html`.

También puedes arrastrar esta carpeta a [Netlify Drop](https://app.netlify.com/drop).

### Dominio personalizado

Si usas `sueñosdorados.com.co`, en Netlify → Domain management agrega el dominio.
Los QR con ñ se resuelven con punycode en el backend (`xn--sueosdorados-chb.com.co`).

## API

La reserva apunta al backend en `js/config.js`:

- `API_URL` — backend `/api`
- `API_KEY` — clave pública de ventas online (`PUBLIC_API_KEY` del backend)

## Estructura

```
index.html          # Landing + flujo de reserva
css/                # Estilos
js/                 # App, hero, motion, config
assets/nmax/web/    # Fotos optimizadas
logo.png / titulo.png / nmax-hero.png / nmax-silueta.png
netlify.toml        # Config Netlify
```

## Desarrollo local

```bash
python3 -m http.server 8080
```

Abre `http://localhost:8080`.
