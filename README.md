# PromptForge web — prompt.sidios.cl

Versión web de PromptForge: arma prompts con la estructura **Rol · Contexto · Objetivo · Salida · Restricciones**, con predicción en línea (texto fantasma que se acepta con Tab o →) según el ámbito, el contexto y un diccionario, historial local y salida adaptada a cada plataforma: Claude (XML), Gemini y ChatGPT (Markdown, cada uno con el orden que recomienda su guía).

- Sitio estático (HTML/CSS/JS sin build) publicado con GitHub Pages en `https://prompt.sidios.cl`.
- Estética de [sidios.cl](https://sidios.cl): estilo Apple, tipografía del sistema (SF Pro), azul `#0071e3` y modo oscuro automático.
- Los prompts se guardan solo en el `localStorage` del navegador.
- Editor visual de ecuaciones (botón «∑ Ecuación» en cada campo salvo Rol): usa [MathLive](https://github.com/arnog/mathlive) (MIT), cargado desde jsDelivr solo al abrirlo, e inserta la fórmula como LaTeX entre `$…$` o `$$…$$`. Sin conexión al CDN cae a un campo de LaTeX.

## Estructura

| Archivo | Contenido |
| --- | --- |
| `index.html` | Página y diálogo de ajustes |
| `assets/styles.css` | Estilos (tokens de sidios.cl) |
| `assets/data.js` | Catálogo de frases por ámbito |
| `assets/lexicon-freq.js` | ~32.000 palabras del español por frecuencia (generado) |
| `assets/lexicon.js` | Vocabulario propio: prompts, profesiones y términos técnicos |
| `assets/math.js` | Editor visual de ecuaciones (MathLive) y conversión a LaTeX |
| `assets/engine.js` | Detección de ámbito, modelo predictivo (vocabulario y n-gramas) y armado del prompt |
| `assets/app.js` | Estado, historial e interfaz |

## Desarrollo local

```sh
python3 -m http.server 8000
# abrir http://localhost:8000
```

## DNS

Cloudflare: registro `CNAME prompt → sidios1.github.io` (solo DNS, nube gris).

## Créditos

La lista de frecuencias de `assets/lexicon-freq.js` proviene de
[FrequencyWords](https://github.com/hermitdave/FrequencyWords) de Hermit Dave (lista `es_50k`,
OpenSubtitles 2018), con licencia [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
Se filtró para quitar nombres propios en inglés, groserías y palabras de menos de 3 letras.
