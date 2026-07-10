/**
 * Build locale overlay files from pending English copies using Romance translations.
 * Reads scripts/overlays/{locale}.pending.json and writes scripts/overlays/{locale}.json
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OVERLAY_DIR = join(import.meta.dir, 'overlays');

type Locale = 'es' | 'ca-ES' | 'it';

function translateEs(en: string): string {
  const exact: Record<string, string> = {
    'Home': 'Inicio',
    'Search': 'Buscar',
    'Notifications': 'Notificaciones',
    'Messages': 'Mensajes',
    'Settings': 'Configuración',
    'Explore': 'Explorar',
    'Chat': 'Chat',
    'Bookmarks': 'Marcadores',
    'Feeds': 'Feeds',
    'Lists': 'Listas',
    'Videos': 'Vídeos',
    'Save': 'Guardar',
    'Post': 'Publicar',
    'Follow': 'Seguir',
    'Following': 'Siguiendo',
    'Sign Up': 'Registrarse',
    'Sign In': 'Iniciar sesión',
    'Show more': 'Mostrar más',
    'Apply Settings': 'Aplicar configuración',
    'All': 'Todos',
    'Unread': 'No leídos',
    'Property': 'Propiedad',
    'Message': 'Mensaje',
    'System': 'Sistema',
    'Permissions': 'Permisos',
    'Loading...': 'Cargando...',
    'Retry': 'Reintentar',
    'Cancel': 'Cancelar',
    'OK': 'OK',
    'Back': 'Atrás',
    'Continue': 'Continuar',
    'Delete': 'Eliminar',
    'Edit': 'Editar',
    'Share': 'Compartir',
    'Close': 'Cerrar',
    'Confirm': 'Confirmar',
    'Done': 'Hecho',
    'Next': 'Siguiente',
    'Previous': 'Anterior',
    'Submit': 'Enviar',
    'View': 'Ver',
    'Clear All': 'Borrar todo',
    'Sound': 'Sonido',
    'Pending': 'Pendiente',
    'Approved': 'Aprobada',
    'Rejected': 'Rechazada',
    'Submitted': 'Enviada',
    'Reviewing': 'En revisión',
    'Withdrawn': 'Retirada',
    'Confirmed': 'Confirmada',
    'Declined': 'Rechazada',
    'Cancelled': 'Cancelada',
    'Completed': 'Completada',
    'Draft': 'Borrador',
    'Active': 'Activo',
    'Expired': 'Caducado',
    'Terminated': 'Rescindido',
    'Monthly': 'Mensual',
    'Free': 'Gratis',
    'night': 'noche',
    'month': 'mes',
  };
  if (exact[en]) return exact[en];

  let s = en;
  const replacements: Array<[RegExp, string]> = [
    [/Search notifications\.\.\./, 'Buscar notificaciones...'],
    [/No notifications/, 'Sin notificaciones'],
    [/Notification Settings/, 'Configuración de notificaciones'],
    [/Notification Categories/, 'Categorías de notificaciones'],
    [/Notification Behavior/, 'Comportamiento de notificaciones'],
    [/Test Notifications/, 'Probar notificaciones'],
    [/Manage Notifications/, 'Gestionar notificaciones'],
    [/Clear All Notifications/, 'Borrar todas las notificaciones'],
    [/Enable Notifications/, 'Activar notificaciones'],
    [/Notifications Enabled/, 'Notificaciones activadas'],
    [/Notifications Disabled/, 'Notificaciones desactivadas'],
    [/Scheduled Notifications/, 'Notificaciones programadas'],
    [/Delete Notification/, 'Eliminar notificación'],
    [/Property Notifications/, 'Notificaciones de propiedades'],
    [/Message Notifications/, 'Notificaciones de mensajes'],
    [/Contract Notifications/, 'Notificaciones de contratos'],
    [/Payment Notifications/, 'Notificaciones de pagos'],
    [/Reminder Notifications/, 'Notificaciones de recordatorios'],
    [/System Notifications/, 'Notificaciones del sistema'],
    [/Marketing Notifications/, 'Notificaciones de marketing'],
    [/Push Notifications/, 'Notificaciones push'],
    [/Badge Count/, 'Contador de insignia'],
    [/Settings updated/, 'Configuración actualizada'],
    [/Welcome to Homiio! 👋/, '¡Bienvenido a Homiio! 👋'],
    [/Thanks for trying out our app\. Start exploring now!/, 'Gracias por probar nuestra aplicación. ¡Comienza a explorar ahora!'],
    [/Something went wrong/, 'Algo salió mal'],
    [/Please try again/, 'Inténtalo de nuevo'],
    [/Sign out/, 'Cerrar sesión'],
    [/Are you sure/, '¿Estás seguro'],
    [/Failed to /, 'No se pudo '],
    [/Unable to /, 'No se pudo '],
    [/Could not /, 'No se pudo '],
    [/You have /, 'Tienes '],
    [/Your /, 'Tu '],
    [/New /, 'Nuevo '],
    [/View /, 'Ver '],
    [/Create /, 'Crear '],
    [/Add /, 'Añadir '],
    [/Remove /, 'Eliminar '],
    [/Update /, 'Actualizar '],
    [/Download /, 'Descargar '],
    [/Upload /, 'Subir '],
    [/Select /, 'Seleccionar '],
    [/Choose /, 'Elegir '],
    [/Loading /, 'Cargando '],
    [/Error /, 'Error '],
    [/Success/, 'Éxito'],
    [/Description/, 'Descripción'],
    [/Title/, 'Título'],
    [/Status/, 'Estado'],
    [/Date/, 'Fecha'],
    [/Time/, 'Hora'],
    [/Price/, 'Precio'],
    [/Address/, 'Dirección'],
    [/Location/, 'Ubicación'],
    [/Details/, 'Detalles'],
    [/Overview/, 'Resumen'],
    [/Profile/, 'Perfil'],
    [/Contract/, 'Contrato'],
    [/Application/, 'Solicitud'],
    [/Reservation/, 'Reserva'],
    [/Roommate/, 'Compañero de piso'],
    [/Subscription/, 'Suscripción'],
    [/Host/, 'Anfitrión'],
    [/Guest/, 'Huésped'],
    [/Landlord/, 'Propietario'],
    [/Tenant/, 'Inquilino'],
    [/Property/, 'Propiedad'],
    [/Properties/, 'Propiedades'],
    [/Notifications/, 'Notificaciones'],
    [/Settings/, 'Configuración'],
    [/Language/, 'Idioma'],
    [/Currency/, 'Moneda'],
    [/Search/, 'Buscar'],
    [/Filter/, 'Filtrar'],
    [/Sort/, 'Ordenar'],
    [/Apply/, 'Aplicar'],
    [/Book/, 'Reservar'],
    [/Reserve/, 'Reservar'],
    [/Contact/, 'Contactar'],
    [/Call/, 'Llamar'],
    [/Email/, 'Correo'],
    [/Phone/, 'Teléfono'],
    [/Message/, 'Mensaje'],
    [/Messages/, 'Mensajes'],
    [/Inbox/, 'Bandeja de entrada'],
    [/Saved/, 'Guardados'],
    [/Recent/, 'Recientes'],
    [/Featured/, 'Destacados'],
    [/Recommended/, 'Recomendados'],
    [/Similar/, 'Similares'],
    [/Nearby/, 'Cercanos'],
    [/Amenities/, 'Comodidades'],
    [/Bedrooms/, 'Dormitorios'],
    [/Bathrooms/, 'Baños'],
    [/Size/, 'Tamaño'],
    [/Available/, 'Disponible'],
    [/Unavailable/, 'No disponible'],
    [/Published/, 'Publicado'],
    [/Draft/, 'Borrador'],
    [/Pending/, 'Pendiente'],
    [/Approved/, 'Aprobado'],
    [/Rejected/, 'Rechazado'],
    [/Active/, 'Activo'],
    [/Inactive/, 'Inactivo'],
    [/Expired/, 'Caducado'],
    [/Cancelled/, 'Cancelado'],
    [/Completed/, 'Completado'],
    [/Confirmed/, 'Confirmado'],
    [/Declined/, 'Rechazado'],
  ];
  for (const [re, rep] of replacements) {
    s = s.replace(re, rep);
  }
  return s;
}

function translateCa(en: string, es: string): string {
  const exact: Record<string, string> = {
    'Home': 'Inici',
    'Search': 'Cercar',
    'Notifications': 'Notificacions',
    'Messages': 'Missatges',
    'Settings': 'Configuració',
    'Explore': 'Explorar',
    'Save': 'Desar',
    'Sign In': 'Inicia sessió',
    'Sign Up': 'Registra\'t',
    'All': 'Tots',
    'Loading...': 'Carregant...',
    'Cancel': 'Cancel·lar',
    'Back': 'Enrere',
    'Share': 'Compartir',
    'Delete': 'Eliminar',
    'Edit': 'Editar',
    'Pending': 'Pendent',
    'Approved': 'Aprovada',
    'Rejected': 'Rebutjada',
    'Monthly': 'Mensual',
    'Free': 'Gratuït',
  };
  if (exact[en]) return exact[en];
  return es
    .replace(/ación/g, 'ació')
    .replace(/ción/g, 'ció')
    .replace(/í/g, 'í')
    .replace(/Buscar/g, 'Cercar')
    .replace(/Guardar/g, 'Desar')
    .replace(/Configuración/g, 'Configuració')
    .replace(/Notificaciones/g, 'Notificacions')
    .replace(/Mensajes/g, 'Missatges')
    .replace(/Propiedad/g, 'Propietat')
    .replace(/Contrato/g, 'Contracte')
    .replace(/Solicitud/g, 'Sol·licitud')
    .replace(/¿/g, '')
    .replace(/¡/g, '');
}

function translateIt(en: string): string {
  const exact: Record<string, string> = {
    'Home': 'Home',
    'Search': 'Cerca',
    'Notifications': 'Notifiche',
    'Messages': 'Messaggi',
    'Settings': 'Impostazioni',
    'Explore': 'Esplora',
    'Save': 'Salva',
    'Sign In': 'Accedi',
    'Sign Up': 'Registrati',
    'All': 'Tutti',
    'Loading...': 'Caricamento...',
    'Cancel': 'Annulla',
    'Back': 'Indietro',
    'Share': 'Condividi',
    'Delete': 'Elimina',
    'Edit': 'Modifica',
    'Pending': 'In attesa',
    'Approved': 'Approvata',
    'Rejected': 'Rifiutata',
    'Monthly': 'Mensile',
    'Free': 'Gratis',
  };
  if (exact[en]) return exact[en];
  let s = en;
  const replacements: Array<[RegExp, string]> = [
    [/Search notifications\.\.\./, 'Cerca notifiche...'],
    [/Notification Settings/, 'Impostazioni notifiche'],
    [/Enable Notifications/, 'Abilita notifiche'],
    [/Welcome to Homiio! 👋/, 'Benvenuto su Homiio! 👋'],
    [/Settings updated/, 'Impostazioni aggiornate'],
    [/Failed to /, 'Impossibile '],
    [/Unable to /, 'Impossibile '],
    [/Could not /, 'Impossibile '],
    [/Your /, 'Il tuo '],
    [/New /, 'Nuovo '],
    [/View /, 'Visualizza '],
    [/Create /, 'Crea '],
    [/Add /, 'Aggiungi '],
    [/Property/, 'Proprietà'],
    [/Contract/, 'Contratto'],
    [/Application/, 'Domanda'],
    [/Reservation/, 'Prenotazione'],
    [/Roommate/, 'Coinquilino'],
    [/Subscription/, 'Abbonamento'],
    [/Notifications/, 'Notifiche'],
    [/Settings/, 'Impostazioni'],
    [/Language/, 'Lingua'],
    [/Search/, 'Cerca'],
    [/Apply/, 'Candidati'],
    [/Contact/, 'Contatta'],
    [/Message/, 'Messaggio'],
    [/Pending/, 'In attesa'],
    [/Approved/, 'Approvato'],
    [/Rejected/, 'Rifiutato'],
  ];
  for (const [re, rep] of replacements) {
    s = s.replace(re, rep);
  }
  return s;
}

function translateValue(locale: Locale, value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) =>
      typeof item === 'string' ? translateValue(locale, item) : item,
    );
  }
  if (typeof value !== 'string') return value;
  const es = translateEs(value);
  if (locale === 'es') return es;
  if (locale === 'ca-ES') return translateCa(value, es);
  return translateIt(value);
}

for (const locale of ['es', 'ca-ES', 'it'] as const) {
  const pendingPath = join(OVERLAY_DIR, `${locale}.pending.json`);
  if (!existsSync(pendingPath)) {
    console.log(`[${locale}] no pending file`);
    continue;
  }
  const pending = JSON.parse(readFileSync(pendingPath, 'utf8')) as Record<string, unknown>;
  const overlay: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(pending)) {
    overlay[key] = translateValue(locale, value);
  }
  writeFileSync(join(OVERLAY_DIR, `${locale}.json`), `${JSON.stringify(overlay, null, 2)}\n`, 'utf8');
  console.log(`[${locale}] wrote ${Object.keys(overlay).length} overlay entries`);
}
