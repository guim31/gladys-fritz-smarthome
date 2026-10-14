// -----------------------------------------------------------------------------
// Texts sent from the container (connection status, action messages, errors),
// in the four languages of the Gladys interface. Entries are strings or
// functions of one parameter object. German says "du", Spanish "usted".
// -----------------------------------------------------------------------------

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

// Connection status shown in the Configuration screen (keys: src/hub.js).
export const STATUS = {
  en: {
    credentials: 'Enter the user name and password of a FRITZ!Box user in the configuration.',
    notFound:
      'No FRITZ!Box found on the network: enter its address (e.g. 192.168.178.1) in the configuration.',
    unreachable: ({ host }) => `The FRITZ!Box does not answer at ${host}.`,
    auth: 'The FRITZ!Box refused the user name or password. Retried in 15 minutes, then less and less often, or when the configuration changes.',
    blocked: ({ seconds }) =>
      `The FRITZ!Box blocks logins for ${seconds} s after failed attempts. Retried later.`,
    rights: 'The FRITZ!Box user lacks the "Smart Home" right (System > FRITZ!Box Users).',
  },
  fr: {
    credentials:
      "Saisissez le nom et le mot de passe d'un utilisateur de la FRITZ!Box dans la configuration.",
    notFound:
      'Aucune FRITZ!Box trouvée sur le réseau : saisissez son adresse (ex. 192.168.178.1) dans la configuration.',
    unreachable: ({ host }) => `La FRITZ!Box ne répond pas à l'adresse ${host}.`,
    auth: 'La FRITZ!Box a refusé le nom ou le mot de passe. Nouvel essai dans 15 minutes puis de plus en plus espacé, ou au changement de la configuration.',
    blocked: ({ seconds }) =>
      `La FRITZ!Box bloque les connexions pendant ${seconds} s après des échecs. Nouvel essai plus tard.`,
    rights:
      "L'utilisateur de la FRITZ!Box n'a pas le droit « Smart Home » (Système > Utilisateurs FRITZ!Box).",
  },
  de: {
    credentials:
      'Gib in der Konfiguration den Benutzernamen und das Kennwort eines FRITZ!Box-Benutzers ein.',
    notFound:
      'Keine FRITZ!Box im Netzwerk gefunden: Gib ihre Adresse (z. B. 192.168.178.1) in der Konfiguration ein.',
    unreachable: ({ host }) => `Die FRITZ!Box antwortet nicht unter ${host}.`,
    auth: 'Die FRITZ!Box hat Benutzername oder Kennwort abgelehnt. Neuer Versuch in 15 Minuten, dann immer seltener, oder bei einer Änderung der Konfiguration.',
    blocked: ({ seconds }) =>
      `Die FRITZ!Box sperrt Anmeldungen nach Fehlversuchen für ${seconds} s. Neuer Versuch später.`,
    rights: 'Dem FRITZ!Box-Benutzer fehlt das Recht „Smart Home“ (System > FRITZ!Box-Benutzer).',
  },
  es: {
    credentials:
      'Introduzca el nombre y la contraseña de un usuario de la FRITZ!Box en la configuración.',
    notFound:
      'No se ha encontrado ninguna FRITZ!Box en la red: introduzca su dirección (p. ej. 192.168.178.1) en la configuración.',
    unreachable: ({ host }) => `La FRITZ!Box no responde en ${host}.`,
    auth: 'La FRITZ!Box ha rechazado el nombre o la contraseña. Nuevo intento en 15 minutos y luego cada vez más espaciado, o al cambiar la configuración.',
    blocked: ({ seconds }) =>
      `La FRITZ!Box bloquea los inicios de sesión durante ${seconds} s tras varios fallos. Nuevo intento más tarde.`,
    rights:
      'Al usuario de la FRITZ!Box le falta el permiso «Smart Home» (Sistema > Usuarios de FRITZ!Box).',
  },
};

// Report of the "Test the connection" action.
export const REPORTS = {
  en: {
    connected: ({ host }) => `Connected to the FRITZ!Box at ${host}.`,
    devices: ({ count, absent }) =>
      `${count} smart home device(s)${absent ? `, ${absent} out of reach` : ''}.`,
    none: 'No smart home device on this FRITZ!Box yet: pair them in Smart Home > Devices.',
    discover: 'Open the Discover tab to add them to Gladys.',
  },
  fr: {
    connected: ({ host }) => `Connecté à la FRITZ!Box à l'adresse ${host}.`,
    devices: ({ count, absent }) =>
      `${count} appareil(s) Smart Home${absent ? `, dont ${absent} hors de portée` : ''}.`,
    none: 'Aucun appareil Smart Home sur cette FRITZ!Box : appairez-les dans Smart Home > Appareils.',
    discover: "Ouvrez l'onglet Découverte pour les ajouter à Gladys.",
  },
  de: {
    connected: ({ host }) => `Mit der FRITZ!Box unter ${host} verbunden.`,
    devices: ({ count, absent }) =>
      `${count} Smart-Home-Gerät(e)${absent ? `, davon ${absent} außer Reichweite` : ''}.`,
    none: 'Noch kein Smart-Home-Gerät an dieser FRITZ!Box: Melde sie unter Smart Home > Geräte an.',
    discover: 'Öffne den Tab „Entdecken“, um sie zu Gladys hinzuzufügen.',
  },
  es: {
    connected: ({ host }) => `Conectado a la FRITZ!Box en ${host}.`,
    devices: ({ count, absent }) =>
      `${count} dispositivo(s) Smart Home${absent ? `, ${absent} fuera de alcance` : ''}.`,
    none: 'Todavía no hay dispositivos Smart Home en esta FRITZ!Box: emparéjelos en Smart Home > Dispositivos.',
    discover: 'Abra la pestaña Descubrir para añadirlos a Gladys.',
  },
};

// Errors of the commands and of the scene actions, in the configured language
// (a scene action does not receive the user's language).
export const ERRORS = {
  en: {
    notConnected: 'The integration is not connected to the FRITZ!Box yet.',
    unknownDevice: 'This device is not a smart home device of the FRITZ!Box.',
    absent: ({ name }) => `${name} is out of reach of the FRITZ!Box.`,
    notThermostat: ({ name }) => `${name} is not a radiator thermostat.`,
    locked: ({ name }) => `${name} is locked against changes in the FRITZ!Box.`,
    holiday: ({ name }) => `${name} follows the holiday programme of the FRITZ!Box.`,
    summer: ({ name }) => `${name} is in summer mode in the FRITZ!Box: the heating is off.`,
    failed: ({ reason }) => `The FRITZ!Box refused the command (${reason}).`,
  },
  fr: {
    notConnected: "L'intégration n'est pas encore connectée à la FRITZ!Box.",
    unknownDevice: "Cet appareil n'est pas un appareil Smart Home de la FRITZ!Box.",
    absent: ({ name }) => `${name} est hors de portée de la FRITZ!Box.`,
    notThermostat: ({ name }) => `${name} n'est pas une tête thermostatique.`,
    locked: ({ name }) => `${name} est verrouillé contre les modifications dans la FRITZ!Box.`,
    holiday: ({ name }) => `${name} suit le programme vacances de la FRITZ!Box.`,
    summer: ({ name }) => `${name} est en mode été dans la FRITZ!Box : le chauffage est coupé.`,
    failed: ({ reason }) => `La FRITZ!Box a refusé la commande (${reason}).`,
  },
  de: {
    notConnected: 'Die Integration ist noch nicht mit der FRITZ!Box verbunden.',
    unknownDevice: 'Dieses Gerät ist kein Smart-Home-Gerät der FRITZ!Box.',
    absent: ({ name }) => `${name} ist außer Reichweite der FRITZ!Box.`,
    notThermostat: ({ name }) => `${name} ist kein Heizkörperregler.`,
    locked: ({ name }) => `${name} ist in der FRITZ!Box gegen Änderungen gesperrt.`,
    holiday: ({ name }) => `${name} folgt dem Urlaubsprogramm der FRITZ!Box.`,
    summer: ({ name }) => `${name} ist in der FRITZ!Box im Sommermodus: Die Heizung ist aus.`,
    failed: ({ reason }) => `Die FRITZ!Box hat den Befehl abgelehnt (${reason}).`,
  },
  es: {
    notConnected: 'La integración aún no está conectada a la FRITZ!Box.',
    unknownDevice: 'Este dispositivo no es un dispositivo Smart Home de la FRITZ!Box.',
    absent: ({ name }) => `${name} está fuera del alcance de la FRITZ!Box.`,
    notThermostat: ({ name }) => `${name} no es un termostato de radiador.`,
    locked: ({ name }) => `${name} está bloqueado contra cambios en la FRITZ!Box.`,
    holiday: ({ name }) => `${name} sigue el programa de vacaciones de la FRITZ!Box.`,
    summer: ({ name }) =>
      `${name} está en modo verano en la FRITZ!Box: la calefacción está apagada.`,
    failed: ({ reason }) => `La FRITZ!Box ha rechazado la orden (${reason}).`,
  },
};

/** A message table entry, rendered in every language. */
export function render(table, key, params = {}) {
  return Object.fromEntries(
    Object.entries(table).map(([language, entries]) => {
      const entry = entries[key];
      return [language, typeof entry === 'function' ? entry(params) : entry];
    }),
  );
}

/** Join several rendered messages, language by language. */
export function join(...messages) {
  return Object.fromEntries(
    Object.keys(messages[0]).map((language) => [
      language,
      messages.map((message) => message[language]).join(' '),
    ]),
  );
}
