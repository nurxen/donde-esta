// ─────────────────────────────────────────────────────────────
//  CONFIGURACIÓN DE FIREBASE
//  Sustituye este bloque por el que te da Firebase al registrar
//  la app web (Configuración del proyecto → Tus apps → Config).
//  Estos datos NO son secretos: es normal que estén en GitHub.
// ─────────────────────────────────────────────────────────────
export const firebaseConfig = {
  apiKey: "PEGA_AQUI_TU_API_KEY",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

// Lugares que se crean la primera vez que se da de alta la casa.
// Después se pueden renombrar, añadir o borrar desde la app.
// type: floor (planta) → room (habitación) → furniture (mueble) → spot (cajón, estante, caja…)
export const DEFAULT_PLACES = [
  { name: "Planta baja", type: "floor", icon: "0️⃣", children: [
    { name: "Jardín", icon: "🌳" },
    { name: "Terraza", icon: "☀️" },
    { name: "Cocina", icon: "🍳" },
    { name: "Salón", icon: "🛋️", children: [{ name: "Taquillón" }] },
    { name: "Despacho", icon: "💼" },
    { name: "Entrada", icon: "🚪", children: [{ name: "Mueble de la entrada" }] },
    { name: "Pasillo", icon: "🚶" }
  ]},
  { name: "Primera planta", type: "floor", icon: "1️⃣", children: [
    { name: "Habitación 1", icon: "🛏️" },
    { name: "Habitación 2", icon: "🛏️" },
    { name: "Habitación 3", icon: "🛏️" },
    { name: "Habitación 4", icon: "🛏️" }
  ]},
  { name: "Buhardilla", type: "floor", icon: "2️⃣", children: [
    { name: "Buhardilla", icon: "🏚️" },
    { name: "Trastero", icon: "📦" }
  ]},
  { name: "Sótano", type: "floor", icon: "⬇️", children: [
    { name: "Garaje", icon: "🚗" },
    { name: "Lavadero", icon: "🧺" },
    { name: "Bodega / despensa", icon: "🍷" },
    { name: "Gimnasio", icon: "🏋️" },
    { name: "Cine", icon: "🎬" }
  ]}
];

export const DEFAULT_CATEGORIES = [
  "Documentos", "Electrónica", "Cables y cargadores", "Herramientas",
  "Navidad y fiestas", "Ropa", "Deporte", "Camping y viaje",
  "Medicinas", "Papeles y garantías", "Recuerdos", "Juguetes", "Cocina", "Jardín"
];
