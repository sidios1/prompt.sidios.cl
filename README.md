# PromptForge web — prompt.sidios.cl

Versión web de PromptForge: arma prompts con la estructura **Rol · Contexto · Objetivo · Salida · Restricciones**, con sugerencias según el ámbito detectado, historial local y exportación en Texto, Markdown o XML.

- Sitio estático (HTML/CSS/JS sin build) publicado con GitHub Pages en `https://prompt.sidios.cl`.
- Estética de [sidios.cl](https://sidios.cl): estilo Apple, tipografía del sistema (SF Pro), azul `#0071e3` y modo oscuro automático.
- Los prompts se guardan solo en el `localStorage` del navegador.

## Estructura

| Archivo | Contenido |
| --- | --- |
| `index.html` | Página y diálogo de ajustes |
| `assets/styles.css` | Estilos (tokens de sidios.cl) |
| `assets/data.js` | Catálogo de sugerencias por ámbito |
| `assets/engine.js` | Detección de ámbito, autocompletado y armado del prompt |
| `assets/app.js` | Estado, historial e interfaz |

## Desarrollo local

```sh
python3 -m http.server 8000
# abrir http://localhost:8000
```

## DNS

Cloudflare: registro `CNAME prompt → sidios1.github.io` (solo DNS, nube gris).
