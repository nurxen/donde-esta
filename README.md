# 🏠🔎 ¿Dónde está?

App familiar para apuntar **dónde guardáis las cosas de casa** y encontrarlas en segundos.
Funciona en iPhone y Android como una app normal (icono en la pantalla de inicio), sin pasar por la App Store, y los datos se comparten entre toda la familia.

> «¿Dónde están los pasaportes?» → **Salón › Taquillón › Cajón de arriba**

---

## Qué hace

- **Tutorial de bienvenida** la primera vez que se entra. Se puede volver a ver con el botón **?** de la pantalla de inicio o desde *Ajustes*.
- **Buscar** escribiendo o por voz 🎤. Entiende frases como «¿dónde están los pasaportes?», sin importar tildes ni plurales.
- **Guardar algo** con el botón ＋: nombre, foto opcional y sitio. El sitio se elige paso a paso
  (**Planta → Habitación → Mueble → Cajón/estante/caja**). Si el mueble o el cajón no existe, se crea en ese momento.
- **Sitios recientes**: para meter varias cosas seguidas en el mismo sitio (ideal para hacer inventario del trastero).
- **«Lo he cambiado de sitio»**: mueve una cosa y guarda el historial («antes estaba en…»).
- **Prestado**: apunta a quién se lo has dejado y se ve en la pantalla de inicio.
- **«Lo hemos tirado»**: no se borra, pasa a la lista *Tirado*. Así sabéis que ya no está y no lo buscáis.
- **Caducidades**: pon la fecha de caducidad del pasaporte, DNI, garantías… y la app avisa 60 días antes.
- **Explorar la casa**: ver qué hay en cada habitación, mueble o caja.
- **Etiquetas QR** para cajas y muebles del trastero: se imprimen, se pegan y al escanearlas se ve lo que hay dentro.
- **Aviso de duplicados**: si ya tenéis apuntado algo con el mismo nombre, os lo dice.
- **Quién y cuándo**: cada cosa indica quién la guardó o movió.
- **Funciona sin conexión** (bodega, garaje…) y se sincroniza al volver a tener cobertura.
- **Copia de seguridad**: exportar e importar todo en un archivo.

Los lugares iniciales ya vienen creados (planta baja, primera planta, buhardilla y sótano, con sus habitaciones). Todo se puede renombrar, añadir o borrar desde la app.

---

## Puesta en marcha (una sola vez, ~20 minutos, mejor desde un ordenador)

### 1. Crear la base de datos en Firebase (gratis)

1. Entra en <https://console.firebase.google.com> con tu cuenta de Google y pulsa **Crear un proyecto**.
   Ponle de nombre `donde-esta`. Puedes **desactivar Google Analytics**, no hace falta.
2. En el menú izquierdo: **Compilación → Authentication → Comenzar**.
   En **Método de acceso**, elige **Anónimo** → **Habilitar** → Guardar.
3. Menú izquierdo: **Compilación → Firestore Database → Crear base de datos**.
   - Ubicación: `europe-southwest1 (Madrid)` o `eur3 (Europa)`.
   - Modo: **producción**.
4. Dentro de Firestore, abre la pestaña **Reglas**, borra lo que haya, pega el contenido del archivo
   [`firestore.rules`](firestore.rules) de este proyecto y pulsa **Publicar**.
5. Pulsa el ⚙️ (arriba a la izquierda) → **Configuración del proyecto** → baja hasta **Tus apps** → icono **`</>`** (Web).
   Ponle un nombre (ej. `donde-esta-web`), **no** marques Hosting, y pulsa **Registrar app**.
   Te enseñará un bloque así; déjalo a mano:

   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "donde-esta-xxxx.firebaseapp.com",
     projectId: "donde-esta-xxxx",
     storageBucket: "donde-esta-xxxx.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abc123"
   };
   ```

### 2. Publicar la app en GitHub Pages

1. En GitHub, pulsa **＋ → New repository**. Nombre: `donde-esta`. Tipo: **Public** (GitHub Pages gratis lo necesita;
   el código es público, pero **los datos de casa no**: están en Firebase y solo se ven con el código familiar).
2. En el repositorio nuevo, pulsa **uploading an existing file** y arrastra **todo el contenido** de la carpeta
   `donde-esta` (archivos y carpetas `css`, `js`, `icons`). Pulsa **Commit changes**.
3. Abre `js/config.js` en GitHub → icono del lápiz ✏️ → sustituye el bloque `firebaseConfig` por el tuyo → **Commit changes**.
4. Ve a **Settings → Pages**. En *Build and deployment*: Source **Deploy from a branch**, Branch **main** y carpeta **/ (root)** → **Save**.
5. En 1–2 minutos la app estará en: `https://TU-USUARIO.github.io/donde-esta/`
6. *(Recomendado)* En Firebase → **Authentication → Configuración → Dominios autorizados** → **Agregar dominio** → `TU-USUARIO.github.io`.

### 3. Instalarla en los móviles

- **iPhone**: abre el enlace en **Safari** → botón **Compartir ⬆︎** → **Añadir a pantalla de inicio**.
- **Android**: abre el enlace en **Chrome** → menú **⋮** → **Instalar aplicación** (o «Añadir a pantalla de inicio»).

### 4. Entrar

- La **primera persona** entra con un **código familiar** inventado (largo, por ejemplo `garcia-casa-2026-azul`) y su nombre.
  La app preguntará si quiere **crear una casa nueva** → Sí.
- Los demás entran con **exactamente el mismo código** y su nombre. Desde *Ajustes → Enviar invitación* se manda por WhatsApp.

> ⚠️ El código familiar es la llave: quien tenga el enlace y el código puede ver y editar la casa. No lo publiquéis.
> Si alguien escribe un código distinto, se crearía una casa vacía distinta (la app avisa antes).

---

## Preguntas frecuentes

**¿Cuesta dinero?** No. El plan gratuito de Firebase (Spark) da de sobra: 1 GB de datos y 50.000 lecturas al día.
Cada foto ocupa unos 100–200 KB, así que caben miles.

**¿Puedo probarla antes de configurar Firebase?** Sí: sin configuración la app arranca en **modo demo** y guarda
los datos solo en ese móvil.

**¿Cómo actualizo la app?** Sube los archivos nuevos al repositorio. Los móviles se actualizan solos al abrirla con conexión.

**Escaneé una etiqueta QR en iPhone y me pide el código.** En iPhone, el QR abre Safari, que es independiente de la app
instalada. Entra una vez con el código en Safari y ya no lo volverá a pedir.

**¿Y si borro algo sin querer?** Usad «Lo hemos tirado» en vez de borrar. Y haced de vez en cuando
*Ajustes → Copia de seguridad → Exportar*.

---

## Estructura

```
index.html            Página principal
css/styles.css        Estilos (modo claro y oscuro)
js/app.js             La aplicación
js/store.js           Conexión con Firebase / modo demo
js/tutorial.js        Tutorial de bienvenida
js/config.js          ← Aquí va tu configuración de Firebase y los lugares iniciales
sw.js                 Funcionamiento sin conexión
manifest.webmanifest  Para instalarla como app
firestore.rules       Reglas de seguridad para pegar en Firebase
icons/                Iconos
```
