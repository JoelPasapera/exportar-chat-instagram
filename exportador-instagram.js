// @ts-check
/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 *  EXPORTADOR DE CHATS DE INSTAGRAM · v1.0.0
 *  Descarga la conversación que tienes abierta en instagram.com.
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 *
 *  USO
 *   1. Abre la conversación en instagram.com (la dirección debe contener /direct/t/…).
 *   2. Abre la consola (F12 → «Consola»), pega TODO este archivo y pulsa Enter.
 *      Chrome puede pedirte escribir «allow pasting» la primera vez.
 *   3. Al terminar se descarga un .zip con:
 *        chat.html  → para leer: burbujas, fotos, videos, días y buscador
 *        chat.json  → datos estructurados (fecha ISO de cada mensaje)
 *        chat.txt   → texto plano agrupado por día
 *        media/     → fotos, videos, audios y stickers que se pudieron descargar
 *      Descomprime el ZIP antes de abrir chat.html (las fotos van en media/).
 *
 *  POR QUÉ ES RÁPIDO
 *   No recorre el chat con scroll. Le pide el historial directamente al servidor de Instagram,
 *   con la misma consulta que usa la página cuando subes por el chat. Instagram entrega como
 *   máximo 20 mensajes por petición, así que 1 000 mensajes son 50 peticiones: unos 20 segundos
 *   al ritmo por defecto, si Instagram responde con normalidad.
 *   Puedes cambiar de pestaña mientras trabaja; no cierres ni recargues la de Instagram.
 *
 *  SOLO UNA PARTE (todavía más rápido): edita CONFIG, justo debajo, antes de pegar.
 *   ultimosMensajes: 500          → solo los 500 mensajes más recientes
 *   desde: '2026-01-01'           → solo desde esa fecha; deja de pedir historial al llegar a ella
 *   hasta: '2026-06-30'           → solo hasta esa fecha
 *   descargarMultimedia: false    → solo texto
 *
 *  CONTROL DESDE LA CONSOLA (o con los botones del panel)
 *   exportadorInstagram.detener()      → deja de cargar y descarga lo capturado, marcado como parcial
 *   exportadorInstagram.cancelar()     → aborta sin descargar nada
 *   exportadorInstagram.diagnostico()  → informe técnico sin textos, nombres ni credenciales.
 *                                        Si algo falla, cópialo con copy(exportadorInstagram.diagnostico())
 *
 *  QUÉ HACE Y QUÉ NO
 *   · Solo lee. No envía mensajes, no marca nada como leído y no cambia nada de tu cuenta.
 *   · Todo ocurre en tu navegador: los datos van de Instagram a tu disco, sin pasar por otro servidor.
 *   · Usa la API interna de la web de Instagram, que no es pública y puede cambiar. Para aguantar
 *     esos cambios, el script lee de la propia página los identificadores vigentes de cada consulta.
 *   · Va a un ritmo moderado y, si Instagram pide ir más despacio, espera y continúa.
 *   · Las fotos y videos «de ver una vez» no se guardan: quedan anotados, sin el archivo.
 *
 *  DISEÑO
 *   · Módulos de una sola responsabilidad (cada sección de este archivo es uno), con JSDoc y @ts-check.
 *   · ZIP sin compresión escrito desde cero y CRC-32 «slice-by-8»: la multimedia ya viene comprimida.
 *   · Sin innerHTML, sin estilos en línea y sin dependencias: funciona aunque la página los prohíba.
 *   · Sin exportaciones parciales calladas: si algo impide llegar al primer mensaje, el ZIP se
 *     llama «…-PARCIAL» y el motivo queda escrito en los tres archivos.
 */
(() => {
'use strict';

// ═══ MÓDULO configuracion ════════════════════════════════════════════════════════════════════════════

/**
 * @file Opciones del exportador.
 * Responsabilidad única: declarar los valores por defecto que la persona puede editar.
 */

const VERSION = '1.0.0';

/**
 * CONFIG: edita estos valores ANTES de pegar el script si no quieres el chat completo.
 *
 * También puedes dejarlos como están y escribir en la consola, antes de pegar, por ejemplo:
 *   CONFIG_EXPORTADOR_INSTAGRAM = { desde: '2026-01-01', descargarMultimedia: false }
 *
 * @type {Configuracion}
 */
const CONFIG = {
  // Solo los N mensajes más recientes. 0 = todo el historial.
  ultimosMensajes: 0,

  // Solo desde este día (incluido), con formato 'AAAA-MM-DD'. '' = desde el primer mensaje.
  // Es lo que más tiempo ahorra: el script deja de pedir historial al llegar a esa fecha.
  desde: '',

  // Solo hasta este día (incluido), con formato 'AAAA-MM-DD'. '' = hasta el último mensaje.
  hasta: '',

  // false = solo texto: no baja fotos, videos ni audios (ZIP mínimo y mucho más rápido).
  descargarMultimedia: true,

  // true = baja también la miniatura de los reels y publicaciones compartidos.
  // Por defecto se guarda solo su enlace, que no caduca, porque un chat puede tener miles.
  miniaturasDeCompartidos: false,

  // Tope total de multimedia dentro del ZIP, en MB. Lo que no quepa queda anotado como «no descargado».
  limiteMultimediaMB: 2000,

  // Archivos multimedia que se bajan a la vez.
  descargasSimultaneas: 6,

  // Respiro entre dos peticiones de historial, en milisegundos. Instagram entrega 20 mensajes
  // por petición; con 150 ms salen unos 50 mensajes por segundo. 0 = sin respiro.
  pausaEntrePaginasMs: 150,
};

/**
 * Ajustes internos. Cambian plazos y reintentos; no hace falta tocarlos.
 * @type {AjustesAvanzados}
 */
const AJUSTES_AVANZADOS = {
  mensajesPorPagina: 20,
  variacionPausaMs: 90,
  tiempoLimitePeticionMs: 30000,
  tiempoLimiteDescargaMs: 120000,
  esperasPorLimiteS: [30, 60, 120, 240],
  pausaMinimaTrasLimiteMs: 1000,
  esperasPorFalloDeRedS: [1, 2, 4, 8, 16],
  paginasSinNovedadMaximas: 5,
  fallosSeguidosPorServidor: 3,
  archivosMaximosEnZip: 60000,
};

// ═══ MÓDULO tipos ════════════════════════════════════════════════════════════════════════════════════

/**
 * @file Tipos compartidos por todos los módulos.
 * Responsabilidad única: describir con JSDoc la forma de los datos. No genera código.
 */

/**
 * Opciones que la persona edita en CONFIG antes de pegar el script.
 * @typedef {Object} Configuracion
 * @property {number} ultimosMensajes          Cuántos mensajes recientes exportar. 0 = todos.
 * @property {string} desde                    'AAAA-MM-DD' o ''. Exporta desde ese día (incluido).
 * @property {string} hasta                    'AAAA-MM-DD' o ''. Exporta hasta ese día (incluido).
 * @property {boolean} descargarMultimedia     false = solo texto (ZIP mínimo y más rápido).
 * @property {boolean} miniaturasDeCompartidos true = baja también la miniatura de reels y publicaciones compartidas.
 * @property {number} limiteMultimediaMB       Tope total de multimedia dentro del ZIP.
 * @property {number} descargasSimultaneas     Archivos multimedia que se bajan a la vez.
 * @property {number} pausaEntrePaginasMs      Respiro entre dos peticiones de historial.
 */

/**
 * Ajustes internos. No hace falta tocarlos; las pruebas los acortan.
 * @typedef {Object} AjustesAvanzados
 * @property {number} mensajesPorPagina        Instagram entrega 20 como máximo, pida uno lo que pida.
 * @property {number} variacionPausaMs         Azar que se suma a la pausa para no pedir a ritmo fijo.
 * @property {number} tiempoLimitePeticionMs   Plazo de una petición de historial.
 * @property {number} tiempoLimiteDescargaMs   Plazo de la descarga de un archivo multimedia.
 * @property {number[]} esperasPorLimiteS      Esperas sucesivas cuando Instagram pide ir más despacio.
 * @property {number} pausaMinimaTrasLimiteMs  Respiro mínimo entre peticiones después de uno de esos avisos.
 * @property {number[]} esperasPorFalloDeRedS  Esperas sucesivas ante un fallo de red o un error 5xx.
 * @property {number} paginasSinNovedadMaximas Páginas seguidas sin mensajes nuevos antes de dar el historial por atascado.
 * @property {number} fallosSeguidosPorServidor Fallos de red seguidos tras los que un servidor de multimedia se da por bloqueado.
 * @property {number} archivosMaximosEnZip     Tope de entradas del ZIP clásico (sin ZIP64).
 */

/**
 * Opciones ya validadas y convertidas a valores listos para usar.
 * @typedef {Object} Opciones
 * @property {number} ultimosMensajes
 * @property {number | null} desdeMs           Inicio del día `desde` en hora local, o null.
 * @property {number | null} hastaMs           Final del día `hasta` en hora local, o null.
 * @property {string} desdeTexto
 * @property {string} hastaTexto
 * @property {boolean} descargarMultimedia
 * @property {boolean} miniaturasDeCompartidos
 * @property {number} limiteMultimediaBytes
 * @property {number} descargasSimultaneas
 * @property {number} pausaEntrePaginasMs
 * @property {AjustesAvanzados} avanzado
 */

/**
 * Objeto tal como lo entrega Instagram. Su forma no está documentada y cambia sin aviso,
 * así que se lee siempre con comprobaciones.
 * @typedef {Record<string, any>} Crudo
 */

/** @typedef {'imagen' | 'video' | 'audio' | 'animacion' | 'sticker' | 'miniatura'} ClaseAdjunto */

/** @typedef {'pendiente' | 'descargado' | 'fallido' | 'omitido'} EstadoAdjunto */

/**
 * Archivo multimedia de un mensaje.
 * @typedef {Object} Adjunto
 * @property {ClaseAdjunto} clase
 * @property {string} url               Dirección de origen en los servidores de Instagram (caduca).
 * @property {string[]} urlsAlternas    Direcciones de respaldo que da Instagram para el mismo archivo.
 * @property {number} ancho
 * @property {number} alto
 * @property {number} duracionMs
 * @property {string} textoAlternativo
 * @property {EstadoAdjunto} estado
 * @property {string} motivo            Por qué no se descargó, en palabras llanas.
 * @property {string} archivo           Ruta dentro del ZIP ('' si no se descargó).
 * @property {number} bytes
 * @property {string} tipoMime
 */

/**
 * Tarjeta de contenido compartido: reel, publicación, historia, perfil, enlace o canción.
 * @typedef {Object} Compartido
 * @property {string} url
 * @property {string} titulo
 * @property {string} subtitulo
 * @property {string} autor
 * @property {string} descripcion
 * @property {string} cita              Texto citado (por ejemplo, la historia a la que se responde).
 * @property {Adjunto | null} miniatura
 */

/**
 * Mensaje al que otro mensaje responde.
 * @typedef {Object} Cita
 * @property {string} idMensaje
 * @property {string} idRemitente
 * @property {string} resumen
 */

/**
 * @typedef {Object} Reaccion
 * @property {string} emoji
 * @property {string} idRemitente
 * @property {number} marcaTiempoMs
 */

/**
 * @typedef {'texto' | 'foto' | 'video' | 'album' | 'audio' | 'gif' | 'sticker' | 'compartido' | 'musica'
 *   | 'efimero' | 'llamada' | 'sistema' | 'ia' | 'desconocido'} TipoMensaje
 */

/**
 * Mensaje ya normalizado: el modelo propio del exportador.
 * @typedef {Object} Mensaje
 * @property {string} id
 * @property {string} idAlterno         Segundo identificador que Instagram da al mismo mensaje ('' si no hay).
 * @property {number} marcaTiempoMs
 * @property {string} idRemitente       Identificador de mensajería de quien lo envió.
 * @property {TipoMensaje} tipo
 * @property {string} tipoOriginal      `content.__typename` de Instagram, para diagnóstico.
 * @property {string} texto
 * @property {Adjunto[]} adjuntos
 * @property {Compartido | null} compartido
 * @property {Cita | null} respuestaA
 * @property {Reaccion[]} reacciones
 * @property {boolean} editado
 * @property {boolean} reenviado
 * @property {Crudo | null} crudo       Contenido original; solo se conserva en los tipos que no se reconocen.
 */

/**
 * @typedef {Object} Participante
 * @property {string} id                Identificador de mensajería.
 * @property {string} idInstagram       Identificador de la cuenta.
 * @property {string} nombre
 * @property {string} usuario
 * @property {string} apodo
 * @property {boolean} esYo
 */

/**
 * Identidad de quien exporta, leída de la página.
 * @typedef {Object} IdentidadPropia
 * @property {string} idMensajeria
 * @property {string} idInstagram
 * @property {string} nombre
 * @property {string} usuario
 */

/**
 * Página de historial ya localizada dentro de una respuesta.
 * @typedef {Object} PaginaMensajes
 * @property {Crudo[]} nodos            Mensajes crudos, del más nuevo al más antiguo.
 * @property {string} cursorSiguiente   Marca para pedir la página anterior ('' si no hay).
 * @property {boolean} hayMas
 */

/**
 * Datos generales de la conversación.
 * @typedef {Object} DatosConversacion
 * @property {string} clave             Identificador que aparece en la dirección /direct/t/….
 * @property {string} idHilo
 * @property {string} titulo
 * @property {boolean} esGrupo
 */

/**
 * Cómo terminó la carga del historial.
 * @typedef {Object} EstadoFinal
 * @property {boolean} completa         true si se obtuvo todo lo pedido.
 * @property {string} motivoParcial     Explicación cuando no es completa ('' si lo es).
 * @property {number} paginas
 * @property {number} duracionMs
 * @property {Record<string, number>} descartados  Filas que Instagram envió y no son mensajes.
 * @property {Record<string, number>} tiposDesconocidos
 */

/**
 * Resultado de la multimedia.
 * @typedef {Object} ResumenMultimedia
 * @property {number} descargados
 * @property {number} fallidos
 * @property {number} omitidos
 * @property {number} bytes
 * @property {Record<string, number>} motivos
 */

/**
 * Todo lo que necesitan los serializadores para escribir un archivo de salida.
 * @typedef {Object} ContextoSalida
 * @property {string} version
 * @property {number} exportadoMs
 * @property {string} zonaHoraria                  Zona horaria del equipo, para explicar las horas.
 * @property {DatosConversacion} conversacion
 * @property {Participante[]} participantes
 * @property {Mensaje[]} mensajes                  En orden cronológico.
 * @property {(id: string) => string} nombreDe     Nombre para mostrar de un participante.
 * @property {(id: string) => boolean} esYo
 * @property {Map<string, number>} indicePorId     Posición de cada mensaje dentro de `mensajes`.
 * @property {Opciones} opciones
 * @property {EstadoFinal} estado
 * @property {ResumenMultimedia} multimedia
 */

// ═══ MÓDULO errores ══════════════════════════════════════════════════════════════════════════════════

/**
 * @file Errores propios del exportador.
 * Responsabilidad única: dar a cada fallo un código estable y un mensaje que diga qué hacer.
 */

/**
 * @typedef {'CONFIG' | 'SIN_CHAT' | 'SIN_SESION' | 'RED' | 'LIMITE' | 'GRAPHQL'
 *   | 'HILO_NO_ENCONTRADO' | 'DETENIDO' | 'CANCELADO' | 'INTERNO'} CodigoError
 */

/**
 * Error con código. El mensaje va dirigido a la persona: explica qué pasó y cómo seguir.
 */
class ErrorExportacion extends Error {
  /**
   * @param {CodigoError} codigo
   * @param {string} mensaje
   */
  constructor(codigo, mensaje) {
    super(mensaje);
    this.name = 'ErrorExportacion';
    /** @type {CodigoError} */
    this.codigo = codigo;
  }
}

/**
 * Indica si un valor capturado es un error del exportador con el código dado.
 * @param {unknown} error
 * @param {CodigoError} codigo
 * @returns {boolean}
 */
function esErrorDeCodigo(error, codigo) {
  if (!(error instanceof ErrorExportacion)) {
    return false;
  }

  return error.codigo === codigo;
}

/**
 * Convierte cualquier valor capturado en un texto corto para mostrar o registrar.
 * @param {unknown} error
 * @returns {string}
 */
function describirError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

// ═══ MÓDULO utilidades ═══════════════════════════════════════════════════════════════════════════════

/**
 * @file Funciones pequeñas sin estado que usan varios módulos.
 * Responsabilidad única: leer valores de forma segura y dar formato a textos y cifras.
 */

/**
 * Indica si un valor es un objeto simple (no null, no lista).
 * @param {unknown} valor
 * @returns {valor is Record<string, any>}
 */
function esObjeto(valor) {
  if (valor === null || typeof valor !== 'object') {
    return false;
  }

  return !Array.isArray(valor);
}

/**
 * Devuelve el valor como texto. Lo que no es texto ni número se convierte en ''.
 * @param {unknown} valor
 * @returns {string}
 */
function aTexto(valor) {
  if (typeof valor === 'string') {
    return valor;
  }

  if (typeof valor === 'number' && Number.isFinite(valor)) {
    return String(valor);
  }

  return '';
}

/**
 * Devuelve el valor como entero. Instagram envía las marcas de tiempo como texto.
 * @param {unknown} valor
 * @returns {number} 0 si no es un número válido.
 */
function aEntero(valor) {
  let numero = Number.NaN;

  if (typeof valor === 'number') {
    numero = valor;
  } else if (typeof valor === 'string' && valor !== '') {
    numero = Number(valor);
  }

  if (!Number.isFinite(numero)) {
    return 0;
  }

  return Math.trunc(numero);
}

/**
 * Devuelve siempre una lista: la propia lista, una lista con el objeto suelto, o una lista vacía.
 * Instagram entrega algunos campos unas veces como lista y otras como objeto único.
 * @param {unknown} valor
 * @returns {any[]}
 */
function aLista(valor) {
  if (Array.isArray(valor)) {
    return valor;
  }

  if (esObjeto(valor)) {
    return [valor];
  }

  return [];
}

/**
 * Número al azar entre 0 y el máximo (sin incluirlo).
 * @param {number} maximo
 * @returns {number}
 */
function azarHasta(maximo) {
  return Math.random() * Math.max(0, maximo);
}

/** @type {Record<string, string>} */
const ENTIDADES_HTML = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapa un texto para insertarlo en HTML, tanto en contenido como en atributos.
 * @param {string} texto
 * @returns {string}
 */
function escaparHtml(texto) {
  return texto.replace(/[&<>"']/g, (caracter) => ENTIDADES_HTML[caracter]);
}

/**
 * Acorta un texto a un máximo de caracteres visibles y avisa del corte con «…».
 * Corta por puntos de código para no partir un emoji por la mitad.
 * @param {string} texto
 * @param {number} maximo
 * @returns {string}
 */
function recortar(texto, maximo) {
  if (texto.length <= maximo) {
    return texto;
  }

  const puntos = Array.from(texto);

  if (puntos.length <= maximo) {
    return texto;
  }

  return `${puntos.slice(0, maximo).join('').trimEnd()}…`;
}

/**
 * Une en una sola línea un texto con saltos, para usarlo en resúmenes.
 * @param {string} texto
 * @returns {string}
 */
function enUnaLinea(texto) {
  return texto.replace(/\s+/g, ' ').trim();
}

/**
 * Formatea un entero con separador de miles fino («12 345»).
 * @param {number} numero
 * @returns {string}
 */
function formatearEntero(numero) {
  const texto = String(Math.round(numero));

  return texto.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Formatea un tamaño en bytes con la unidad más cómoda.
 * @param {number} bytes
 * @returns {string}
 */
function formatearBytes(bytes) {
  const UNIDADES = ['B', 'KB', 'MB', 'GB'];
  let valor = Math.max(0, bytes);
  let indice = 0;

  while (valor >= 1024 && indice < UNIDADES.length - 1) {
    valor /= 1024;
    indice += 1;
  }

  const decimales = indice === 0 || valor >= 100 ? 0 : 1;

  return `${valor.toFixed(decimales).replace('.', ',')} ${UNIDADES[indice]}`;
}

/**
 * Formatea una duración para leerla de un vistazo («42 s», «3 min 05 s»).
 * @param {number} milisegundos
 * @returns {string}
 */
function formatearDuracion(milisegundos) {
  const segundosTotales = Math.max(0, Math.round(milisegundos / 1000));

  if (segundosTotales < 60) {
    return `${segundosTotales} s`;
  }

  const minutos = Math.floor(segundosTotales / 60);
  const segundos = segundosTotales % 60;

  return `${minutos} min ${String(segundos).padStart(2, '0')} s`;
}

/**
 * Valida una dirección y la devuelve absoluta. Solo se aceptan http y https:
 * así ninguna dirección del chat puede ejecutar código en el HTML exportado.
 * @param {unknown} valor
 * @param {string} [base] Origen con el que resolver direcciones relativas.
 * @returns {string} '' si no es una dirección aceptable.
 */
function urlSegura(valor, base = 'https://www.instagram.com') {
  const texto = aTexto(valor).trim();

  if (texto === '') {
    return '';
  }

  try {
    const url = new URL(texto, base);

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return '';
    }

    return url.href;
  } catch {
    return '';
  }
}

/**
 * Convierte un título en un trozo de nombre de archivo: sin acentos, sin símbolos, con guiones.
 * @param {string} texto
 * @param {number} [maximo]
 * @returns {string}
 */
function crearSlug(texto, maximo = 40) {
  const sinAcentos = texto.normalize('NFD').replace(/\p{M}/gu, '');
  const limpio = sinAcentos.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const corto = limpio.slice(0, maximo).replace(/-+$/g, '');

  if (corto === '') {
    return 'chat';
  }

  return corto;
}

// ═══ MÓDULO fechas ═══════════════════════════════════════════════════════════════════════════════════

/**
 * @file Fechas en la hora local del navegador y en español.
 * Responsabilidad única: interpretar las fechas de CONFIG y dar formato a las marcas de tiempo.
 */

/**
 * Rellena con un cero a la izquierda hasta dos cifras.
 * @param {number} numero
 * @returns {string}
 */
function dosCifras(numero) {
  return String(numero).padStart(2, '0');
}

/**
 * Interpreta un día 'AAAA-MM-DD' en hora local.
 * @param {string} texto
 * @param {boolean} finDelDia true devuelve el último milisegundo del día.
 * @returns {number | null} Marca de tiempo en milisegundos, o null si el texto no es un día válido.
 */
function interpretarDiaLocal(texto, finDelDia) {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto.trim());

  if (partes === null) {
    return null;
  }

  const anio = Number(partes[1]);
  const mes = Number(partes[2]);
  const dia = Number(partes[3]);
  const fecha = new Date(anio, mes - 1, dia, 0, 0, 0, 0);

  // Date acepta «31 de febrero» y lo desborda al mes siguiente: se comprueba que no haya ocurrido.
  const esFechaReal = fecha.getFullYear() === anio && fecha.getMonth() === mes - 1 && fecha.getDate() === dia;

  if (!esFechaReal) {
    return null;
  }

  if (finDelDia) {
    fecha.setHours(23, 59, 59, 999);
  }

  return fecha.getTime();
}

/**
 * Clave de día en hora local: 'AAAA-MM-DD'.
 * @param {number} marcaTiempoMs
 * @returns {string}
 */
function claveDeDia(marcaTiempoMs) {
  const fecha = new Date(marcaTiempoMs);

  return `${fecha.getFullYear()}-${dosCifras(fecha.getMonth() + 1)}-${dosCifras(fecha.getDate())}`;
}

/**
 * Clave de mes en hora local: 'AAAA-MM'.
 * @param {number} marcaTiempoMs
 * @returns {string}
 */
function claveDeMes(marcaTiempoMs) {
  return claveDeDia(marcaTiempoMs).slice(0, 7);
}

/**
 * Hora local en formato de 24 horas: 'HH:MM'.
 * @param {number} marcaTiempoMs
 * @returns {string}
 */
function hora(marcaTiempoMs) {
  const fecha = new Date(marcaTiempoMs);

  return `${dosCifras(fecha.getHours())}:${dosCifras(fecha.getMinutes())}`;
}

/**
 * Fecha local corta: 'DD/MM/AAAA'.
 * @param {number} marcaTiempoMs
 * @returns {string}
 */
function fechaCorta(marcaTiempoMs) {
  const fecha = new Date(marcaTiempoMs);

  return `${dosCifras(fecha.getDate())}/${dosCifras(fecha.getMonth() + 1)}/${fecha.getFullYear()}`;
}

/**
 * Fecha y hora locales cortas: 'DD/MM/AAAA HH:MM'.
 * @param {number} marcaTiempoMs
 * @returns {string}
 */
function fechaHoraCorta(marcaTiempoMs) {
  return `${fechaCorta(marcaTiempoMs)} ${hora(marcaTiempoMs)}`;
}

/**
 * Fecha y hora locales con segundos, ordenable como texto: 'AAAA-MM-DD HH:MM:SS'.
 * @param {number} marcaTiempoMs
 * @returns {string}
 */
function fechaHoraLocalOrdenable(marcaTiempoMs) {
  const fecha = new Date(marcaTiempoMs);

  return `${claveDeDia(marcaTiempoMs)} ${hora(marcaTiempoMs)}:${dosCifras(fecha.getSeconds())}`;
}

/** @type {Intl.DateTimeFormat | null} */
let formatoDiaLargo = null;

/** @type {Intl.DateTimeFormat | null} */
let formatoMesLargo = null;

/** @type {Intl.DateTimeFormat | null} */
let formatoDiaDeLaSemana = null;

/**
 * Día completo en español: «miércoles, 3 de enero de 2024».
 * @param {number} marcaTiempoMs
 * @returns {string}
 */
function diaLargo(marcaTiempoMs) {
  if (formatoDiaLargo === null) {
    formatoDiaLargo = new Intl.DateTimeFormat('es', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  return formatoDiaLargo.format(new Date(marcaTiempoMs));
}

/**
 * Mes y año en español: «enero de 2024».
 * @param {number} marcaTiempoMs
 * @returns {string}
 */
function mesLargo(marcaTiempoMs) {
  if (formatoMesLargo === null) {
    formatoMesLargo = new Intl.DateTimeFormat('es', { month: 'long', year: 'numeric' });
  }

  return formatoMesLargo.format(new Date(marcaTiempoMs));
}

/**
 * Día de la semana en español: «miércoles».
 * @param {number} marcaTiempoMs
 * @returns {string}
 */
function diaDeLaSemana(marcaTiempoMs) {
  if (formatoDiaDeLaSemana === null) {
    formatoDiaDeLaSemana = new Intl.DateTimeFormat('es', { weekday: 'long' });
  }

  return formatoDiaDeLaSemana.format(new Date(marcaTiempoMs));
}

/**
 * Zona horaria del equipo («America/Lima»), para explicar a qué hora corresponden las fechas.
 * @returns {string}
 */
function zonaHorariaLocal() {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'hora local';
  } catch {
    return 'hora local';
  }
}

// ═══ MÓDULO opciones ═════════════════════════════════════════════════════════════════════════════════

/**
 * @file Validación de las opciones.
 * Responsabilidad única: convertir CONFIG (y lo que la persona escriba en la consola)
 * en opciones comprobadas, o explicar con claridad qué valor está mal.
 */

/** Tope de un ZIP clásico sin ZIP64, con margen para los archivos de texto. */
const LIMITE_MULTIMEDIA_MAXIMO_MB = 3500;

/**
 * Lee un número entero dentro de un rango, o lanza un error que nombra la opción.
 * @param {string} nombre
 * @param {unknown} valor
 * @param {number} minimo
 * @param {number} maximo
 * @returns {number}
 */
function leerEntero(nombre, valor, minimo, maximo) {
  const esValido = typeof valor === 'number' && Number.isInteger(valor) && valor >= minimo && valor <= maximo;

  if (!esValido) {
    throw new ErrorExportacion(
      'CONFIG',
      `La opción «${nombre}» debe ser un número entero entre ${minimo} y ${maximo}. Recibí: ${JSON.stringify(valor)}.`,
    );
  }

  return /** @type {number} */ (valor);
}

/**
 * Lee un valor verdadero o falso, o lanza un error que nombra la opción.
 * @param {string} nombre
 * @param {unknown} valor
 * @returns {boolean}
 */
function leerBooleano(nombre, valor) {
  if (typeof valor !== 'boolean') {
    throw new ErrorExportacion(
      'CONFIG',
      `La opción «${nombre}» debe ser true o false. Recibí: ${JSON.stringify(valor)}.`,
    );
  }

  return valor;
}

/**
 * Lee un día 'AAAA-MM-DD' opcional.
 * @param {string} nombre
 * @param {unknown} valor
 * @param {boolean} finDelDia
 * @returns {number | null} null si la opción está vacía.
 */
function leerDia(nombre, valor, finDelDia) {
  if (valor === '' || valor === null || valor === undefined) {
    return null;
  }

  let marca = null;

  if (typeof valor === 'string') {
    marca = interpretarDiaLocal(valor, finDelDia);
  }

  if (marca === null) {
    throw new ErrorExportacion(
      'CONFIG',
      `La opción «${nombre}» debe ser un día con formato 'AAAA-MM-DD' (por ejemplo '2026-03-15') o quedar vacía. Recibí: ${JSON.stringify(valor)}.`,
    );
  }

  return marca;
}

/**
 * Mezcla los ajustes avanzados por defecto con los que se hayan pasado desde fuera.
 * @param {AjustesAvanzados} base
 * @param {unknown} externos
 * @returns {AjustesAvanzados}
 */
function mezclarAvanzados(base, externos) {
  /** @type {Record<string, unknown>} */
  const mezcla = { ...base };

  if (esObjeto(externos)) {
    for (const clave of Object.keys(base)) {
      if (externos[clave] !== undefined) {
        mezcla[clave] = externos[clave];
      }
    }
  }

  return /** @type {AjustesAvanzados} */ (mezcla);
}

/**
 * Valida y resuelve las opciones de una exportación.
 * @param {Configuracion} config        CONFIG del propio script.
 * @param {AjustesAvanzados} avanzados  Ajustes internos por defecto.
 * @param {unknown} externa             Lo que haya en `CONFIG_EXPORTADOR_INSTAGRAM`, si existe.
 * @returns {Opciones}
 * @throws {ErrorExportacion} con código CONFIG si algún valor no es válido.
 */
function resolverOpciones(config, avanzados, externa) {
  /** @type {Record<string, unknown>} */
  const mezcla = { ...config };
  let avanzadosExternos = null;

  if (esObjeto(externa)) {
    for (const clave of Object.keys(config)) {
      if (externa[clave] !== undefined) {
        mezcla[clave] = externa[clave];
      }
    }
    avanzadosExternos = externa.avanzado;
  }

  const desdeMs = leerDia('desde', mezcla.desde, false);
  const hastaMs = leerDia('hasta', mezcla.hasta, true);

  if (desdeMs !== null && hastaMs !== null && desdeMs > hastaMs) {
    throw new ErrorExportacion('CONFIG', 'La fecha «desde» es posterior a la fecha «hasta»: no hay ningún día entre las dos.');
  }

  const limiteMB = leerEntero('limiteMultimediaMB', mezcla.limiteMultimediaMB, 0, LIMITE_MULTIMEDIA_MAXIMO_MB);

  return {
    ultimosMensajes: leerEntero('ultimosMensajes', mezcla.ultimosMensajes, 0, 100000000),
    desdeMs,
    hastaMs,
    desdeTexto: desdeMs === null ? '' : String(mezcla.desde),
    hastaTexto: hastaMs === null ? '' : String(mezcla.hasta),
    descargarMultimedia: leerBooleano('descargarMultimedia', mezcla.descargarMultimedia),
    miniaturasDeCompartidos: leerBooleano('miniaturasDeCompartidos', mezcla.miniaturasDeCompartidos),
    limiteMultimediaBytes: limiteMB * 1024 * 1024,
    descargasSimultaneas: leerEntero('descargasSimultaneas', mezcla.descargasSimultaneas, 1, 16),
    pausaEntrePaginasMs: leerEntero('pausaEntrePaginasMs', mezcla.pausaEntrePaginasMs, 0, 60000),
    avanzado: mezclarAvanzados(avanzados, avanzadosExternos),
  };
}

// ═══ MÓDULO cola-circular ════════════════════════════════════════════════════════════════════════════

/**
 * @file Cola FIFO sobre un búfer circular que crece al doble cuando se llena.
 * Responsabilidad única: encolar y desencolar en tiempo constante.
 *
 * Por qué no `Array.prototype.shift()`: desplaza todos los elementos en cada extracción.
 * Con decenas de miles de descargas pendientes eso se vuelve cuadrático; aquí solo se
 * mueven dos índices.
 */

/**
 * @template T
 */
class ColaCircular {
  /** @type {(T | undefined)[]} */
  #celdas;

  /** Índice de la próxima celda a leer. */
  #cabeza = 0;

  /** Cantidad de elementos guardados. */
  #cantidad = 0;

  /**
   * @param {number} [capacidadInicial] Se redondea hacia arriba a una potencia de dos.
   */
  constructor(capacidadInicial = 16) {
    let capacidad = 2;

    while (capacidad < capacidadInicial) {
      capacidad *= 2;
    }

    this.#celdas = new Array(capacidad).fill(undefined);
  }

  /** @returns {number} */
  get longitud() {
    return this.#cantidad;
  }

  /**
   * Añade un elemento al final.
   * @param {T} elemento
   * @returns {void}
   */
  encolar(elemento) {
    if (this.#cantidad === this.#celdas.length) {
      this.#duplicar();
    }

    // La capacidad es potencia de dos: la máscara equivale al resto de la división y es más barata.
    const mascara = this.#celdas.length - 1;
    const posicion = (this.#cabeza + this.#cantidad) & mascara;

    this.#celdas[posicion] = elemento;
    this.#cantidad += 1;
  }

  /**
   * Extrae el elemento más antiguo.
   * @returns {T | undefined} undefined si la cola está vacía.
   */
  desencolar() {
    if (this.#cantidad === 0) {
      return undefined;
    }

    const elemento = this.#celdas[this.#cabeza];

    // Se suelta la referencia para que el recolector pueda liberar el elemento.
    this.#celdas[this.#cabeza] = undefined;
    this.#cabeza = (this.#cabeza + 1) & (this.#celdas.length - 1);
    this.#cantidad -= 1;

    return elemento;
  }

  /**
   * Extrae todo lo que queda, en orden.
   * @returns {T[]}
   */
  vaciar() {
    /** @type {T[]} */
    const restantes = [];
    let elemento = this.desencolar();

    while (elemento !== undefined) {
      restantes.push(elemento);
      elemento = this.desencolar();
    }

    return restantes;
  }

  /**
   * Duplica la capacidad y deja los elementos ordenados desde la celda 0.
   * @returns {void}
   */
  #duplicar() {
    const anterior = this.#celdas;
    const mascara = anterior.length - 1;
    /** @type {(T | undefined)[]} */
    const nuevo = new Array(anterior.length * 2).fill(undefined);

    for (let i = 0; i < this.#cantidad; i += 1) {
      nuevo[i] = anterior[(this.#cabeza + i) & mascara];
    }

    this.#celdas = nuevo;
    this.#cabeza = 0;
  }
}

// ═══ MÓDULO reloj-de-fondo ═══════════════════════════════════════════════════════════════════════════

/**
 * @file Reloj que no se frena cuando la pestaña queda en segundo plano.
 * Responsabilidad única: avisar cuando pasa un tiempo, también con la pestaña oculta.
 *
 * Chrome ralentiza los temporizadores de las pestañas ocultas: uno por segundo y, pasados cinco
 * minutos, uno por minuto. Con eso, una exportación larga quedaría casi parada al cambiar de
 * pestaña. Los temporizadores de un Worker no sufren ese freno.
 *
 * Cada espera se arma en los dos sitios, el Worker y el temporizador corriente, y vale el primero
 * que venza. Así, si la página no permite crear el Worker, todo sigue funcionando (más lento solo
 * mientras la pestaña esté oculta).
 */

/** Código del Worker: devuelve el identificador de cada espera cuando se cumple su plazo. */
const CODIGO_DEL_TRABAJADOR = 'onmessage = (evento) => { setTimeout(() => postMessage(evento.data.id), evento.data.ms); };';

class RelojDeFondo {
  /** @type {Worker | null} */
  #trabajador = null;

  /** Dirección temporal con el código del Worker ('' si no se llegó a crear). */
  #direccionDelCodigo = '';

  /** Qué hacer al vencer cada espera pendiente, por su identificador. */
  /** @type {Map<number, () => void>} */
  #alVencer = new Map();

  #siguienteId = 1;

  constructor() {
    try {
      this.#direccionDelCodigo = URL.createObjectURL(new Blob([CODIGO_DEL_TRABAJADOR], { type: 'text/javascript' }));

      const trabajador = new Worker(this.#direccionDelCodigo);

      trabajador.onmessage = (evento) => this.#vencer(Number(evento.data));
      // Si la política de seguridad de la página bloquea el Worker, el aviso llega aquí.
      trabajador.onerror = () => this.#abandonarTrabajador();
      this.#trabajador = trabajador;
    } catch {
      this.#abandonarTrabajador();
    }
  }

  /** @returns {boolean} true si el Worker está en uso. */
  get usaTrabajador() {
    return this.#trabajador !== null;
  }

  /**
   * Programa un aviso.
   * @param {number} milisegundos
   * @param {() => void} alVencer
   * @returns {() => void} Función que cancela el aviso.
   */
  programar(milisegundos, alVencer) {
    const id = this.#siguienteId;
    const temporizador = setTimeout(() => this.#vencer(id), Math.max(0, milisegundos));

    this.#siguienteId += 1;
    this.#alVencer.set(id, () => {
      clearTimeout(temporizador);
      alVencer();
    });

    if (this.#trabajador !== null) {
      this.#trabajador.postMessage({ id, ms: Math.max(0, milisegundos) });
    }

    return () => {
      clearTimeout(temporizador);
      this.#alVencer.delete(id);
    };
  }

  /**
   * Apaga el Worker. Las esperas pendientes siguen en el temporizador corriente.
   * @returns {void}
   */
  cerrar() {
    this.#abandonarTrabajador();
  }

  /**
   * Da por cumplida una espera. Solo actúa la primera vez: el segundo aviso (del otro reloj) se ignora.
   * @param {number} id
   * @returns {void}
   */
  #vencer(id) {
    const accion = this.#alVencer.get(id);

    if (accion === undefined) {
      return;
    }

    this.#alVencer.delete(id);
    accion();
  }

  /**
   * Deja de usar el Worker y libera sus recursos.
   * @returns {void}
   */
  #abandonarTrabajador() {
    if (this.#trabajador !== null) {
      this.#trabajador.terminate();
      this.#trabajador = null;
    }

    if (this.#direccionDelCodigo !== '') {
      URL.revokeObjectURL(this.#direccionDelCodigo);
      this.#direccionDelCodigo = '';
    }
  }
}

// ═══ MÓDULO control-ejecucion ════════════════════════════════════════════════════════════════════════

/**
 * @file Interruptor de la exportación.
 * Responsabilidad única: saber si la persona pidió detener o cancelar, y avisar a quien espera.
 *
 * Hay dos formas de parar:
 *  · detener  → deja de cargar, pero se entrega lo capturado (marcado como parcial);
 *  · cancelar → se aborta todo y no se descarga nada.
 */

/** @typedef {'activo' | 'deteniendo' | 'cancelado'} EstadoControl */

class ControlEjecucion {
  /** @type {EstadoControl} */
  #estado = 'activo';

  /** Corta las esperas y las descargas de multimedia: se aborta al detener y al cancelar. */
  #interrupcion = new AbortController();

  /** Corta también las peticiones de historial en curso: solo se aborta al cancelar. */
  #cancelacion = new AbortController();

  /** Reloj de las esperas: sigue a su ritmo aunque la pestaña quede en segundo plano. */
  #reloj = new RelojDeFondo();

  /** @returns {AbortSignal} */
  get senalInterrumpir() {
    return this.#interrupcion.signal;
  }

  /** @returns {AbortSignal} */
  get senalCancelar() {
    return this.#cancelacion.signal;
  }

  /** @returns {boolean} true si se pidió detener o cancelar. */
  get detenido() {
    return this.#estado !== 'activo';
  }

  /** @returns {boolean} */
  get cancelado() {
    return this.#estado === 'cancelado';
  }

  /**
   * Pide terminar pronto y conservar lo capturado.
   * @returns {void}
   */
  detener() {
    if (this.#estado !== 'activo') {
      return;
    }

    this.#estado = 'deteniendo';
    this.#interrupcion.abort(new ErrorExportacion('DETENIDO', 'La exportación se detuvo a petición tuya.'));
  }

  /**
   * Pide abortar sin descargar nada.
   * @returns {void}
   */
  cancelar() {
    if (this.#estado === 'cancelado') {
      return;
    }

    const motivo = new ErrorExportacion('CANCELADO', 'La exportación se canceló.');

    this.#estado = 'cancelado';
    this.#interrupcion.abort(motivo);
    this.#cancelacion.abort(motivo);
  }

  /** @returns {boolean} true si las esperas no dependen de que la pestaña esté visible. */
  get relojDeFondoActivo() {
    return this.#reloj.usaTrabajador;
  }

  /**
   * Espera que se corta en cuanto se detiene o se cancela.
   * @param {number} milisegundos
   * @returns {Promise<void>} Rechaza con el motivo (DETENIDO o CANCELADO) si se interrumpe.
   */
  esperar(milisegundos) {
    const senal = this.#interrupcion.signal;

    return new Promise((resolver, rechazar) => {
      if (senal.aborted) {
        rechazar(senal.reason);
        return;
      }

      /** @returns {void} */
      const alInterrumpir = () => {
        cancelarAviso();
        rechazar(senal.reason);
      };

      const cancelarAviso = this.#reloj.programar(milisegundos, () => {
        senal.removeEventListener('abort', alInterrumpir);
        resolver();
      });

      senal.addEventListener('abort', alInterrumpir, { once: true });
    });
  }

  /**
   * Libera el reloj de fondo. Se llama cuando la exportación termina.
   * @returns {void}
   */
  cerrar() {
    this.#reloj.cerrar();
  }
}

// ═══ MÓDULO registro-diagnostico ═════════════════════════════════════════════════════════════════════

/**
 * @file Bitácora para `exportadorInstagram.diagnostico()`.
 * Responsabilidad única: guardar qué pasó (estados, tiempos, recuentos y la FORMA de las
 * respuestas) sin guardar nunca textos de mensajes, nombres ni credenciales.
 */

/** Claves cuyo valor es un nombre de tipo de Instagram, no un dato personal: se muestran tal cual. */
const CLAVES_VISIBLES = new Set(['__typename', 'content_type', '__isSlideMessageContent', 'thread_subtype']);

/** Claves que se describen como máximo por objeto, para que el volcado no crezca sin límite. */
const CLAVES_MAXIMAS_POR_OBJETO = 80;

/**
 * Describe la forma de un valor: conserva claves y tipos y oculta el contenido.
 * Un texto se convierte en «texto(n)» y un número en «número».
 * @param {unknown} valor
 * @param {number} [profundidad] Niveles que quedan por describir.
 * @returns {unknown}
 */
function describirForma(valor, profundidad = 5) {
  if (valor === null || valor === undefined) {
    return null;
  }

  if (typeof valor === 'boolean') {
    return valor;
  }

  if (typeof valor === 'number') {
    return 'número';
  }

  if (typeof valor === 'string') {
    return `texto(${valor.length})`;
  }

  if (Array.isArray(valor)) {
    if (profundidad <= 0 || valor.length === 0) {
      return `lista(${valor.length})`;
    }

    return { lista: valor.length, primero: describirForma(valor[0], profundidad - 1) };
  }

  if (!esObjeto(valor)) {
    return typeof valor;
  }

  if (profundidad <= 0) {
    return 'objeto';
  }

  /** @type {Record<string, unknown>} */
  const forma = {};
  const claves = Object.keys(valor).slice(0, CLAVES_MAXIMAS_POR_OBJETO);

  for (const clave of claves) {
    const contenido = valor[clave];

    if (CLAVES_VISIBLES.has(clave) && typeof contenido === 'string') {
      forma[clave] = contenido;
    } else {
      forma[clave] = describirForma(contenido, profundidad - 1);
    }
  }

  return forma;
}

/**
 * @typedef {Object} EventoDiagnostico
 * @property {number} t      Milisegundos desde que arrancó el script.
 * @property {string} tipo
 * @property {Record<string, string | number | boolean | null>} datos
 */

class RegistroDiagnostico {
  #inicioMs = Date.now();

  /** Anillo de eventos recientes: al llenarse, cada evento nuevo pisa al más antiguo. */
  /** @type {(EventoDiagnostico | undefined)[]} */
  #eventos;

  /** Posición donde se escribirá el próximo evento. */
  #siguiente = 0;

  /** Total de eventos anotados, incluidos los ya pisados. */
  #totalEventos = 0;

  /** @type {Map<string, number>} */
  #contadores = new Map();

  /** @type {Map<string, unknown>} */
  #datos = new Map();

  /** @type {Map<string, unknown>} */
  #formas = new Map();

  /**
   * @param {number} [capacidad] Eventos recientes que se conservan.
   */
  constructor(capacidad = 80) {
    this.#eventos = new Array(Math.max(1, capacidad)).fill(undefined);
  }

  /**
   * Anota un evento. Quien llama pasa solo datos inofensivos: códigos, recuentos y tiempos.
   * @param {string} tipo
   * @param {Record<string, string | number | boolean | null>} [datos]
   * @returns {void}
   */
  anotar(tipo, datos = {}) {
    this.#eventos[this.#siguiente] = { t: Date.now() - this.#inicioMs, tipo, datos };
    this.#siguiente = (this.#siguiente + 1) % this.#eventos.length;
    this.#totalEventos += 1;
  }

  /**
   * Suma a un contador con nombre.
   * @param {string} nombre
   * @param {number} [incremento]
   * @returns {void}
   */
  contar(nombre, incremento = 1) {
    const actual = this.#contadores.get(nombre) ?? 0;

    this.#contadores.set(nombre, actual + incremento);
  }

  /**
   * Guarda un dato fijo del entorno (por ejemplo, de dónde salió el identificador de una consulta).
   * @param {string} nombre
   * @param {unknown} valor
   * @returns {void}
   */
  fijar(nombre, valor) {
    this.#datos.set(nombre, valor);
  }

  /**
   * Guarda la forma de una respuesta, con el contenido enmascarado.
   * @param {string} nombre
   * @param {unknown} valor
   * @returns {void}
   */
  guardarForma(nombre, valor) {
    this.#formas.set(nombre, describirForma(valor));
  }

  /**
   * Devuelve los eventos recientes del más antiguo al más nuevo.
   * @returns {EventoDiagnostico[]}
   */
  #eventosEnOrden() {
    /** @type {EventoDiagnostico[]} */
    const ordenados = [];
    const capacidad = this.#eventos.length;

    for (let i = 0; i < capacidad; i += 1) {
      const evento = this.#eventos[(this.#siguiente + i) % capacidad];

      if (evento !== undefined) {
        ordenados.push(evento);
      }
    }

    return ordenados;
  }

  /**
   * Devuelve todo lo registrado como un objeto simple, listo para copiar y compartir.
   * @returns {Record<string, unknown>}
   */
  volcar() {
    return {
      datos: Object.fromEntries(this.#datos),
      contadores: Object.fromEntries(this.#contadores),
      formas: Object.fromEntries(this.#formas),
      eventosTotales: this.#totalEventos,
      eventosRecientes: this.#eventosEnOrden(),
    };
  }
}

// ═══ MÓDULO modulos-pagina ═══════════════════════════════════════════════════════════════════════════

/**
 * @file Acceso al sistema de módulos de la propia página de Instagram.
 * Responsabilidad única: pedir un módulo por su nombre sin que un fallo detenga el script.
 *
 * Instagram expone en la ventana una función `require` con sus módulos internos. De ahí se leen
 * la credencial de la sesión y los identificadores vigentes de las consultas, que Instagram
 * cambia cada pocas semanas: así el script sigue funcionando sin tener que actualizarlo.
 */

class ModulosPagina {
  /** @type {((nombre: string) => unknown) | null} */
  #requerir = null;

  /**
   * @param {unknown} ventana Normalmente `window`.
   */
  constructor(ventana) {
    const candidato = /** @type {{ require?: unknown } | null} */ (ventana);

    if (candidato !== null && typeof candidato === 'object' && typeof candidato.require === 'function') {
      const requerir = candidato.require;

      this.#requerir = (nombre) => requerir.call(candidato, nombre);
    }
  }

  /** @returns {boolean} true si la página expone su sistema de módulos. */
  get disponible() {
    return this.#requerir !== null;
  }

  /**
   * Dice cuáles de los módulos indicados existen en la página. Sirve para el diagnóstico.
   * @param {string[]} nombres
   * @returns {Record<string, boolean>}
   */
  inventario(nombres) {
    /** @type {Record<string, boolean>} */
    const hallados = {};

    for (const nombre of nombres) {
      hallados[nombre] = this.pedir(nombre) !== null;
    }

    return hallados;
  }

  /**
   * Pide un módulo de la página.
   * @param {string} nombre
   * @returns {any} El módulo, o null si no existe, no está cargado o falla al evaluarse.
   */
  pedir(nombre) {
    if (this.#requerir === null) {
      return null;
    }

    try {
      const modulo = this.#requerir(nombre);

      if (modulo === undefined) {
        return null;
      }

      return modulo;
    } catch {
      return null;
    }
  }
}

// ═══ MÓDULO sesion-pagina ════════════════════════════════════════════════════════════════════════════

/**
 * @file Sesión de Instagram abierta en la pestaña.
 * Responsabilidad única: obtener las credenciales que la propia página usa en sus peticiones
 * y la identidad de quien exporta. Nunca las guarda fuera de la memoria ni las envía a otro sitio.
 */

/** Identificador público de la aplicación web de Instagram. Es igual para todas las cuentas. */
const APP_ID_WEB = '936619743392459';

/** Página de la que se relee la credencial cuando la que hay en memoria ya no sirve. */
const RUTA_PARA_REFRESCAR = '/direct/inbox/';

/** Veces que se puede releer la credencial en una misma exportación. */
const REFRESCOS_MAXIMOS = 2;

/** Formas en que el HTML de Instagram incrusta la credencial `fb_dtsg`. */
const PATRONES_FB_DTSG = [
  /"DTSGInitialData",\[\],\{"token":"([^"]+)"/,
  /"DTSGInitData",\[\],\{"token":"([^"]+)"/,
];

const PATRON_LSD = /"LSD",\[\],\{"token":"([^"]+)"/;
const PATRON_APP_ID = /"X-IG-App-ID":"(\d{6,25})"/;
const PATRON_ID_MENSAJERIA = /"IG_USER_EIMU":"(\d+)"/;

/**
 * @typedef {Object} Credenciales
 * @property {string} fbDtsg  Credencial anti-falsificación de la sesión. Es lo único que el servidor exige.
 * @property {string} lsd     Credencial ligera que la página envía junto a la anterior ('' si no se encontró).
 * @property {string} csrf    Valor de la cookie `csrftoken` ('' si no existe).
 * @property {string} appId
 * @property {string} asbdId  Cabecera que añade la página ('' si no se pudo leer).
 */

/**
 * Devuelve el primer grupo capturado por el primer patrón que coincida.
 * @param {string} texto
 * @param {RegExp[]} patrones
 * @returns {string} '' si ninguno coincide.
 */
function primeraCoincidencia(texto, patrones) {
  for (const patron of patrones) {
    const coincidencia = patron.exec(texto);

    if (coincidencia !== null) {
      return desescaparJson(coincidencia[1]);
    }
  }

  return '';
}

/**
 * Deshace los escapes de un texto que venía dentro de un JSON («\/» → «/»).
 * @param {string} texto
 * @returns {string}
 */
function desescaparJson(texto) {
  if (!texto.includes('\\')) {
    return texto;
  }

  try {
    return String(JSON.parse(`"${texto}"`));
  } catch {
    return texto;
  }
}

class SesionPagina {
  /** @type {ModulosPagina} */
  #modulos;

  /** @type {Document} */
  #documento;

  /** @type {RegistroDiagnostico} */
  #registro;

  /** Credencial releída del HTML. Tiene prioridad: es más reciente que la de la memoria de la página. */
  #fbDtsgRefrescado = '';

  #lsdRefrescado = '';

  #refrescos = 0;

  /** Credenciales ya reunidas. Se vuelven a leer solo si el servidor las rechaza. */
  /** @type {Credenciales | null} */
  #credencialesReunidas = null;

  /**
   * @param {ModulosPagina} modulos
   * @param {Document} documento
   * @param {RegistroDiagnostico} registro
   */
  constructor(modulos, documento, registro) {
    this.#modulos = modulos;
    this.#documento = documento;
    this.#registro = registro;
  }

  /**
   * Lee una cookie visible para JavaScript.
   * @param {string} nombre
   * @returns {string} '' si no existe.
   */
  #leerCookie(nombre) {
    const pares = this.#documento.cookie.split(';');

    for (const par of pares) {
      const separador = par.indexOf('=');

      if (separador === -1) {
        continue;
      }

      if (par.slice(0, separador).trim() !== nombre) {
        continue;
      }

      try {
        return decodeURIComponent(par.slice(separador + 1).trim());
      } catch {
        return par.slice(separador + 1).trim();
      }
    }

    return '';
  }

  /**
   * Busca un patrón en los scripts incrustados de la página.
   * @param {RegExp[]} patrones
   * @returns {string}
   */
  #buscarEnScripts(patrones) {
    const scripts = this.#documento.querySelectorAll('script:not([src])');

    for (const script of scripts) {
      const hallado = primeraCoincidencia(script.textContent ?? '', patrones);

      if (hallado !== '') {
        return hallado;
      }
    }

    return '';
  }

  /**
   * Lee la credencial `fb_dtsg` de las fuentes de la página, de la más fiable a la menos.
   * @returns {string} '' si no está en ninguna.
   */
  #leerFbDtsg() {
    if (this.#fbDtsgRefrescado !== '') {
      return this.#fbDtsgRefrescado;
    }

    /** @type {[string, () => unknown][]} */
    const fuentes = [
      ['módulo DTSGInitialData', () => this.#modulos.pedir('DTSGInitialData')?.token],
      ['módulo DTSGInitData', () => this.#modulos.pedir('DTSGInitData')?.token],
      ['bloque __eqmc', () => this.#leerDeEqmc()],
      ['scripts incrustados', () => this.#buscarEnScripts(PATRONES_FB_DTSG)],
    ];

    for (const [nombre, leer] of fuentes) {
      const valor = aTexto(leer());

      if (valor !== '') {
        this.#registro.fijar('credencial.fuente', nombre);
        return valor;
      }
    }

    return '';
  }

  /**
   * Lee la credencial del bloque de configuración `__eqmc` de la página.
   * @returns {string}
   */
  #leerDeEqmc() {
    const bloque = this.#documento.getElementById('__eqmc');

    if (bloque === null) {
      return '';
    }

    try {
      const datos = JSON.parse(bloque.textContent ?? '');

      if (esObjeto(datos)) {
        return aTexto(datos.f);
      }
    } catch {
      // El bloque no es JSON: se sigue con la siguiente fuente.
    }

    return '';
  }

  /**
   * Vuelve a leer la credencial pidiendo de nuevo una página de Instagram.
   * Sirve cuando la pestaña lleva tanto tiempo abierta que la credencial en memoria caducó.
   * @returns {Promise<boolean>} true si se obtuvo una credencial.
   */
  async refrescar() {
    if (this.#refrescos >= REFRESCOS_MAXIMOS) {
      return false;
    }

    this.#refrescos += 1;

    let html = '';

    try {
      const respuesta = await fetch(RUTA_PARA_REFRESCAR, { credentials: 'include', headers: { accept: 'text/html' } });

      html = await respuesta.text();
    } catch {
      this.#registro.anotar('credencial.refresco', { resultado: 'fallo de red' });
      return false;
    }

    const fbDtsg = primeraCoincidencia(html, PATRONES_FB_DTSG);

    this.#registro.anotar('credencial.refresco', { resultado: fbDtsg === '' ? 'sin credencial' : 'correcto' });

    if (fbDtsg === '') {
      return false;
    }

    this.#fbDtsgRefrescado = fbDtsg;
    this.#lsdRefrescado = primeraCoincidencia(html, [PATRON_LSD]);
    this.#credencialesReunidas = null;
    this.#registro.fijar('credencial.fuente', 'HTML releído');

    return true;
  }

  /**
   * Reúne las credenciales para una petición.
   * @returns {Promise<Credenciales | null>} null si la pestaña no tiene una sesión utilizable.
   */
  async credenciales() {
    if (this.#credencialesReunidas !== null) {
      return this.#credencialesReunidas;
    }

    let fbDtsg = this.#leerFbDtsg();

    if (fbDtsg === '') {
      await this.refrescar();
      fbDtsg = this.#fbDtsgRefrescado;
    }

    if (fbDtsg === '') {
      return null;
    }

    let lsd = this.#lsdRefrescado;

    if (lsd === '') {
      lsd = aTexto(this.#modulos.pedir('LSD')?.token);
    }

    if (lsd === '') {
      lsd = this.#buscarEnScripts([PATRON_LSD]);
    }

    let appId = aTexto(this.#modulos.pedir('CurrentUserInitialData')?.APP_ID);

    if (appId === '') {
      appId = this.#buscarEnScripts([PATRON_APP_ID]);
    }

    if (appId === '') {
      appId = APP_ID_WEB;
    }

    this.#credencialesReunidas = {
      fbDtsg,
      lsd,
      csrf: this.#leerCookie('csrftoken'),
      appId,
      asbdId: aTexto(this.#modulos.pedir('BDHeaderConfig')?.ASBD_ID),
    };

    return this.#credencialesReunidas;
  }

  /**
   * Campos de formulario que la página añade a todas sus peticiones (revisión del sitio, contador…).
   * Se piden a la función de la propia página para enviar lo mismo que enviaría ella; si no está,
   * se usa el conjunto mínimo.
   * @returns {Record<string, string>}
   */
  parametrosDeFormulario() {
    /** @type {Record<string, string>} */
    const parametros = { __d: 'www', __user: '0', __a: '1', __comet_req: '7' };
    const obtener = this.#modulos.pedir('getAsyncParams');

    if (typeof obtener !== 'function') {
      return parametros;
    }

    let nativos = null;

    try {
      nativos = obtener('POST');
    } catch {
      return parametros;
    }

    if (!esObjeto(nativos)) {
      return parametros;
    }

    for (const [clave, valor] of Object.entries(nativos)) {
      // Las credenciales las pone el cliente de una sola fuente, para que nunca queden mezcladas.
      const esCredencial = clave === 'fb_dtsg' || clave === 'jazoest' || clave === 'lsd';

      if (esCredencial) {
        continue;
      }

      const texto = aTexto(valor);

      if (texto !== '') {
        parametros[clave] = texto;
      }
    }

    return parametros;
  }

  /**
   * Identidad de quien exporta, para saber qué mensajes son suyos.
   * @returns {IdentidadPropia}
   */
  identidad() {
    const usuarioActual = this.#modulos.pedir('CurrentUserInitialData');
    const espectador = this.#modulos.pedir('PolarisViewer');
    /** @type {Record<string, any>} */
    const datosEspectador = esObjeto(espectador) && esObjeto(espectador.data) ? espectador.data : {};

    let idMensajeria = aTexto(usuarioActual?.IG_USER_EIMU);

    if (idMensajeria === '') {
      idMensajeria = this.#buscarEnScripts([PATRON_ID_MENSAJERIA]);
    }

    let idInstagram = this.#leerCookie('ds_user_id');

    if (idInstagram === '') {
      idInstagram = aTexto(datosEspectador.id);
    }

    return {
      idMensajeria,
      idInstagram,
      nombre: aTexto(datosEspectador.full_name),
      usuario: aTexto(datosEspectador.username),
    };
  }
}

// ═══ MÓDULO catalogo-consultas ═══════════════════════════════════════════════════════════════════════

/**
 * @file Catálogo de las consultas de Instagram que usa el exportador.
 * Responsabilidad única: averiguar el identificador vigente de cada consulta y las variables
 * que la página le añade.
 *
 * Instagram no publica estas consultas y cambia sus identificadores cada pocas semanas. Por eso
 * se buscan en tres sitios, del más fiable al menos:
 *   1. los módulos de la propia página (el identificador que está usando ahora mismo);
 *   2. el código JavaScript que la página ya descargó (sale de la caché, sin tocar la API);
 *   3. identificadores incorporados, vistos funcionando durante 2026.
 */

/** Variable con la que la página pide el tamaño de página del historial. */
const VAR_TAMANO_PAGINA = '__relay_internal__pv__IGDInitialMessagePageCountrelayprovider';
const VAR_TEMAS_DE_CHAT = '__relay_internal__pv__IGDEnableOffMsysChatThemesQErelayprovider';
const VAR_ETIQUETA_IA = '__relay_internal__pv__PolarisAIGMAccountLabelEnabledrelayprovider';
const VAR_MENSAJES_FIJADOS = '__relay_internal__pv__IGDEnableOffMsysPinnedMessagesQErelayprovider';

/** Los identificadores de consulta son números de entre 6 y 25 cifras. */
const ES_IDENTIFICADOR = /^\d{6,25}$/;

/** Paquetes de JavaScript que se leen como mucho al buscar un identificador. */
const PAQUETES_MAXIMOS = 300;

/** Paquetes que se leen a la vez. */
const PAQUETES_SIMULTANEOS = 6;

/**
 * @typedef {Object} IdDeRespaldo
 * @property {string} id
 * @property {Record<string, unknown>} provistas  Variables de página que acompañaban a ese identificador.
 */

/**
 * @typedef {Object} DefinicionConsulta
 * @property {string} nombre
 * @property {Record<string, unknown>} provistasPorDefecto
 * @property {IdDeRespaldo[]} respaldos
 */

/** @typedef {'página' | 'paquetes' | 'incorporado'} OrigenConsulta */

/**
 * @typedef {Object} CandidatoConsulta
 * @property {string} id
 * @property {OrigenConsulta} origen
 * @property {Record<string, unknown>} provistas  Variables que la página añade por su cuenta.
 * @property {string[]} argumentos                Variables que declara la consulta ([] si no se conocen).
 */

/**
 * Abre una conversación: devuelve sus datos y los 20 mensajes más recientes.
 * @type {DefinicionConsulta}
 */
const CONSULTA_DETALLE = {
  nombre: 'IGDThreadDetailQuery',
  provistasPorDefecto: { [VAR_TEMAS_DE_CHAT]: false, [VAR_TAMANO_PAGINA]: 20, [VAR_ETIQUETA_IA]: false },
  respaldos: [
    { id: '37117700834487428', provistas: { [VAR_TEMAS_DE_CHAT]: false, [VAR_TAMANO_PAGINA]: 20, [VAR_ETIQUETA_IA]: false } },
    { id: '29432273173041378', provistas: { [VAR_TEMAS_DE_CHAT]: false, [VAR_TAMANO_PAGINA]: 20 } },
    { id: '28007469415578650', provistas: { [VAR_TEMAS_DE_CHAT]: false, [VAR_TAMANO_PAGINA]: 20, [VAR_ETIQUETA_IA]: false } },
  ],
};

/**
 * Pide una página de mensajes anteriores a un cursor.
 * @type {DefinicionConsulta}
 */
const CONSULTA_MENSAJES = {
  nombre: 'IGDMessageListOffMsysQuery',
  provistasPorDefecto: { [VAR_TAMANO_PAGINA]: 20 },
  respaldos: [
    { id: '27502152406082940', provistas: { [VAR_TAMANO_PAGINA]: 20 } },
    { id: '29380270148264352', provistas: { [VAR_TAMANO_PAGINA]: 20 } },
    { id: '28574971342201921', provistas: { [VAR_TAMANO_PAGINA]: 20 } },
    { id: '28798548116496168', provistas: { [VAR_TAMANO_PAGINA]: 20 } },
    { id: '26252548844395561', provistas: { [VAR_TAMANO_PAGINA]: 20, [VAR_MENSAJES_FIJADOS]: false } },
  ],
};

/**
 * Devuelve solo el título y los participantes. Se usa si la consulta de detalle no responde.
 * @type {DefinicionConsulta}
 */
const CONSULTA_CABECERA = {
  nombre: 'IGDInboxHeaderOffMsysQuery',
  provistasPorDefecto: {},
  respaldos: [{ id: '28914252884904227', provistas: {} }],
};

const TODAS_LAS_CONSULTAS = [CONSULTA_DETALLE, CONSULTA_MENSAJES, CONSULTA_CABECERA];

/**
 * Arma las variables de una petición: las de la página, las propias y, para las que la consulta
 * declara y nadie rellenó, un null explícito (el servidor rechaza las variables ausentes).
 * @param {CandidatoConsulta} candidato
 * @param {Record<string, unknown>} propias
 * @returns {Record<string, unknown>}
 */
function construirVariables(candidato, propias) {
  /** @type {Record<string, unknown>} */
  const variables = { ...candidato.provistas, ...propias };

  for (const nombre of candidato.argumentos) {
    if (!(nombre in variables)) {
      variables[nombre] = null;
    }
  }

  return variables;
}

/**
 * Busca en el texto de un paquete el identificador de una consulta.
 * Instagram lo define en un módulo propio cuyo cuerpo solo exporta ese número.
 * @param {string} codigo
 * @param {string} nombre
 * @returns {string} '' si el paquete no define esa consulta.
 */
function buscarIdEnCodigo(codigo, nombre) {
  const inicio = codigo.indexOf(`__d("${nombre}_instagramRelayOperation"`);

  if (inicio === -1) {
    return '';
  }

  // El módulo siguiente empieza con otro «__d(»: la búsqueda no debe pasar de ahí.
  const finDelModulo = codigo.indexOf('__d(', inicio + 4);
  const limite = finDelModulo === -1 ? inicio + 400 : Math.min(finDelModulo, inicio + 400);
  const coincidencia = /exports="(\d{6,25})"/.exec(codigo.slice(inicio, limite));

  if (coincidencia === null) {
    return '';
  }

  return coincidencia[1];
}

class CatalogoConsultas {
  /** @type {ModulosPagina} */
  #modulos;

  /** @type {Document} */
  #documento;

  /** @type {RegistroDiagnostico} */
  #registro;

  /** Consultas cuyo identificador ya se comprobó que funciona. */
  /** @type {Map<string, CandidatoConsulta>} */
  #comprobados = new Map();

  /** Resultado de explorar los paquetes; null mientras no se haya hecho. */
  /** @type {Map<string, string> | null} */
  #idsDePaquetes = null;

  /**
   * @param {ModulosPagina} modulos
   * @param {Document} documento
   * @param {RegistroDiagnostico} registro
   */
  constructor(modulos, documento, registro) {
    this.#modulos = modulos;
    this.#documento = documento;
    this.#registro = registro;
  }

  /**
   * Recorre los identificadores posibles de una consulta, del más fiable al menos.
   * Quien lo usa prueba cada uno y deja de pedir en cuanto uno funciona, de modo que los
   * pasos costosos (explorar paquetes) solo ocurren si los anteriores fallaron.
   * @param {DefinicionConsulta} definicion
   * @returns {AsyncGenerator<CandidatoConsulta, void, void>}
   */
  async *candidatos(definicion) {
    const comprobado = this.#comprobados.get(definicion.nombre);

    if (comprobado !== undefined) {
      yield comprobado;
      return;
    }

    /** @type {Set<string>} */
    const yaOfrecidos = new Set();
    const dePagina = this.#leerDeLaPagina(definicion);

    if (dePagina !== null) {
      yaOfrecidos.add(dePagina.id);
      yield dePagina;
    }

    const idDePaquetes = (await this.#explorarPaquetes()).get(definicion.nombre) ?? '';

    if (idDePaquetes !== '' && !yaOfrecidos.has(idDePaquetes)) {
      yaOfrecidos.add(idDePaquetes);
      yield { id: idDePaquetes, origen: 'paquetes', provistas: { ...definicion.provistasPorDefecto }, argumentos: [] };
    }

    for (const respaldo of definicion.respaldos) {
      if (yaOfrecidos.has(respaldo.id)) {
        continue;
      }

      yaOfrecidos.add(respaldo.id);
      yield { id: respaldo.id, origen: 'incorporado', provistas: { ...respaldo.provistas }, argumentos: [] };
    }
  }

  /**
   * Recuerda el identificador que funcionó, para no volver a probar los demás.
   * @param {DefinicionConsulta} definicion
   * @param {CandidatoConsulta} candidato
   * @returns {void}
   */
  marcarComprobado(definicion, candidato) {
    this.#comprobados.set(definicion.nombre, candidato);
    this.#registro.fijar(`consulta.${definicion.nombre}`, {
      id: candidato.id,
      origen: candidato.origen,
      variablesDePagina: Object.keys(candidato.provistas),
      argumentosDeclarados: candidato.argumentos.length,
    });
  }

  /**
   * Lee el identificador que la página está usando ahora mismo.
   * @param {DefinicionConsulta} definicion
   * @returns {CandidatoConsulta | null} null si la página no tiene cargada esa consulta.
   */
  #leerDeLaPagina(definicion) {
    const artefacto = this.#modulos.pedir(`${definicion.nombre}.graphql`);

    if (esObjeto(artefacto) && esObjeto(artefacto.params)) {
      const id = aTexto(artefacto.params.id);

      if (ES_IDENTIFICADOR.test(id)) {
        return {
          id,
          origen: 'página',
          provistas: this.#evaluarProvistas(artefacto.params.providedVariables, definicion),
          argumentos: this.#nombresDeArgumentos(artefacto),
        };
      }
    }

    const idSuelto = this.#modulos.pedir(`${definicion.nombre}_instagramRelayOperation`);

    if (typeof idSuelto === 'string' && ES_IDENTIFICADOR.test(idSuelto)) {
      return { id: idSuelto, origen: 'página', provistas: { ...definicion.provistasPorDefecto }, argumentos: [] };
    }

    return null;
  }

  /**
   * Calcula el valor actual de las variables que la página añade a la consulta.
   * Cada una es un objeto de la página con un método `get()`.
   * @param {unknown} proveedores
   * @param {DefinicionConsulta} definicion
   * @returns {Record<string, unknown>}
   */
  #evaluarProvistas(proveedores, definicion) {
    /** @type {Record<string, unknown>} */
    const provistas = {};

    if (!esObjeto(proveedores)) {
      return provistas;
    }

    for (const [clave, proveedor] of Object.entries(proveedores)) {
      let valor = definicion.provistasPorDefecto[clave];

      try {
        if (esObjeto(proveedor) && typeof proveedor.get === 'function') {
          valor = proveedor.get();
        }
      } catch {
        // Se conserva el valor por defecto conocido, si lo hay.
      }

      if (valor !== undefined) {
        provistas[clave] = valor;
      }
    }

    return provistas;
  }

  /**
   * Lista los nombres de las variables que declara una consulta compilada.
   * @param {Record<string, any>} artefacto
   * @returns {string[]}
   */
  #nombresDeArgumentos(artefacto) {
    /** @type {unknown} */
    let definiciones = null;

    if (esObjeto(artefacto.operation)) {
      definiciones = artefacto.operation.argumentDefinitions;
    }

    if (!Array.isArray(definiciones) && esObjeto(artefacto.fragment)) {
      definiciones = artefacto.fragment.argumentDefinitions;
    }

    if (!Array.isArray(definiciones)) {
      return [];
    }

    /** @type {string[]} */
    const nombres = [];

    for (const definicion of definiciones) {
      if (esObjeto(definicion) && typeof definicion.name === 'string') {
        nombres.push(definicion.name);
      }
    }

    return nombres;
  }

  /**
   * Reúne las direcciones de los paquetes de JavaScript que la página ya cargó.
   * @returns {string[]} Los más recientes primero: los del chat se cargan al final.
   */
  #direccionesDePaquetes() {
    /** @type {Set<string>} */
    const direcciones = new Set();

    /**
     * @param {string} direccion
     * @returns {void}
     */
    const agregar = (direccion) => {
      let url = null;

      try {
        url = new URL(direccion, this.#documento.baseURI);
      } catch {
        return;
      }

      const esServidorDeInstagram = /(^|\.)(cdninstagram\.com|instagram\.com|fbcdn\.net)$/.test(url.hostname);

      if (url.protocol === 'https:' && esServidorDeInstagram && url.pathname.endsWith('.js')) {
        direcciones.add(url.href);
      }
    };

    for (const script of this.#documento.querySelectorAll('script[src]')) {
      agregar(script.getAttribute('src') ?? '');
    }

    for (const enlace of this.#documento.querySelectorAll('link[rel="preload"][as="script"][href]')) {
      agregar(enlace.getAttribute('href') ?? '');
    }

    if (typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function') {
      for (const recurso of performance.getEntriesByType('resource')) {
        agregar(recurso.name);
      }
    }

    return Array.from(direcciones).reverse().slice(0, PAQUETES_MAXIMOS);
  }

  /**
   * Busca los identificadores en el código que la página ya descargó. Se lee de la caché del
   * navegador, así que no supone tráfico nuevo hacia la API de Instagram.
   * @returns {Promise<Map<string, string>>} Nombre de consulta → identificador.
   */
  async #explorarPaquetes() {
    if (this.#idsDePaquetes !== null) {
      return this.#idsDePaquetes;
    }

    /** @type {Map<string, string>} */
    const hallados = new Map();
    const direcciones = this.#direccionesDePaquetes();
    let leidos = 0;
    let fallidos = 0;

    this.#idsDePaquetes = hallados;

    /**
     * @param {string} direccion
     * @returns {Promise<void>}
     */
    const leerPaquete = async (direccion) => {
      let codigo = '';

      try {
        const respuesta = await fetch(direccion, { credentials: 'omit', cache: 'force-cache' });

        codigo = await respuesta.text();
        leidos += 1;
      } catch {
        fallidos += 1;
        return;
      }

      for (const definicion of TODAS_LAS_CONSULTAS) {
        if (hallados.has(definicion.nombre)) {
          continue;
        }

        const id = buscarIdEnCodigo(codigo, definicion.nombre);

        if (id !== '') {
          hallados.set(definicion.nombre, id);
        }
      }
    };

    for (let inicio = 0; inicio < direcciones.length; inicio += PAQUETES_SIMULTANEOS) {
      await Promise.all(direcciones.slice(inicio, inicio + PAQUETES_SIMULTANEOS).map(leerPaquete));

      const yaEstanTodos = hallados.size === TODAS_LAS_CONSULTAS.length;
      // Si la primera tanda falla entera, el navegador no deja leer los paquetes: no se insiste.
      const lecturaBloqueada = leidos === 0 && fallidos >= PAQUETES_SIMULTANEOS;

      if (yaEstanTodos || lecturaBloqueada) {
        break;
      }
    }

    this.#registro.fijar('paquetes', { disponibles: direcciones.length, leidos, fallidos, consultasHalladas: hallados.size });

    return hallados;
  }
}

// ═══ MÓDULO cliente-graphql ══════════════════════════════════════════════════════════════════════════

/**
 * @file Cliente de la API interna de Instagram.
 * Responsabilidad única: enviar una consulta a /api/graphql igual que la envía la página,
 * a un ritmo moderado, y resolver los tropiezos de transporte: fallos de red, avisos de
 * «ve más despacio» y credenciales caducadas. Interpretar los datos es tarea de otros módulos.
 */

const RUTA_GRAPHQL = '/api/graphql';

/** Prefijo que Instagram antepone a algunas respuestas JSON. */
const PREFIJO_DE_RESPUESTA = 'for (;;);';

/** «Recarga la página»: la credencial enviada ya no vale. */
const CODIGO_RECARGAR = 1357004;

/** «Inicia sesión»: la sesión se cerró. */
const CODIGO_SIN_SESION = 1357001;

/** Frases con las que Instagram pide esperar, a veces con un estado HTTP 401 o 403. */
const PIDE_ESPERAR = /wait a few minutes|espera unos minutos|try again later|rate limit|too fast|demasiado rápido|temporarily blocked/i;

/** Códigos de error con los que la plataforma de Meta avisa de un exceso de peticiones. */
const CODIGOS_DE_LIMITE = [1390008, 1675004];

const MENSAJE_SIN_SESION =
  'Instagram no reconoce la sesión de esta pestaña. Comprueba que has iniciado sesión, recarga la página (F5) y vuelve a pegar el script.';

/**
 * @typedef {Object} RespuestaGraphQL
 * @property {Crudo | null} datos  Contenido de `data`; null si la consulta no devolvió datos.
 * @property {string[]} errores    Avisos de error que acompañan a la respuesta, resumidos.
 */

/**
 * @typedef {Object} AvisoEspera
 * @property {'limite' | 'red'} motivo
 * @property {number} segundos     0 significa que la espera terminó.
 */

/**
 * @typedef {Object} RespuestaHttp
 * @property {number} estado
 * @property {string} texto
 * @property {string} direccionFinal  Adónde llegó la petición tras las redirecciones.
 */

/**
 * @typedef {Object} Veredicto
 * @property {'correcto' | 'limite' | 'servidor' | 'credencial' | 'sin-sesion' | 'error'} tipo
 * @property {string} mensaje
 * @property {RespuestaGraphQL | null} respuesta
 */

/**
 * @typedef {Object} DependenciasCliente
 * @property {SesionPagina} sesion
 * @property {ControlEjecucion} control
 * @property {RegistroDiagnostico} registro
 * @property {AjustesAvanzados} ajustes
 * @property {number} pausaEntrePaginasMs
 * @property {(aviso: AvisoEspera) => void} alEsperar  Aviso para mostrar una cuenta atrás.
 */

/**
 * Interpreta el cuerpo de una respuesta. Acepta el prefijo de Instagram y también las respuestas
 * partidas en varias líneas, cada una con un documento JSON.
 * @param {string} texto
 * @returns {Crudo[] | null} Los documentos encontrados, o null si el cuerpo no es JSON.
 */
function interpretarCuerpo(texto) {
  let limpio = texto.trimStart();

  if (limpio.startsWith(PREFIJO_DE_RESPUESTA)) {
    limpio = limpio.slice(PREFIJO_DE_RESPUESTA.length);
  }

  try {
    const unico = JSON.parse(limpio);

    if (esObjeto(unico)) {
      return [unico];
    }

    return null;
  } catch {
    // No es un único documento: puede ser uno por línea.
  }

  /** @type {Crudo[]} */
  const documentos = [];

  for (const linea of limpio.split('\n')) {
    const contenido = linea.trim();

    if (contenido === '') {
      continue;
    }

    try {
      const documento = JSON.parse(contenido);

      if (esObjeto(documento)) {
        documentos.push(documento);
      }
    } catch {
      return null;
    }
  }

  if (documentos.length === 0) {
    return null;
  }

  return documentos;
}

/**
 * Resume los errores de un documento de respuesta en frases cortas.
 * Son mensajes del servidor sobre la consulta; no contienen datos del chat.
 * @param {Crudo} documento
 * @returns {string[]}
 */
function resumirErrores(documento) {
  /** @type {string[]} */
  const resumenes = [];
  const codigo = aEntero(documento.error);

  if (codigo !== 0) {
    const descripcion = aTexto(documento.errorSummary) || aTexto(documento.errorDescription);

    resumenes.push(recortar(`código ${codigo}: ${descripcion}`, 200));
  }

  if (Array.isArray(documento.errors)) {
    for (const error of documento.errors) {
      if (!esObjeto(error)) {
        continue;
      }

      const mensaje = aTexto(error.message) || aTexto(error.summary) || 'error sin descripción';

      resumenes.push(recortar(mensaje, 200));
    }
  }

  return resumenes;
}

/**
 * Calcula el campo `jazoest` que la página envía junto a la credencial:
 * un «2» seguido de la suma de los códigos de sus caracteres.
 * @param {string} fbDtsg
 * @returns {string}
 */
function calcularJazoest(fbDtsg) {
  let suma = 0;

  for (let i = 0; i < fbDtsg.length; i += 1) {
    suma += fbDtsg.charCodeAt(i);
  }

  return `2${suma}`;
}

class ClienteGraphQL {
  /** @type {SesionPagina} */
  #sesion;

  /** @type {ControlEjecucion} */
  #control;

  /** @type {RegistroDiagnostico} */
  #registro;

  /** @type {AjustesAvanzados} */
  #ajustes;

  /** @type {(aviso: AvisoEspera) => void} */
  #alEsperar;

  /** Respiro actual entre peticiones. Crece si Instagram pide ir más despacio. */
  #pausaMs;

  /** Azar que se suma al respiro. Con respiro 0 tampoco hay azar. */
  #variacionMs;

  /** Momento en que llegó la última respuesta (0 si aún no hubo ninguna). */
  #ultimaRespuestaMs = 0;

  #peticiones = 0;

  /**
   * @param {DependenciasCliente} dependencias
   */
  constructor(dependencias) {
    this.#sesion = dependencias.sesion;
    this.#control = dependencias.control;
    this.#registro = dependencias.registro;
    this.#ajustes = dependencias.ajustes;
    this.#alEsperar = dependencias.alEsperar;
    this.#pausaMs = dependencias.pausaEntrePaginasMs;
    this.#variacionMs = dependencias.pausaEntrePaginasMs === 0 ? 0 : dependencias.ajustes.variacionPausaMs;
  }

  /** @returns {number} Peticiones enviadas hasta ahora. */
  get peticiones() {
    return this.#peticiones;
  }

  /**
   * Ejecuta una consulta y devuelve sus datos.
   * @param {string} nombre     Nombre de la consulta (por ejemplo «IGDMessageListOffMsysQuery»).
   * @param {string} docId      Identificador vigente de la consulta.
   * @param {Record<string, unknown>} variables
   * @returns {Promise<RespuestaGraphQL>}
   * @throws {ErrorExportacion} SIN_SESION, RED, LIMITE, GRAPHQL, DETENIDO o CANCELADO.
   */
  async ejecutar(nombre, docId, variables) {
    let fallosSeguidos = 0;
    let avisosDeLimite = 0;
    let credencialRenovada = false;

    for (;;) {
      await this.#respetarRitmo();

      const credenciales = await this.#sesion.credenciales();

      if (credenciales === null) {
        throw new ErrorExportacion('SIN_SESION', MENSAJE_SIN_SESION);
      }

      /** @type {RespuestaHttp} */
      let http;

      try {
        http = await this.#enviar(nombre, docId, variables, credenciales);
      } catch (error) {
        if (this.#control.cancelado) {
          throw new ErrorExportacion('CANCELADO', 'La exportación se canceló.');
        }

        fallosSeguidos += 1;
        await this.#esperarTrasFallo(fallosSeguidos, describirError(error));
        continue;
      }

      const veredicto = this.#clasificar(http);

      this.#registro.anotar('petición', { consulta: nombre, estado: http.estado, resultado: veredicto.tipo, bytes: http.texto.length });

      if (veredicto.tipo === 'correcto' && veredicto.respuesta !== null) {
        return veredicto.respuesta;
      }

      if (veredicto.tipo === 'limite') {
        avisosDeLimite += 1;
        await this.#esperarPorLimite(avisosDeLimite);
        continue;
      }

      if (veredicto.tipo === 'servidor') {
        fallosSeguidos += 1;
        await this.#esperarTrasFallo(fallosSeguidos, veredicto.mensaje);
        continue;
      }

      if (veredicto.tipo === 'credencial') {
        const sePuedeRenovar = !credencialRenovada && (await this.#sesion.refrescar());

        if (!sePuedeRenovar) {
          throw new ErrorExportacion('SIN_SESION', MENSAJE_SIN_SESION);
        }

        credencialRenovada = true;
        continue;
      }

      if (veredicto.tipo === 'sin-sesion') {
        throw new ErrorExportacion('SIN_SESION', veredicto.mensaje);
      }

      throw new ErrorExportacion('GRAPHQL', veredicto.mensaje);
    }
  }

  /**
   * Deja pasar el respiro configurado desde la última respuesta.
   * @returns {Promise<void>}
   */
  async #respetarRitmo() {
    if (this.#ultimaRespuestaMs === 0) {
      return;
    }

    const respiro = this.#pausaMs + azarHasta(this.#variacionMs);
    const transcurrido = Date.now() - this.#ultimaRespuestaMs;

    if (respiro > transcurrido) {
      await this.#control.esperar(respiro - transcurrido);
    }
  }

  /**
   * Envía la petición con los mismos campos y cabeceras que usa la página.
   * @param {string} nombre
   * @param {string} docId
   * @param {Record<string, unknown>} variables
   * @param {Credenciales} credenciales
   * @returns {Promise<RespuestaHttp>}
   */
  async #enviar(nombre, docId, variables, credenciales) {
    const cuerpo = new URLSearchParams(this.#sesion.parametrosDeFormulario());

    cuerpo.set('fb_dtsg', credenciales.fbDtsg);
    cuerpo.set('jazoest', calcularJazoest(credenciales.fbDtsg));
    cuerpo.set('fb_api_caller_class', 'RelayModern');
    cuerpo.set('fb_api_req_friendly_name', nombre);
    cuerpo.set('server_timestamps', 'true');
    cuerpo.set('variables', JSON.stringify(variables));
    cuerpo.set('doc_id', docId);

    /** @type {Record<string, string>} */
    const cabeceras = {
      'content-type': 'application/x-www-form-urlencoded',
      'x-ig-app-id': credenciales.appId,
      'x-fb-friendly-name': nombre,
    };

    if (credenciales.lsd !== '') {
      cuerpo.set('lsd', credenciales.lsd);
      cabeceras['x-fb-lsd'] = credenciales.lsd;
    }

    if (credenciales.csrf !== '') {
      cabeceras['x-csrftoken'] = credenciales.csrf;
    }

    if (credenciales.asbdId !== '') {
      cabeceras['x-asbd-id'] = credenciales.asbdId;
    }

    const senalCancelar = this.#control.senalCancelar;
    const controlPeticion = new AbortController();

    /** @returns {void} */
    const alCancelar = () => controlPeticion.abort(senalCancelar.reason);

    if (senalCancelar.aborted) {
      alCancelar();
    }

    senalCancelar.addEventListener('abort', alCancelar, { once: true });

    const plazo = setTimeout(() => {
      controlPeticion.abort(new Error('la petición superó el plazo de espera'));
    }, this.#ajustes.tiempoLimitePeticionMs);

    this.#peticiones += 1;

    try {
      const respuesta = await fetch(RUTA_GRAPHQL, {
        method: 'POST',
        credentials: 'include',
        headers: cabeceras,
        body: cuerpo.toString(),
        signal: controlPeticion.signal,
      });
      const texto = await respuesta.text();

      this.#ultimaRespuestaMs = Date.now();

      return { estado: respuesta.status, texto, direccionFinal: respuesta.url };
    } finally {
      clearTimeout(plazo);
      senalCancelar.removeEventListener('abort', alCancelar);
    }
  }

  /**
   * Decide qué significa una respuesta HTTP.
   * @param {RespuestaHttp} http
   * @returns {Veredicto}
   */
  #clasificar(http) {
    /**
     * @param {Veredicto['tipo']} tipo
     * @param {string} mensaje
     * @returns {Veredicto}
     */
    const sinDatos = (tipo, mensaje) => ({ tipo, mensaje, respuesta: null });

    if (/\/accounts\/login/.test(http.direccionFinal)) {
      return sinDatos('sin-sesion', MENSAJE_SIN_SESION);
    }

    if (/\/challenge\/|\/accounts\/suspended/.test(http.direccionFinal)) {
      return sinDatos(
        'sin-sesion',
        'Instagram está pidiendo una verificación de tu cuenta. Resuélvela en la propia página y vuelve a pegar el script.',
      );
    }

    if (http.estado === 429) {
      return sinDatos('limite', 'HTTP 429');
    }

    if (http.estado === 401 || http.estado === 403) {
      if (PIDE_ESPERAR.test(http.texto)) {
        return sinDatos('limite', `HTTP ${http.estado}`);
      }

      return sinDatos('sin-sesion', MENSAJE_SIN_SESION);
    }

    if (http.estado >= 500) {
      return sinDatos('servidor', `Instagram respondió con un error temporal (HTTP ${http.estado}).`);
    }

    if (http.estado < 200 || http.estado >= 300) {
      return sinDatos(
        'error',
        `Instagram respondió HTTP ${http.estado} a la consulta del historial. Es probable que haya cambiado su web; ejecuta exportadorInstagram.diagnostico() y comparte el resultado.`,
      );
    }

    const documentos = interpretarCuerpo(http.texto);

    if (documentos === null) {
      // Con una credencial caducada Instagram devuelve su página HTML en lugar de JSON.
      if (/^\s*<(!doctype|html)/i.test(http.texto)) {
        return sinDatos('credencial', 'credencial rechazada');
      }

      return sinDatos('error', 'Instagram devolvió una respuesta que no se puede leer como JSON.');
    }

    /** @type {Crudo | null} */
    let datos = null;
    /** @type {string[]} */
    const errores = [];

    for (const documento of documentos) {
      const codigo = aEntero(documento.error);

      if (codigo === CODIGO_RECARGAR) {
        return sinDatos('credencial', 'credencial rechazada');
      }

      if (codigo === CODIGO_SIN_SESION) {
        return sinDatos('sin-sesion', MENSAJE_SIN_SESION);
      }

      if (datos === null && esObjeto(documento.data)) {
        datos = documento.data;
      }

      for (const resumen of resumirErrores(documento)) {
        errores.push(resumen);
      }
    }

    if (documentos.length > 1) {
      this.#registro.contar('respuestas en varias partes');
    }

    // Sin datos y con un error que habla de ir demasiado rápido: es un aviso de límite, no una consulta inválida.
    const avisaDeLimite = documentos.some((documento) => CODIGOS_DE_LIMITE.includes(aEntero(documento.error))) || errores.some((resumen) => PIDE_ESPERAR.test(resumen));

    if (datos === null && avisaDeLimite) {
      return sinDatos('limite', errores[0] ?? 'aviso de límite');
    }

    return { tipo: 'correcto', mensaje: '', respuesta: { datos, errores } };
  }

  /**
   * Espera antes de reintentar tras un fallo de red o un error temporal del servidor.
   * @param {number} numeroDeFallo  1 para el primer fallo seguido.
   * @param {string} causa
   * @returns {Promise<void>}
   * @throws {ErrorExportacion} RED cuando se agotan los reintentos.
   */
  async #esperarTrasFallo(numeroDeFallo, causa) {
    const esperas = this.#ajustes.esperasPorFalloDeRedS;

    this.#registro.anotar('fallo de red', { numero: numeroDeFallo, causa: recortar(causa, 120) });

    if (numeroDeFallo > esperas.length) {
      throw new ErrorExportacion(
        'RED',
        `No pude comunicarme con Instagram tras ${esperas.length} reintentos (${causa}). Revisa tu conexión.`,
      );
    }

    const segundos = esperas[numeroDeFallo - 1];

    this.#alEsperar({ motivo: 'red', segundos });

    try {
      await this.#control.esperar(segundos * 1000);
    } finally {
      // También si la espera se corta porque la persona detuvo o canceló.
      this.#alEsperar({ motivo: 'red', segundos: 0 });
    }
  }

  /**
   * Espera cuando Instagram pide ir más despacio y, desde entonces, alarga el respiro.
   * @param {number} numeroDeAviso  1 para el primer aviso seguido.
   * @returns {Promise<void>}
   * @throws {ErrorExportacion} LIMITE cuando los avisos se repiten demasiado.
   */
  async #esperarPorLimite(numeroDeAviso) {
    const esperas = this.#ajustes.esperasPorLimiteS;

    this.#registro.contar('avisos de límite');

    if (numeroDeAviso > esperas.length) {
      throw new ErrorExportacion(
        'LIMITE',
        'Instagram sigue pidiendo ir más despacio después de varias esperas. Deja pasar un rato antes de volver a intentarlo.',
      );
    }

    const segundos = esperas[numeroDeAviso - 1];

    // Tras un aviso, el resto de la exportación va más despacio.
    this.#pausaMs = Math.max(this.#pausaMs * 2, this.#ajustes.pausaMinimaTrasLimiteMs);
    this.#variacionMs = Math.max(this.#variacionMs, this.#pausaMs * 0.3);
    this.#alEsperar({ motivo: 'limite', segundos });

    try {
      await this.#control.esperar(segundos * 1000);
    } finally {
      this.#alEsperar({ motivo: 'limite', segundos: 0 });
    }
  }
}

// ═══ MÓDULO respuesta-hilo ═══════════════════════════════════════════════════════════════════════════

/**
 * @file Lectura de las respuestas de Instagram.
 * Responsabilidad única: encontrar, dentro de una respuesta, la conversación y su lista de mensajes.
 *
 * La ruta hasta la lista (`data.fetch__SlideThread.as_ig_direct_thread.slide_messages`) ha cambiado
 * entre versiones de la web. Por eso no se depende de ella: se recorre la respuesta buscando
 * cualquier objeto que tenga una lista `slide_messages`.
 */

/** Niveles de anidamiento que se recorren como máximo. */
const PROFUNDIDAD_MAXIMA = 7;

/** Objetos que se visitan como máximo, para no perder tiempo en respuestas enormes. */
const VISITAS_MAXIMAS = 4000;

/** Elementos de cada lista que se miran al buscar. */
const ELEMENTOS_POR_LISTA = 40;

/**
 * @typedef {Object} HallazgoHilo
 * @property {Crudo} hilo             Objeto de la conversación que contiene la lista de mensajes.
 * @property {PaginaMensajes} pagina
 */

/**
 * Recorre un valor a lo ancho y devuelve el primer objeto que cumpla la condición.
 * A lo ancho, porque lo buscado está cerca de la raíz y así se evita bajar por cada mensaje.
 * @param {unknown} raiz
 * @param {(objeto: Crudo) => boolean} cumple
 * @returns {Crudo | null}
 */
function buscarObjeto(raiz, cumple) {
  /** @type {unknown[]} */
  let nivel = [raiz];
  let visitas = 0;

  for (let profundidad = 0; profundidad <= PROFUNDIDAD_MAXIMA && nivel.length > 0; profundidad += 1) {
    /** @type {unknown[]} */
    const siguiente = [];

    for (const valor of nivel) {
      if (!esObjeto(valor)) {
        continue;
      }

      visitas += 1;

      if (visitas > VISITAS_MAXIMAS) {
        return null;
      }

      if (cumple(valor)) {
        return valor;
      }

      for (const hijo of Object.values(valor)) {
        if (esObjeto(hijo)) {
          siguiente.push(hijo);
        } else if (Array.isArray(hijo)) {
          for (const elemento of hijo.slice(0, ELEMENTOS_POR_LISTA)) {
            siguiente.push(elemento);
          }
        }
      }
    }

    nivel = siguiente;
  }

  return null;
}

/**
 * Indica si un objeto es una conversación con su lista de mensajes.
 * @param {Crudo} objeto
 * @returns {boolean}
 */
function tieneListaDeMensajes(objeto) {
  const conexion = objeto.slide_messages;

  return esObjeto(conexion) && Array.isArray(conexion.edges);
}

/**
 * Localiza la conversación y su página de mensajes dentro de los datos de una respuesta.
 * @param {unknown} datos Contenido de `data`.
 * @returns {HallazgoHilo | null} null si la respuesta no trae ninguna lista de mensajes.
 */
function localizarHilo(datos) {
  const hilo = buscarObjeto(datos, tieneListaDeMensajes);

  if (hilo === null) {
    return null;
  }

  const conexion = hilo.slide_messages;
  /** @type {Crudo[]} */
  const nodos = [];

  for (const borde of conexion.edges) {
    if (esObjeto(borde) && esObjeto(borde.node)) {
      nodos.push(borde.node);
    }
  }

  /** @type {Crudo} */
  const infoDePagina = esObjeto(conexion.page_info) ? conexion.page_info : {};
  const cursorSiguiente = aTexto(infoDePagina.end_cursor);

  return {
    hilo,
    pagina: {
      nodos,
      cursorSiguiente,
      // «Hay más» solo sirve si además viene el cursor con el que pedirlo.
      hayMas: infoDePagina.has_next_page === true && cursorSiguiente !== '',
    },
  };
}

/**
 * Localiza los datos generales de una conversación (título y participantes) en una respuesta
 * que no trae mensajes.
 * @param {unknown} datos
 * @returns {Crudo | null}
 */
function localizarCabecera(datos) {
  return buscarObjeto(datos, (objeto) => Array.isArray(objeto.users));
}

// ═══ MÓDULO lector-hilo ══════════════════════════════════════════════════════════════════════════════

/**
 * @file Lectura del historial de una conversación.
 * Responsabilidad única: abrir la conversación y pedir, una tras otra, sus páginas de mensajes.
 *
 * Así lo hace la propia web de Instagram:
 *   1. «IGDThreadDetailQuery» recibe la clave de la dirección (/direct/t/<clave>/) y devuelve los
 *      datos de la conversación, sus 20 mensajes más recientes y un cursor;
 *   2. «IGDMessageListOffMsysQuery» recibe ese cursor y devuelve los 20 anteriores y otro cursor.
 * Cada página necesita el cursor de la anterior, así que se piden en serie.
 */

/**
 * Respuestas con datos pero sin conversación tras las que se deja de probar identificadores.
 * Con una basta: si el servidor aceptó la consulta, su respuesta vale, y cada identificador
 * caducado que se probara de más sería una petición inválida gastada sin motivo.
 */
const RESPUESTAS_VACIAS_TOLERADAS = 1;

/** Veces que se repite una página que llegó sin lista de mensajes antes de rendirse. */
const REINTENTOS_DE_PAGINA = 3;

/**
 * @typedef {Object} AperturaHilo
 * @property {Crudo} hilo             Datos de la conversación tal como los entrega Instagram.
 * @property {PaginaMensajes} pagina  Los mensajes más recientes.
 */

/**
 * @typedef {Object} DependenciasLector
 * @property {ClienteGraphQL} cliente
 * @property {CatalogoConsultas} catalogo
 * @property {RegistroDiagnostico} registro
 * @property {string} clave             Clave de la conversación, tomada de la dirección.
 * @property {number} mensajesPorPagina
 */

class LectorHilo {
  /** @type {ClienteGraphQL} */
  #cliente;

  /** @type {CatalogoConsultas} */
  #catalogo;

  /** @type {RegistroDiagnostico} */
  #registro;

  #clave;

  #mensajesPorPagina;

  /** Consulta de páginas que ya se comprobó que funciona (null hasta la primera página antigua). */
  /** @type {CandidatoConsulta | null} */
  #consultaDePaginas = null;

  /** Identificador de la conversación que acepta la consulta de páginas. */
  #idDePaginas = '';

  /** Identificadores de la conversación que se probarán, del más probable al menos. */
  /** @type {string[]} */
  #idsPosibles = [];

  /** true si Instagram anunció más mensajes y, al pedirlos, no entregó ninguno. */
  #finIncierto = false;

  /**
   * @param {DependenciasLector} dependencias
   */
  constructor(dependencias) {
    this.#cliente = dependencias.cliente;
    this.#catalogo = dependencias.catalogo;
    this.#registro = dependencias.registro;
    this.#clave = dependencias.clave;
    this.#mensajesPorPagina = dependencias.mensajesPorPagina;
  }

  /** @returns {boolean} */
  get finIncierto() {
    return this.#finIncierto;
  }

  /**
   * Abre la conversación y devuelve sus datos y los mensajes más recientes.
   * @returns {Promise<AperturaHilo>}
   * @throws {ErrorExportacion} HILO_NO_ENCONTRADO si Instagram no la entrega por ninguna vía.
   */
  async abrir() {
    const porDetalle = await this.#abrirConDetalle();

    if (porDetalle !== null) {
      this.#idsPosibles = this.#reunirIdsPosibles(porDetalle);
      this.#registro.fijar('apertura', 'consulta de detalle');

      return porDetalle;
    }

    const porLista = await this.#abrirConLista();

    if (porLista !== null) {
      this.#registro.fijar('apertura', 'lista de mensajes');

      const cabecera = await this.#leerCabecera();

      return { hilo: { ...cabecera, ...porLista.hilo }, pagina: porLista.pagina };
    }

    throw new ErrorExportacion(
      'HILO_NO_ENCONTRADO',
      'Instagram no devolvió esta conversación. Comprueba que el chat está abierto (la dirección debe contener /direct/t/…), recarga la página (F5) y vuelve a pegar el script. Si se repite, ejecuta exportadorInstagram.diagnostico() y comparte el resultado.',
    );
  }

  /**
   * Devuelve la página de mensajes anterior a un cursor.
   * @param {string} cursor
   * @returns {Promise<PaginaMensajes>}
   * @throws {ErrorExportacion} GRAPHQL si Instagram deja de entregar el historial.
   */
  async paginaAnterior(cursor) {
    if (this.#consultaDePaginas !== null) {
      return this.#pedirPaginaComprobada(this.#consultaDePaginas, cursor);
    }

    return this.#descubrirPaginacion(cursor);
  }

  /**
   * Variables de la consulta de páginas: las mismas ocho que envía la web.
   * @param {CandidatoConsulta} candidato
   * @param {string} idDeHilo
   * @param {string | null} cursor
   * @returns {Record<string, unknown>}
   */
  #variablesDePagina(candidato, idDeHilo, cursor) {
    return construirVariables(candidato, {
      after: cursor,
      before: null,
      first: this.#mensajesPorPagina,
      last: null,
      newer_than_message_id: null,
      older_than_message_id: null,
      id: idDeHilo,
    });
  }

  /**
   * Deja constancia de un intento, sin datos del chat.
   * @param {DefinicionConsulta} definicion
   * @param {CandidatoConsulta} candidato
   * @param {RespuestaGraphQL} respuesta
   * @param {HallazgoHilo | null} hallazgo
   * @returns {void}
   */
  #anotarIntento(definicion, candidato, respuesta, hallazgo) {
    this.#registro.anotar('intento', {
      consulta: definicion.nombre,
      origen: candidato.origen,
      conDatos: respuesta.datos !== null,
      conMensajes: hallazgo !== null,
      mensajes: hallazgo === null ? 0 : hallazgo.pagina.nodos.length,
      primerError: respuesta.errores.length === 0 ? '' : respuesta.errores[0],
    });
  }

  /**
   * Abre la conversación con la consulta de detalle, probando sus identificadores.
   * @returns {Promise<HallazgoHilo | null>} null si ninguno devuelve la conversación.
   */
  async #abrirConDetalle() {
    let respuestasVacias = 0;

    for await (const candidato of this.#catalogo.candidatos(CONSULTA_DETALLE)) {
      const variables = construirVariables(candidato, { min_uq_seq_id: null, thread_fbid: this.#clave });
      const respuesta = await this.#cliente.ejecutar(CONSULTA_DETALLE.nombre, candidato.id, variables);
      const hallazgo = localizarHilo(respuesta.datos);

      this.#anotarIntento(CONSULTA_DETALLE, candidato, respuesta, hallazgo);

      if (hallazgo !== null) {
        this.#catalogo.marcarComprobado(CONSULTA_DETALLE, candidato);
        this.#registro.guardarForma('respuesta de detalle', respuesta.datos);

        return hallazgo;
      }

      // Con datos pero sin conversación, el identificador de la consulta es válido y lo que
      // falla es la clave: probar más identificadores no cambiaría el resultado.
      if (respuesta.datos !== null) {
        respuestasVacias += 1;
      }

      if (respuestasVacias >= RESPUESTAS_VACIAS_TOLERADAS) {
        break;
      }
    }

    return null;
  }

  /**
   * Segunda vía: pide directamente la primera página de mensajes con la clave de la dirección.
   * @returns {Promise<HallazgoHilo | null>}
   */
  async #abrirConLista() {
    let respuestasVacias = 0;

    for await (const candidato of this.#catalogo.candidatos(CONSULTA_MENSAJES)) {
      const variables = this.#variablesDePagina(candidato, this.#clave, null);
      const respuesta = await this.#cliente.ejecutar(CONSULTA_MENSAJES.nombre, candidato.id, variables);
      const hallazgo = localizarHilo(respuesta.datos);

      this.#anotarIntento(CONSULTA_MENSAJES, candidato, respuesta, hallazgo);

      if (hallazgo !== null) {
        this.#fijarPaginacion(candidato, this.#clave, respuesta);

        return hallazgo;
      }

      if (respuesta.datos !== null) {
        respuestasVacias += 1;
      }

      if (respuestasVacias >= RESPUESTAS_VACIAS_TOLERADAS) {
        break;
      }
    }

    return null;
  }

  /**
   * Lee el título y los participantes con la consulta de cabecera. Es opcional:
   * si falla, los nombres se toman de los propios mensajes.
   * @returns {Promise<Crudo>}
   */
  async #leerCabecera() {
    try {
      for await (const candidato of this.#catalogo.candidatos(CONSULTA_CABECERA)) {
        const variables = construirVariables(candidato, { thread_fbid: this.#clave });
        const respuesta = await this.#cliente.ejecutar(CONSULTA_CABECERA.nombre, candidato.id, variables);
        const cabecera = localizarCabecera(respuesta.datos);

        if (cabecera !== null) {
          this.#catalogo.marcarComprobado(CONSULTA_CABECERA, candidato);

          return cabecera;
        }
      }
    } catch (error) {
      const hayQueParar = esErrorDeCodigo(error, 'CANCELADO') || esErrorDeCodigo(error, 'DETENIDO');

      if (hayQueParar) {
        throw error;
      }
    }

    return {};
  }

  /**
   * Reúne los identificadores con los que se puede pedir el historial de esta conversación.
   * Una conversación tiene varios (clave de la dirección, identificador corto…) y la consulta
   * de páginas solo acepta uno de ellos.
   * @param {HallazgoHilo} hallazgo
   * @returns {string[]}
   */
  #reunirIdsPosibles(hallazgo) {
    /** @type {string[]} */
    const ids = [];

    /**
     * @param {unknown} valor
     * @returns {void}
     */
    const agregar = (valor) => {
      const id = aTexto(valor);

      if (/^\d+$/.test(id) && !ids.includes(id)) {
        ids.push(id);
      }
    };

    agregar(hallazgo.hilo.thread_fbid);

    if (hallazgo.pagina.nodos.length > 0) {
      agregar(hallazgo.pagina.nodos[0].thread_fbid);
    }

    agregar(hallazgo.hilo.id);
    agregar(this.#clave);
    agregar(hallazgo.hilo.thread_key);

    return ids;
  }

  /**
   * Recuerda la combinación de consulta e identificador que funcionó.
   * @param {CandidatoConsulta} candidato
   * @param {string} idDeHilo
   * @param {RespuestaGraphQL} respuesta
   * @returns {void}
   */
  #fijarPaginacion(candidato, idDeHilo, respuesta) {
    this.#consultaDePaginas = candidato;
    this.#idDePaginas = idDeHilo;
    this.#catalogo.marcarComprobado(CONSULTA_MENSAJES, candidato);
    this.#registro.guardarForma('respuesta de página', respuesta.datos);
    this.#registro.fijar('paginación.identificador', idDeHilo === this.#clave ? 'clave de la dirección' : 'identificador del hilo');
  }

  /**
   * Primera página antigua: averigua qué identificador de consulta y qué identificador de
   * conversación acepta Instagram.
   * @param {string} cursor
   * @returns {Promise<PaginaMensajes>}
   */
  async #descubrirPaginacion(cursor) {
    /** @type {PaginaMensajes | null} */
    let primeraPaginaVacia = null;
    /** @type {CandidatoConsulta | null} */
    let candidatoDeLaVacia = null;
    let idDeLaVacia = '';
    let ultimoError = '';

    for await (const candidato of this.#catalogo.candidatos(CONSULTA_MENSAJES)) {
      let consultaRechazada = false;

      for (const idDeHilo of this.#idsPosibles) {
        const variables = this.#variablesDePagina(candidato, idDeHilo, cursor);
        const respuesta = await this.#cliente.ejecutar(CONSULTA_MENSAJES.nombre, candidato.id, variables);
        const hallazgo = localizarHilo(respuesta.datos);

        this.#anotarIntento(CONSULTA_MENSAJES, candidato, respuesta, hallazgo);

        if (respuesta.errores.length > 0) {
          ultimoError = respuesta.errores[0];
        }

        if (hallazgo !== null && hallazgo.pagina.nodos.length > 0) {
          this.#fijarPaginacion(candidato, idDeHilo, respuesta);

          return hallazgo.pagina;
        }

        if (hallazgo !== null && primeraPaginaVacia === null) {
          primeraPaginaVacia = hallazgo.pagina;
          candidatoDeLaVacia = candidato;
          idDeLaVacia = idDeHilo;
        }

        // Sin datos, lo que no vale es el identificador de la consulta: se pasa al siguiente.
        if (respuesta.datos === null) {
          consultaRechazada = true;
          break;
        }
      }

      // Si la consulta respondió con datos para todos los identificadores de la conversación,
      // es válida: probar otros identificadores de consulta no cambiaría el resultado.
      if (!consultaRechazada) {
        break;
      }
    }

    if (primeraPaginaVacia !== null && candidatoDeLaVacia !== null) {
      // Instagram anunció más mensajes y entregó una página vacía con todos los identificadores.
      this.#finIncierto = true;
      this.#consultaDePaginas = candidatoDeLaVacia;
      this.#idDePaginas = idDeLaVacia;

      return primeraPaginaVacia;
    }

    const detalle = ultimoError === '' ? '' : ` Instagram dijo: «${ultimoError}».`;

    throw new ErrorExportacion(
      'GRAPHQL',
      `Instagram no entregó los mensajes anteriores a los 20 más recientes.${detalle} Ejecuta exportadorInstagram.diagnostico() y comparte el resultado.`,
    );
  }

  /**
   * Pide una página con la combinación que ya funcionó.
   * @param {CandidatoConsulta} candidato
   * @param {string} cursor
   * @returns {Promise<PaginaMensajes>}
   */
  async #pedirPaginaComprobada(candidato, cursor) {
    let ultimoError = '';

    for (let intento = 1; intento <= REINTENTOS_DE_PAGINA; intento += 1) {
      const variables = this.#variablesDePagina(candidato, this.#idDePaginas, cursor);
      const respuesta = await this.#cliente.ejecutar(CONSULTA_MENSAJES.nombre, candidato.id, variables);
      const hallazgo = localizarHilo(respuesta.datos);

      if (hallazgo !== null) {
        return hallazgo.pagina;
      }

      if (respuesta.errores.length > 0) {
        ultimoError = respuesta.errores[0];
      }

      this.#registro.anotar('página sin lista de mensajes', { intento, primerError: ultimoError });
    }

    const detalle = ultimoError === '' ? '' : ` Instagram dijo: «${ultimoError}».`;

    throw new ErrorExportacion('GRAPHQL', `Instagram dejó de entregar mensajes a mitad del historial.${detalle}`);
  }
}

// ═══ MÓDULO normalizador ═════════════════════════════════════════════════════════════════════════════

/**
 * @file Traducción de los mensajes de Instagram al modelo propio.
 * Responsabilidad única: convertir un nodo «SlideMessage» en un `Mensaje`, sin red ni estado.
 *
 * El campo que dice qué es un mensaje es `content.__typename` («SlideMessageText»,
 * «SlideMessageImageContent»…). Un tipo que no se reconoce nunca se descarta: se conserva con
 * el texto que traiga y con su contenido original, para no perder nada si Instagram añade tipos.
 */

const PREFIJO_DE_TIPO = 'SlideMessage';

/** Longitud máxima del resumen de un mensaje citado. */
const LONGITUD_DE_RESUMEN = 140;

/** Modo de las fotos y videos efímeros que el remitente permitió conservar en el chat. */
const MODO_CONSERVAR_EN_CHAT = 2;

/**
 * Nombre legible de cada tipo, para citas, texto plano y avisos de contenido ausente.
 * @type {Record<TipoMensaje, string>}
 */
const ETIQUETAS_DE_TIPO = {
  texto: 'Mensaje',
  foto: 'Foto',
  video: 'Video',
  album: 'Álbum',
  audio: 'Mensaje de voz',
  gif: 'GIF',
  sticker: 'Sticker',
  compartido: 'Contenido compartido',
  musica: 'Canción',
  efimero: 'Foto o video de visualización única',
  llamada: 'Llamada',
  sistema: 'Aviso',
  ia: 'Respuesta de IA',
  desconocido: 'Mensaje de un tipo no reconocido',
};

/**
 * @typedef {Object} ContenidoInterpretado
 * @property {TipoMensaje} tipo
 * @property {string} texto
 * @property {Adjunto[]} adjuntos
 * @property {Compartido | null} compartido
 */

/**
 * @typedef {Object} ResultadoNormalizacion
 * @property {Mensaje | null} mensaje  null si la fila no es un mensaje.
 * @property {string} descarte         Por qué no lo es ('' si lo es).
 */

/**
 * Crea un adjunto pendiente de descarga.
 * @param {ClaseAdjunto} clase
 * @param {string} url
 * @param {Partial<Adjunto>} [extras]
 * @returns {Adjunto}
 */
function crearAdjunto(clase, url, extras = {}) {
  return {
    clase,
    url,
    urlsAlternas: [],
    ancho: 0,
    alto: 0,
    duracionMs: 0,
    textoAlternativo: '',
    estado: 'pendiente',
    motivo: '',
    archivo: '',
    bytes: 0,
    tipoMime: '',
    ...extras,
  };
}

/**
 * Reúne direcciones válidas y distintas, sin repetir la principal.
 * @param {string} principal
 * @param {unknown[]} candidatas
 * @returns {string[]}
 */
function direccionesAlternas(principal, candidatas) {
  /** @type {string[]} */
  const alternas = [];

  for (const candidata of candidatas) {
    const direccion = urlSegura(candidata);
    const esNueva = direccion !== '' && direccion !== principal && !alternas.includes(direccion);

    if (esNueva) {
      alternas.push(direccion);
    }
  }

  return alternas;
}

/**
 * Convierte un archivo de Instagram (foto o video) en un adjunto.
 * @param {unknown} crudo
 * @param {ClaseAdjunto} clase
 * @returns {Adjunto | null} null si no trae ninguna dirección utilizable.
 */
function adjuntoDesdeArchivo(crudo, clase) {
  if (!esObjeto(crudo)) {
    return null;
  }

  const candidatas = [
    crudo.attachment_cdn_url,
    crudo.attachment_cdn_fallback_url,
    crudo.preview_cdn_url,
    crudo.preview_cdn_fallback_url,
  ];
  const direcciones = direccionesAlternas('', candidatas);

  if (direcciones.length === 0) {
    return null;
  }

  return crearAdjunto(clase, direcciones[0], {
    urlsAlternas: direcciones.slice(1),
    ancho: aEntero(crudo.preview_width),
    alto: aEntero(crudo.preview_height),
  });
}

/**
 * Decide si un archivo de un álbum mixto es un video. Instagram no documenta su campo de tipo,
 * así que se miran las señales propias de un video.
 * @param {Crudo} crudo
 * @returns {boolean}
 */
function esVideo(crudo) {
  if (aTexto(crudo.dash_manifest) !== '') {
    return true;
  }

  if (/video/i.test(aTexto(crudo.__typename))) {
    return true;
  }

  return /\.mp4(\?|$)/i.test(aTexto(crudo.attachment_cdn_url));
}

/**
 * Convierte una lista de archivos en adjuntos, saltando los que no tienen dirección.
 * @param {unknown} lista
 * @param {(crudo: Crudo) => ClaseAdjunto} claseDe
 * @returns {Adjunto[]}
 */
function adjuntosDesdeLista(lista, claseDe) {
  /** @type {Adjunto[]} */
  const adjuntos = [];

  for (const crudo of aLista(lista)) {
    if (!esObjeto(crudo)) {
      continue;
    }

    const adjunto = adjuntoDesdeArchivo(crudo, claseDe(crudo));

    if (adjunto !== null) {
      adjuntos.push(adjunto);
    }
  }

  return adjuntos;
}

/**
 * Quita el redirector de Instagram o Facebook de un enlace y devuelve el destino real.
 * @param {string} direccion
 * @returns {string}
 */
function desenvolverEnlace(direccion) {
  if (direccion === '') {
    return '';
  }

  try {
    const url = new URL(direccion);
    const esRedirector = /^l\.(instagram|facebook)\.com$/.test(url.hostname);

    if (esRedirector) {
      const destino = urlSegura(url.searchParams.get('u'));

      if (destino !== '') {
        return destino;
      }
    }
  } catch {
    // Dirección mal formada: se devuelve tal cual.
  }

  return direccion;
}

/**
 * Convierte una tarjeta «XMA» (reel, publicación, historia, perfil o enlace) en un `Compartido`.
 * @param {Crudo} xma
 * @returns {Compartido}
 */
function compartidoDesdeTarjeta(xma) {
  /** @type {Crudo | null} */
  let vistaPrevia = null;

  if (esObjeto(xma.preview_image)) {
    vistaPrevia = xma.preview_image;
  } else if (esObjeto(xma.xmaPreviewImage)) {
    vistaPrevia = xma.xmaPreviewImage;
  }

  /** @type {Adjunto | null} */
  let miniatura = null;

  if (vistaPrevia !== null) {
    const direcciones = direccionesAlternas('', [vistaPrevia.url, vistaPrevia.fallback_url]);

    if (direcciones.length > 0) {
      miniatura = crearAdjunto('miniatura', direcciones[0], {
        urlsAlternas: direcciones.slice(1),
        ancho: aEntero(vistaPrevia.width),
        alto: aEntero(vistaPrevia.height),
      });
    }
  }

  let titulo = aTexto(xma.title_text) || aTexto(xma.xmaTitle);
  const direccion = desenvolverEnlace(urlSegura(xma.target_url));
  const estaVacia = titulo === '' && direccion === '' && miniatura === null;

  if (estaVacia && /Placeholder/.test(aTexto(xma.__typename))) {
    titulo = 'Contenido que ya no está disponible';
  }

  return {
    url: direccion,
    titulo,
    subtitulo: aTexto(xma.subtitle_text),
    autor: aTexto(xma.header_title_text) || aTexto(xma.xmaHeaderTitle),
    descripcion: aTexto(xma.caption_body_text),
    cita: aTexto(xma.eyebrow_text),
    miniatura,
  };
}

/**
 * Texto que el mensaje trae como tal.
 * @param {Crudo} nodo
 * @param {Crudo} contenido
 * @returns {string}
 */
function textoPropio(nodo, contenido) {
  return aTexto(nodo.text_body) || aTexto(contenido.text_body);
}

/**
 * @param {Crudo} nodo
 * @param {Crudo} contenido
 * @returns {ContenidoInterpretado}
 */
function interpretarTexto(nodo, contenido) {
  return { tipo: 'texto', texto: textoPropio(nodo, contenido), adjuntos: [], compartido: null };
}

/**
 * Avisos del sistema: «X cambió el nombre del grupo», llamadas…
 * @param {Crudo} nodo
 * @param {Crudo} contenido
 * @returns {ContenidoInterpretado}
 */
function interpretarAviso(nodo, contenido) {
  let texto = '';

  for (const fragmento of aLista(contenido.text_fragments)) {
    if (esObjeto(fragmento)) {
      texto += aTexto(fragmento.plaintext);
    }
  }

  const esLlamada = /CALL/i.test(aTexto(nodo.content_type));

  return { tipo: esLlamada ? 'llamada' : 'sistema', texto: texto.trim(), adjuntos: [], compartido: null };
}

/**
 * @param {Crudo} nodo
 * @param {Crudo} contenido
 * @returns {ContenidoInterpretado}
 */
function interpretarFotos(nodo, contenido) {
  const adjuntos = adjuntosDesdeLista(contenido.attachments, () => 'imagen');

  return { tipo: adjuntos.length > 1 ? 'album' : 'foto', texto: textoPropio(nodo, contenido), adjuntos, compartido: null };
}

/**
 * @param {Crudo} nodo
 * @param {Crudo} contenido
 * @returns {ContenidoInterpretado}
 */
function interpretarVideos(nodo, contenido) {
  const adjuntos = adjuntosDesdeLista(contenido.videos, () => 'video');

  return { tipo: adjuntos.length > 1 ? 'album' : 'video', texto: textoPropio(nodo, contenido), adjuntos, compartido: null };
}

/**
 * Álbum con fotos y videos mezclados.
 * @param {Crudo} nodo
 * @param {Crudo} contenido
 * @returns {ContenidoInterpretado}
 */
function interpretarAlbum(nodo, contenido) {
  const adjuntos = adjuntosDesdeLista(contenido.ordered_photo_video_attachments, (crudo) => (esVideo(crudo) ? 'video' : 'imagen'));

  return { tipo: 'album', texto: textoPropio(nodo, contenido), adjuntos, compartido: null };
}

/**
 * Mensajes de voz.
 * @param {Crudo} nodo
 * @param {Crudo} contenido
 * @returns {ContenidoInterpretado}
 */
function interpretarAudios(nodo, contenido) {
  /** @type {Adjunto[]} */
  const adjuntos = [];

  for (const crudo of aLista(contenido.audio_attachments)) {
    if (!esObjeto(crudo)) {
      continue;
    }

    const direccion = urlSegura(crudo.attachment_cdn_url);

    if (direccion !== '') {
      adjuntos.push(crearAdjunto('audio', direccion, { duracionMs: aEntero(crudo.playable_duration_ms) }));
    }
  }

  return { tipo: 'audio', texto: textoPropio(nodo, contenido), adjuntos, compartido: null };
}

/**
 * GIF y stickers animados. Instagram entrega el campo unas veces como lista y otras como objeto.
 * @param {Crudo} nodo
 * @param {Crudo} contenido
 * @returns {ContenidoInterpretado}
 */
function interpretarAnimacion(nodo, contenido) {
  /** @type {Adjunto[]} */
  const adjuntos = [];
  let hayStickers = false;

  for (const crudo of aLista(contenido.animated_media)) {
    if (!esObjeto(crudo)) {
      continue;
    }

    // Se prefiere WebP: se ve animado en una etiqueta <img>, sin controles de video.
    const direcciones = direccionesAlternas('', [crudo.attachment_webp_url, crudo.attachment_mp4_url, crudo.preview_cdn_url]);

    if (direcciones.length === 0) {
      continue;
    }

    if (crudo.is_sticker === true) {
      hayStickers = true;
    }

    adjuntos.push(
      crearAdjunto('animacion', direcciones[0], {
        urlsAlternas: direcciones.slice(1),
        ancho: aEntero(crudo.preview_width),
        alto: aEntero(crudo.preview_height),
        textoAlternativo: aTexto(crudo.alt_text),
      }),
    );
  }

  return { tipo: hayStickers ? 'sticker' : 'gif', texto: textoPropio(nodo, contenido), adjuntos, compartido: null };
}

/**
 * Fotos y videos «de ver una vez». Solo se descargan si quien los envió permitió conservarlos
 * en el chat; los demás se anotan sin guardar el archivo, porque se enviaron para desaparecer.
 * @param {Crudo} contenido
 * @param {boolean} esDeVideo
 * @returns {ContenidoInterpretado}
 */
function interpretarEfimero(contenido, esDeVideo) {
  const seConserva = aEntero(contenido.view_mode) === MODO_CONSERVAR_EN_CHAT;

  if (seConserva) {
    const adjunto = adjuntoDesdeArchivo(contenido.attachment, esDeVideo ? 'video' : 'imagen');

    if (adjunto !== null) {
      return { tipo: esDeVideo ? 'video' : 'foto', texto: '', adjuntos: [adjunto], compartido: null };
    }
  }

  const texto = esDeVideo ? 'Video de visualización única' : 'Foto de visualización única';

  return { tipo: 'efimero', texto, adjuntos: [], compartido: null };
}

/**
 * Stickers de tienda, de avatar, recortados o hechos con IA.
 * @param {Crudo} nodo
 * @param {Crudo} contenido
 * @returns {ContenidoInterpretado}
 */
function interpretarSticker(nodo, contenido) {
  /** @type {Adjunto[]} */
  const adjuntos = [];
  const direccion = urlSegura(contenido.preview_url);

  if (direccion !== '') {
    adjuntos.push(
      crearAdjunto('sticker', direccion, {
        ancho: aEntero(contenido.preview_width),
        alto: aEntero(contenido.preview_height),
        textoAlternativo: aTexto(contenido.alt_text),
      }),
    );
  }

  return { tipo: 'sticker', texto: textoPropio(nodo, contenido), adjuntos, compartido: null };
}

/**
 * Tarjetas de contenido compartido y enlaces con vista previa.
 * @param {Crudo} nodo
 * @param {Crudo} contenido
 * @returns {ContenidoInterpretado}
 */
function interpretarCompartido(nodo, contenido) {
  const textoDeLaTarjeta = aTexto(contenido.xma_text_body);
  const texto = textoPropio(nodo, contenido) || textoDeLaTarjeta;

  if (!esObjeto(contenido.xma)) {
    return { tipo: texto === '' ? 'compartido' : 'texto', texto, adjuntos: [], compartido: null };
  }

  const compartido = compartidoDesdeTarjeta(contenido.xma);
  // Un texto con enlace llega como tarjeta sin destino interno: es un mensaje de texto con vista previa.
  const esTextoConEnlace = textoDeLaTarjeta !== '' && aTexto(contenido.xma.target_id) === '';

  return { tipo: esTextoConEnlace ? 'texto' : 'compartido', texto, adjuntos: [], compartido };
}

/**
 * Canciones compartidas.
 * @param {Crudo} nodo
 * @param {Crudo} contenido
 * @returns {ContenidoInterpretado}
 */
function interpretarMusica(nodo, contenido) {
  /** @type {Crudo} */
  const pista = esObjeto(contenido.audio_track) ? contenido.audio_track : {};
  const portada = urlSegura(contenido.preview_url);

  return {
    tipo: 'musica',
    texto: textoPropio(nodo, contenido),
    adjuntos: [],
    compartido: {
      url: urlSegura(contenido.attribution_link),
      titulo: aTexto(pista.title),
      subtitulo: aTexto(pista.display_artist),
      autor: '',
      descripcion: '',
      cita: '',
      miniatura: portada === '' ? null : crearAdjunto('miniatura', portada),
    },
  };
}

/**
 * Respuestas del asistente de IA de Instagram.
 * @param {Crudo} nodo
 * @param {Crudo} contenido
 * @returns {ContenidoInterpretado}
 */
function interpretarRespuestaDeIA(nodo, contenido) {
  // «messasge_text_body» está escrito así en la respuesta de Instagram.
  const texto = textoPropio(nodo, contenido) || aTexto(contenido.unified_response) || aTexto(contenido.messasge_text_body);

  return { tipo: 'ia', texto, adjuntos: [], compartido: null };
}

/**
 * Tipos que este script no conoce: se rescata el texto y, si la hay, la imagen de vista previa.
 * @param {Crudo} nodo
 * @param {Crudo} contenido
 * @returns {ContenidoInterpretado}
 */
function interpretarDesconocido(nodo, contenido) {
  const rescatado = interpretarSticker(nodo, contenido);

  return { tipo: 'desconocido', texto: rescatado.texto, adjuntos: rescatado.adjuntos, compartido: null };
}

/**
 * Intérprete de cada tipo de contenido, por su nombre sin el prefijo «SlideMessage».
 * @type {Record<string, (nodo: Crudo, contenido: Crudo) => ContenidoInterpretado>}
 */
const INTERPRETES = {
  Text: interpretarTexto,
  AdminText: interpretarAviso,
  ImageContent: interpretarFotos,
  VideosContent: interpretarVideos,
  MultiMediaContent: interpretarAlbum,
  AudiosContent: interpretarAudios,
  AnimatedMediaContent: interpretarAnimacion,
  RavenImageContent: (_nodo, contenido) => interpretarEfimero(contenido, false),
  RavenVideoContent: (_nodo, contenido) => interpretarEfimero(contenido, true),
  StoreStickerContent: interpretarSticker,
  AvatarStickerXMAContent: interpretarSticker,
  CutoutStickerXMAContent: interpretarSticker,
  AIStickerXMAContent: interpretarSticker,
  XMAContent: interpretarCompartido,
  MusicStickerXMAContent: interpretarMusica,
  GenAIRichResponseXMAContent: interpretarRespuestaDeIA,
  GenAISearchPluginResponseXMAContent: interpretarRespuestaDeIA,
};

/**
 * Interpreta el contenido de un nodo según su tipo.
 * @param {Crudo} nodo
 * @returns {ContenidoInterpretado}
 */
function interpretarContenido(nodo) {
  /** @type {Crudo} */
  const contenido = esObjeto(nodo.content) ? nodo.content : {};
  const tipoOriginal = aTexto(contenido.__typename);
  const clave = tipoOriginal.startsWith(PREFIJO_DE_TIPO) ? tipoOriginal.slice(PREFIJO_DE_TIPO.length) : tipoOriginal;

  // Sin tipo declarado pero con texto, es un mensaje de texto corriente.
  if (clave === '' && textoPropio(nodo, contenido) !== '') {
    return interpretarTexto(nodo, contenido);
  }

  if (Object.hasOwn(INTERPRETES, clave)) {
    return INTERPRETES[clave](nodo, contenido);
  }

  return interpretarDesconocido(nodo, contenido);
}

/**
 * Resume un mensaje en una línea, para mostrarlo como cita.
 * @param {Crudo} nodo
 * @returns {string}
 */
function resumirNodo(nodo) {
  const interpretado = interpretarContenido(nodo);
  const texto = enUnaLinea(interpretado.texto || aTexto(nodo.igd_snippet));

  if (texto !== '') {
    return recortar(texto, LONGITUD_DE_RESUMEN);
  }

  return ETIQUETAS_DE_TIPO[interpretado.tipo];
}

/**
 * Lee el mensaje al que responde un nodo.
 * @param {Crudo} nodo
 * @returns {Cita | null}
 */
function leerCita(nodo) {
  const citado = nodo.replied_to_message;

  if (esObjeto(citado)) {
    return {
      idMensaje: aTexto(citado.message_id) || aTexto(citado.id),
      idRemitente: aTexto(citado.sender_fbid),
      resumen: resumirNodo(citado),
    };
  }

  const idCitado = aTexto(nodo.replied_to_message_id);

  if (idCitado === '') {
    return null;
  }

  return { idMensaje: idCitado, idRemitente: '', resumen: '' };
}

/**
 * Lee las reacciones de un nodo.
 * @param {Crudo} nodo
 * @returns {Reaccion[]}
 */
function leerReacciones(nodo) {
  /** @type {Reaccion[]} */
  const reacciones = [];

  for (const cruda of aLista(nodo.reactions)) {
    if (!esObjeto(cruda)) {
      continue;
    }

    const emoji = aTexto(cruda.reaction);

    if (emoji === '') {
      continue;
    }

    reacciones.push({
      emoji,
      idRemitente: aTexto(cruda.sender_fbid),
      marcaTiempoMs: aEntero(cruda.reaction_timestamp_ms),
    });
  }

  return reacciones;
}

/**
 * Convierte un nodo de Instagram en un mensaje del modelo propio.
 * @param {Crudo} nodo
 * @returns {ResultadoNormalizacion}
 */
function normalizarMensaje(nodo) {
  const marcaTiempoMs = aEntero(nodo.timestamp_ms);

  if (marcaTiempoMs <= 0) {
    return { mensaje: null, descarte: 'fila sin fecha' };
  }

  /** @type {Crudo} */
  const contenido = esObjeto(nodo.content) ? nodo.content : {};

  // «X reaccionó con ❤ a tu mensaje»: es un registro, no un mensaje. La reacción ya va en su mensaje.
  if (contenido.is_reaction_action_log === true) {
    return { mensaje: null, descarte: 'registro de reacción' };
  }

  const interpretado = interpretarContenido(nodo);
  let texto = interpretado.texto;
  const estaVacio = texto === '' && interpretado.adjuntos.length === 0 && interpretado.compartido === null;

  if (estaVacio) {
    // Instagram acompaña cada mensaje de un resumen («Envió una foto»): mejor eso que nada.
    texto = aTexto(nodo.igd_snippet);
  }

  const idPrincipal = aTexto(nodo.message_id) || aTexto(nodo.id);
  const idDelNodo = aTexto(nodo.id);

  return {
    descarte: '',
    mensaje: {
      id: idPrincipal,
      // Las citas pueden nombrar al mensaje por cualquiera de sus dos identificadores.
      idAlterno: idDelNodo === idPrincipal ? '' : idDelNodo,
      marcaTiempoMs,
      idRemitente: aTexto(nodo.sender_fbid),
      tipo: interpretado.tipo,
      tipoOriginal: aTexto(contenido.__typename),
      texto,
      adjuntos: interpretado.adjuntos,
      compartido: interpretado.compartido,
      respuestaA: leerCita(nodo),
      reacciones: leerReacciones(nodo),
      editado: Array.isArray(nodo.slide_edit_history) && nodo.slide_edit_history.length > 0,
      reenviado: nodo.igd_is_forwarded === true,
      crudo: interpretado.tipo === 'desconocido' ? contenido : null,
    },
  };
}

// ═══ MÓDULO directorio-participantes ═════════════════════════════════════════════════════════════════

/**
 * @file Directorio de quienes participan en la conversación.
 * Responsabilidad única: saber cómo se llama cada remitente y cuál de ellos es quien exporta.
 *
 * Los nombres llegan por dos vías: los datos de la conversación (lista de usuarios y apodos) y
 * cada mensaje, que lleva los de su remitente. Se usan las dos para no depender de una sola.
 */

const NOMBRE_DESCONOCIDO = 'Usuario de Instagram';
const NOMBRE_PROPIO_POR_DEFECTO = 'Yo';

class DirectorioParticipantes {
  /** Participantes por su identificador de mensajería. */
  /** @type {Map<string, Participante>} */
  #porId = new Map();

  /** @type {IdentidadPropia} */
  #identidad;

  /**
   * @param {IdentidadPropia} identidad Lo que la página dice de quien exporta.
   */
  constructor(identidad) {
    this.#identidad = identidad;
  }

  /**
   * Devuelve la ficha de un participante y la crea vacía si no existía.
   * @param {string} id
   * @returns {Participante}
   */
  #obtener(id) {
    let participante = this.#porId.get(id);

    if (participante === undefined) {
      participante = { id, idInstagram: '', nombre: '', usuario: '', apodo: '', esYo: false };
      this.#porId.set(id, participante);
    }

    return participante;
  }

  /**
   * Completa una ficha con los datos que falten. Nunca pisa un dato ya conocido.
   * @param {Participante} participante
   * @param {{ idInstagram: string, nombre: string, usuario: string }} datos
   * @returns {void}
   */
  #completar(participante, datos) {
    if (participante.idInstagram === '') {
      participante.idInstagram = datos.idInstagram;
    }

    if (participante.nombre === '') {
      participante.nombre = datos.nombre;
    }

    if (participante.usuario === '') {
      participante.usuario = datos.usuario;
    }

    const coincideConLaCuenta = this.#identidad.idInstagram !== '' && participante.idInstagram === this.#identidad.idInstagram;
    const coincideConLaMensajeria = this.#identidad.idMensajeria !== '' && participante.id === this.#identidad.idMensajeria;

    if (coincideConLaCuenta || coincideConLaMensajeria) {
      participante.esYo = true;
    }
  }

  /**
   * Registra un usuario de los datos de la conversación.
   * @param {Crudo} usuario
   * @param {boolean} esQuienExporta
   * @returns {void}
   */
  #registrarUsuario(usuario, esQuienExporta) {
    let id = aTexto(usuario.interop_messaging_user_fbid);

    if (id === '' && esQuienExporta) {
      id = this.#identidad.idMensajeria;
    }

    if (id === '') {
      return;
    }

    const participante = this.#obtener(id);

    this.#completar(participante, {
      idInstagram: aTexto(usuario.id) || aTexto(usuario.pk),
      nombre: aTexto(usuario.full_name),
      usuario: aTexto(usuario.username),
    });

    if (esQuienExporta) {
      participante.esYo = true;
    }
  }

  /**
   * Registra los usuarios, quien exporta y los apodos que traen los datos de la conversación.
   * @param {Crudo} hilo
   * @returns {void}
   */
  registrarHilo(hilo) {
    for (const usuario of aLista(hilo.users)) {
      if (esObjeto(usuario)) {
        this.#registrarUsuario(usuario, false);
      }
    }

    if (esObjeto(hilo.viewer)) {
      this.#registrarUsuario(hilo.viewer, true);
    }

    for (const entrada of aLista(hilo.nicknames)) {
      if (!esObjeto(entrada)) {
        continue;
      }

      const id = aTexto(entrada.eimu_id);
      const apodo = aTexto(entrada.nickname);

      if (id !== '' && apodo !== '') {
        this.#obtener(id).apodo = apodo;
      }
    }
  }

  /**
   * Registra al remitente de un mensaje con los datos que el propio mensaje trae.
   * @param {Crudo} nodo Mensaje crudo de Instagram.
   * @returns {void}
   */
  registrarRemitente(nodo) {
    const id = aTexto(nodo.sender_fbid);

    if (id === '') {
      return;
    }

    /** @type {Crudo} */
    const remitente = esObjeto(nodo.sender) ? nodo.sender : {};
    /** @type {Crudo} */
    const ficha = esObjeto(remitente.user_dict) ? remitente.user_dict : {};

    this.#completar(this.#obtener(id), {
      idInstagram: aTexto(remitente.igid) || aTexto(ficha.id) || aTexto(ficha.pk),
      nombre: aTexto(ficha.full_name) || aTexto(remitente.name),
      usuario: aTexto(ficha.username),
    });
  }

  /**
   * Indica si un identificador de mensajería es el de quien exporta.
   * @param {string} id
   * @returns {boolean}
   */
  esYo(id) {
    if (id === '') {
      return false;
    }

    if (id === this.#identidad.idMensajeria) {
      return true;
    }

    const participante = this.#porId.get(id);

    return participante !== undefined && participante.esYo;
  }

  /**
   * Nombre para mostrar: el apodo puesto en el chat, el nombre, el usuario o un genérico.
   * @param {string} id
   * @returns {string}
   */
  nombreDe(id) {
    const participante = this.#porId.get(id);
    const esPropio = this.esYo(id);

    if (participante !== undefined) {
      if (participante.apodo !== '') {
        return participante.apodo;
      }

      if (participante.nombre !== '') {
        return participante.nombre;
      }

      // Para quien exporta, el nombre que da la página vale más que su nombre de usuario.
      if (esPropio && this.#identidad.nombre !== '') {
        return this.#identidad.nombre;
      }

      if (participante.usuario !== '') {
        return `@${participante.usuario}`;
      }
    }

    if (esPropio) {
      return this.#identidad.nombre || NOMBRE_PROPIO_POR_DEFECTO;
    }

    return NOMBRE_DESCONOCIDO;
  }

  /**
   * Lista de participantes: primero los demás por orden alfabético y al final quien exporta.
   * @returns {Participante[]}
   */
  lista() {
    /** @type {Participante[]} */
    const participantes = [];

    for (const participante of this.#porId.values()) {
      const esPropio = this.esYo(participante.id);
      let nombre = participante.nombre;
      let usuario = participante.usuario;

      if (esPropio && nombre === '') {
        nombre = this.#identidad.nombre;
      }

      if (esPropio && usuario === '') {
        usuario = this.#identidad.usuario;
      }

      participantes.push({ ...participante, nombre, usuario, esYo: esPropio });
    }

    participantes.sort((a, b) => {
      if (a.esYo !== b.esYo) {
        return a.esYo ? 1 : -1;
      }

      return this.nombreDe(a.id).localeCompare(this.nombreDe(b.id), 'es');
    });

    return participantes;
  }
}

// ═══ MÓDULO almacen-mensajes ═════════════════════════════════════════════════════════════════════════

/**
 * @file Almacén de los mensajes capturados.
 * Responsabilidad única: guardar cada mensaje una sola vez y entregarlos en orden cronológico.
 *
 * Instagram entrega el historial del mensaje más nuevo al más antiguo. Se guarda en ese orden,
 * que es el de llegada, y al final se invierte: no hace falta ordenar mientras se carga.
 */

class AlmacenMensajes {
  /** Mensajes en orden de llegada: del más nuevo al más antiguo. */
  /** @type {Mensaje[]} */
  #mensajes = [];

  /** Identificadores ya guardados, para no duplicar un mensaje que llegue dos veces. */
  /** @type {Set<string>} */
  #identificadores = new Set();

  /** Mensajes que llegaron sin identificador y recibieron uno propio. */
  #sinIdentificador = 0;

  #masAntiguoMs = Number.POSITIVE_INFINITY;

  #masNuevoMs = Number.NEGATIVE_INFINITY;

  /** @returns {number} */
  get cantidad() {
    return this.#mensajes.length;
  }

  /** @returns {number} Marca de tiempo del mensaje más antiguo, o 0 si el almacén está vacío. */
  get masAntiguoMs() {
    if (this.#mensajes.length === 0) {
      return 0;
    }

    return this.#masAntiguoMs;
  }

  /** @returns {number} Marca de tiempo del mensaje más nuevo, o 0 si el almacén está vacío. */
  get masNuevoMs() {
    if (this.#mensajes.length === 0) {
      return 0;
    }

    return this.#masNuevoMs;
  }

  /**
   * Guarda un mensaje si no estaba ya.
   * @param {Mensaje} mensaje
   * @returns {boolean} true si era nuevo.
   */
  agregar(mensaje) {
    if (mensaje.id === '') {
      // Sin identificador no se puede comprobar si está repetido: se conserva con uno propio.
      this.#sinIdentificador += 1;
      mensaje.id = `sin-identificador-${this.#sinIdentificador}`;
    }

    if (this.#identificadores.has(mensaje.id)) {
      return false;
    }

    this.#identificadores.add(mensaje.id);
    this.#mensajes.push(mensaje);

    if (mensaje.marcaTiempoMs < this.#masAntiguoMs) {
      this.#masAntiguoMs = mensaje.marcaTiempoMs;
    }

    if (mensaje.marcaTiempoMs > this.#masNuevoMs) {
      this.#masNuevoMs = mensaje.marcaTiempoMs;
    }

    return true;
  }

  /**
   * Devuelve los mensajes del más antiguo al más nuevo.
   * @returns {Mensaje[]} Lista nueva; el almacén no cambia.
   */
  enOrdenCronologico() {
    const ordenados = this.#mensajes.slice().reverse();
    let yaEstaOrdenado = true;

    for (let i = 1; i < ordenados.length; i += 1) {
      if (ordenados[i].marcaTiempoMs < ordenados[i - 1].marcaTiempoMs) {
        yaEstaOrdenado = false;
        break;
      }
    }

    if (!yaEstaOrdenado) {
      // La ordenación del motor es estable: los mensajes del mismo milisegundo conservan su orden de llegada.
      ordenados.sort((a, b) => a.marcaTiempoMs - b.marcaTiempoMs);
    }

    return ordenados;
  }
}

/**
 * Indica si un mensaje cae dentro de las fechas pedidas.
 * @param {number} marcaTiempoMs
 * @param {Opciones} opciones
 * @returns {boolean}
 */
function estaEnElTramo(marcaTiempoMs, opciones) {
  if (opciones.desdeMs !== null && marcaTiempoMs < opciones.desdeMs) {
    return false;
  }

  if (opciones.hastaMs !== null && marcaTiempoMs > opciones.hastaMs) {
    return false;
  }

  return true;
}

/**
 * Aplica las opciones de tramo a una lista cronológica: fechas primero y, después,
 * los N mensajes más recientes.
 * @param {Mensaje[]} ordenados
 * @param {Opciones} opciones
 * @returns {Mensaje[]}
 */
function seleccionarTramo(ordenados, opciones) {
  let seleccion = ordenados;

  if (opciones.desdeMs !== null || opciones.hastaMs !== null) {
    seleccion = seleccion.filter((mensaje) => estaEnElTramo(mensaje.marcaTiempoMs, opciones));
  }

  if (opciones.ultimosMensajes > 0 && seleccion.length > opciones.ultimosMensajes) {
    seleccion = seleccion.slice(seleccion.length - opciones.ultimosMensajes);
  }

  return seleccion;
}

// ═══ MÓDULO crc32 ════════════════════════════════════════════════════════════════════════════════════

/**
 * @file CRC-32 (el de ZIP, PNG y gzip; polinomio reflejado 0xEDB88320).
 * Responsabilidad única: calcular la suma de comprobación que el formato ZIP exige por archivo.
 *
 * Se usa la técnica «slice-by-8»: ocho tablas de 256 entradas permiten consumir ocho bytes por
 * vuelta en lugar de uno, varias veces más rápido que la versión de una tabla. Importa porque la
 * multimedia de un chat puede sumar cientos de megabytes.
 */

const POLINOMIO = 0xedb88320;

/** Las ocho tablas seguidas en un solo bloque: la tabla t empieza en la posición t × 256. */
const TABLAS = construirTablas();

/**
 * Construye las tablas. La primera es la clásica (un byte por vuelta); cada una de las siguientes
 * adelanta un byte más el resultado de la anterior.
 * @returns {Uint32Array}
 */
function construirTablas() {
  const tablas = new Uint32Array(8 * 256);

  for (let byte = 0; byte < 256; byte += 1) {
    let resto = byte;

    for (let bit = 0; bit < 8; bit += 1) {
      if ((resto & 1) === 1) {
        resto = POLINOMIO ^ (resto >>> 1);
      } else {
        resto >>>= 1;
      }
    }

    tablas[byte] = resto;
  }

  for (let byte = 0; byte < 256; byte += 1) {
    let resto = tablas[byte];

    for (let tabla = 1; tabla < 8; tabla += 1) {
      resto = tablas[resto & 0xff] ^ (resto >>> 8);
      tablas[tabla * 256 + byte] = resto;
    }
  }

  return tablas;
}

/**
 * Continúa el cálculo del CRC-32 con más bytes. Permite sumar un archivo por trozos.
 * @param {number} crcPrevio  CRC de lo procesado hasta ahora (0 al empezar).
 * @param {Uint8Array} bytes
 * @returns {number} CRC-32 sin signo.
 */
function actualizarCrc32(crcPrevio, bytes) {
  const total = bytes.length;
  const finDeBloques = total - (total % 8);
  let crc = ~crcPrevio;
  let i = 0;

  while (i < finDeBloques) {
    // Los cuatro primeros bytes se mezclan con el estado; los cuatro siguientes entran directos.
    crc ^= bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24);
    crc =
      TABLAS[1792 + (crc & 0xff)] ^
      TABLAS[1536 + ((crc >>> 8) & 0xff)] ^
      TABLAS[1280 + ((crc >>> 16) & 0xff)] ^
      TABLAS[1024 + (crc >>> 24)] ^
      TABLAS[768 + bytes[i + 4]] ^
      TABLAS[512 + bytes[i + 5]] ^
      TABLAS[256 + bytes[i + 6]] ^
      TABLAS[bytes[i + 7]];
    i += 8;
  }

  while (i < total) {
    crc = TABLAS[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    i += 1;
  }

  return ~crc >>> 0;
}

// ═══ MÓDULO escritor-zip ═════════════════════════════════════════════════════════════════════════════

/**
 * @file Escritor de archivos ZIP.
 * Responsabilidad única: empaquetar archivos en un ZIP sin compresión (método «STORE»).
 *
 * Por qué sin compresión: las fotos, videos y audios ya vienen comprimidos; recomprimirlos solo
 * costaría tiempo. Y por qué escrito a mano: en la página de Instagram no se pueden cargar
 * librerías externas, y el formato sin compresión cabe en unas pocas cabeceras.
 *
 * Límite: es un ZIP clásico (sin la extensión ZIP64), así que admite hasta 65 535 archivos y
 * 4 GB en total. El exportador se mantiene por debajo con sus propios topes.
 */

const FIRMA_CABECERA_LOCAL = 0x04034b50;
const FIRMA_DIRECTORIO = 0x02014b50;
const FIRMA_FIN_DE_DIRECTORIO = 0x06054b50;

/** Versión 2.0 del formato: la mínima que entiende cualquier programa. */
const VERSION_ZIP = 20;

/** Bit 11 de las banderas: los nombres de archivo están en UTF-8. */
const BANDERA_UTF8 = 0x0800;

const ARCHIVOS_MAXIMOS = 65535;
const BYTES_MAXIMOS = 0xffffffff;

/** Caracteres que se juntan antes de codificar un archivo de texto, para no crear miles de trozos. */
const TAMANO_DE_LOTE_DE_TEXTO = 1 << 20;

/**
 * @typedef {Object} EntradaZip
 * @property {Uint8Array} nombre       Ruta del archivo, en UTF-8.
 * @property {number} crc
 * @property {number} tamano
 * @property {number} hora             Hora en formato MS-DOS.
 * @property {number} fecha            Fecha en formato MS-DOS.
 * @property {number} desplazamiento   Posición de su cabecera local dentro del ZIP.
 */

/**
 * Convierte una marca de tiempo al par (hora, fecha) de MS-DOS que usa el formato ZIP.
 * @param {number} marcaTiempoMs
 * @returns {{ hora: number, fecha: number }}
 */
function aFechaDos(marcaTiempoMs) {
  const momento = new Date(marcaTiempoMs);
  // El formato no puede representar años anteriores a 1980.
  const anio = Math.max(1980, momento.getFullYear());

  return {
    hora: (momento.getHours() << 11) | (momento.getMinutes() << 5) | (momento.getSeconds() >> 1),
    fecha: ((anio - 1980) << 9) | ((momento.getMonth() + 1) << 5) | momento.getDate(),
  };
}

class EscritorZip {
  /** Trozos del ZIP en orden. El navegador los une al crear el Blob, sin copiarlos a la memoria de JavaScript. */
  /** @type {BlobPart[]} */
  #partes = [];

  /** @type {EntradaZip[]} */
  #entradas = [];

  /** Bytes escritos hasta ahora: es la posición de la próxima cabecera local. */
  #desplazamiento = 0;

  #codificador = new TextEncoder();

  /** @returns {number} */
  get cantidad() {
    return this.#entradas.length;
  }

  /**
   * Añade un archivo cuyo contenido y CRC-32 ya se conocen.
   * @param {string} ruta           Ruta dentro del ZIP, con «/» como separador.
   * @param {BlobPart[]} contenido  Trozos del contenido, en orden.
   * @param {number} tamano         Bytes totales del contenido.
   * @param {number} crc            CRC-32 del contenido.
   * @param {number} marcaTiempoMs  Fecha que tendrá el archivo.
   * @returns {void}
   * @throws {ErrorExportacion} INTERNO si el ZIP clásico no puede contenerlo.
   */
  agregar(ruta, contenido, tamano, crc, marcaTiempoMs) {
    const nombre = this.#codificador.encode(ruta);
    const cabeceraLocal = 30 + nombre.length;
    // Lo que este archivo añadirá al directorio final, más el cierre del ZIP.
    const reservaDeDirectorio = (this.#entradas.length + 1) * 46 + nombre.length + 22;
    const cabeAunque = this.#desplazamiento + cabeceraLocal + tamano + reservaDeDirectorio < BYTES_MAXIMOS;

    if (this.#entradas.length >= ARCHIVOS_MAXIMOS || !cabeAunque) {
      throw new ErrorExportacion('INTERNO', 'El ZIP alcanzó el tamaño máximo del formato (65 535 archivos o 4 GB).');
    }

    const { hora, fecha } = aFechaDos(marcaTiempoMs);
    const cabecera = new Uint8Array(cabeceraLocal);
    const vista = new DataView(cabecera.buffer);

    vista.setUint32(0, FIRMA_CABECERA_LOCAL, true);
    vista.setUint16(4, VERSION_ZIP, true);
    vista.setUint16(6, BANDERA_UTF8, true);
    vista.setUint16(8, 0, true); // método 0: almacenado sin comprimir
    vista.setUint16(10, hora, true);
    vista.setUint16(12, fecha, true);
    vista.setUint32(14, crc, true);
    vista.setUint32(18, tamano, true); // tamaño comprimido: igual al original
    vista.setUint32(22, tamano, true);
    vista.setUint16(26, nombre.length, true);
    vista.setUint16(28, 0, true); // sin campo extra
    cabecera.set(nombre, 30);

    this.#entradas.push({ nombre, crc, tamano, hora, fecha, desplazamiento: this.#desplazamiento });
    this.#partes.push(cabecera);

    for (const trozo of contenido) {
      this.#partes.push(trozo);
    }

    this.#desplazamiento += cabeceraLocal + tamano;
  }

  /**
   * Añade un archivo de texto a partir de sus fragmentos. Los codifica en UTF-8 por lotes y
   * calcula el CRC-32 sobre la marcha, sin construir nunca el texto completo en una sola cadena.
   * @param {string} ruta
   * @param {string[]} fragmentos
   * @param {number} marcaTiempoMs
   * @returns {void}
   */
  agregarTexto(ruta, fragmentos, marcaTiempoMs) {
    /** @type {BlobPart[]} */
    const contenido = [];
    /** @type {string[]} */
    let lote = [];
    let caracteresDelLote = 0;
    let tamano = 0;
    let crc = 0;

    /** @returns {void} */
    const cerrarLote = () => {
      if (lote.length === 0) {
        return;
      }

      const bytes = this.#codificador.encode(lote.join(''));

      crc = actualizarCrc32(crc, bytes);
      tamano += bytes.length;
      contenido.push(bytes);
      lote = [];
      caracteresDelLote = 0;
    };

    for (const fragmento of fragmentos) {
      lote.push(fragmento);
      caracteresDelLote += fragmento.length;

      if (caracteresDelLote >= TAMANO_DE_LOTE_DE_TEXTO) {
        cerrarLote();
      }
    }

    cerrarLote();
    this.agregar(ruta, contenido, tamano, crc, marcaTiempoMs);
  }

  /**
   * Cierra el ZIP: escribe el directorio central y devuelve el archivo completo.
   * @returns {Blob}
   */
  generar() {
    /** @type {BlobPart[]} */
    const directorio = [];
    let tamanoDelDirectorio = 0;

    for (const entrada of this.#entradas) {
      const registro = new Uint8Array(46 + entrada.nombre.length);
      const vista = new DataView(registro.buffer);

      vista.setUint32(0, FIRMA_DIRECTORIO, true);
      vista.setUint16(4, VERSION_ZIP, true); // creado por: formato 2.0, sistema MS-DOS
      vista.setUint16(6, VERSION_ZIP, true); // versión necesaria para extraer
      vista.setUint16(8, BANDERA_UTF8, true);
      vista.setUint16(10, 0, true); // método 0
      vista.setUint16(12, entrada.hora, true);
      vista.setUint16(14, entrada.fecha, true);
      vista.setUint32(16, entrada.crc, true);
      vista.setUint32(20, entrada.tamano, true);
      vista.setUint32(24, entrada.tamano, true);
      vista.setUint16(28, entrada.nombre.length, true);
      // Bytes 30 a 41: campo extra, comentario, disco y atributos; todos a cero.
      vista.setUint32(42, entrada.desplazamiento, true);
      registro.set(entrada.nombre, 46);

      directorio.push(registro);
      tamanoDelDirectorio += registro.length;
    }

    const cierre = new Uint8Array(22);
    const vistaDelCierre = new DataView(cierre.buffer);

    vistaDelCierre.setUint32(0, FIRMA_FIN_DE_DIRECTORIO, true);
    // Bytes 4 a 7: números de disco, a cero (el ZIP ocupa un solo «disco»).
    vistaDelCierre.setUint16(8, this.#entradas.length, true);
    vistaDelCierre.setUint16(10, this.#entradas.length, true);
    vistaDelCierre.setUint32(12, tamanoDelDirectorio, true);
    vistaDelCierre.setUint32(16, this.#desplazamiento, true);
    // Bytes 20 y 21: longitud del comentario, a cero.

    return new Blob([...this.#partes, ...directorio, cierre], { type: 'application/zip' });
  }
}

// ═══ MÓDULO descargador-multimedia ═══════════════════════════════════════════════════════════════════

/**
 * @file Descarga de fotos, videos y audios.
 * Responsabilidad única: bajar los adjuntos en paralelo, con tope de tamaño, y anotar en cada uno
 * si se descargó o por qué no.
 *
 * Las direcciones de la multimedia de Instagram caducan a las pocas horas: lo que no se baje
 * durante la exportación ya no se podrá recuperar con el enlace guardado. Por eso un fallo nunca
 * se calla: queda escrito en el adjunto y en el resumen.
 */

const MOTIVO_DETENIDA = 'la exportación se detuvo antes de descargarlo';
const MOTIVO_LIMITE = 'se alcanzó el límite de tamaño de multimedia (limiteMultimediaMB)';
const MOTIVO_DEMASIADOS = 'el ZIP alcanzó su máximo de archivos';
const MOTIVO_BLOQUEO = 'el navegador no permite descargar desde ese servidor';
const MOTIVO_POLITICA = 'la política de seguridad de la página de Instagram no permite descargar desde ese servidor';
const MOTIVO_RED = 'falló la conexión o el navegador bloqueó la descarga';

/**
 * Extensión de archivo por tipo MIME.
 * @type {Record<string, string>}
 */
const EXTENSION_POR_MIME = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/webm': 'weba',
};

/**
 * Extensión que se usa cuando el servidor no dice el tipo y la dirección no ayuda.
 * @type {Record<ClaseAdjunto, string>}
 */
const EXTENSION_POR_CLASE = {
  imagen: 'jpg',
  video: 'mp4',
  audio: 'm4a',
  animacion: 'webp',
  sticker: 'png',
  miniatura: 'jpg',
};

/**
 * @typedef {Object} ContenidoDescargado
 * @property {Blob} blob
 * @property {number} crc  CRC-32 del contenido, que el ZIP necesita.
 */

/**
 * @typedef {Object} EstadoServidor
 * @property {number} exitos
 * @property {number} fallosSeguidos
 * @property {boolean} bloqueado
 * @property {boolean} vetadoPorPolitica  true si fue la política de seguridad de la página la que lo impidió.
 */

/**
 * @typedef {Object} IntentoDeDescarga
 * @property {Blob | null} blob   El contenido, o null si no se pudo bajar.
 * @property {string} motivo      Por qué no se pudo ('' si se pudo).
 * @property {boolean} esDeRed    true si el fallo fue de conexión o de permisos del navegador.
 * @property {boolean} esDefinitivo true si no tiene sentido probar otra dirección.
 */

/**
 * @typedef {Object} DependenciasDescargador
 * @property {Document} documento
 * @property {ControlEjecucion} control
 * @property {RegistroDiagnostico} registro
 * @property {AjustesAvanzados} ajustes
 * @property {number} simultaneas
 * @property {number} limiteBytes
 * @property {() => void} alProgresar  Aviso para refrescar el panel.
 */

/**
 * Elige la extensión de archivo de un adjunto descargado.
 * @param {string} tipoMime
 * @param {string} direccion
 * @param {ClaseAdjunto} clase
 * @returns {string}
 */
function extensionPara(tipoMime, direccion, clase) {
  if (Object.hasOwn(EXTENSION_POR_MIME, tipoMime)) {
    return EXTENSION_POR_MIME[tipoMime];
  }

  try {
    const ruta = new URL(direccion).pathname;
    const coincidencia = /\.([a-z0-9]{2,5})$/i.exec(ruta);

    if (coincidencia !== null) {
      const extension = coincidencia[1].toLowerCase();

      if (Object.values(EXTENSION_POR_MIME).includes(extension) || extension === 'jpeg') {
        return extension === 'jpeg' ? 'jpg' : extension;
      }
    }
  } catch {
    // Dirección mal formada: se usa la extensión por clase.
  }

  return EXTENSION_POR_CLASE[clase];
}

class DescargadorMultimedia {
  /** @type {ControlEjecucion} */
  #control;

  /** @type {RegistroDiagnostico} */
  #registro;

  /** @type {AjustesAvanzados} */
  #ajustes;

  #simultaneas;

  #limiteBytes;

  /** @type {() => void} */
  #alProgresar;

  /** Adjuntos que esperan turno. */
  /** @type {ColaCircular<Adjunto>} */
  #cola = new ColaCircular(64);

  /** Descargas en curso. */
  #activas = 0;

  /** Contenido de cada adjunto descargado. Va aparte del modelo porque no se serializa. */
  /** @type {Map<Adjunto, ContenidoDescargado>} */
  #contenidos = new Map();

  /** Salud de cada servidor, para dejar de insistir en uno que el navegador bloquea. */
  /** @type {Map<string, EstadoServidor>} */
  #servidores = new Map();

  /** Funciones que esperan a que no quede nada pendiente. */
  /** @type {(() => void)[]} */
  #alVaciarse = [];

  #encolados = 0;

  #descargados = 0;

  #fallidos = 0;

  #omitidos = 0;

  #bytes = 0;

  /** Cuántos adjuntos se quedaron sin descargar por cada motivo. */
  /** @type {Map<string, number>} */
  #motivos = new Map();

  /** @type {Document} */
  #documento;

  /**
   * Atiende los avisos del navegador cuando la política de seguridad de la página impide una conexión.
   * Con el primero ya se sabe que ese servidor está vetado y no se insiste con él.
   * @param {SecurityPolicyViolationEvent} evento
   * @returns {void}
   */
  #alInfringirLaPolitica = (evento) => {
    if (evento.effectiveDirective !== 'connect-src') {
      return;
    }

    let servidor = '';

    try {
      servidor = new URL(evento.blockedURI).hostname;
    } catch {
      return;
    }

    const estado = this.#estadoDe(servidor);

    if (!estado.bloqueado) {
      estado.bloqueado = true;
      estado.vetadoPorPolitica = true;
      this.#registro.anotar('servidor de multimedia vetado por la política de la página', { servidor });
    }
  };

  /**
   * @param {DependenciasDescargador} dependencias
   */
  constructor(dependencias) {
    this.#documento = dependencias.documento;
    this.#control = dependencias.control;
    this.#registro = dependencias.registro;
    this.#ajustes = dependencias.ajustes;
    this.#simultaneas = dependencias.simultaneas;
    this.#limiteBytes = dependencias.limiteBytes;
    this.#alProgresar = dependencias.alProgresar;
    this.#documento.addEventListener('securitypolicyviolation', this.#alInfringirLaPolitica);
  }

  /**
   * Deja de escuchar los avisos de la página. Se llama cuando ya no quedan descargas.
   * @returns {void}
   */
  cerrar() {
    this.#documento.removeEventListener('securitypolicyviolation', this.#alInfringirLaPolitica);
  }

  /** @returns {number} Adjuntos que se han pedido descargar. */
  get encolados() {
    return this.#encolados;
  }

  /** @returns {number} Adjuntos ya resueltos: descargados, fallidos u omitidos. */
  get resueltos() {
    return this.#descargados + this.#fallidos + this.#omitidos;
  }

  /** @returns {number} */
  get descargados() {
    return this.#descargados;
  }

  /** @returns {number} */
  get bytes() {
    return this.#bytes;
  }

  /**
   * Pone un adjunto en la cola de descarga.
   * @param {Adjunto} adjunto
   * @returns {void}
   */
  encolar(adjunto) {
    this.#encolados += 1;
    this.#cola.encolar(adjunto);
    this.#arrancarDescargas();
  }

  /**
   * Devuelve el contenido de un adjunto descargado.
   * @param {Adjunto} adjunto
   * @returns {ContenidoDescargado | undefined}
   */
  contenidoDe(adjunto) {
    return this.#contenidos.get(adjunto);
  }

  /**
   * Espera a que no quede ninguna descarga pendiente ni en curso.
   * @returns {Promise<void>}
   */
  esperarFin() {
    if (this.#activas === 0 && this.#cola.longitud === 0) {
      return Promise.resolve();
    }

    return new Promise((resolver) => {
      this.#alVaciarse.push(resolver);
    });
  }

  /**
   * @returns {ResumenMultimedia}
   */
  resumen() {
    return {
      descargados: this.#descargados,
      fallidos: this.#fallidos,
      omitidos: this.#omitidos,
      bytes: this.#bytes,
      motivos: Object.fromEntries(this.#motivos),
    };
  }

  /**
   * Arranca descargas mientras haya adjuntos en cola y huecos libres.
   * @returns {void}
   */
  #arrancarDescargas() {
    while (this.#activas < this.#simultaneas && this.#cola.longitud > 0) {
      const adjunto = this.#cola.desencolar();

      if (adjunto === undefined) {
        break;
      }

      this.#activas += 1;
      void this.#atender(adjunto);
    }
  }

  /**
   * Atiende un adjunto y, al terminar, cede el hueco al siguiente.
   * @param {Adjunto} adjunto
   * @returns {Promise<void>}
   */
  async #atender(adjunto) {
    try {
      await this.#resolver(adjunto);
    } catch {
      // Un fallo inesperado no debe dejar el adjunto en «pendiente» ni detener la cola.
      this.#marcarSinDescargar(adjunto, 'fallido', MOTIVO_RED);
    }

    this.#activas -= 1;
    this.#alProgresar();
    this.#arrancarDescargas();

    if (this.#activas === 0 && this.#cola.longitud === 0) {
      const esperando = this.#alVaciarse;

      this.#alVaciarse = [];

      for (const avisar of esperando) {
        avisar();
      }
    }
  }

  /**
   * Anota que un adjunto no se descargó.
   * @param {Adjunto} adjunto
   * @param {'fallido' | 'omitido'} estado
   * @param {string} motivo
   * @returns {void}
   */
  #marcarSinDescargar(adjunto, estado, motivo) {
    adjunto.estado = estado;
    adjunto.motivo = motivo;

    if (estado === 'fallido') {
      this.#fallidos += 1;
    } else {
      this.#omitidos += 1;
    }

    this.#motivos.set(motivo, (this.#motivos.get(motivo) ?? 0) + 1);
  }

  /**
   * Devuelve la ficha de salud de un servidor.
   * @param {string} servidor
   * @returns {EstadoServidor}
   */
  #estadoDe(servidor) {
    let estado = this.#servidores.get(servidor);

    if (estado === undefined) {
      estado = { exitos: 0, fallosSeguidos: 0, bloqueado: false, vetadoPorPolitica: false };
      this.#servidores.set(servidor, estado);
    }

    return estado;
  }

  /**
   * Intenta descargar un adjunto probando su dirección principal y las de respaldo.
   * @param {Adjunto} adjunto
   * @returns {Promise<void>}
   */
  async #resolver(adjunto) {
    if (this.#control.detenido) {
      this.#marcarSinDescargar(adjunto, 'omitido', MOTIVO_DETENIDA);
      return;
    }

    if (this.#descargados >= this.#ajustes.archivosMaximosEnZip) {
      this.#marcarSinDescargar(adjunto, 'omitido', MOTIVO_DEMASIADOS);
      return;
    }

    if (this.#bytes >= this.#limiteBytes) {
      this.#marcarSinDescargar(adjunto, 'omitido', MOTIVO_LIMITE);
      return;
    }

    let ultimoMotivo = MOTIVO_RED;

    for (const direccion of [adjunto.url, ...adjunto.urlsAlternas]) {
      let servidor = '';

      try {
        servidor = new URL(direccion).hostname;
      } catch {
        continue;
      }

      const estado = this.#estadoDe(servidor);

      if (estado.bloqueado) {
        ultimoMotivo = estado.vetadoPorPolitica ? MOTIVO_POLITICA : MOTIVO_BLOQUEO;
        continue;
      }

      const intento = await this.#bajar(direccion);

      if (intento.blob !== null) {
        estado.exitos += 1;
        estado.fallosSeguidos = 0;
        await this.#guardar(adjunto, intento.blob);
        return;
      }

      ultimoMotivo = intento.motivo;

      if (intento.esDeRed) {
        // El aviso de la política de seguridad llega en otra vuelta del bucle de eventos: se le da paso.
        await new Promise((resolver) => setTimeout(resolver, 0));
      }

      if (intento.esDeRed && estado.vetadoPorPolitica) {
        // El aviso de la política llegó mientras se intentaba: el motivo exacto es ese.
        ultimoMotivo = MOTIVO_POLITICA;
      }

      if (intento.esDeRed) {
        estado.fallosSeguidos += 1;

        // Un servidor que nunca respondió y falla varias veces seguidas está vetado por el navegador
        // (CORS o política de seguridad de la página): seguir intentándolo solo llenaría la consola de errores.
        const nuncaFunciono = estado.exitos === 0 && estado.fallosSeguidos >= this.#ajustes.fallosSeguidosPorServidor;

        if (nuncaFunciono) {
          estado.bloqueado = true;
          this.#registro.anotar('servidor de multimedia bloqueado', { servidor });
        }
      }

      if (intento.esDefinitivo) {
        break;
      }
    }

    const fueOmitido = ultimoMotivo === MOTIVO_LIMITE || ultimoMotivo === MOTIVO_DETENIDA;

    this.#marcarSinDescargar(adjunto, fueOmitido ? 'omitido' : 'fallido', ultimoMotivo);
  }

  /**
   * Descarga una dirección.
   * @param {string} direccion
   * @returns {Promise<IntentoDeDescarga>}
   */
  async #bajar(direccion) {
    const senalInterrumpir = this.#control.senalInterrumpir;
    const controlDescarga = new AbortController();

    /** @returns {void} */
    const alInterrumpir = () => controlDescarga.abort();

    if (senalInterrumpir.aborted) {
      return { blob: null, motivo: MOTIVO_DETENIDA, esDeRed: false, esDefinitivo: true };
    }

    senalInterrumpir.addEventListener('abort', alInterrumpir, { once: true });

    const plazo = setTimeout(() => controlDescarga.abort(), this.#ajustes.tiempoLimiteDescargaMs);

    try {
      // Sin cookies ni referente: las direcciones de la multimedia ya van firmadas y el servidor
      // solo permite la lectura desde otra página cuando la petición llega sin credenciales.
      const respuesta = await fetch(direccion, {
        mode: 'cors',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: controlDescarga.signal,
      });

      if (!respuesta.ok) {
        return { blob: null, motivo: `el servidor respondió HTTP ${respuesta.status} (el enlace pudo caducar)`, esDeRed: false, esDefinitivo: false };
      }

      const anunciado = aEntero(respuesta.headers.get('content-length'));

      if (anunciado > 0 && this.#bytes + anunciado > this.#limiteBytes) {
        controlDescarga.abort();

        return { blob: null, motivo: MOTIVO_LIMITE, esDeRed: false, esDefinitivo: true };
      }

      const blob = await respuesta.blob();

      return { blob, motivo: '', esDeRed: false, esDefinitivo: true };
    } catch {
      if (this.#control.detenido) {
        return { blob: null, motivo: MOTIVO_DETENIDA, esDeRed: false, esDefinitivo: true };
      }

      return { blob: null, motivo: MOTIVO_RED, esDeRed: true, esDefinitivo: false };
    } finally {
      clearTimeout(plazo);
      senalInterrumpir.removeEventListener('abort', alInterrumpir);
    }
  }

  /**
   * Da por descargado un adjunto: calcula su CRC-32 y guarda su contenido.
   * @param {Adjunto} adjunto
   * @param {Blob} blob
   * @returns {Promise<void>}
   */
  async #guardar(adjunto, blob) {
    if (this.#bytes + blob.size > this.#limiteBytes) {
      this.#marcarSinDescargar(adjunto, 'omitido', MOTIVO_LIMITE);
      return;
    }

    // Se reserva el espacio antes de la pausa asíncrona, para que varias descargas que terminan
    // a la vez no superen juntas el límite.
    this.#bytes += blob.size;

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const crc = actualizarCrc32(0, bytes);

    adjunto.estado = 'descargado';
    adjunto.motivo = '';
    adjunto.bytes = blob.size;
    adjunto.tipoMime = blob.type.split(';')[0].trim().toLowerCase();
    this.#contenidos.set(adjunto, { blob, crc });
    this.#descargados += 1;
  }
}

// ═══ MÓDULO etiquetas ════════════════════════════════════════════════════════════════════════════════

/**
 * @file Textos que comparten los tres archivos de salida (HTML, TXT y JSON).
 * Responsabilidad única: nombrar en español adjuntos, estados y recuentos de la conversación.
 */

/**
 * Nombre de cada clase de adjunto.
 * @type {Record<ClaseAdjunto, string>}
 */
const NOMBRE_DE_CLASE = {
  imagen: 'Foto',
  video: 'Video',
  audio: 'Mensaje de voz',
  animacion: 'GIF',
  sticker: 'Sticker',
  miniatura: 'Miniatura',
};

/**
 * Duración en minutos y segundos: «0:12».
 * @param {number} milisegundos
 * @returns {string}
 */
function duracionCorta(milisegundos) {
  const segundosTotales = Math.max(0, Math.round(milisegundos / 1000));
  const minutos = Math.floor(segundosTotales / 60);
  const segundos = segundosTotales % 60;

  return `${minutos}:${String(segundos).padStart(2, '0')}`;
}

/**
 * Nombre de un adjunto, con su duración si la tiene.
 * @param {Adjunto} adjunto
 * @returns {string}
 */
function nombreDeAdjunto(adjunto) {
  const nombre = NOMBRE_DE_CLASE[adjunto.clase];

  if (adjunto.duracionMs > 0) {
    return `${nombre} (${duracionCorta(adjunto.duracionMs)})`;
  }

  return nombre;
}

/**
 * Explica por qué un adjunto no está en el ZIP.
 * @param {Adjunto} adjunto
 * @returns {string}
 */
function explicarAusencia(adjunto) {
  if (adjunto.estado === 'pendiente') {
    return 'no se pidió descargar (descargarMultimedia: false)';
  }

  return adjunto.motivo;
}

/**
 * Texto que sustituye al contenido de un mensaje que no trae nada legible.
 * @param {Mensaje} mensaje
 * @returns {string}
 */
function notaDeMensajeVacio(mensaje) {
  if (mensaje.tipo === 'desconocido') {
    const tipo = mensaje.tipoOriginal === '' ? 'sin tipo declarado' : mensaje.tipoOriginal;

    return `${ETIQUETAS_DE_TIPO.desconocido} (${tipo})`;
  }

  if (mensaje.tipo === 'texto') {
    return 'Mensaje sin contenido';
  }

  return `${ETIQUETAS_DE_TIPO[mensaje.tipo]} que ya no está disponible`;
}

/**
 * @typedef {Object} ResumenConversacion
 * @property {number} total
 * @property {number} primerMs                  0 si no hay mensajes.
 * @property {number} ultimoMs
 * @property {{ id: string, nombre: string, cantidad: number }[]} porParticipante
 * @property {Record<string, number>} porTipo
 */

/**
 * Cuenta los mensajes por participante y por tipo.
 * @param {ContextoSalida} contexto
 * @returns {ResumenConversacion}
 */
function resumirConversacion(contexto) {
  /** @type {Map<string, number>} */
  const porRemitente = new Map();
  /** @type {Record<string, number>} */
  const porTipo = {};

  for (const mensaje of contexto.mensajes) {
    porTipo[mensaje.tipo] = (porTipo[mensaje.tipo] ?? 0) + 1;

    const esAviso = mensaje.tipo === 'sistema' || mensaje.tipo === 'llamada';

    if (!esAviso) {
      porRemitente.set(mensaje.idRemitente, (porRemitente.get(mensaje.idRemitente) ?? 0) + 1);
    }
  }

  /** @type {{ id: string, nombre: string, cantidad: number }[]} */
  const porParticipante = [];

  for (const [id, cantidad] of porRemitente) {
    porParticipante.push({ id, nombre: contexto.nombreDe(id), cantidad });
  }

  porParticipante.sort((a, b) => b.cantidad - a.cantidad);

  const total = contexto.mensajes.length;

  return {
    total,
    primerMs: total === 0 ? 0 : contexto.mensajes[0].marcaTiempoMs,
    ultimoMs: total === 0 ? 0 : contexto.mensajes[total - 1].marcaTiempoMs,
    porParticipante,
    porTipo,
  };
}

/**
 * Frase que describe el estado de la exportación.
 * @param {ContextoSalida} contexto
 * @returns {string}
 */
function describirEstado(contexto) {
  if (!contexto.estado.completa) {
    return `PARCIAL: ${contexto.estado.motivoParcial}`;
  }

  const opciones = contexto.opciones;
  /** @type {string[]} */
  const filtros = [];

  if (opciones.ultimosMensajes > 0) {
    filtros.push(`los ${opciones.ultimosMensajes} mensajes más recientes`);
  }

  if (opciones.desdeTexto !== '') {
    filtros.push(`desde el ${opciones.desdeTexto}`);
  }

  if (opciones.hastaTexto !== '') {
    filtros.push(`hasta el ${opciones.hastaTexto}`);
  }

  if (filtros.length === 0) {
    return 'Completa: desde el primer mensaje de la conversación';
  }

  return `Completa para el tramo pedido: ${filtros.join(', ')}`;
}

// ═══ MÓDULO serializador-json ════════════════════════════════════════════════════════════════════════

/**
 * @file Salida en JSON (chat.json).
 * Responsabilidad única: escribir la conversación como datos estructurados para otros programas.
 *
 * El archivo se entrega por fragmentos (uno por mensaje) en lugar de con un único
 * JSON.stringify: un chat de años no cabría en una sola cadena de texto.
 */

/**
 * @param {Adjunto} adjunto
 * @returns {Record<string, unknown>}
 */
function adjuntoParaJson(adjunto) {
  /** @type {Record<string, unknown>} */
  const salida = { clase: adjunto.clase, estado: adjunto.estado };

  if (adjunto.estado === 'descargado') {
    salida.archivo = adjunto.archivo;
    salida.bytes = adjunto.bytes;
    salida.tipoMime = adjunto.tipoMime;
  } else {
    salida.motivo = explicarAusencia(adjunto);
    // El enlace original caduca a las pocas horas; se guarda por si se quiere reintentar enseguida.
    salida.urlOriginal = adjunto.url;
  }

  if (adjunto.ancho > 0 && adjunto.alto > 0) {
    salida.ancho = adjunto.ancho;
    salida.alto = adjunto.alto;
  }

  if (adjunto.duracionMs > 0) {
    salida.duracionMs = adjunto.duracionMs;
  }

  if (adjunto.textoAlternativo !== '') {
    salida.textoAlternativo = adjunto.textoAlternativo;
  }

  return salida;
}

/**
 * @param {Compartido} compartido
 * @returns {Record<string, unknown>}
 */
function compartidoParaJson(compartido) {
  /** @type {Record<string, unknown>} */
  const salida = {};

  /** @type {[string, string][]} */
  const campos = [
    ['url', compartido.url],
    ['titulo', compartido.titulo],
    ['subtitulo', compartido.subtitulo],
    ['autor', compartido.autor],
    ['descripcion', compartido.descripcion],
    ['cita', compartido.cita],
  ];

  for (const [clave, valor] of campos) {
    if (valor !== '') {
      salida[clave] = valor;
    }
  }

  if (compartido.miniatura !== null) {
    salida.miniatura = adjuntoParaJson(compartido.miniatura);
  }

  return salida;
}

/**
 * @param {Mensaje} mensaje
 * @param {number} indice
 * @param {ContextoSalida} contexto
 * @returns {Record<string, unknown>}
 */
function mensajeParaJson(mensaje, indice, contexto) {
  /** @type {Record<string, unknown>} */
  const salida = {
    indice,
    id: mensaje.id,
    fecha: new Date(mensaje.marcaTiempoMs).toISOString(),
    fechaLocal: fechaHoraLocalOrdenable(mensaje.marcaTiempoMs),
    marcaTiempoMs: mensaje.marcaTiempoMs,
    remitente: { id: mensaje.idRemitente, nombre: contexto.nombreDe(mensaje.idRemitente) },
    esMio: contexto.esYo(mensaje.idRemitente),
    tipo: mensaje.tipo,
    texto: mensaje.texto,
  };

  if (mensaje.adjuntos.length > 0) {
    salida.adjuntos = mensaje.adjuntos.map(adjuntoParaJson);
  }

  if (mensaje.compartido !== null) {
    salida.compartido = compartidoParaJson(mensaje.compartido);
  }

  if (mensaje.respuestaA !== null) {
    const indiceCitado = contexto.indicePorId.get(mensaje.respuestaA.idMensaje);

    salida.respuestaA = {
      id: mensaje.respuestaA.idMensaje,
      indice: indiceCitado === undefined ? null : indiceCitado,
      remitente: mensaje.respuestaA.idRemitente === '' ? null : contexto.nombreDe(mensaje.respuestaA.idRemitente),
      resumen: mensaje.respuestaA.resumen,
    };
  }

  if (mensaje.reacciones.length > 0) {
    salida.reacciones = mensaje.reacciones.map((reaccion) => ({
      emoji: reaccion.emoji,
      de: contexto.nombreDe(reaccion.idRemitente),
    }));
  }

  if (mensaje.editado) {
    salida.editado = true;
  }

  if (mensaje.reenviado) {
    salida.reenviado = true;
  }

  if (mensaje.crudo !== null) {
    salida.tipoOriginal = mensaje.tipoOriginal;
    salida.contenidoOriginal = mensaje.crudo;
  }

  return salida;
}

/**
 * Escribe chat.json.
 * @param {ContextoSalida} contexto
 * @returns {string[]} Fragmentos del archivo, en orden.
 */
function serializarJson(contexto) {
  const resumen = resumirConversacion(contexto);
  const cabecera = {
    formato: 'exportador-instagram/1',
    exportacion: {
      version: contexto.version,
      fecha: new Date(contexto.exportadoMs).toISOString(),
      zonaHoraria: contexto.zonaHoraria,
      completa: contexto.estado.completa,
      estado: describirEstado(contexto),
      filtros: {
        ultimosMensajes: contexto.opciones.ultimosMensajes,
        desde: contexto.opciones.desdeTexto,
        hasta: contexto.opciones.hastaTexto,
      },
      paginasPedidas: contexto.estado.paginas,
      duracionMs: contexto.estado.duracionMs,
      filasQueNoSonMensajes: contexto.estado.descartados,
      tiposNoReconocidos: contexto.estado.tiposDesconocidos,
    },
    conversacion: {
      titulo: contexto.conversacion.titulo,
      esGrupo: contexto.conversacion.esGrupo,
      clave: contexto.conversacion.clave,
      idHilo: contexto.conversacion.idHilo,
      participantes: contexto.participantes.map((participante) => ({
        id: participante.id,
        nombre: contexto.nombreDe(participante.id),
        nombreReal: participante.nombre,
        usuario: participante.usuario,
        apodo: participante.apodo,
        esYo: participante.esYo,
      })),
    },
    resumen: {
      mensajes: resumen.total,
      primerMensaje: resumen.total === 0 ? null : new Date(resumen.primerMs).toISOString(),
      ultimoMensaje: resumen.total === 0 ? null : new Date(resumen.ultimoMs).toISOString(),
      porParticipante: resumen.porParticipante.map((fila) => ({ nombre: fila.nombre, mensajes: fila.cantidad })),
      porTipo: resumen.porTipo,
      multimedia: contexto.multimedia,
    },
  };

  const textoDeCabecera = JSON.stringify(cabecera, null, 2);
  // Se abre la cabecera para añadirle la lista de mensajes como última clave.
  /** @type {string[]} */
  const fragmentos = [textoDeCabecera.slice(0, textoDeCabecera.lastIndexOf('}')).trimEnd(), ',\n  "mensajes": ['];

  for (let i = 0; i < contexto.mensajes.length; i += 1) {
    const separador = i === 0 ? '\n    ' : ',\n    ';

    fragmentos.push(separador, JSON.stringify(mensajeParaJson(contexto.mensajes[i], i, contexto)));
  }

  fragmentos.push(contexto.mensajes.length === 0 ? ']\n}\n' : '\n  ]\n}\n');

  return fragmentos;
}

// ═══ MÓDULO serializador-texto ═══════════════════════════════════════════════════════════════════════

/**
 * @file Salida en texto plano (chat.txt).
 * Responsabilidad única: escribir la conversación en un formato que se lee en cualquier editor.
 */

/** Sangría de las líneas que continúan un mensaje (citas, reacciones). */
const SANGRIA = '        ';

/**
 * @param {Adjunto} adjunto
 * @returns {string}
 */
function adjuntoEnTexto(adjunto) {
  const nombre = nombreDeAdjunto(adjunto);

  if (adjunto.estado === 'descargado') {
    return `[${nombre}: ${adjunto.archivo}]`;
  }

  return `[${nombre} sin descargar: ${explicarAusencia(adjunto)}]`;
}

/**
 * Compone el contenido de un mensaje en una sola cadena.
 * @param {Mensaje} mensaje
 * @returns {string}
 */
function contenidoEnTexto(mensaje) {
  /** @type {string[]} */
  const trozos = [];

  if (mensaje.reenviado) {
    trozos.push('(reenviado)');
  }

  if (mensaje.texto !== '') {
    trozos.push(mensaje.texto);
  }

  for (const adjunto of mensaje.adjuntos) {
    trozos.push(adjuntoEnTexto(adjunto));
  }

  if (mensaje.compartido !== null) {
    const compartido = mensaje.compartido;
    const descripcion = [compartido.cita, compartido.autor, compartido.titulo, compartido.subtitulo, enUnaLinea(compartido.descripcion)]
      .filter((dato) => dato !== '')
      .join(' | ');

    trozos.push(`[Compartido: ${[descripcion, compartido.url].filter((dato) => dato !== '').join(' ')}]`);
  }

  if (trozos.length === 0) {
    trozos.push(`[${notaDeMensajeVacio(mensaje)}]`);
  }

  if (mensaje.editado) {
    trozos.push('(editado)');
  }

  return trozos.join(' ');
}

/**
 * Escribe las líneas de un mensaje.
 * @param {Mensaje} mensaje
 * @param {ContextoSalida} contexto
 * @param {string[]} fragmentos
 * @returns {void}
 */
function escribirMensaje(mensaje, contexto, fragmentos) {
  const marca = `[${hora(mensaje.marcaTiempoMs)}]`;
  const esAviso = mensaje.tipo === 'sistema' || mensaje.tipo === 'llamada';

  if (esAviso) {
    fragmentos.push(`${marca} * ${mensaje.texto || notaDeMensajeVacio(mensaje)} *\n`);
    return;
  }

  fragmentos.push(`${marca} ${contexto.nombreDe(mensaje.idRemitente)}: ${contenidoEnTexto(mensaje)}\n`);

  if (mensaje.respuestaA !== null) {
    const cita = mensaje.respuestaA;
    const autor = cita.idRemitente === '' ? 'un mensaje anterior' : contexto.nombreDe(cita.idRemitente);
    const resumen = cita.resumen === '' ? '' : `: «${cita.resumen}»`;

    fragmentos.push(`${SANGRIA}↪ En respuesta a ${autor}${resumen}\n`);
  }

  if (mensaje.reacciones.length > 0) {
    const reacciones = mensaje.reacciones.map((reaccion) => `${reaccion.emoji} ${contexto.nombreDe(reaccion.idRemitente)}`);

    fragmentos.push(`${SANGRIA}Reacciones: ${reacciones.join(', ')}\n`);
  }
}

/**
 * Escribe chat.txt.
 * @param {ContextoSalida} contexto
 * @returns {string[]} Fragmentos del archivo, en orden.
 */
function serializarTexto(contexto) {
  const resumen = resumirConversacion(contexto);
  const multimedia = contexto.multimedia;
  /** @type {string[]} */
  const fragmentos = [];

  fragmentos.push(`Conversación de Instagram: ${contexto.conversacion.titulo}\n`);
  fragmentos.push(`Exportada el ${fechaHoraCorta(contexto.exportadoMs)} (hora de ${contexto.zonaHoraria})\n`);
  fragmentos.push(`Estado: ${describirEstado(contexto)}\n`);

  if (resumen.total > 0) {
    fragmentos.push(`Mensajes: ${formatearEntero(resumen.total)}, del ${fechaCorta(resumen.primerMs)} al ${fechaCorta(resumen.ultimoMs)}\n`);
  } else {
    fragmentos.push('Mensajes: 0\n');
  }

  for (const fila of resumen.porParticipante) {
    fragmentos.push(`  ${fila.nombre}: ${formatearEntero(fila.cantidad)}\n`);
  }

  const sinDescargar = multimedia.fallidos + multimedia.omitidos;

  fragmentos.push(
    `Multimedia: ${formatearEntero(multimedia.descargados)} archivos (${formatearBytes(multimedia.bytes)}); ${formatearEntero(sinDescargar)} sin descargar\n`,
  );

  let diaActual = '';

  for (const mensaje of contexto.mensajes) {
    const dia = claveDeDia(mensaje.marcaTiempoMs);

    if (dia !== diaActual) {
      diaActual = dia;
      fragmentos.push(`\n──── ${diaLargo(mensaje.marcaTiempoMs)} ────\n`);
    }

    escribirMensaje(mensaje, contexto, fragmentos);
  }

  return fragmentos;
}

// ═══ MÓDULO visor-estilos ════════════════════════════════════════════════════════════════════════════

/**
 * @file Hoja de estilos de chat.html, el archivo para leer la conversación exportada.
 * Responsabilidad única: declarar el aspecto del visor. No contiene lógica.
 *
 * DIRECCIÓN VISUAL — «copia de plano»
 *  · Concepto: la exportación es una copia de archivo, y se presenta como una copia de plano
 *    (cianotipo): tinta azul de Prusia sobre papel azulado.
 *  · Elemento memorable: el cajetín. Los planos técnicos llevan en una esquina un cuadro rotulado
 *    con título, fecha y autor; aquí encabeza la página con los datos de la conversación.
 *  · Tipografía: rótulos en una DIN condensada del sistema (Bahnschrift en Windows, DIN en macOS),
 *    la letra normalizada del dibujo técnico; los mensajes, en la sans del sistema, que es la que
 *    mejor convive con los emoji. Escala de proporción 1,2 (interfaz densa).
 *  · Paleta (rol → claro / oscuro), con su contraste sobre el fondo:
 *      fondo       oklch(0.962 0.014 245) / oklch(0.21 0.045 260)
 *      superficie  oklch(0.990 0.004 245) / oklch(0.265 0.055 260)
 *      texto       oklch(0.26 0.065 258)  / oklch(0.94 0.02 245)    14,0:1 / 14,9:1
 *      texto suave oklch(0.46 0.055 256)  / oklch(0.76 0.04 250)     6,4:1 /  8,3:1
 *      acento      oklch(0.42 0.135 259)  / oklch(0.50 0.14 259)    texto claro encima: 8,2:1 / 5,8:1
 *      marca       oklch(0.87 0.15 90)    / oklch(0.80 0.14 90)     ámbar de sello, para lo encontrado
 *  · Composición: una columna de lectura alineada a la izquierda; cada día lleva su fecha en un
 *    margen propio, como las cotas de un plano. Los mensajes propios van a la derecha.
 *  · Descartes: degradado y burbujas al estilo de Instagram (sería imitar su interfaz), fondo crema
 *    con serif, fondo negro con acento neón, cuadrícula milimetrada de fondo (adorno sin función).
 *
 * Las fuentes son las del sistema a propósito: el archivo debe abrirse sin conexión y pesar poco.
 * Las reglas van en capas de cascada, de la más general a la más concreta.
 */

const ESTILOS_DEL_VISOR = `
@layer reset, tokens, base, layout, components, utilities;

@layer reset {
  *, *::before, *::after { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
  body, h1, h2, p, ul, ol, dl, dd, figure, blockquote { margin: 0; }
  ul, ol { padding: 0; list-style: none; }
  img, video { display: block; max-inline-size: 100%; block-size: auto; }
  input, button { font: inherit; color: inherit; }
  a { color: inherit; }
}

@layer tokens {
  :root {
    color-scheme: light dark;

    --color-bg: oklch(0.962 0.014 245);
    --color-surface: oklch(0.99 0.004 245);
    --color-text: oklch(0.26 0.065 258);
    --color-text-muted: oklch(0.46 0.055 256);
    --color-accent: oklch(0.42 0.135 259);
    --color-on-accent: oklch(0.985 0.008 245);
    --color-link: oklch(0.42 0.135 259);
    --color-border: oklch(0.8 0.04 250);
    --color-border-strong: oklch(0.56 0.06 254);
    --color-mark: oklch(0.87 0.15 90);
    --color-on-mark: oklch(0.26 0.065 258);
    --color-focus: oklch(0.56 0.17 40);

    --font-rotulo: "Bahnschrift", "DIN Alternate", "DIN Condensed", "Avenir Next Condensed", "Roboto Condensed", "Arial Narrow", sans-serif;
    --font-texto: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", "Noto Sans", sans-serif;

    /* Escala tipográfica: base 15 → 16 px, proporción 1,2, ventana 320 → 1440 px. */
    --step--1: clamp(0.8rem, 0.7906rem + 0.0471vw, 0.833rem);
    --step-0: clamp(0.9375rem, 0.9196rem + 0.0893vw, 1rem);
    --step-1: clamp(1.125rem, 1.1036rem + 0.1071vw, 1.2rem);
    --step-2: clamp(1.35rem, 1.3243rem + 0.1286vw, 1.44rem);
    --step-3: clamp(1.62rem, 1.5891rem + 0.1543vw, 1.728rem);
    --step-4: clamp(1.944rem, 1.7886rem + 0.7771vw, 2.488rem);

    --space-2xs: 0.25rem;
    --space-xs: 0.5rem;
    --space-s: clamp(0.75rem, 0.6786rem + 0.3571vw, 1rem);
    --space-m: clamp(1.25rem, 1.1071rem + 0.7143vw, 1.75rem);
    --space-l: clamp(2rem, 1.7143rem + 1.4286vw, 3rem);

    --radio: 0.9rem;
    --radio-cola: 0.25rem;
    --ancho-pagina: 62rem;
    --ancho-margen-fecha: 8.5rem;
    --alto-buscador: 3.5rem;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --color-bg: oklch(0.21 0.045 260);
      --color-surface: oklch(0.265 0.055 260);
      --color-text: oklch(0.94 0.02 245);
      --color-text-muted: oklch(0.76 0.04 250);
      --color-accent: oklch(0.5 0.14 259);
      --color-on-accent: oklch(0.985 0.008 245);
      --color-link: oklch(0.8 0.09 245);
      --color-border: oklch(0.42 0.06 256);
      --color-border-strong: oklch(0.63 0.06 252);
      --color-mark: oklch(0.8 0.14 90);
      --color-on-mark: oklch(0.26 0.065 258);
      --color-focus: oklch(0.75 0.17 55);
    }
  }
}

@layer base {
  html { scroll-padding-block-start: calc(var(--alto-buscador) + var(--space-s)); }

  body {
    background: var(--color-bg);
    color: var(--color-text);
    font-family: var(--font-texto);
    font-size: var(--step-0);
    line-height: 1.45;
  }

  h1, h2 {
    font-family: var(--font-rotulo);
    font-stretch: 80%;
    font-weight: 600;
    line-height: 1.1;
    text-wrap: balance;
  }

  a { color: var(--color-link); text-underline-offset: 0.15em; }

  :focus-visible { outline: 3px solid var(--color-focus); outline-offset: 2px; }

  mark {
    background: var(--color-mark);
    color: var(--color-on-mark);
    border-radius: 0.15em;
    padding-inline: 0.1em;
  }
}

@layer layout {
  .pagina {
    max-inline-size: var(--ancho-pagina);
    margin-inline: auto;
    padding-inline: var(--space-s);
    padding-block-end: var(--space-l);
  }

  .dia {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-xs);
    padding-block: var(--space-m);
    border-block-start: 1px solid var(--color-border);
    /* El navegador no dibuja los días que quedan fuera de pantalla: un chat de años abre al instante. */
    content-visibility: auto;
    contain-intrinsic-size: auto 40rem;
  }

  .dia__mensajes {
    display: flex;
    flex-direction: column;
    gap: var(--space-s);
    min-inline-size: 0;
  }

  @media (min-width: 52rem) {
    .dia {
      grid-template-columns: var(--ancho-margen-fecha) minmax(0, 1fr);
      gap: var(--space-m);
    }
  }
}

@layer components {
  /* Enlace para saltar la cabecera con el teclado. */
  .salto {
    position: absolute;
    inset-block-start: var(--space-xs);
    inset-inline-start: var(--space-xs);
    z-index: 3;
    padding: var(--space-xs) var(--space-s);
    background: var(--color-surface);
    border: 2px solid var(--color-accent);
    transform: translateY(-200%);
  }

  .salto:focus-visible { transform: none; }

  /* Cajetín: el cuadro rotulado de los planos técnicos, con los datos de la conversación. */
  .cajetin {
    margin-block: var(--space-m);
    background: var(--color-surface);
    border: 2px solid var(--color-accent);
    outline: 1px solid var(--color-accent);
    outline-offset: 3px;
  }

  .cajetin__titular {
    padding: var(--space-s) var(--space-m);
    border-block-end: 1px solid var(--color-accent);
  }

  .cajetin__rotulo,
  .cajetin dt {
    font-family: var(--font-rotulo);
    font-stretch: 80%;
    font-size: var(--step--1);
    color: var(--color-text-muted);
  }

  .cajetin__titulo {
    font-size: var(--step-4);
    overflow-wrap: anywhere;
  }

  .cajetin__datos {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  @media (min-width: 30rem) {
    .cajetin__datos { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }

  @media (min-width: 52rem) {
    .cajetin__datos { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  }

  .cajetin__celda {
    padding: var(--space-xs) var(--space-m);
    /* Una sola línea por celda hace de rejilla sin duplicar bordes. */
    box-shadow: 1px 0 0 var(--color-border), 0 1px 0 var(--color-border);
  }

  .cajetin__celda--ancha { grid-column: 1 / -1; }

  .cajetin dd {
    font-family: var(--font-rotulo);
    font-stretch: 80%;
    font-size: var(--step-1);
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }

  .cajetin__personas {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2xs) var(--space-m);
  }

  .cajetin__detalle {
    font-size: var(--step--1);
    color: var(--color-text-muted);
  }

  .cajetin__aviso {
    padding: var(--space-xs) var(--space-m);
    background: var(--color-mark);
    color: var(--color-on-mark);
    font-weight: 600;
  }

  /* Escala: una barra por mes (o por día) con la cantidad de mensajes; cada barra lleva a su fecha. */
  .escala { margin-block-end: var(--space-m); }

  .escala__titulo {
    font-family: var(--font-rotulo);
    font-stretch: 80%;
    font-size: var(--step--1);
    color: var(--color-text-muted);
    margin-block-end: var(--space-2xs);
  }

  .escala__barras {
    display: flex;
    align-items: flex-end;
    gap: 1px;
    block-size: 3.5rem;
    padding-block-end: 1.1rem;
    border-block-end: 1px solid var(--color-border-strong);
  }

  .escala__barras li {
    position: relative;
    flex: 1 1 0;
    min-inline-size: 2px;
    block-size: 100%;
    display: flex;
    align-items: flex-end;
  }

  .escala__barras a {
    display: block;
    inline-size: 100%;
    block-size: max(2px, calc(var(--n) * 100%));
    background: var(--color-accent);
  }

  .escala__barras a:hover,
  .escala__barras a:focus-visible { background: var(--color-focus); }

  .escala__barras li[data-anio]::after {
    content: attr(data-anio);
    position: absolute;
    inset-block-start: 100%;
    inset-inline-start: 0;
    padding-block-start: 0.15rem;
    padding-inline-start: 0.2rem;
    border-inline-start: 1px solid var(--color-border-strong);
    font-family: var(--font-rotulo);
    font-stretch: 80%;
    font-size: var(--step--1);
    line-height: 1;
    color: var(--color-text-muted);
  }

  /* Buscador: se queda arriba al desplazarse. */
  .buscador {
    position: sticky;
    inset-block-start: 0;
    z-index: 2;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2xs) var(--space-s);
    min-block-size: var(--alto-buscador);
    padding-block: var(--space-xs);
    background: var(--color-bg);
    border-block-end: 2px solid var(--color-accent);
  }

  .buscador__campo {
    flex: 1 1 14rem;
    min-inline-size: 0;
    padding: 0.45rem 0.7rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border-strong);
    border-radius: 0.3rem;
  }

  .buscador__estado {
    font-family: var(--font-rotulo);
    font-stretch: 80%;
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .resultados {
    position: absolute;
    inset-block-start: 100%;
    inset-inline: 0;
    max-block-size: min(65vh, 32rem);
    overflow-y: auto;
    background: var(--color-surface);
    border: 2px solid var(--color-accent);
    border-block-start: 0;
  }

  .resultados a,
  .resultados button {
    display: block;
    inline-size: 100%;
    padding: var(--space-xs) var(--space-s);
    border: 0;
    border-block-end: 1px solid var(--color-border);
    background: none;
    color: var(--color-text);
    text-align: start;
    text-decoration: none;
    cursor: pointer;
  }

  .resultados a:hover,
  .resultados button:hover { background: var(--color-bg); }

  .resultados__dato {
    display: block;
    font-family: var(--font-rotulo);
    font-stretch: 80%;
    font-size: var(--step--1);
    color: var(--color-text-muted);
  }

  .resultados__texto { overflow-wrap: anywhere; }

  /* Fecha de cada día, en su margen. */
  .dia__fecha {
    align-self: start;
    font-size: var(--step-0);
    font-weight: 400;
    color: var(--color-text-muted);
  }

  .dia__numero {
    display: block;
    font-size: var(--step-4);
    font-weight: 600;
    line-height: 0.95;
    color: var(--color-text);
    font-variant-numeric: tabular-nums;
  }

  @media (min-width: 52rem) {
    .dia__fecha {
      position: sticky;
      inset-block-start: calc(var(--alto-buscador) + var(--space-s));
    }
  }

  @media (max-width: 51.99rem) {
    .dia__numero { display: inline; font-size: var(--step-2); }
  }

  /* Grupo: mensajes seguidos de una misma persona. */
  .grupo {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2xs);
  }

  .grupo--mio { align-items: flex-end; }

  .grupo__autor {
    font-family: var(--font-rotulo);
    font-stretch: 80%;
    font-size: var(--step--1);
    color: var(--color-text-muted);
  }

  .grupo__hora {
    font-size: var(--step--1);
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .msg {
    display: flex;
    flex-direction: column;
    align-items: inherit;
    gap: var(--space-2xs);
    max-inline-size: min(100%, 34rem);
    scroll-margin-block-start: calc(var(--alto-buscador) + var(--space-m));
  }

  .burbuja {
    padding: 0.5rem 0.8rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radio);
    border-end-start-radius: var(--radio-cola);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .grupo--mio .burbuja {
    background: var(--color-accent);
    border-color: var(--color-accent);
    color: var(--color-on-accent);
    border-end-start-radius: var(--radio);
    border-end-end-radius: var(--radio-cola);
  }

  .grupo--mio .burbuja a { color: inherit; }

  /* Mensajes que son solo emoji: grandes y sin burbuja. */
  .burbuja--emoji,
  .grupo--mio .burbuja--emoji {
    padding: 0;
    background: none;
    border: 0;
    font-size: var(--step-4);
    line-height: 1.2;
  }

  /* Notas del exportador sobre un mensaje sin contenido legible. */
  .burbuja--nota,
  .grupo--mio .burbuja--nota {
    background: none;
    border-style: dashed;
    border-color: var(--color-border-strong);
    color: var(--color-text-muted);
  }

  .msg:target .burbuja,
  .msg:target .adjunto,
  .msg:target .tarjeta {
    outline: 3px solid var(--color-mark);
    outline-offset: 2px;
  }

  .msg__nota {
    font-size: var(--step--1);
    color: var(--color-text-muted);
  }

  .cita {
    display: block;
    max-inline-size: 100%;
    padding-inline-start: var(--space-xs);
    border-inline-start: 2px solid var(--color-accent);
    font-size: var(--step--1);
    color: var(--color-text-muted);
    text-decoration: none;
    overflow-wrap: anywhere;
  }

  .cita b { color: var(--color-text); font-weight: 600; }
  a.cita:hover { text-decoration: underline; }

  .adjuntos {
    display: grid;
    gap: var(--space-2xs);
    /* Cada adjunto ocupa lo que mide, hasta el ancho de lectura de una foto. */
    justify-items: start;
    max-inline-size: 20rem;
  }

  .grupo--mio .adjuntos { justify-items: end; }

  /* Álbum: dos columnas de teselas cuadradas. */
  .adjuntos--varios {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    justify-items: stretch;
    inline-size: min(100%, 26rem);
    max-inline-size: 26rem;
  }

  .adjuntos--varios img,
  .adjuntos--varios video {
    inline-size: 100%;
    block-size: 100%;
    aspect-ratio: 1;
    object-fit: cover;
  }

  .adjunto {
    display: block;
    max-inline-size: 100%;
    border: 1px solid var(--color-border);
    border-radius: 0.6rem;
    overflow: hidden;
    background: var(--color-surface);
  }

  .adjunto--pegatina { border: 0; background: none; max-inline-size: 9rem; }
  .adjunto--audio { border: 0; background: none; overflow: visible; }
  .adjunto--audio audio { display: block; inline-size: min(100%, 18rem); }
  .adjunto video { inline-size: 100%; background: oklch(0.2 0.03 260); }

  .adjunto--ausente {
    padding: var(--space-xs) var(--space-s);
    border-style: dashed;
    border-color: var(--color-border-strong);
    font-size: var(--step--1);
    color: var(--color-text-muted);
    overflow-wrap: anywhere;
  }

  .tarjeta {
    display: flex;
    flex-direction: column;
    gap: var(--space-2xs);
    max-inline-size: 20rem;
    padding: var(--space-xs) var(--space-s);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-inline-start: 3px solid var(--color-accent);
    border-radius: 0.3rem;
    overflow-wrap: anywhere;
  }

  .tarjeta__imagen { border-radius: 0.2rem; }

  .tarjeta__autor {
    font-family: var(--font-rotulo);
    font-stretch: 80%;
    color: var(--color-text-muted);
  }

  .tarjeta__titulo { font-weight: 600; }

  .tarjeta__texto {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 5;
    line-clamp: 5;
    overflow: hidden;
    font-size: var(--step--1);
  }

  .tarjeta__cita {
    padding-inline-start: var(--space-xs);
    border-inline-start: 2px solid var(--color-border-strong);
    font-size: var(--step--1);
    color: var(--color-text-muted);
  }

  .reacciones {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2xs);
  }

  .reacciones li {
    padding: 0.05rem 0.45rem;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 999px;
    font-size: var(--step--1);
  }

  /* Avisos del sistema y llamadas: centrados entre dos líneas finas. */
  .aviso {
    display: flex;
    align-items: center;
    gap: var(--space-s);
    font-size: var(--step--1);
    color: var(--color-text-muted);
    text-align: center;
  }

  .aviso::before,
  .aviso::after {
    content: "";
    flex: 1 1 1rem;
    border-block-start: 1px solid var(--color-border);
  }

  .pie {
    margin-block-start: var(--space-l);
    padding-block-start: var(--space-s);
    border-block-start: 2px solid var(--color-accent);
    font-size: var(--step--1);
    color: var(--color-text-muted);
    max-inline-size: 65ch;
  }

  @media (prefers-reduced-motion: no-preference) {
    .msg:target .burbuja,
    .msg:target .adjunto,
    .msg:target .tarjeta { animation: sello 1.2s ease-out 1; }

    @keyframes sello {
      from { outline-offset: 10px; outline-color: transparent; }
      to { outline-offset: 2px; }
    }
  }
}

@layer utilities {
  .oculto {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  [hidden] { display: none !important; }

  @media print {
    .buscador, .escala, .salto { display: none; }
    .dia { content-visibility: visible; break-inside: auto; }
    .msg { break-inside: avoid; }
    .grupo--mio .burbuja { background: none; color: inherit; border-width: 2px; }
  }
}
`;

// ═══ MÓDULO visor-comportamiento ═════════════════════════════════════════════════════════════════════

/**
 * @file Comportamiento de chat.html: el buscador.
 * Responsabilidad única: buscar en los mensajes de la página exportada y llevar a cada resultado.
 *
 * Esta función NO se ejecuta en Instagram. El exportador copia su código tal cual dentro del HTML
 * exportado, así que no puede usar nada definido fuera de ella.
 */

/**
 * Activa el buscador de la página exportada.
 * @returns {void}
 */
function iniciarVisor() {
  const RESULTADOS_POR_TANDA = 60;
  const CARACTERES_DE_CONTEXTO = 60;
  const ESPERA_AL_ESCRIBIR_MS = 160;

  /**
   * @typedef {Object} EntradaDelIndice
   * @property {string} ancla        Identificador del mensaje en la página.
   * @property {string} texto        Texto del mensaje tal como se lee.
   * @property {string} normalizado  El mismo texto sin mayúsculas ni acentos, con la misma longitud.
   * @property {string} dato         Fecha, hora y autor.
   */

  const campoHallado = document.querySelector('[data-buscar]');
  const listaHallada = document.querySelector('[data-resultados]');
  const estadoHallado = document.querySelector('[data-estado-busqueda]');
  const faltaAlgo =
    !(campoHallado instanceof HTMLInputElement) || !(listaHallada instanceof HTMLElement) || !(estadoHallado instanceof HTMLElement);

  if (faltaAlgo) {
    return;
  }

  /** @type {HTMLInputElement} */
  const campo = campoHallado;
  /** @type {HTMLElement} */
  const lista = listaHallada;
  /** @type {HTMLElement} */
  const estado = estadoHallado;

  /** @type {EntradaDelIndice[] | null} */
  let indice = null;
  /** @type {EntradaDelIndice[]} */
  let coincidencias = [];
  let mostradas = 0;
  let consultaNormalizada = '';
  let temporizador = 0;

  /** Caracteres no ASCII ya normalizados, para no repetir el trabajo. */
  /** @type {Map<string, string>} */
  const caracteresNormalizados = new Map();

  /**
   * Normaliza un carácter no ASCII: minúscula y sin acento. Devuelve siempre UN carácter,
   * para que las posiciones del texto normalizado coincidan con las del original.
   * La «ñ» se conserva: en español es otra letra, no una «n» con adorno.
   * @param {string} caracter
   * @returns {string}
   */
  function normalizarCaracter(caracter) {
    const conocido = caracteresNormalizados.get(caracter);

    if (conocido !== undefined) {
      return conocido;
    }

    const minuscula = caracter.toLowerCase();
    let normalizado = 'ñ';

    if (minuscula !== 'ñ') {
      const sinAcento = minuscula.normalize('NFD').replace(/\p{M}/gu, '');

      normalizado = sinAcento.length === 0 ? '\u0000' : sinAcento[0];
    }

    caracteresNormalizados.set(caracter, normalizado);

    return normalizado;
  }

  /**
   * Quita mayúsculas y acentos conservando la longitud del texto.
   * @param {string} texto Texto en forma NFC.
   * @returns {string}
   */
  function normalizar(texto) {
    let salida = '';

    for (let i = 0; i < texto.length; i += 1) {
      const codigo = texto.charCodeAt(i);

      if (codigo >= 128) {
        salida += normalizarCaracter(texto[i]);
      } else if (codigo >= 65 && codigo <= 90) {
        salida += String.fromCharCode(codigo + 32);
      } else {
        salida += texto[i];
      }
    }

    return salida;
  }

  /**
   * Lee todos los mensajes de la página una sola vez.
   * @returns {EntradaDelIndice[]}
   */
  function construirIndice() {
    /** @type {EntradaDelIndice[]} */
    const entradas = [];

    for (const mensaje of document.querySelectorAll('.msg')) {
      if (!(mensaje instanceof HTMLElement)) {
        continue;
      }

      let texto = '';

      for (const trozo of mensaje.querySelectorAll('.burbuja, .tarjeta')) {
        texto += `${trozo.textContent ?? ''} `;
      }

      texto = texto.replace(/\s+/g, ' ').trim().normalize('NFC');

      if (texto === '') {
        continue;
      }

      const grupo = mensaje.closest('.grupo');
      const autor = grupo instanceof HTMLElement ? grupo.dataset.autor ?? '' : '';

      entradas.push({ ancla: mensaje.id, texto, normalizado: normalizar(texto), dato: `${autor}, ${mensaje.title}` });
    }

    return entradas;
  }

  /**
   * Crea la fila de un resultado: fecha y autor, y el fragmento con lo encontrado resaltado.
   * @param {EntradaDelIndice} entrada
   * @returns {HTMLLIElement}
   */
  function crearResultado(entrada) {
    const posicion = entrada.normalizado.indexOf(consultaNormalizada);
    const inicio = Math.max(0, posicion - CARACTERES_DE_CONTEXTO);
    const finDeLoEncontrado = posicion + consultaNormalizada.length;
    const fin = Math.min(entrada.texto.length, finDeLoEncontrado + CARACTERES_DE_CONTEXTO);

    const fila = document.createElement('li');
    const enlace = document.createElement('a');
    const dato = document.createElement('span');
    const fragmento = document.createElement('span');
    const resaltado = document.createElement('mark');

    enlace.href = `#${entrada.ancla}`;
    dato.className = 'resultados__dato';
    dato.textContent = entrada.dato;
    fragmento.className = 'resultados__texto';
    resaltado.textContent = entrada.texto.slice(posicion, finDeLoEncontrado);
    fragmento.append(
      `${inicio > 0 ? '…' : ''}${entrada.texto.slice(inicio, posicion)}`,
      resaltado,
      `${entrada.texto.slice(finDeLoEncontrado, fin)}${fin < entrada.texto.length ? '…' : ''}`,
    );
    enlace.append(dato, fragmento);
    fila.append(enlace);

    return fila;
  }

  /**
   * Añade a la lista la siguiente tanda de resultados y, si quedan más, un botón para seguir.
   * @returns {void}
   */
  function mostrarTanda() {
    const botonAnterior = lista.querySelector('[data-mas]');

    if (botonAnterior !== null && botonAnterior.parentElement !== null) {
      botonAnterior.parentElement.remove();
    }

    const hasta = Math.min(coincidencias.length, mostradas + RESULTADOS_POR_TANDA);

    for (let i = mostradas; i < hasta; i += 1) {
      lista.append(crearResultado(coincidencias[i]));
    }

    mostradas = hasta;

    if (mostradas < coincidencias.length) {
      const fila = document.createElement('li');
      const boton = document.createElement('button');

      boton.type = 'button';
      boton.dataset.mas = '';
      boton.textContent = `Mostrar más resultados (quedan ${coincidencias.length - mostradas})`;
      boton.addEventListener('click', mostrarTanda);
      fila.append(boton);
      lista.append(fila);
    }
  }

  /**
   * Cierra la lista de resultados sin borrar lo escrito.
   * @returns {void}
   */
  function cerrarResultados() {
    lista.hidden = true;
  }

  /**
   * Busca lo escrito en el campo y pinta los resultados, del más reciente al más antiguo.
   * @returns {void}
   */
  function buscar() {
    const consulta = campo.value.trim().normalize('NFC');

    lista.replaceChildren();
    coincidencias = [];
    mostradas = 0;

    if (consulta.length < 2) {
      estado.textContent = consulta.length === 0 ? '' : 'Escribe al menos dos letras';
      cerrarResultados();
      return;
    }

    if (indice === null) {
      indice = construirIndice();
    }

    consultaNormalizada = normalizar(consulta);

    for (let i = indice.length - 1; i >= 0; i -= 1) {
      if (indice[i].normalizado.includes(consultaNormalizada)) {
        coincidencias.push(indice[i]);
      }
    }

    if (coincidencias.length === 0) {
      estado.textContent = 'Sin coincidencias';
      cerrarResultados();
      return;
    }

    estado.textContent = coincidencias.length === 1 ? '1 mensaje' : `${coincidencias.length} mensajes`;
    lista.hidden = false;
    mostrarTanda();
  }

  campo.addEventListener('input', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(buscar, ESPERA_AL_ESCRIBIR_MS);
  });

  campo.addEventListener('focus', () => {
    if (coincidencias.length > 0) {
      lista.hidden = false;
    }
  });

  lista.addEventListener('click', (evento) => {
    const destino = evento.target;

    // Al elegir un resultado se cierra la lista para dejar ver el mensaje.
    if (destino instanceof Element && destino.closest('a') !== null) {
      cerrarResultados();
    }
  });

  document.addEventListener('click', (evento) => {
    const destino = evento.target;
    const fueDentroDelBuscador = destino instanceof Element && destino.closest('[data-buscador]') !== null;

    if (!fueDentroDelBuscador) {
      cerrarResultados();
    }
  });

  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape') {
      cerrarResultados();
      return;
    }

    const destino = evento.target;
    const estaEscribiendo = destino instanceof HTMLInputElement || destino instanceof HTMLTextAreaElement;

    // «/» lleva al buscador, como en muchas páginas de lectura.
    if (evento.key === '/' && !estaEscribiendo) {
      evento.preventDefault();
      campo.focus();
    }
  });
}

// ═══ MÓDULO serializador-html ════════════════════════════════════════════════════════════════════════

/**
 * @file Salida para leer (chat.html).
 * Responsabilidad única: escribir la conversación como una página que se abre sin conexión.
 *
 * Toda cadena que viene del chat pasa por `escaparHtml` y toda dirección ya fue validada al
 * normalizar (solo http y https): nada de lo que alguien escribió en el chat puede ejecutar
 * código al abrir el archivo.
 */

/** Dos mensajes de la misma persona separados por más de esto empiezan un grupo nuevo. */
const PAUSA_QUE_SEPARA_GRUPOS_MS = 5 * 60 * 1000;

/** Hasta esta duración la escala muestra una barra por día; por encima, una por mes. */
const DIAS_CON_ESCALA_DIARIA = 45;

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Longitud máxima, en símbolos, de un mensaje que se muestra como «solo emoji». */
const EMOJIS_GRANDES_MAXIMOS = 8;

const SOLO_SIGNOS_DE_EMOJI = /^(?:[\p{Extended_Pictographic}\p{Emoji_Component}‍️]|\s)+$/u;
const TIENE_PICTOGRAMA = /\p{Extended_Pictographic}/u;
const DIRECCION_WEB = /https?:\/\/[^\s<>"']+/g;

/** Servidores públicos de GIF: sus direcciones no caducan, así que se pueden mostrar en línea. */
const SERVIDOR_PUBLICO_DE_GIF = /(^|\.)(giphy\.com|tenor\.com|tenor\.co)$/;

/** Signos de puntuación que suelen ir pegados al final de un enlace sin formar parte de él. */
const PUNTUACION_FINAL = /[.,;:!?)\]}»'"]+$/;

/**
 * Indica si un texto es solo unos pocos emoji, para mostrarlos grandes y sin burbuja.
 * @param {string} texto
 * @returns {boolean}
 */
function esSoloEmoji(texto) {
  if (texto.length > EMOJIS_GRANDES_MAXIMOS * 8) {
    return false;
  }

  if (!SOLO_SIGNOS_DE_EMOJI.test(texto) || !TIENE_PICTOGRAMA.test(texto)) {
    return false;
  }

  const simbolos = texto.match(/\p{Extended_Pictographic}/gu);

  return simbolos !== null && simbolos.length <= EMOJIS_GRANDES_MAXIMOS;
}

/**
 * Escapa un texto y convierte sus direcciones web en enlaces.
 * @param {string} texto
 * @returns {string} HTML seguro.
 */
function textoConEnlaces(texto) {
  let html = '';
  let ultimoCorte = 0;

  for (const coincidencia of texto.matchAll(DIRECCION_WEB)) {
    const inicio = coincidencia.index;
    let direccion = coincidencia[0];
    const sobrante = PUNTUACION_FINAL.exec(direccion);

    if (sobrante !== null) {
      direccion = direccion.slice(0, direccion.length - sobrante[0].length);
    }

    html += escaparHtml(texto.slice(ultimoCorte, inicio));
    html += `<a href="${escaparHtml(direccion)}" rel="noopener noreferrer" target="_blank">${escaparHtml(direccion)}</a>`;
    ultimoCorte = inicio + direccion.length;
  }

  return html + escaparHtml(texto.slice(ultimoCorte));
}

/**
 * Atributos de tamaño de una imagen o un video, para que la página no salte al cargarlos.
 * @param {Adjunto} adjunto
 * @returns {string}
 */
function atributosDeTamano(adjunto) {
  if (adjunto.ancho > 0 && adjunto.alto > 0) {
    return ` width="${adjunto.ancho}" height="${adjunto.alto}"`;
  }

  return '';
}

/**
 * Indica si un adjunto es un GIF o sticker alojado en un servidor público, fuera de Instagram.
 * @param {Adjunto} adjunto
 * @returns {boolean}
 */
function esGifPublico(adjunto) {
  if (adjunto.clase !== 'animacion' && adjunto.clase !== 'sticker') {
    return false;
  }

  try {
    return SERVIDOR_PUBLICO_DE_GIF.test(new URL(adjunto.url).hostname);
  } catch {
    return false;
  }
}

/**
 * HTML de un adjunto.
 * @param {Adjunto} adjunto
 * @param {string} autor Nombre de quien lo envió, para el texto alternativo.
 * @returns {string}
 */
function htmlDeAdjunto(adjunto, autor) {
  const nombre = nombreDeAdjunto(adjunto);

  if (adjunto.estado !== 'descargado' && esGifPublico(adjunto)) {
    const direccion = escaparHtml(adjunto.url);
    const descripcion = escaparHtml(adjunto.textoAlternativo || nombre);

    // Instagram no deja descargarlo, pero su dirección es pública y estable: se muestra desde su servidor.
    return (
      `<a class="adjunto adjunto--pegatina" href="${direccion}" rel="noopener noreferrer" target="_blank">` +
      `<img src="${direccion}" alt="${descripcion}" loading="lazy" decoding="async" referrerpolicy="no-referrer"${atributosDeTamano(adjunto)}></a>` +
      `<span class="msg__nota">${escaparHtml(nombre)} en línea: necesita conexión</span>`
    );
  }

  if (adjunto.estado !== 'descargado') {
    const enlace = `<a href="${escaparHtml(adjunto.url)}" rel="noopener noreferrer" target="_blank">Enlace original</a>`;

    return `<div class="adjunto adjunto--ausente">${escaparHtml(nombre)} sin descargar: ${escaparHtml(explicarAusencia(adjunto))}. ${enlace} (caduca a las pocas horas).</div>`;
  }

  const ruta = escaparHtml(adjunto.archivo);
  const descripcion = escaparHtml(adjunto.textoAlternativo || `${nombre} de ${autor}`);

  // Se decide por el tipo real del archivo: de un video puede haberse bajado solo su imagen previa.
  if (adjunto.tipoMime.startsWith('audio/')) {
    return `<div class="adjunto adjunto--audio"><audio controls preload="none" src="${ruta}"></audio><span class="msg__nota">${escaparHtml(nombre)}</span></div>`;
  }

  if (adjunto.tipoMime.startsWith('video/')) {
    const esAnimacion = adjunto.clase === 'animacion';
    const modo = esAnimacion ? 'autoplay loop muted playsinline' : 'controls';

    return `<div class="adjunto"><video ${modo} preload="${esAnimacion ? 'metadata' : 'none'}" src="${ruta}" aria-label="${descripcion}"${atributosDeTamano(adjunto)}></video></div>`;
  }

  const esPegatina = adjunto.clase === 'sticker' || adjunto.clase === 'animacion';
  const clase = esPegatina ? 'adjunto adjunto--pegatina' : 'adjunto';

  return `<a class="${clase}" href="${ruta}"><img src="${ruta}" alt="${descripcion}" loading="lazy" decoding="async"${atributosDeTamano(adjunto)}></a>`;
}

/**
 * HTML de una tarjeta de contenido compartido.
 * @param {Compartido} compartido
 * @returns {string}
 */
function htmlDeCompartido(compartido) {
  let html = '<div class="tarjeta">';
  const miniatura = compartido.miniatura;

  if (miniatura !== null && miniatura.estado === 'descargado') {
    html += `<img class="tarjeta__imagen" src="${escaparHtml(miniatura.archivo)}" alt="" loading="lazy" decoding="async"${atributosDeTamano(miniatura)}>`;
  }

  if (compartido.cita !== '') {
    html += `<p class="tarjeta__cita">${escaparHtml(compartido.cita)}</p>`;
  }

  if (compartido.autor !== '') {
    html += `<p class="tarjeta__autor">${escaparHtml(compartido.autor)}</p>`;
  }

  if (compartido.titulo !== '') {
    html += `<p class="tarjeta__titulo">${escaparHtml(compartido.titulo)}</p>`;
  }

  const texto = [compartido.subtitulo, compartido.descripcion].filter((dato) => dato !== '').join('\n');

  if (texto !== '') {
    html += `<p class="tarjeta__texto">${escaparHtml(texto)}</p>`;
  }

  if (compartido.url !== '') {
    let servidor = '';

    try {
      servidor = new URL(compartido.url).hostname.replace(/^www\./, '');
    } catch {
      servidor = '';
    }

    const esDeInstagram = servidor === 'instagram.com' || servidor.endsWith('.instagram.com');
    const rotulo = esDeInstagram ? 'Abrir en Instagram' : `Abrir en ${servidor}`;

    html += `<a href="${escaparHtml(compartido.url)}" rel="noopener noreferrer" target="_blank">${escaparHtml(rotulo)}</a>`;
  }

  return `${html}</div>`;
}

/**
 * HTML de las reacciones de un mensaje, agrupadas por emoji.
 * @param {Mensaje} mensaje
 * @param {ContextoSalida} contexto
 * @returns {string}
 */
function htmlDeReacciones(mensaje, contexto) {
  if (mensaje.reacciones.length === 0) {
    return '';
  }

  /** @type {Map<string, string[]>} */
  const nombresPorEmoji = new Map();

  for (const reaccion of mensaje.reacciones) {
    const nombres = nombresPorEmoji.get(reaccion.emoji) ?? [];

    nombres.push(contexto.nombreDe(reaccion.idRemitente));
    nombresPorEmoji.set(reaccion.emoji, nombres);
  }

  let html = '<ul class="reacciones">';

  for (const [emoji, nombres] of nombresPorEmoji) {
    const cantidad = nombres.length > 1 ? ` ${nombres.length}` : '';
    const quienes = escaparHtml(nombres.join(', '));

    html += `<li title="${quienes}">${escaparHtml(emoji)}${cantidad}<span class="oculto"> de ${quienes}</span></li>`;
  }

  return `${html}</ul>`;
}

/**
 * HTML de la cita del mensaje al que se responde. Si ese mensaje está en la exportación, enlaza con él.
 * @param {Mensaje} mensaje
 * @param {ContextoSalida} contexto
 * @returns {string}
 */
function htmlDeCita(mensaje, contexto) {
  const cita = mensaje.respuestaA;

  if (cita === null) {
    return '';
  }

  const autor = cita.idRemitente === '' ? 'Mensaje anterior' : contexto.nombreDe(cita.idRemitente);
  const contenido = `<b>${escaparHtml(autor)}</b> ${escaparHtml(cita.resumen)}`;
  const indiceCitado = contexto.indicePorId.get(cita.idMensaje);

  if (indiceCitado === undefined) {
    return `<span class="cita">${contenido}</span>`;
  }

  return `<a class="cita" href="#m-${indiceCitado}">${contenido}</a>`;
}

/**
 * HTML de un mensaje.
 * @param {Mensaje} mensaje
 * @param {number} indice
 * @param {ContextoSalida} contexto
 * @returns {string}
 */
function htmlDeMensaje(mensaje, indice, contexto) {
  const autor = contexto.nombreDe(mensaje.idRemitente);
  let html = `<div class="msg" id="m-${indice}" title="${fechaHoraCorta(mensaje.marcaTiempoMs)}">`;

  if (mensaje.reenviado) {
    html += '<span class="msg__nota">Reenviado</span>';
  }

  html += htmlDeCita(mensaje, contexto);

  const tieneContenido = mensaje.texto !== '' || mensaje.adjuntos.length > 0 || mensaje.compartido !== null;

  if (mensaje.texto !== '') {
    // Los textos que escribe el exportador (no una persona) van como nota, con trazo discontinuo.
    const esNota = mensaje.tipo === 'efimero' || mensaje.tipo === 'desconocido';
    let clase = 'burbuja';

    if (esNota) {
      clase = 'burbuja burbuja--nota';
    } else if (esSoloEmoji(mensaje.texto)) {
      clase = 'burbuja burbuja--emoji';
    }

    html += `<div class="${clase}">${textoConEnlaces(mensaje.texto)}</div>`;
  }

  if (!tieneContenido) {
    html += `<div class="burbuja burbuja--nota">${escaparHtml(notaDeMensajeVacio(mensaje))}</div>`;
  }

  if (mensaje.adjuntos.length > 0) {
    const clase = mensaje.adjuntos.length > 1 ? 'adjuntos adjuntos--varios' : 'adjuntos';

    html += `<div class="${clase}">`;

    for (const adjunto of mensaje.adjuntos) {
      html += htmlDeAdjunto(adjunto, autor);
    }

    html += '</div>';
  }

  if (mensaje.compartido !== null) {
    html += htmlDeCompartido(mensaje.compartido);
  }

  if (mensaje.editado) {
    html += '<span class="msg__nota">Editado</span>';
  }

  return `${html}${htmlDeReacciones(mensaje, contexto)}</div>\n`;
}

/**
 * HTML del cajetín: los datos de la conversación.
 * @param {ContextoSalida} contexto
 * @returns {string}
 */
function htmlDelCajetin(contexto) {
  const resumen = resumirConversacion(contexto);
  const multimedia = contexto.multimedia;
  const sinDescargar = multimedia.fallidos + multimedia.omitidos;
  let periodo = 'Sin mensajes';

  if (resumen.total > 0) {
    periodo = `${fechaCorta(resumen.primerMs)} a ${fechaCorta(resumen.ultimoMs)}`;
  }

  let personas = '';

  for (const participante of contexto.participantes) {
    const fila = resumen.porParticipante.find((candidata) => candidata.id === participante.id);
    const cantidad = fila === undefined ? 0 : fila.cantidad;
    const usuario = participante.usuario === '' ? '' : ` @${escaparHtml(participante.usuario)},`;

    personas += `<li>${escaparHtml(contexto.nombreDe(participante.id))} <span class="cajetin__detalle">${usuario} ${formatearEntero(cantidad)} mensajes</span></li>`;
  }

  let textoDeMultimedia = `${formatearEntero(multimedia.descargados)} archivos, ${formatearBytes(multimedia.bytes)}`;

  if (sinDescargar > 0) {
    textoDeMultimedia += ` <span class="cajetin__detalle">${formatearEntero(sinDescargar)} sin descargar</span>`;
  }

  /**
   * @param {string} rotulo
   * @param {string} valorHtml
   * @param {boolean} [ancha]
   * @returns {string}
   */
  const celda = (rotulo, valorHtml, ancha = false) =>
    `<div class="cajetin__celda${ancha ? ' cajetin__celda--ancha' : ''}"><dt>${rotulo}</dt><dd>${valorHtml}</dd></div>`;

  let html = '<header class="cajetin">';

  if (!contexto.estado.completa) {
    html += `<p class="cajetin__aviso">Exportación parcial: ${escaparHtml(contexto.estado.motivoParcial)}</p>`;
  }

  html += '<div class="cajetin__titular"><p class="cajetin__rotulo">Conversación de Instagram</p>';
  html += `<h1 class="cajetin__titulo">${escaparHtml(contexto.conversacion.titulo)}</h1></div>`;
  html += '<dl class="cajetin__datos">';
  html += celda('Mensajes', formatearEntero(resumen.total));
  html += celda('Periodo', periodo);
  html += celda('Exportada', fechaHoraCorta(contexto.exportadoMs));
  html += celda('Multimedia', textoDeMultimedia);
  html += celda('Participantes', `<ul class="cajetin__personas">${personas}</ul>`, true);
  html += celda('Estado', escaparHtml(describirEstado(contexto)), true);

  return `${html}</dl></header>\n`;
}

/**
 * @typedef {Object} TramoDeEscala
 * @property {string} ancla     Identificador del primer día del tramo.
 * @property {string} rotulo    «marzo de 2024» o «miércoles, 3 de enero de 2024».
 * @property {string} anio
 * @property {number} cantidad
 */

/**
 * HTML de la escala: una barra por mes (o por día en chats cortos) con la cantidad de mensajes.
 * Cada barra es un enlace al primer día de su tramo.
 * @param {ContextoSalida} contexto
 * @returns {string}
 */
function htmlDeLaEscala(contexto) {
  const mensajes = contexto.mensajes;

  if (mensajes.length === 0) {
    return '';
  }

  const duracionEnDias = (mensajes[mensajes.length - 1].marcaTiempoMs - mensajes[0].marcaTiempoMs) / MS_POR_DIA;
  const esDiaria = duracionEnDias <= DIAS_CON_ESCALA_DIARIA;
  /** @type {TramoDeEscala[]} */
  const tramos = [];
  let claveActual = '';
  let maximo = 0;

  for (const mensaje of mensajes) {
    const clave = esDiaria ? claveDeDia(mensaje.marcaTiempoMs) : claveDeMes(mensaje.marcaTiempoMs);

    if (clave !== claveActual) {
      claveActual = clave;
      tramos.push({
        ancla: `d-${claveDeDia(mensaje.marcaTiempoMs)}`,
        rotulo: esDiaria ? diaLargo(mensaje.marcaTiempoMs) : mesLargo(mensaje.marcaTiempoMs),
        anio: clave.slice(0, 4),
        cantidad: 0,
      });
    }

    const tramo = tramos[tramos.length - 1];

    tramo.cantidad += 1;

    if (tramo.cantidad > maximo) {
      maximo = tramo.cantidad;
    }
  }

  let html = `<nav class="escala" aria-label="Mensajes por ${esDiaria ? 'día' : 'mes'}">`;

  html += `<p class="escala__titulo">Mensajes por ${esDiaria ? 'día' : 'mes'}: cada barra lleva a su fecha</p><ol class="escala__barras">`;

  let anioRotulado = '';

  for (const tramo of tramos) {
    const descripcion = escaparHtml(`${tramo.rotulo}: ${formatearEntero(tramo.cantidad)} mensajes`);
    let marcaDeAnio = '';

    if (tramo.anio !== anioRotulado) {
      anioRotulado = tramo.anio;
      marcaDeAnio = ` data-anio="${tramo.anio}"`;
    }

    html += `<li${marcaDeAnio}><a href="#${tramo.ancla}" style="--n:${(tramo.cantidad / maximo).toFixed(3)}" title="${descripcion}"><span class="oculto">${descripcion}</span></a></li>`;
  }

  return `${html}</ol></nav>\n`;
}

/**
 * Escribe los mensajes agrupados por día y, dentro de cada día, por rachas de la misma persona.
 * @param {ContextoSalida} contexto
 * @param {string[]} fragmentos
 * @returns {void}
 */
function escribirMensajes(contexto, fragmentos) {
  let diaAbierto = '';
  let hayGrupoAbierto = false;
  let remitenteDelGrupo = '';
  let ultimaMarcaDelGrupo = 0;

  /** @returns {void} */
  const cerrarGrupo = () => {
    if (!hayGrupoAbierto) {
      return;
    }

    const iso = new Date(ultimaMarcaDelGrupo).toISOString();

    fragmentos.push(`<p class="grupo__hora"><time datetime="${iso}">${hora(ultimaMarcaDelGrupo)}</time></p></div>\n`);
    hayGrupoAbierto = false;
  };

  /** @returns {void} */
  const cerrarDia = () => {
    if (diaAbierto !== '') {
      fragmentos.push('</div></section>\n');
    }
  };

  for (let i = 0; i < contexto.mensajes.length; i += 1) {
    const mensaje = contexto.mensajes[i];
    const dia = claveDeDia(mensaje.marcaTiempoMs);

    if (dia !== diaAbierto) {
      cerrarGrupo();
      cerrarDia();
      diaAbierto = dia;

      const numero = new Date(mensaje.marcaTiempoMs).getDate();

      fragmentos.push(
        `<section class="dia" id="d-${dia}"><h2 class="dia__fecha"><span class="oculto">${diaLargo(mensaje.marcaTiempoMs)}</span>` +
          `<span aria-hidden="true"><span class="dia__numero">${numero}</span> ${diaDeLaSemana(mensaje.marcaTiempoMs)}<br>${mesLargo(mensaje.marcaTiempoMs)}</span></h2>` +
          '<div class="dia__mensajes">\n',
      );
    }

    const esAviso = mensaje.tipo === 'sistema' || mensaje.tipo === 'llamada';

    if (esAviso) {
      cerrarGrupo();
      fragmentos.push(
        `<p class="aviso" id="m-${i}"><span>${escaparHtml(mensaje.texto || notaDeMensajeVacio(mensaje))} <time datetime="${new Date(mensaje.marcaTiempoMs).toISOString()}">${hora(mensaje.marcaTiempoMs)}</time></span></p>\n`,
      );
      continue;
    }

    const sigueLaRacha =
      hayGrupoAbierto &&
      mensaje.idRemitente === remitenteDelGrupo &&
      mensaje.marcaTiempoMs - ultimaMarcaDelGrupo <= PAUSA_QUE_SEPARA_GRUPOS_MS;

    if (!sigueLaRacha) {
      cerrarGrupo();

      const autor = escaparHtml(contexto.nombreDe(mensaje.idRemitente));
      const esPropio = contexto.esYo(mensaje.idRemitente);
      // En un chat de dos, el lado ya dice quién habla: el nombre queda solo para lectores de pantalla.
      const claseDelAutor = contexto.conversacion.esGrupo && !esPropio ? 'grupo__autor' : 'grupo__autor oculto';

      fragmentos.push(`<div class="grupo${esPropio ? ' grupo--mio' : ''}" data-autor="${autor}"><p class="${claseDelAutor}">${autor}</p>\n`);
      hayGrupoAbierto = true;
      remitenteDelGrupo = mensaje.idRemitente;
    }

    fragmentos.push(htmlDeMensaje(mensaje, i, contexto));
    ultimaMarcaDelGrupo = mensaje.marcaTiempoMs;
  }

  cerrarGrupo();
  cerrarDia();
}

/**
 * Escribe chat.html.
 * @param {ContextoSalida} contexto
 * @returns {string[]} Fragmentos del archivo, en orden.
 */
function serializarHtml(contexto) {
  const titulo = escaparHtml(`Chat con ${contexto.conversacion.titulo}`);
  /** @type {string[]} */
  const fragmentos = [];

  fragmentos.push(
    '<!DOCTYPE html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n',
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n',
    '<meta name="color-scheme" content="light dark">\n',
    '<meta name="referrer" content="no-referrer">\n',
    `<meta name="description" content="Copia de la conversación de Instagram con ${escaparHtml(contexto.conversacion.titulo)}, exportada el ${fechaCorta(contexto.exportadoMs)}.">\n`,
    `<title>${titulo}</title>\n`,
    `<style>${ESTILOS_DEL_VISOR}</style>\n</head>\n<body>\n`,
    '<a class="salto" href="#mensajes">Saltar a los mensajes</a>\n<div class="pagina">\n',
    htmlDelCajetin(contexto),
    htmlDeLaEscala(contexto),
    '<div class="buscador" role="search" data-buscador>',
    '<label class="oculto" for="buscar">Buscar en la conversación</label>',
    '<input class="buscador__campo" id="buscar" data-buscar type="search" placeholder="Buscar en la conversación" autocomplete="off" spellcheck="false">',
    '<p class="buscador__estado" data-estado-busqueda aria-live="polite"></p>',
    '<ol class="resultados" data-resultados hidden></ol></div>\n',
    '<main id="mensajes">\n',
  );

  escribirMensajes(contexto, fragmentos);

  fragmentos.push(
    '</main>\n',
    `<footer class="pie"><p>Copia hecha con el exportador de chats de Instagram, versión ${escaparHtml(contexto.version)}. `,
    `Las horas corresponden a la zona horaria ${escaparHtml(contexto.zonaHoraria)}. `,
    `${escaparHtml(enUnaLinea(describirEstado(contexto)))}.</p></footer>\n</div>\n`,
    // El código del buscador se copia tal cual desde su módulo.
    `<script type="module">(${iniciarVisor.toString()})();</script>\n`,
    '</body>\n</html>\n',
  );

  return fragmentos;
}

// ═══ MÓDULO panel ════════════════════════════════════════════════════════════════════════════════════

/**
 * @file Panel de progreso que se muestra sobre la página de Instagram.
 * Responsabilidad única: enseñar cómo va la exportación y ofrecer los botones para pararla.
 *
 * Vive dentro de un Shadow DOM: así los estilos de Instagram no lo alteran ni los suyos alteran
 * la página. Los estilos se aplican con una hoja construida desde JavaScript y los elementos se
 * crean uno a uno, sin estilos en línea ni HTML insertado como texto: de ese modo el panel
 * funciona también si la política de seguridad de la página llega a prohibir ambas cosas.
 */

const ESTILOS_DEL_PANEL = `
:host {
  all: initial;
  position: fixed;
  inset-block-end: 16px;
  inset-inline-end: 16px;
  z-index: 2147483647;
  inline-size: min(22rem, calc(100vw - 32px));
  color-scheme: light;
  --fondo: oklch(0.99 0.004 245);
  --papel: oklch(0.962 0.014 245);
  --tinta: oklch(0.26 0.065 258);
  --tinta-suave: oklch(0.46 0.055 256);
  --acento: oklch(0.42 0.135 259);
  --sobre-acento: oklch(0.985 0.008 245);
  --linea: oklch(0.8 0.04 250);
  --marca: oklch(0.87 0.15 90);
  --foco: oklch(0.56 0.17 40);
  --rotulo: "Bahnschrift", "DIN Alternate", "DIN Condensed", "Avenir Next Condensed", "Roboto Condensed", "Arial Narrow", sans-serif;
  --texto: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", sans-serif;
}

.panel {
  box-sizing: border-box;
  background: var(--fondo);
  color: var(--tinta);
  border: 2px solid var(--acento);
  box-shadow: 0 0 0 3px var(--fondo), 0 0 0 4px var(--acento), 0 12px 32px oklch(0.2 0.05 258 / 0.35);
  font: 14px/1.4 var(--texto);
}

.panel * { box-sizing: border-box; margin: 0; }

.avance {
  block-size: 4px;
  background: var(--linea);
  overflow: hidden;
}

.avance::after {
  content: "";
  display: block;
  inline-size: 35%;
  block-size: 100%;
  background: var(--acento);
}

.panel[data-estado="hecho"] .avance::after { inline-size: 100%; }
.panel[data-estado="error"] .avance::after { inline-size: 100%; background: var(--foco); }

@media (prefers-reduced-motion: no-preference) {
  .panel[data-estado="trabajando"] .avance::after { animation: recorrer 1.4s ease-in-out infinite alternate; }

  @keyframes recorrer {
    from { transform: translateX(0); }
    to { transform: translateX(186%); }
  }
}

.titular {
  padding: 10px 14px;
  border-block-end: 1px solid var(--acento);
}

.rotulo,
dt {
  font-family: var(--rotulo);
  font-stretch: 80%;
  font-size: 13px;
  color: var(--tinta-suave);
}

.titulo {
  font-family: var(--rotulo);
  font-stretch: 80%;
  font-weight: 600;
  font-size: 22px;
  line-height: 1.1;
  overflow-wrap: anywhere;
}

dl {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.dato {
  padding: 6px 14px;
  box-shadow: 1px 0 0 var(--linea), 0 1px 0 var(--linea);
}

dd {
  font-family: var(--rotulo);
  font-stretch: 80%;
  font-size: 17px;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.fase {
  padding: 10px 14px;
  min-block-size: 3.2em;
  overflow-wrap: anywhere;
}

.panel[data-estado="error"] .fase { background: var(--marca); }

.botones {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 14px 12px;
}

button {
  flex: 1 1 auto;
  padding: 7px 12px;
  border: 2px solid var(--acento);
  border-radius: 4px;
  background: var(--fondo);
  color: var(--acento);
  font: 600 14px/1.2 var(--texto);
  cursor: pointer;
}

button.principal {
  background: var(--acento);
  color: var(--sobre-acento);
}

button:hover { filter: brightness(1.12); }
button:focus-visible { outline: 3px solid var(--foco); outline-offset: 2px; }
[hidden] { display: none; }
`;

/**
 * @typedef {Object} DatosDeProgreso
 * @property {string} titulo               Nombre de la conversación ('' mientras no se conoce).
 * @property {number} mensajes
 * @property {number} masAntiguoMs         Fecha del mensaje más antiguo cargado (0 si no hay).
 * @property {number} peticiones
 * @property {number} multimediaResueltos
 * @property {number} multimediaTotales
 * @property {number} multimediaBytes
 * @property {string} fase                 Qué está haciendo el exportador, en una frase.
 */

/**
 * @typedef {Object} AccionesDelPanel
 * @property {() => void} alDetener
 * @property {() => void} alCancelar
 */

class PanelProgreso {
  /** @type {Document} */
  #documento;

  /** @type {AccionesDelPanel} */
  #acciones;

  /** @type {HTMLElement} */
  #anfitrion;

  /** @type {HTMLElement} */
  #panel;

  /** @type {HTMLElement} */
  #rotulo;

  /** @type {HTMLElement} */
  #titulo;

  /** @type {HTMLElement} */
  #fase;

  /** Celdas de datos por su nombre. */
  /** @type {Map<string, HTMLElement>} */
  #valores = new Map();

  /** @type {HTMLElement} */
  #botones;

  /** Temporizador de la cuenta atrás de una espera (0 si no hay ninguna). */
  #cuentaAtras = 0;

  /** Frase que había antes de empezar una espera, para restaurarla al terminar. */
  #faseAnterior = '';

  /**
   * @param {Document} documento
   * @param {AccionesDelPanel} acciones
   */
  constructor(documento, acciones) {
    this.#documento = documento;
    this.#acciones = acciones;
    this.#anfitrion = documento.createElement('div');
    this.#panel = this.#crear('section', 'panel');
    this.#rotulo = this.#crear('p', 'rotulo', 'Exportador de chats de Instagram');
    this.#titulo = this.#crear('p', 'titulo', 'Preparando');
    this.#fase = this.#crear('p', 'fase');
    this.#botones = this.#crear('div', 'botones');
    this.#montar();
  }

  /**
   * Crea un elemento con su clase y su texto.
   * @param {string} etiqueta
   * @param {string} clase
   * @param {string} [texto]
   * @returns {HTMLElement}
   */
  #crear(etiqueta, clase, texto = '') {
    const elemento = this.#documento.createElement(etiqueta);

    if (clase !== '') {
      elemento.className = clase;
    }

    elemento.textContent = texto;

    return elemento;
  }

  /**
   * Construye el panel y lo añade a la página.
   * @returns {void}
   */
  #montar() {
    const raiz = this.#anfitrion.attachShadow({ mode: 'closed' });

    this.#aplicarEstilos(raiz);
    this.#panel.dataset.estado = 'trabajando';
    this.#panel.setAttribute('role', 'region');
    this.#panel.setAttribute('aria-label', 'Exportación del chat');
    this.#fase.setAttribute('aria-live', 'polite');

    const titular = this.#crear('div', 'titular');
    const datos = this.#crear('dl', '');

    titular.append(this.#rotulo, this.#titulo);

    for (const nombre of ['Mensajes', 'Llegó hasta', 'Peticiones', 'Multimedia']) {
      const celda = this.#crear('div', 'dato');
      const valor = this.#crear('dd', '', '—');

      celda.append(this.#crear('dt', '', nombre), valor);
      datos.append(celda);
      this.#valores.set(nombre, valor);
    }

    this.#panel.append(this.#crear('div', 'avance'), titular, datos, this.#fase, this.#botones);
    raiz.append(this.#panel);
    this.#ponerBotones([
      { texto: 'Detener y descargar', principal: true, alPulsar: this.#acciones.alDetener },
      { texto: 'Cancelar', principal: false, alPulsar: this.#acciones.alCancelar },
    ]);
    this.#documento.documentElement.append(this.#anfitrion);
  }

  /**
   * Aplica la hoja de estilos al panel sin usar estilos en línea.
   * @param {ShadowRoot} raiz
   * @returns {void}
   */
  #aplicarEstilos(raiz) {
    try {
      const hoja = new CSSStyleSheet();

      hoja.replaceSync(ESTILOS_DEL_PANEL);
      raiz.adoptedStyleSheets = [hoja];
    } catch {
      // Navegador sin hojas construibles: se intenta con una etiqueta <style>. Si la página la
      // bloquea, el panel se ve sin diseño pero sigue funcionando.
      const etiqueta = this.#documento.createElement('style');

      etiqueta.textContent = ESTILOS_DEL_PANEL;
      raiz.append(etiqueta);
    }
  }

  /**
   * Sustituye los botones del panel.
   * @param {{ texto: string, principal: boolean, alPulsar: () => void }[]} botones
   * @returns {void}
   */
  #ponerBotones(botones) {
    this.#botones.replaceChildren();

    for (const definicion of botones) {
      const boton = this.#documento.createElement('button');

      boton.type = 'button';
      boton.textContent = definicion.texto;

      if (definicion.principal) {
        boton.className = 'principal';
      }

      boton.addEventListener('click', definicion.alPulsar);
      this.#botones.append(boton);
    }
  }

  /**
   * Escribe el valor de una celda de datos.
   * @param {string} nombre
   * @param {string} texto
   * @returns {void}
   */
  #escribir(nombre, texto) {
    const celda = this.#valores.get(nombre);

    if (celda !== undefined && celda.textContent !== texto) {
      celda.textContent = texto;
    }
  }

  /**
   * Refresca las cifras y la frase de estado.
   * @param {DatosDeProgreso} datos
   * @returns {void}
   */
  actualizar(datos) {
    this.#rotulo.textContent = 'Exportando el chat';

    if (datos.titulo !== '') {
      this.#titulo.textContent = datos.titulo;
    }

    this.#escribir('Mensajes', formatearEntero(datos.mensajes));
    this.#escribir('Llegó hasta', datos.masAntiguoMs === 0 ? '—' : fechaCorta(datos.masAntiguoMs));
    this.#escribir('Peticiones', formatearEntero(datos.peticiones));

    if (datos.multimediaTotales === 0) {
      this.#escribir('Multimedia', '—');
    } else {
      this.#escribir(
        'Multimedia',
        `${formatearEntero(datos.multimediaResueltos)} de ${formatearEntero(datos.multimediaTotales)} (${formatearBytes(datos.multimediaBytes)})`,
      );
    }

    this.#faseAnterior = datos.fase;

    // Durante una espera manda la cuenta atrás; la frase se restaura al terminar.
    if (this.#cuentaAtras === 0) {
      this.#fase.textContent = datos.fase;
    }
  }

  /**
   * Muestra una cuenta atrás mientras se espera para reintentar.
   * @param {AvisoEspera} aviso Con `segundos` a 0, la espera terminó.
   * @returns {void}
   */
  mostrarEspera(aviso) {
    clearInterval(this.#cuentaAtras);
    this.#cuentaAtras = 0;

    if (aviso.segundos <= 0) {
      this.#fase.textContent = this.#faseAnterior;
      return;
    }

    const causa = aviso.motivo === 'limite' ? 'Instagram pidió ir más despacio.' : 'Falló la conexión con Instagram.';
    let restantes = Math.ceil(aviso.segundos);

    /** @returns {void} */
    const pintar = () => {
      this.#fase.textContent = `${causa} Reintento en ${restantes} s.`;
      restantes = Math.max(0, restantes - 1);
    };

    pintar();
    this.#cuentaAtras = setInterval(pintar, 1000);
  }

  /**
   * Deja el panel en su estado final, con el resultado y el botón para repetir la descarga.
   * @param {{ titulo: string, detalle: string, alDescargarOtraVez: () => void, alCerrar: () => void }} final
   * @returns {void}
   */
  finalizar(final) {
    clearInterval(this.#cuentaAtras);
    this.#cuentaAtras = 0;
    this.#panel.dataset.estado = 'hecho';
    this.#rotulo.textContent = 'Chat exportado';
    this.#titulo.textContent = final.titulo;
    this.#fase.textContent = final.detalle;
    this.#ponerBotones([
      { texto: 'Descargar otra vez', principal: true, alPulsar: final.alDescargarOtraVez },
      {
        texto: 'Cerrar',
        principal: false,
        alPulsar: () => {
          final.alCerrar();
          this.quitar();
        },
      },
    ]);
  }

  /**
   * Muestra un error que impidió exportar.
   * @param {string} mensaje
   * @returns {void}
   */
  mostrarError(mensaje) {
    clearInterval(this.#cuentaAtras);
    this.#cuentaAtras = 0;
    this.#panel.dataset.estado = 'error';
    this.#rotulo.textContent = 'No se pudo exportar';
    this.#fase.textContent = mensaje;
    this.#ponerBotones([{ texto: 'Cerrar', principal: true, alPulsar: () => this.quitar() }]);
  }

  /**
   * Retira el panel de la página.
   * @returns {void}
   */
  quitar() {
    clearInterval(this.#cuentaAtras);
    this.#cuentaAtras = 0;
    this.#anfitrion.remove();
  }
}

// ═══ MÓDULO exportador ═══════════════════════════════════════════════════════════════════════════════

/**
 * @file Dirección de la exportación.
 * Responsabilidad única: coordinar los demás módulos, de la lectura del historial al ZIP.
 * No sabe hablar con Instagram, ni interpretar mensajes, ni escribir formatos: reparte el trabajo.
 */

const TITULO_POR_DEFECTO = 'Conversación';

/** Módulos de la página que usa el exportador. Su presencia se anota en el diagnóstico. */
const MODULOS_QUE_SE_CONSULTAN = [
  'DTSGInitialData',
  'DTSGInitData',
  'LSD',
  'CurrentUserInitialData',
  'PolarisViewer',
  'BDHeaderConfig',
  'getAsyncParams',
  'IGDThreadDetailQuery.graphql',
  'IGDMessageListOffMsysQuery.graphql',
  'IGDInboxHeaderOffMsysQuery.graphql',
];

/**
 * @typedef {Object} ResultadoExportacion
 * @property {string} archivo       Nombre del ZIP descargado.
 * @property {number} bytes
 * @property {number} mensajes
 * @property {boolean} completa
 * @property {string} motivoParcial
 * @property {ResumenMultimedia} multimedia
 * @property {number} duracionMs
 */

/**
 * @typedef {Object} DependenciasExportador
 * @property {Window} ventana
 * @property {Document} documento
 * @property {Opciones} opciones
 * @property {ControlEjecucion} control
 * @property {RegistroDiagnostico} registro
 * @property {PanelProgreso} panel
 */

/**
 * Lee la clave de la conversación abierta a partir de la dirección de la página.
 * @param {Location} direccion
 * @returns {string}
 * @throws {ErrorExportacion} SIN_CHAT si la pestaña no muestra una conversación de Instagram.
 */
function leerClaveDeLaDireccion(direccion) {
  const esInstagram = direccion.hostname === 'instagram.com' || direccion.hostname.endsWith('.instagram.com');

  if (!esInstagram) {
    throw new ErrorExportacion('SIN_CHAT', 'Este script se pega en la consola de instagram.com, con la conversación abierta.');
  }

  const coincidencia = /\/direct\/t\/([^/?#]+)/.exec(direccion.pathname);

  if (coincidencia === null) {
    throw new ErrorExportacion(
      'SIN_CHAT',
      'No hay ninguna conversación abierta. Entra en instagram.com/direct, abre el chat (la dirección debe contener /direct/t/…) y vuelve a pegar el script.',
    );
  }

  return decodeURIComponent(coincidencia[1]);
}

/**
 * Resume un mensaje ya normalizado en una línea, para completar las citas que llegaron sin texto.
 * @param {Mensaje} mensaje
 * @returns {string}
 */
function resumirMensaje(mensaje) {
  const texto = enUnaLinea(mensaje.texto);

  if (texto !== '') {
    return recortar(texto, 140);
  }

  return ETIQUETAS_DE_TIPO[mensaje.tipo];
}

/**
 * Recorre todos los adjuntos de un mensaje, incluida la miniatura de lo compartido.
 * @param {Mensaje} mensaje
 * @returns {Adjunto[]}
 */
function adjuntosDe(mensaje) {
  if (mensaje.compartido === null || mensaje.compartido.miniatura === null) {
    return mensaje.adjuntos;
  }

  return [...mensaje.adjuntos, mensaje.compartido.miniatura];
}

class Exportador {
  /** @type {Window} */
  #ventana;

  /** @type {Document} */
  #documento;

  /** @type {Opciones} */
  #opciones;

  /** @type {ControlEjecucion} */
  #control;

  /** @type {RegistroDiagnostico} */
  #registro;

  /** @type {PanelProgreso} */
  #panel;

  #almacen = new AlmacenMensajes();

  /** @type {DirectorioParticipantes | null} */
  #directorio = null;

  /** @type {DescargadorMultimedia | null} */
  #descargador = null;

  /** @type {ClienteGraphQL | null} */
  #cliente = null;

  /** Mensajes cargados que caen dentro de las fechas pedidas. */
  #enElTramo = 0;

  #titulo = '';

  #fase = 'Abriendo la conversación.';

  /** Filas que Instagram envió y no son mensajes, por motivo. */
  /** @type {Record<string, number>} */
  #descartados = {};

  /** Mensajes de tipos que este script no conoce, por tipo. */
  /** @type {Record<string, number>} */
  #tiposDesconocidos = {};

  /** Dirección temporal del ZIP, para poder repetir la descarga desde el panel. */
  #direccionDelZip = '';

  /**
   * @param {DependenciasExportador} dependencias
   */
  constructor(dependencias) {
    this.#ventana = dependencias.ventana;
    this.#documento = dependencias.documento;
    this.#opciones = dependencias.opciones;
    this.#control = dependencias.control;
    this.#registro = dependencias.registro;
    this.#panel = dependencias.panel;
  }

  /**
   * Exporta la conversación abierta y descarga el ZIP.
   * @returns {Promise<ResultadoExportacion>}
   * @throws {ErrorExportacion} si no se puede obtener ni la primera página del historial.
   */
  async ejecutar() {
    const inicioMs = Date.now();
    const clave = leerClaveDeLaDireccion(this.#ventana.location);
    const modulos = new ModulosPagina(this.#ventana);
    const sesion = new SesionPagina(modulos, this.#documento, this.#registro);
    const catalogo = new CatalogoConsultas(modulos, this.#documento, this.#registro);
    const cliente = new ClienteGraphQL({
      sesion,
      control: this.#control,
      registro: this.#registro,
      ajustes: this.#opciones.avanzado,
      pausaEntrePaginasMs: this.#opciones.pausaEntrePaginasMs,
      alEsperar: (aviso) => this.#panel.mostrarEspera(aviso),
    });
    const lector = new LectorHilo({
      cliente,
      catalogo,
      registro: this.#registro,
      clave,
      mensajesPorPagina: this.#opciones.avanzado.mensajesPorPagina,
    });
    const directorio = new DirectorioParticipantes(sesion.identidad());

    this.#cliente = cliente;
    this.#directorio = directorio;
    this.#descargador = new DescargadorMultimedia({
      documento: this.#documento,
      control: this.#control,
      registro: this.#registro,
      ajustes: this.#opciones.avanzado,
      simultaneas: this.#opciones.descargasSimultaneas,
      limiteBytes: this.#opciones.limiteMultimediaBytes,
      alProgresar: () => this.#refrescarPanel(),
    });
    this.#registro.fijar('entorno', {
      version: VERSION,
      relojDeFondo: this.#control.relojDeFondoActivo,
      modulosDeLaPagina: modulos.disponible,
      modulosHallados: modulos.inventario(MODULOS_QUE_SE_CONSULTAN),
    });
    this.#refrescarPanel();

    const apertura = await lector.abrir();

    directorio.registrarHilo(apertura.hilo);
    this.#titulo = this.#componerTitulo(apertura.hilo, directorio);

    const carga = await this.#cargarHistorial(lector, apertura);

    await this.#esperarMultimedia(carga);
    this.#descargador.cerrar();

    if (this.#control.cancelado) {
      throw new ErrorExportacion('CANCELADO', 'La exportación se canceló.');
    }

    this.#fase = 'Armando el archivo ZIP.';
    this.#refrescarPanel();

    const mensajes = seleccionarTramo(this.#almacen.enOrdenCronologico(), this.#opciones);
    /** @type {DatosConversacion} */
    const conversacion = {
      clave,
      idHilo: aTexto(apertura.hilo.thread_fbid) || aTexto(apertura.hilo.id),
      // Se recompone al final: los nombres de los remitentes pueden haber llegado con los mensajes.
      titulo: this.#componerTitulo(apertura.hilo, directorio),
      esGrupo: apertura.hilo.is_group === true || directorio.lista().length > 2,
    };
    /** @type {EstadoFinal} */
    const estado = {
      completa: carga.completa,
      motivoParcial: carga.motivoParcial,
      paginas: carga.paginas,
      duracionMs: Date.now() - inicioMs,
      descartados: this.#descartados,
      tiposDesconocidos: this.#tiposDesconocidos,
    };

    return this.#empaquetar(conversacion, mensajes, estado, directorio, inicioMs);
  }

  /**
   * Compone el título de la conversación: el nombre del grupo o los nombres de las otras personas.
   * @param {Crudo} hilo
   * @param {DirectorioParticipantes} directorio
   * @returns {string}
   */
  #componerTitulo(hilo, directorio) {
    const tituloDelHilo = aTexto(hilo.thread_title).trim();

    if (tituloDelHilo !== '') {
      return tituloDelHilo;
    }

    const otros = directorio
      .lista()
      .filter((participante) => !participante.esYo)
      .map((participante) => directorio.nombreDe(participante.id));

    if (otros.length === 0) {
      return TITULO_POR_DEFECTO;
    }

    return otros.join(', ');
  }

  /**
   * Refresca las cifras del panel.
   * @returns {void}
   */
  #refrescarPanel() {
    const descargador = this.#descargador;

    this.#panel.actualizar({
      titulo: this.#titulo,
      mensajes: this.#almacen.cantidad,
      masAntiguoMs: this.#almacen.masAntiguoMs,
      peticiones: this.#cliente === null ? 0 : this.#cliente.peticiones,
      multimediaResueltos: descargador === null ? 0 : descargador.resueltos,
      multimediaTotales: descargador === null ? 0 : descargador.encolados,
      multimediaBytes: descargador === null ? 0 : descargador.bytes,
      fase: this.#fase,
    });
  }

  /**
   * Pone en cola la multimedia de un mensaje, si las opciones piden descargarla.
   * @param {Mensaje} mensaje
   * @returns {void}
   */
  #encolarMultimedia(mensaje) {
    const descargador = this.#descargador;

    if (descargador === null || !this.#opciones.descargarMultimedia) {
      return;
    }

    for (const adjunto of mensaje.adjuntos) {
      descargador.encolar(adjunto);
    }

    const miniatura = mensaje.compartido === null ? null : mensaje.compartido.miniatura;

    if (miniatura !== null && this.#opciones.miniaturasDeCompartidos) {
      descargador.encolar(miniatura);
    }
  }

  /**
   * Incorpora una página de mensajes crudos al almacén.
   * @param {Crudo[]} nodos
   * @returns {{ nuevos: number, masNuevoMs: number }} Cuántos eran nuevos y la fecha del más reciente (0 si ninguno).
   */
  #incorporarPagina(nodos) {
    const directorio = this.#directorio;
    let nuevos = 0;
    let masNuevoMs = 0;

    for (const nodo of nodos) {
      if (directorio !== null) {
        directorio.registrarRemitente(nodo);
      }

      const { mensaje, descarte } = normalizarMensaje(nodo);

      if (mensaje === null) {
        this.#descartados[descarte] = (this.#descartados[descarte] ?? 0) + 1;
        continue;
      }

      if (mensaje.marcaTiempoMs > masNuevoMs) {
        masNuevoMs = mensaje.marcaTiempoMs;
      }

      if (!this.#almacen.agregar(mensaje)) {
        continue;
      }

      nuevos += 1;

      if (mensaje.tipo === 'desconocido') {
        const tipo = mensaje.tipoOriginal === '' ? '(sin tipo)' : mensaje.tipoOriginal;

        if (this.#tiposDesconocidos[tipo] === undefined) {
          this.#registro.guardarForma(`tipo no reconocido: ${tipo}`, nodo.content);
        }

        this.#tiposDesconocidos[tipo] = (this.#tiposDesconocidos[tipo] ?? 0) + 1;
      }

      if (!estaEnElTramo(mensaje.marcaTiempoMs, this.#opciones)) {
        continue;
      }

      // Los mensajes llegan del más nuevo al más antiguo: los primeros N del tramo son los pedidos.
      const superaLoPedido = this.#opciones.ultimosMensajes > 0 && this.#enElTramo >= this.#opciones.ultimosMensajes;

      this.#enElTramo += 1;

      if (!superaLoPedido) {
        this.#encolarMultimedia(mensaje);
      }
    }

    return { nuevos, masNuevoMs };
  }

  /**
   * Carga el historial página a página hasta el primer mensaje, hasta el tramo pedido o hasta
   * que algo obligue a parar.
   * @param {LectorHilo} lector
   * @param {AperturaHilo} apertura
   * @returns {Promise<{ completa: boolean, motivoParcial: string, paginas: number }>}
   */
  async #cargarHistorial(lector, apertura) {
    const ajustes = this.#opciones.avanzado;
    /** @type {Set<string>} */
    const cursoresVistos = new Set();
    /** @type {PaginaMensajes} */
    let pagina = apertura.pagina;
    let paginas = 1;
    let paginasSinNovedad = 0;

    this.#fase = 'Pidiendo el historial a Instagram, 20 mensajes por petición.';

    /**
     * @param {string} motivo
     * @returns {{ completa: boolean, motivoParcial: string, paginas: number }}
     */
    const parcial = (motivo) => {
      const alcance = this.#almacen.cantidad === 0 ? '' : ` Los mensajes llegan hasta el ${fechaCorta(this.#almacen.masAntiguoMs)}.`;

      return { completa: false, motivoParcial: `${motivo}${alcance}`, paginas };
    };

    for (;;) {
      const { nuevos, masNuevoMs } = this.#incorporarPagina(pagina.nodos);

      this.#refrescarPanel();

      const yaEstanLosPedidos = this.#opciones.ultimosMensajes > 0 && this.#enElTramo >= this.#opciones.ultimosMensajes;
      // Se da por pasada la fecha «desde» cuando una página entera es anterior a ella.
      const yaPasoLaFecha = this.#opciones.desdeMs !== null && masNuevoMs !== 0 && masNuevoMs < this.#opciones.desdeMs;

      if (yaEstanLosPedidos || yaPasoLaFecha) {
        return { completa: true, motivoParcial: '', paginas };
      }

      if (!pagina.hayMas) {
        if (lector.finIncierto) {
          return parcial('Instagram anunció mensajes más antiguos y no los entregó; puede que falten.');
        }

        return { completa: true, motivoParcial: '', paginas };
      }

      if (this.#control.detenido) {
        return parcial('La detuviste antes de llegar al primer mensaje.');
      }

      if (cursoresVistos.has(pagina.cursorSiguiente)) {
        return parcial('Instagram repitió una página del historial y no se pudo seguir.');
      }

      cursoresVistos.add(pagina.cursorSiguiente);
      paginasSinNovedad = nuevos === 0 ? paginasSinNovedad + 1 : 0;

      if (paginasSinNovedad >= ajustes.paginasSinNovedadMaximas) {
        return parcial('Instagram dejó de entregar mensajes nuevos antes de llegar al principio.');
      }

      try {
        pagina = await lector.paginaAnterior(pagina.cursorSiguiente);
        paginas += 1;
      } catch (error) {
        if (esErrorDeCodigo(error, 'CANCELADO')) {
          throw error;
        }

        if (esErrorDeCodigo(error, 'DETENIDO')) {
          return parcial('La detuviste antes de llegar al primer mensaje.');
        }

        this.#registro.anotar('historial interrumpido', { causa: recortar(describirError(error), 160) });

        return parcial(describirError(error));
      }
    }
  }

  /**
   * Espera a que termine la multimedia que quedó en cola.
   * @param {{ completa: boolean, motivoParcial: string }} carga Se marca como parcial si se detiene durante la espera.
   * @returns {Promise<void>}
   */
  async #esperarMultimedia(carga) {
    const descargador = this.#descargador;

    if (descargador === null || descargador.resueltos >= descargador.encolados) {
      return;
    }

    const estabaDetenida = this.#control.detenido;

    this.#fase = 'Historial completo. Descargando fotos, videos y audios.';
    this.#refrescarPanel();
    await descargador.esperarFin();

    if (!estabaDetenida && this.#control.detenido && carga.completa) {
      carga.completa = false;
      carga.motivoParcial = 'La detuviste antes de terminar de descargar la multimedia; los mensajes están completos.';
    }
  }

  /**
   * Cuenta la multimedia de los mensajes que entran en el ZIP.
   * @param {Mensaje[]} mensajes
   * @returns {ResumenMultimedia}
   */
  #resumirMultimedia(mensajes) {
    /** @type {ResumenMultimedia} */
    const resumen = { descargados: 0, fallidos: 0, omitidos: 0, bytes: 0, motivos: {} };

    for (const mensaje of mensajes) {
      for (const adjunto of adjuntosDe(mensaje)) {
        if (adjunto.estado === 'descargado') {
          resumen.descargados += 1;
          resumen.bytes += adjunto.bytes;
          continue;
        }

        // La miniatura de un reel que no se pidió descargar no es una pérdida: queda su enlace.
        const esMiniaturaNoPedida = adjunto.clase === 'miniatura' && adjunto.estado === 'pendiente';

        if (esMiniaturaNoPedida) {
          continue;
        }

        if (adjunto.estado === 'fallido') {
          resumen.fallidos += 1;
        } else {
          resumen.omitidos += 1;
        }

        const motivo = explicarAusencia(adjunto);

        resumen.motivos[motivo] = (resumen.motivos[motivo] ?? 0) + 1;
      }
    }

    return resumen;
  }

  /**
   * Escribe los tres archivos de texto, añade la multimedia y descarga el ZIP.
   * @param {DatosConversacion} conversacion
   * @param {Mensaje[]} mensajes  En orden cronológico.
   * @param {EstadoFinal} estado
   * @param {DirectorioParticipantes} directorio
   * @param {number} inicioMs     Momento en que empezó la exportación.
   * @returns {ResultadoExportacion}
   */
  #empaquetar(conversacion, mensajes, estado, directorio, inicioMs) {
    const descargador = this.#descargador;
    const exportadoMs = Date.now();
    const zip = new EscritorZip();
    /** @type {Map<string, number>} */
    const indicePorId = new Map();

    for (let i = 0; i < mensajes.length; i += 1) {
      indicePorId.set(mensajes[i].id, i);

      if (mensajes[i].idAlterno !== '') {
        indicePorId.set(mensajes[i].idAlterno, i);
      }
    }

    // Las citas que llegaron solo con el identificador se completan con el mensaje citado, si está.
    for (const mensaje of mensajes) {
      const cita = mensaje.respuestaA;

      if (cita === null) {
        continue;
      }

      const indiceCitado = indicePorId.get(cita.idMensaje);

      if (indiceCitado === undefined) {
        continue;
      }

      const citado = mensajes[indiceCitado];

      if (cita.resumen === '') {
        cita.resumen = resumirMensaje(citado);
      }

      if (cita.idRemitente === '') {
        cita.idRemitente = citado.idRemitente;
      }
    }

    // Los archivos se numeran en orden cronológico: media/000001 es el más antiguo.
    /** @type {{ adjunto: Adjunto, marcaTiempoMs: number }[]} */
    const archivos = [];

    for (const mensaje of mensajes) {
      for (const adjunto of adjuntosDe(mensaje)) {
        if (adjunto.estado !== 'descargado') {
          continue;
        }

        const numero = String(archivos.length + 1).padStart(6, '0');

        adjunto.archivo = `media/${numero}.${extensionPara(adjunto.tipoMime, adjunto.url, adjunto.clase)}`;
        archivos.push({ adjunto, marcaTiempoMs: mensaje.marcaTiempoMs });
      }
    }

    /** @type {ContextoSalida} */
    const contexto = {
      version: VERSION,
      exportadoMs,
      zonaHoraria: zonaHorariaLocal(),
      conversacion,
      participantes: directorio.lista(),
      mensajes,
      nombreDe: (id) => directorio.nombreDe(id),
      esYo: (id) => directorio.esYo(id),
      indicePorId,
      opciones: this.#opciones,
      estado,
      multimedia: this.#resumirMultimedia(mensajes),
    };

    zip.agregarTexto('chat.html', serializarHtml(contexto), exportadoMs);
    zip.agregarTexto('chat.json', serializarJson(contexto), exportadoMs);
    zip.agregarTexto('chat.txt', serializarTexto(contexto), exportadoMs);

    for (const { adjunto, marcaTiempoMs } of archivos) {
      const contenido = descargador === null ? undefined : descargador.contenidoDe(adjunto);

      if (contenido !== undefined) {
        zip.agregar(adjunto.archivo, [contenido.blob], contenido.blob.size, contenido.crc, marcaTiempoMs);
      }
    }

    const blob = zip.generar();
    const sufijo = estado.completa ? '' : '-PARCIAL';
    const archivo = `instagram-${crearSlug(conversacion.titulo)}-${claveDeDia(exportadoMs)}${sufijo}.zip`;

    this.#direccionDelZip = URL.createObjectURL(blob);
    this.#descargar(archivo);

    /** @type {ResultadoExportacion} */
    const resultado = {
      archivo,
      bytes: blob.size,
      mensajes: mensajes.length,
      completa: estado.completa,
      motivoParcial: estado.motivoParcial,
      multimedia: contexto.multimedia,
      duracionMs: Date.now() - inicioMs,
    };

    this.#mostrarFinal(resultado, conversacion.titulo);

    return resultado;
  }

  /**
   * Libera el ZIP de la memoria del navegador. Después ya no se puede repetir la descarga.
   * @returns {void}
   */
  liberar() {
    if (this.#direccionDelZip !== '') {
      URL.revokeObjectURL(this.#direccionDelZip);
      this.#direccionDelZip = '';
    }
  }

  /**
   * Lanza la descarga del ZIP con un enlace temporal.
   * @param {string} archivo
   * @returns {void}
   */
  #descargar(archivo) {
    const enlace = this.#documento.createElement('a');

    enlace.href = this.#direccionDelZip;
    enlace.download = archivo;
    enlace.rel = 'noopener';
    this.#documento.body.append(enlace);
    enlace.click();
    enlace.remove();
  }

  /**
   * Deja en el panel el resumen de lo exportado.
   * @param {ResultadoExportacion} resultado
   * @param {string} titulo
   * @returns {void}
   */
  #mostrarFinal(resultado, titulo) {
    const multimedia = resultado.multimedia;
    const sinDescargar = multimedia.fallidos + multimedia.omitidos;
    /** @type {string[]} */
    const frases = [
      `${formatearEntero(resultado.mensajes)} mensajes en ${formatearDuracion(resultado.duracionMs)}.`,
      `Se descargó ${resultado.archivo} (${formatearBytes(resultado.bytes)}).`,
    ];

    if (sinDescargar > 0) {
      frases.push(`${formatearEntero(sinDescargar)} archivos multimedia no se pudieron bajar; el motivo de cada uno está en chat.json.`);
    }

    if (!resultado.completa) {
      frases.unshift(`Exportación parcial. ${resultado.motivoParcial}`);
    }

    this.#panel.finalizar({
      titulo,
      detalle: frases.join(' '),
      alDescargarOtraVez: () => this.#descargar(resultado.archivo),
      alCerrar: () => this.liberar(),
    });
  }
}

// ═══ MÓDULO principal ════════════════════════════════════════════════════════════════════════════════

/**
 * @file Arranque del script.
 * Responsabilidad única: poner en marcha la exportación al pegar el archivo en la consola y
 * dejar en `exportadorInstagram` las órdenes para controlarla.
 */

/**
 * @typedef {Object} OrdenesDeConsola
 * @property {string} version
 * @property {() => string} detener                        Deja de cargar y descarga lo capturado.
 * @property {() => string} cancelar                       Aborta sin descargar nada.
 * @property {() => Record<string, unknown>} diagnostico   Informe técnico sin datos del chat.
 * @property {Promise<ResultadoExportacion | null>} resultado  Se cumple al terminar (null si no se exportó).
 */

/**
 * Oculta la clave de la conversación en una ruta, para que el diagnóstico se pueda compartir.
 * @param {string} ruta
 * @returns {string}
 */
function enmascararRuta(ruta) {
  return ruta.replace(/\/direct\/t\/([^/]+)/, (_todo, clave) => `/direct/t/<clave de ${String(clave).length} caracteres>`);
}

/**
 * Arranca la exportación de la conversación abierta.
 * @returns {string} Frase que la consola muestra al pegar el script.
 */
function arrancar() {
  /** @type {{ exportadorInstagram?: Partial<OrdenesDeConsola>, CONFIG_EXPORTADOR_INSTAGRAM?: unknown }} */
  const global = /** @type {any} */ (globalThis);
  const anterior = global.exportadorInstagram;

  // Si el script se pega dos veces, la exportación anterior se cancela para que no se solapen.
  if (anterior !== undefined && typeof anterior.cancelar === 'function') {
    try {
      anterior.cancelar();
    } catch {
      // La instancia anterior ya había terminado.
    }
  }

  const registro = new RegistroDiagnostico();
  const control = new ControlEjecucion();
  const panel = new PanelProgreso(document, {
    alDetener: () => control.detener(),
    alCancelar: () => control.cancelar(),
  });

  /** @type {Exportador | null} */
  let exportador = null;

  /**
   * @returns {Promise<ResultadoExportacion | null>}
   */
  const exportar = async () => {
    try {
      const opciones = resolverOpciones(CONFIG, AJUSTES_AVANZADOS, global.CONFIG_EXPORTADOR_INSTAGRAM);

      exportador = new Exportador({ ventana: window, documento: document, opciones, control, registro, panel });

      const exportado = await exportador.ejecutar();

      console.info(`[Exportador de Instagram] ${exportado.mensajes} mensajes en ${exportado.archivo}.`, exportado);

      return exportado;
    } catch (error) {
      if (esErrorDeCodigo(error, 'CANCELADO')) {
        panel.quitar();
        console.info('[Exportador de Instagram] Exportación cancelada: no se descargó nada.');

        return null;
      }

      registro.anotar('error', { mensaje: describirError(error) });
      panel.mostrarError(describirError(error));
      console.error('[Exportador de Instagram]', error);

      return null;
    }
  };

  /**
   * Exporta sosteniendo un «bloqueo web»: mientras una página tiene uno, Chrome no la congela
   * aunque lleve rato en segundo plano. El bloqueo se suelta solo cuando la exportación termina.
   * @returns {Promise<ResultadoExportacion | null>}
   */
  const exportarSinCongelarse = async () => {
    const hayBloqueos = typeof navigator.locks === 'object' && navigator.locks !== null;

    if (!hayBloqueos) {
      return exportar();
    }

    const nombreDelBloqueo = `exportador-instagram-${Date.now()}`;
    const exportado = await navigator.locks.request(nombreDelBloqueo, () => exportar());

    return exportado;
  };

  let haTerminado = false;
  const resultado = exportarSinCongelarse().finally(() => {
    haTerminado = true;
    control.cerrar();
  });

  /** @type {OrdenesDeConsola} */
  const ordenes = {
    version: VERSION,
    detener: () => {
      if (haTerminado) {
        return 'La exportación ya había terminado.';
      }

      control.detener();

      return 'Deteniendo: se descargará lo capturado hasta ahora, marcado como parcial.';
    },
    cancelar: () => {
      control.cancelar();

      if (haTerminado) {
        if (exportador !== null) {
          exportador.liberar();
        }

        panel.quitar();

        return 'La exportación ya había terminado: se cerró su panel.';
      }

      return 'Cancelado: no se descargará nada.';
    },
    diagnostico: () => ({
      version: VERSION,
      fecha: new Date().toISOString(),
      ruta: enmascararRuta(location.pathname),
      navegador: navigator.userAgent,
      ...registro.volcar(),
    }),
    resultado,
  };

  global.exportadorInstagram = ordenes;

  return 'Exportación en marcha: sigue el panel de la esquina inferior derecha.';
}

// ═══ ARRANQUE ════════════════════════════════════════════════════════════════════════════════════

return arrancar();
})();
