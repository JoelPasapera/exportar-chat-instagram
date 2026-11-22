# Exportador de chats de Instagram

**Exporta la conversación de Instagram que tienes abierta a un archivo ZIP** con una versión legible en HTML, los datos estructurados en JSON, una copia en texto plano y los archivos multimedia que se hayan podido descargar.

- **Versión:** 1.0.0
- **Tipo de proyecto:** script JavaScript de navegador, en un solo archivo y sin dependencias externas.
- **Ejecución:** desde la consola de desarrollador de Instagram Web.

> **Aviso importante:** este proyecto utiliza endpoints, módulos e identificadores internos de Instagram que no forman parte de una API pública estable. Instagram puede modificarlos, limitar las solicitudes o impedir determinadas descargas. El funcionamiento no está garantizado y puede requerir mantenimiento.

## Contenido

- [Características](#características)
- [Requisitos](#requisitos)
- [Instalación y uso](#instalación-y-uso)
- [Configuración](#configuración)
- [Controles durante la exportación](#controles-durante-la-exportación)
- [Contenido del ZIP](#contenido-del-zip)
- [Limitaciones conocidas](#limitaciones-conocidas)
- [Privacidad y seguridad](#privacidad-y-seguridad)
- [Estructura técnica](#estructura-técnica)
- [Solución de problemas](#solución-de-problemas)
- [Licencia](#licencia)

## Características

- **Historial por paginación:** obtiene mensajes anteriores mediante cursores, sin depender de recorrer la conversación manualmente con el scroll.
- **Filtros de exportación:** permite limitar la exportación por cantidad de mensajes recientes y por fechas.
- **Multimedia:** intenta descargar fotos, videos, audios, animaciones y stickers compatibles. También puede descargar miniaturas de publicaciones y reels compartidos.
- **Tres formatos de lectura:** genera HTML, JSON y TXT dentro del mismo ZIP.
- **Visor HTML:** presenta los mensajes en orden cronológico, agrupados por día y participante, con buscador y recursos multimedia locales cuando se descargaron correctamente.
- **Progreso visible:** muestra un panel con el estado de la exportación y permite detenerla o cancelarla.
- **Manejo de errores:** contempla reintentos ante fallos de red, esperas cuando Instagram limita las solicitudes y exportaciones parciales cuando no se puede completar la lectura.
- **Diagnóstico:** ofrece un informe técnico pensado para ayudar a identificar problemas sin incluir el texto de los mensajes ni los nombres de los participantes.
- **ZIP sin compresión:** escribe el archivo ZIP con el método STORE y calcula CRC-32 para verificar la integridad de sus entradas. No necesita incorporar una biblioteca ZIP externa.

## Requisitos

- Una cuenta con sesión iniciada en [Instagram Web](https://www.instagram.com/).
- Una conversación abierta cuya dirección contenga la ruta `/direct/t/...`.
- Un navegador de escritorio moderno. El uso está orientado principalmente a Chrome; otros navegadores pueden comportarse de manera diferente y no se consideran verificados.
- Acceso a las herramientas de desarrollador y a la consola del navegador.

No requiere Node.js, npm, instalación de paquetes ni un servidor propio para ejecutarse en el navegador.

## Instalación y uso

1. Descarga o clona este repositorio.
2. Abre Instagram Web e inicia sesión normalmente.
3. Entra en la conversación que deseas exportar. Comprueba que la dirección incluya `/direct/t/`.
4. Abre las herramientas de desarrollador con `F12` y selecciona la pestaña **Consola**.
5. Abre `exportador-instagram.js`, copia su contenido completo y pégalo en la consola.
6. Pulsa `Enter`. Si Chrome muestra su advertencia de protección contra pegado, sigue el procedimiento que el propio navegador indique únicamente después de haber revisado el código que vas a ejecutar.
7. El panel que aparece en la página mostrará el progreso. Al terminar, el navegador descargará un archivo `.zip`.
8. Descomprime el ZIP y abre `chat.html` en el navegador para consultar la conversación.

**Importante:** no cierres ni recargues la pestaña de Instagram mientras se realiza la exportación. Puedes cambiar a otra pestaña, pero deja abierta la pestaña desde la que comenzó el proceso.

## Configuración

La configuración se puede establecer antes de ejecutar el script mediante la variable global `CONFIG_EXPORTADOR_INSTAGRAM`. Por ejemplo, para exportar los últimos 500 mensajes sin descargar multimedia:

```javascript
window.CONFIG_EXPORTADOR_INSTAGRAM = {
  ultimosMensajes: 500,
  desde: "",
  hasta: "",
  descargarMultimedia: false,
  miniaturasDeCompartidos: false,
  limiteMultimediaMB: 500,
  descargasSimultaneas: 3,
  pausaEntrePaginasMs: 150
};
```

Después de ejecutar ese bloque en la consola, pega el contenido de `exportador-instagram.js`.

### Opciones disponibles

| Opción | Valor predeterminado | Descripción |
|---|---:|---|
| `ultimosMensajes` | `0` | Cantidad máxima de mensajes recientes. `0` significa que no se aplica este límite. |
| `desde` | `""` | Fecha inicial incluida, con formato `AAAA-MM-DD`. Vacía significa sin fecha inicial. |
| `hasta` | `""` | Fecha final incluida, con formato `AAAA-MM-DD`. Vacía significa sin fecha final. |
| `descargarMultimedia` | `true` | Intenta descargar los archivos multimedia compatibles. `false` exporta solo los datos y referencias. |
| `miniaturasDeCompartidos` | `false` | Intenta descargar también miniaturas de publicaciones y reels compartidos. |
| `limiteMultimediaMB` | `2000` | Límite total de multimedia que se intentará incluir en el ZIP, expresado en MB. |
| `descargasSimultaneas` | `6` | Número máximo de descargas multimedia simultáneas. |
| `pausaEntrePaginasMs` | `150` | Pausa base entre peticiones del historial, en milisegundos. |

Los valores externos sustituyen únicamente las opciones indicadas; las demás conservan sus valores predeterminados.

### Consideraciones sobre las fechas y los límites

- Las fechas deben escribirse como `AAAA-MM-DD`, por ejemplo `2026-01-01`.
- Los días indicados en `desde` y `hasta` se incluyen en el intervalo.
- Las fechas se interpretan usando la zona horaria local del navegador.
- `ultimosMensajes: 0` solicita todo el historial disponible para esa conversación, sujeto a los límites y respuestas de Instagram.
- Para una primera prueba, conviene usar pocos mensajes y desactivar la descarga multimedia. Las conversaciones extensas y los archivos grandes pueden consumir bastante memoria del navegador.

## Controles durante la exportación

Una vez iniciado el script, queda disponible el objeto global `exportadorInstagram`.

| Comando | Acción |
|---|---|
| `exportadorInstagram.detener()` | Deja de solicitar más historial y prepara una exportación parcial con lo que se haya recopilado. |
| `exportadorInstagram.cancelar()` | Cancela la operación sin generar una nueva descarga. |
| `exportadorInstagram.diagnostico()` | Devuelve un informe técnico para investigar problemas. |
| `exportadorInstagram.resultado` | Promesa que se resuelve al finalizar con el resultado de la exportación, o `null` si se canceló o no se pudo completar. |
| `exportadorInstagram.version` | Muestra la versión del script en ejecución. |

Para copiar el diagnóstico desde la consola de Chrome:

```javascript
copy(exportadorInstagram.diagnostico());
```

El diagnóstico está diseñado para excluir textos de mensajes, nombres y credenciales. Aun así, revísalo antes de compartirlo públicamente.

## Contenido del ZIP

El archivo descargado tendrá un nombre parecido a `instagram-nombre-del-chat-AAAA-MM-DD.zip`. Si la lectura del historial terminó de forma incompleta, el nombre incluirá el sufijo `-PARCIAL`.

```text
instagram-nombre-del-chat-AAAA-MM-DD.zip
│
├── chat.html       # Visor de la conversación
├── chat.json       # Datos estructurados de los mensajes
├── chat.txt        # Texto agrupado por día
│
└── media/          # Multimedia que se pudo descargar
    ├── 000001.jpg
    ├── 000002.mp4
    └── ...
```

### `chat.html`

Versión visual de la conversación. Incluye burbujas de mensajes, participantes, fechas, referencias a respuestas, reacciones y visualización de los archivos multimedia locales que se hayan descargado. También incorpora un buscador y una escala temporal para recorrer la conversación.

### `chat.json`

Datos estructurados para consulta, procesamiento o análisis posterior. Incluye, entre otros campos, identificadores, remitentes, tipo de mensaje, texto, fecha ISO, fecha local, respuestas, reacciones y metadatos de adjuntos. Para los tipos de mensaje no reconocidos se conserva información original disponible en la respuesta de Instagram.

### `chat.txt`

Transcripción en texto plano organizada cronológicamente y agrupada por día. Es útil para búsquedas externas o lectura sin formato.

### `media/`

Contiene los archivos multimedia cuya descarga se completó. Los adjuntos que no se pudieron obtener quedan identificados en los datos exportados con su estado y motivo. Los enlaces originales de Instagram pueden caducar.

## Limitaciones conocidas

- **API no pública:** la extracción depende de la implementación interna de Instagram Web. Los nombres de consultas, identificadores, variables, credenciales y estructuras de respuesta pueden cambiar sin aviso.
- **Límites de la plataforma:** Instagram puede ralentizar, limitar o bloquear temporalmente las solicitudes. Las esperas y reintentos reducen algunos fallos, pero no garantizan que la exportación termine.
- **Paginación:** el script trabaja con las páginas que devuelve Instagram. No puede recuperar mensajes que el servidor ya no ofrece a esa cuenta o conversación.
- **Multimedia:** CORS, la política de seguridad del navegador, enlaces vencidos, errores del servidor o límites de tamaño pueden impedir algunas descargas.
- **Mensajes efímeros:** las fotos y videos de «ver una vez» no se guardan; quedan indicados sin el archivo multimedia.
- **Tipos no reconocidos:** si Instagram introduce un formato nuevo, puede aparecer como desconocido. El JSON conserva el contenido original que haya recibido el exportador, pero el visor no necesariamente podrá representarlo con todos sus detalles.
- **Memoria del navegador:** el contenido descargado se mantiene en memoria mientras se prepara el ZIP. Las conversaciones con muchos archivos o archivos muy grandes pueden elevar el consumo de memoria y provocar lentitud o bloqueos.
- **Compatibilidad:** no se garantiza el funcionamiento en todas las versiones de Instagram ni en todos los navegadores.

Una exportación marcada como completa indica que el proceso terminó según las respuestas y condiciones que pudo observar el script; no constituye una certificación de que Instagram haya entregado absolutamente todos los datos históricos de la cuenta.

## Privacidad y seguridad

- El script está diseñado para ejecutarse en la pestaña de Instagram y guardar el resultado en el dispositivo. Las peticiones del historial se hacen a Instagram con la sesión activa; las descargas de multimedia se intentan sin enviar cookies.
- El código obtiene de la página algunos valores de sesión necesarios para realizar las consultas. No compartas el código modificado con credenciales incrustadas ni pegues en la consola scripts que no hayas revisado.
- El ZIP puede contener conversaciones privadas, nombres, identificadores, enlaces y archivos personales. Guárdalo en un lugar seguro y compártelo solo con autorización de las personas involucradas.
- Antes de publicar capturas, archivos JSON o diagnósticos, comprueba que no revelen información personal o privada.
- El visor puede abrir enlaces compartidos y enlaces incluidos en los mensajes. Ábrelos solo cuando confíes en su origen.

Utiliza esta herramienta únicamente para conversaciones a las que tengas acceso legítimo y respeta la privacidad de las demás personas y las condiciones aplicables de la plataforma.

## Estructura técnica

El archivo está organizado en módulos lógicos dentro de una única función autoejecutable (IIFE). Entre sus componentes principales se encuentran:

| Módulo | Responsabilidad |
|---|---|
| Configuración y opciones | Define y valida las opciones de exportación. |
| Tipos, errores y utilidades | Describe los datos y centraliza funciones comunes y errores controlados. |
| Cola circular y reloj de fondo | Administra tareas pendientes y temporizadores durante esperas. |
| Control de ejecución y diagnóstico | Gestiona detener/cancelar y registra eventos técnicos. |
| Sesión y catálogo de consultas | Lee de Instagram los valores de sesión y localiza consultas internas vigentes. |
| Cliente GraphQL y lector de hilo | Solicita páginas del historial e interpreta la respuesta. |
| Normalizador y directorio | Convierte respuestas de Instagram al modelo propio y registra participantes. |
| Almacén de mensajes | Deduplica y ordena los mensajes recopilados. |
| CRC-32 y escritor ZIP | Calcula sumas de comprobación y genera el archivo ZIP. |
| Descargador multimedia | Gestiona las descargas, la concurrencia, los límites y sus estados. |
| Serializadores HTML, JSON y TXT | Construye los tres archivos de salida. |
| Panel y exportador | Muestra el progreso y coordina el proceso completo. |

El código utiliza JavaScript moderno, clases con campos privados, `async`/`await`, `fetch`, `Blob`, `AbortController`, `Worker`, `TextEncoder` y anotaciones JSDoc con `@ts-check`.

## Solución de problemas

### Instagram no reconoce la sesión

Comprueba que has iniciado sesión en Instagram Web y que la conversación está abierta. Recarga la página, vuelve a entrar al chat y ejecuta nuevamente el script.

### La conversación no se encuentra

Verifica que la dirección de la pestaña corresponda a un chat y contenga `/direct/t/`. No ejecutes el script desde la bandeja de entrada general ni desde otra sección de Instagram.

### Instagram solicita esperar o limita las peticiones

Deja que el script aplique sus esperas. Evita iniciar varias exportaciones a la vez o reducir `pausaEntrePaginasMs` a cero en una conversación extensa.

### No se descargan algunas fotos, videos o audios

Prueba primero con una conversación pequeña. Algunas direcciones pueden haber caducado o el navegador puede impedir la descarga por políticas de seguridad. Revisa el motivo asociado al adjunto en `chat.json`.

### La exportación falla o queda parcial

Ejecuta `exportadorInstagram.diagnostico()` y revisa el informe. Si solicitas ayuda en el repositorio, comparte el diagnóstico después de comprobar que no incluya información que no quieras divulgar. No compartas cookies, tokens, contraseñas ni el ZIP de una conversación privada.

## Licencia

Este repositorio no declara una licencia en esta versión. Antes de publicarlo como proyecto de código abierto, el propietario debe elegir y añadir un archivo `LICENSE` con los términos de uso, modificación y distribución que correspondan.

---

**Nota:** este proyecto es independiente y no está afiliado, patrocinado ni respaldado por Instagram o Meta. Instagram es una marca de sus respectivos propietarios.
