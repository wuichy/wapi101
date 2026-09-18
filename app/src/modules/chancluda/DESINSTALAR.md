# Chancluda — cómo eliminarla DE RAÍZ

> Pedido de Luis (18-sep-2026): "si elimino la app se vaya todo de raíz y no se
> quede ahí como código feo". Esta ficha es la receta completa. Si algún día se
> agrega un enganche nuevo fuera de esta carpeta, SE ANOTA AQUÍ en el momento.

## Qué es
Avisa por WhatsApp a Chancluda (Mar, +52 33 2609 4214) cada pedido PAGADO de
reelance, desde el número personal de Luis (integración 33). Recordatorio a los
30 min si el pedido sigue sin procesarse. Horario L-V 9:30–17:30 menos comida
(14-15) y festivos LFT; fuera de ventana encola y resume. El interruptor vive
en Apps → Chancluda.

## Su huella completa

**1. Esta carpeta (todo el código):**
```
app/src/modules/chancluda/
```

**2. Tres enganches de UNA línea fuera de la carpeta** (los tres con try/catch:
quitar la carpeta sin quitarlos NO tumba nada, solo deja un warn en el boot):

| Archivo | Qué es | Cómo encontrarlo |
|---|---|---|
| `app/server.js` | el arranque (`.init(db)`) | `grep -n chancluda server.js` |
| `app/src/modules/reelance-ia/service.js` | el evento de pedido (`.onOrderEvent`) | `grep -n chancluda …/reelance-ia/service.js` |
| `app/public/app.js` | la ficha de ayuda de su tarjeta en Apps | `grep -n chancluda public/app.js` |

**3. Sus datos en la base** (`/root/.wapi101/data/wapi101.sqlite`):
```sql
DROP TABLE IF EXISTS chancluda_avisos;  -- su cola/bitácora (la crea ella misma)
DELETE FROM app_installs WHERE app_id = (SELECT id FROM marketplace_apps WHERE slug = 'chancluda');
DELETE FROM marketplace_apps WHERE slug = 'chancluda';
```

## La receta (en orden)
1. Respaldo de la base (regla de la casa) y `git rm -r app/src/modules/chancluda`.
2. Quitar los 3 enganches de la tabla de arriba.
3. Correr el SQL del punto 3.
4. Verificar cero residuos: `grep -ri chancluda app/ | grep -v ".bak"` → vacío.
5. Si se tocó `public/app.js`: subir el `?v=` en `public/index.html` (regla del
   caché) y reiniciar `systemctl restart wapi101`.
6. Avisar a Mar por WhatsApp que ya no le llegarán estos avisos (que no crea
   que se descompuso).

## Convención para TODA app nueva de wapi (nace de esta ficha)
- Todo su código en `app/src/modules/<slug>/`.
- Enganches fuera de la carpeta: los mínimos, de UNA línea, SIEMPRE con
  try/catch, y listados en su propio `DESINSTALAR.md`.
- Sus tablas con prefijo `<slug>_` y creadas por el propio módulo
  (`CREATE TABLE IF NOT EXISTS`).
- El interruptor por el marketplace (`app_installs.enabled`), no por env ni
  por código comentado.
