// Política de Tratamiento de Datos Personales — versionada en el repo: una
// actualización legal es un commit y la ven todos los tenants al instante.
// Texto estándar Ley 1581 de 2012 + Decreto 1377 de 2013 adaptado a Nitro
// Ecom/Nitro Bot; ajustar con la revisión legal cuando esté (doc 06 de Drive).

const VERSION = "1.0";
const VERSION_DATE = "16 de julio de 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-neutral-700">{children}</div>
    </section>
  );
}

export default function LegalPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">
          Política de Tratamiento de Datos Personales
        </h1>
        <p className="text-sm text-neutral-500">
          Nitro Bot · Nitro Ecom — versión {VERSION} · {VERSION_DATE}
        </p>
      </header>

      <Section title="1. Responsable y encargado del tratamiento">
        <p>
          <strong>Nitro Ecom</strong> (en adelante, «la Plataforma»), operadora del
          servicio Nitro Bot, actúa como <strong>encargada del tratamiento</strong> de
          los datos personales de los compradores finales que interactúan por WhatsApp
          con el asesor virtual de cada tienda, y como{" "}
          <strong>responsable del tratamiento</strong> de los datos de los usuarios de
          este dashboard (equipo de la tienda). Cada tienda cliente es la responsable
          del tratamiento de los datos de sus propios compradores, conforme a la Ley
          1581 de 2012 y el Decreto 1377 de 2013 de la República de Colombia.
        </p>
      </Section>

      <Section title="2. Datos que se tratan">
        <p>En la operación del servicio se recolectan y almacenan:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>De los compradores finales:</strong> número de teléfono de WhatsApp,
            nombre, mensajes de la conversación (texto, notas de voz, imágenes y
            videos), ciudad y dirección de entrega, y datos de los pedidos realizados.
          </li>
          <li>
            <strong>Del equipo de la tienda:</strong> nombre, correo electrónico, rol y
            registro de actividad en el dashboard (por ejemplo, qué usuario respondió
            cada mensaje).
          </li>
        </ul>
        <p>
          No se solicitan ni almacenan datos sensibles (salud, orientación política o
          religiosa, biometría) ni datos de menores de edad como parte del servicio.
        </p>
      </Section>

      <Section title="3. Finalidades del tratamiento">
        <ul className="list-disc space-y-1 pl-5">
          <li>Atender y responder las conversaciones de ventas y soporte por WhatsApp.</li>
          <li>Crear y gestionar pedidos en la tienda (incluida la entrega contraentrega).</li>
          <li>Mantener el historial de conversaciones y el CRM de la tienda.</li>
          <li>Enviar recordatorios y seguimientos relacionados con la compra en curso.</li>
          <li>Medir el uso del servicio (consumo de mensajes, métricas de ventas).</li>
          <li>Cumplir obligaciones legales y contractuales.</li>
        </ul>
      </Section>

      <Section title="4. Derechos de los titulares">
        <p>De acuerdo con la Ley 1581 de 2012, todo titular de datos puede:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Conocer, actualizar y rectificar sus datos personales.</li>
          <li>Solicitar prueba de la autorización otorgada para el tratamiento.</li>
          <li>Ser informado sobre el uso que se le ha dado a sus datos.</li>
          <li>Presentar quejas ante la Superintendencia de Industria y Comercio (SIC).</li>
          <li>Revocar la autorización y/o solicitar la supresión de sus datos.</li>
          <li>Acceder de forma gratuita a sus datos personales.</li>
        </ul>
      </Section>

      <Section title="5. Canales para ejercer los derechos">
        <p>
          Los compradores finales pueden ejercer sus derechos directamente ante la
          tienda con la que conversaron (responsable del tratamiento) por el mismo
          canal de WhatsApp. Las tiendas y usuarios del dashboard pueden contactar a la
          Plataforma por la línea de WhatsApp <strong>314&nbsp;668&nbsp;1896</strong> o
          mediante el módulo «Solicitudes» de este dashboard. Las solicitudes se
          atienden en los plazos de la Ley 1581 de 2012 (consultas: 10 días hábiles;
          reclamos: 15 días hábiles).
        </p>
      </Section>

      <Section title="6. Seguridad y conservación">
        <p>
          Los datos se almacenan en infraestructura en la nube con aislamiento por
          tienda (cada tienda solo accede a sus propios datos), credenciales cifradas y
          acceso restringido por roles. Los datos se conservan mientras la tienda
          mantenga activo el servicio y durante los plazos legales aplicables; al
          terminar el contrato, la tienda puede solicitar la entrega y/o supresión de
          su información.
        </p>
      </Section>

      <Section title="7. Vigencia y cambios">
        <p>
          Esta política rige desde el {VERSION_DATE} y permanece vigente mientras se
          preste el servicio. Cualquier cambio sustancial se publicará en esta misma
          página con una nueva versión y fecha.
        </p>
      </Section>

      <p className="border-t border-neutral-200 pt-4 text-xs text-neutral-400">
        Versión {VERSION} · {VERSION_DATE} · Nitro Ecom — Nitro Bot
      </p>
    </div>
  );
}
