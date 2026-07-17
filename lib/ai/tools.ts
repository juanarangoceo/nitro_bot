// Herramientas (function calling) que el asesor expone a Gemini.
// Todas resuelven por tenant_id del contexto y corren server-side con el
// cliente service_role. REGLA CLAVE: precios y totales se calculan aquí desde
// el catálogo, nunca los decide la IA.

import { createAdminClient } from "../supabase/admin";
import { searchProducts } from "./rag";
import { logSearch } from "./search-log";
import { escalateToHuman } from "./escalation";
import { createCodOrder, type OrderItem, type CustomerData } from "../shopify/orders";
import { resolveDepartment } from "../shopify/colombia";
import { sendImage, type WaCreds } from "../whatsapp/meta";
import { resolveLabelId, type TicketLabel } from "../tickets/labels";
import type { ShopifyCreds } from "../shopify/client";
import type { Tenant } from "../tenant";

export type ToolContext = {
  tenant: Tenant;
  conversationId?: string;
  shopify?: ShopifyCreds;
  // Credenciales y destinatario para enviar media al cliente durante el turno
  // (las inyecta el worker; el editor de prueba las omite => no-op).
  wa?: WaCreds;
  customerPhone?: string;
  // Probador del /admin: las herramientas corren de verdad (RAG, stock,
  // imágenes) EXCEPTO crear_orden (simulada, sin tocar Shopify) y
  // escalar_a_humano (marca el resultado sin crear ticket real).
  testMode?: boolean;
  // Herramientas ya ejecutadas en este turno (lo llena executeTool). Permite
  // guards como "no escalar por fuera_de_catalogo sin haber buscado antes".
  calledTools?: Set<string>;
  // Resultado del crear_orden EXITOSO de este turno (lo llena crearOrden).
  // Una segunda llamada en el mismo turno (functionCalls paralelos o rondas
  // posteriores del loop) devuelve esto mismo en vez de crear otra orden.
  createdOrder?: unknown;
  // URLs de fotos de producto enviadas EN ESTE TURNO (lo llena
  // enviarImagenProducto). Evita repetir la misma foto en functionCalls
  // paralelos y cubre el modo dev sin conversación en DB.
  sentImageUrls?: Set<string>;
  // Etiquetas activas del tenant (las carga runAssistant): alimentan el enum
  // de `etiqueta` en escalar_a_humano y la resolución del label del ticket.
  ticketLabels?: TicketLabel[];
};

// --- Declaraciones para Gemini (subset OpenAPI) ---------------------------
export const toolDeclarations = [
  {
    name: "buscar_productos",
    description:
      "Busca productos en el catálogo real de la tienda por similitud semántica. Úsala siempre que el cliente pregunte por productos, características, precios o disponibilidad. Devuelve solo productos disponibles para la venta, con su descripción resumida.",
    parameters: {
      type: "object",
      properties: {
        consulta: {
          type: "string",
          description: "Lo que busca el cliente, en lenguaje natural.",
        },
      },
      required: ["consulta"],
    },
  },
  {
    name: "ver_detalle_producto",
    description:
      "Devuelve la ficha completa de UN producto: descripción completa, precio y disponibilidad. Úsala cuando el cliente pida más detalles, especificaciones o medidas de un producto concreto que ya encontraste con buscar_productos.",
    parameters: {
      type: "object",
      properties: {
        producto_id: { type: "string", description: "shopify_id del producto." },
      },
      required: ["producto_id"],
    },
  },
  {
    name: "ver_historial_cliente",
    description:
      "Devuelve compras previas y datos conocidos del cliente por su teléfono.",
    parameters: {
      type: "object",
      properties: {
        telefono: { type: "string", description: "Teléfono del cliente." },
      },
      required: ["telefono"],
    },
  },
  {
    name: "calcular_envio",
    description: "Calcula el costo de envío según las reglas de la tienda.",
    parameters: {
      type: "object",
      properties: {
        total_pedido: {
          type: "number",
          description: "Subtotal de productos antes de envío.",
        },
      },
      required: ["total_pedido"],
    },
  },
  {
    name: "crear_orden",
    description:
      "Crea la orden de compra (contra entrega). Pásale los ids de producto y cantidades; el sistema calcula el total. Úsala solo cuando tengas confirmados los productos y los datos de envío.",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              producto_id: { type: "string" },
              cantidad: { type: "integer" },
            },
            required: ["producto_id", "cantidad"],
          },
        },
        datos_cliente: {
          type: "object",
          properties: {
            nombre: { type: "string" },
            telefono: {
              type: "string",
              description:
                "Número de contacto para la entrega. OMÍTELO si el cliente quiere que lo contacten a este mismo WhatsApp.",
            },
            direccion: { type: "string" },
            ciudad: { type: "string" },
            departamento: {
              type: "string",
              description:
                "Departamento de Colombia (p. ej. Antioquia). Llénalo SOLO si el cliente lo dijo o se lo preguntaste; para ciudades principales el sistema lo deduce solo.",
            },
          },
          required: ["nombre", "direccion", "ciudad"],
        },
      },
      required: ["items", "datos_cliente"],
    },
  },
  {
    name: "enviar_imagen_producto",
    description:
      "Envía al cliente fotos de un producto del catálogo por WhatsApp. La foto se envía SOLA, sin texto: tu respuesta de texto normal es la que la acompaña, así que no repitas en ella lo que la imagen ya muestra. Pasa el shopify_id (campo 'id' que devuelve buscar_productos).",
    parameters: {
      type: "object",
      properties: {
        producto_id: { type: "string", description: "shopify_id del producto." },
        cantidad: {
          type: "number",
          description:
            "Cuántas fotos enviar (1 a 4, default 1). Usa más de 1 SOLO si el cliente pide ver más fotos o ángulos del producto.",
        },
        reenviar: {
          type: "boolean",
          description:
            "SOLO true si el cliente pide EXPLÍCITAMENTE que le reenvíes una foto que ya le mandaste. Por defecto la herramienta nunca repite fotos ya enviadas en la conversación.",
        },
      },
      required: ["producto_id"],
    },
  },
  {
    name: "escalar_a_humano",
    description:
      "Escala la conversación a un agente humano y el asesor DEJA de responder: es el ÚLTIMO recurso. Úsala SOLO si: (a) el cliente tiene un reclamo o problema con un pedido ya realizado, (b) pide explícitamente hablar con una persona, (c) pide un producto que confirmaste que NO existe llamando buscar_productos en este mismo turno, o (d) quiere corregir o cambiar una orden que YA fue creada (motivo cambio_en_orden). NUNCA escales por preguntas de envíos, garantías, devoluciones, precios o disponibilidad: eso lo respondes tú con las herramientas y la información de la empresa.",
    parameters: {
      type: "object",
      properties: {
        motivo: {
          type: "string",
          enum: ["reclamo", "fuera_de_catalogo", "pide_humano", "cambio_en_orden", "otro"],
        },
      },
      required: ["motivo"],
    },
  },
];

// Declaraciones por tenant: si el tenant tiene etiquetas de tickets activas,
// escalar_a_humano gana un parámetro `etiqueta` con enum de esas etiquetas
// (opcional: si la IA lo omite, el server resuelve por el motivo). Sin
// etiquetas, devuelve las declaraciones base idénticas (mismo prefijo →
// misma caché implícita de Gemini que hoy).
export function buildToolDeclarations(labelNames: string[]) {
  if (labelNames.length === 0) return toolDeclarations;
  return toolDeclarations.map((decl) => {
    if (decl.name !== "escalar_a_humano") return decl;
    return {
      ...decl,
      parameters: {
        ...decl.parameters,
        properties: {
          ...decl.parameters.properties,
          etiqueta: {
            type: "string",
            enum: labelNames,
            description:
              "Área del equipo que debe atender el caso; elige la más afín al motivo.",
          },
        },
      },
    };
  });
}

// --- Implementaciones ------------------------------------------------------
type Args = Record<string, unknown>;

// Recorta la descripción a ~350 chars en límite de palabra para no inflar el
// turno; la ficha completa se pide con ver_detalle_producto.
const SUMMARY_MAX = 350;
function resumir(desc: string | null): string | null {
  const text = desc?.trim();
  if (!text) return null;
  if (text.length <= SUMMARY_MAX) return text;
  const cut = text.slice(0, SUMMARY_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 200 ? lastSpace : SUMMARY_MAX)}…`;
}

async function buscarProductos(ctx: ToolContext, args: Args) {
  const consulta = String(args.consulta ?? "");
  const productos = await searchProducts(ctx.tenant.id, consulta, 5);
  // Demanda de búsqueda para el módulo «Búsquedas» (best-effort, jamás lanza).
  // El probador de /admin no contamina la demanda real.
  if (!ctx.testMode) {
    await logSearch({
      tenantId: ctx.tenant.id,
      conversationId: ctx.conversationId,
      kind: "search",
      query: consulta,
      resultCount: productos.length,
      topSimilarity: productos[0]?.similarity ?? null,
    });
  }
  return {
    productos: productos.map((p) => ({
      id: p.shopify_id,
      titulo: p.title,
      precio: p.price,
      descripcion: resumir(p.description),
      // match_products ya filtra por status active.
      disponible: true,
    })),
  };
}

async function verDetalleProducto(ctx: ToolContext, args: Args) {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("products")
    .select("title, description, price, status")
    .eq("tenant_id", ctx.tenant.id)
    .eq("shopify_id", String(args.producto_id))
    .maybeSingle();
  if (!ctx.testMode) {
    await logSearch({
      tenantId: ctx.tenant.id,
      conversationId: ctx.conversationId,
      kind: "detail",
      productShopifyId: String(args.producto_id),
      resultCount: data ? 1 : 0,
    });
  }
  if (!data) return { encontrado: false };
  const disponible = data.status === "active";
  // Cap de la ficha: una descripción enorme infla el input de TODAS las rondas
  // siguientes del turno (el payload de la tool viaja completo en cada llamada).
  const full = data.description?.trim() || null;
  const DETAIL_MAX = 1500;
  return {
    encontrado: true,
    titulo: data.title,
    precio: data.price,
    descripcion: full && full.length > DETAIL_MAX ? `${full.slice(0, DETAIL_MAX)}…` : full,
    disponible,
    ...(disponible ? {} : { nota: "Este producto no está disponible para la venta." }),
  };
}

async function verHistorialCliente(ctx: ToolContext, args: Args) {
  const supabase = createAdminClient();
  const telefono = String(args.telefono);
  const { data: cliente } = await supabase
    .from("customers")
    .select("name, city, total_spent, first_contact")
    .eq("tenant_id", ctx.tenant.id)
    .eq("phone", telefono)
    .maybeSingle();
  const { count } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", ctx.tenant.id);
  if (!cliente) return { cliente_nuevo: true };
  return {
    cliente_nuevo: false,
    nombre: cliente.name,
    ciudad: cliente.city,
    total_gastado: cliente.total_spent,
    ordenes: count ?? 0,
  };
}

function calcularEnvio(ctx: ToolContext, args: Args) {
  const rules = (ctx.tenant.shipping_rules ?? {}) as {
    free_over?: number;
    flat_fee?: number;
  };
  const freeOver = rules.free_over ?? 150000;
  const flatFee = rules.flat_fee ?? 15000;
  const subtotal = Number(args.total_pedido ?? 0);
  const costo = subtotal >= freeOver ? 0 : flatFee;
  return { costo_envio: costo, envio_gratis: costo === 0, umbral_gratis: freeOver };
}

// Crea la orden REAL en Shopify (contraentrega). El total y los precios se
// calculan server-side desde el catálogo, nunca desde la IA.
async function crearOrden(ctx: ToolContext, args: Args) {
  // Idempotencia del turno: si crear_orden YA tuvo éxito en este mismo turno
  // (functionCalls paralelos o una ronda posterior del loop), no se crea otra.
  if (ctx.createdOrder) {
    return {
      ...(ctx.createdOrder as Record<string, unknown>),
      nota: "La orden YA fue creada en este turno. NO la crees de nuevo; confirma al cliente con estos datos.",
    };
  }
  const items = (args.items ?? []) as OrderItem[];
  const cliente = (args.datos_cliente ?? {}) as CustomerData;
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: "Sin items." };
  }
  // Idempotencia de la conversación: los pedidos dobles reales venían de turnos
  // de corrección ("ya es en Pereira", "entonces solo el kit") donde el modelo
  // "corregía" creando OTRA orden. Si ya hay una orden reciente en esta
  // conversación, no se crea otra: el cambio lo ajusta un humano.
  if (!ctx.testMode && ctx.conversationId) {
    const supabase = createAdminClient();
    const { data: prev } = await supabase
      .from("orders")
      .select("total, created_at")
      .eq("tenant_id", ctx.tenant.id)
      .eq("conversation_id", ctx.conversationId)
      .gt("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (prev) {
      const mins = Math.max(
        1,
        Math.round((Date.now() - new Date(prev.created_at).getTime()) / 60_000)
      );
      return {
        ok: false,
        error:
          `ORDEN_YA_EXISTE: en esta conversación ya se creó una orden hace ${mins} min ` +
          `por $${Number(prev.total).toLocaleString("es-CO")}. NO crees otra orden. ` +
          `Si el cliente quiere corregir o cambiar algo (dirección, ciudad, productos, cantidades), ` +
          `llama escalar_a_humano con motivo 'cambio_en_orden' y dile que una persona del equipo ajusta su pedido.`,
      };
    }
  }
  // Si la IA omitió el teléfono ("al mismo WhatsApp"), el servidor pone el
  // número real del canal — nunca lo decide el modelo.
  if (!cliente.telefono?.trim() && ctx.customerPhone) {
    cliente.telefono = ctx.customerPhone;
  }
  if (!cliente.telefono?.trim()) {
    return { ok: false, error: "Falta el teléfono de contacto." };
  }
  // Modo test (probador del /admin): el total se calcula igual (server-side,
  // desde el catálogo) pero NO se crea nada en Shopify ni en orders.
  if (ctx.testMode) {
    const supabase = createAdminClient();
    let subtotal = 0;
    for (const it of items) {
      const { data: prod } = await supabase
        .from("products")
        .select("price")
        .eq("tenant_id", ctx.tenant.id)
        .eq("shopify_id", String(it.producto_id))
        .maybeSingle();
      if (!prod) return { ok: false, error: `Producto ${it.producto_id} no existe.` };
      subtotal += Number(prod.price ?? 0) * Math.max(1, Number(it.cantidad) || 1);
    }
    // Misma validación de departamento que la orden real, para probar el flujo.
    const department = resolveDepartment(cliente.ciudad ?? "", cliente.departamento);
    if (!department) {
      return {
        ok: false,
        error: `FALTA_DEPARTAMENTO: no reconozco la ciudad "${cliente.ciudad}". Pregunta al cliente en qué departamento está y vuelve a llamar crear_orden con el campo departamento.`,
      };
    }
    const envio = calcularEnvio(ctx, { total_pedido: subtotal }) as { costo_envio: number };
    return {
      ok: true,
      simulada: true,
      total: subtotal + envio.costo_envio,
      departamento: department.name,
      nota: "Orden de PRUEBA: no se creó en Shopify.",
    };
  }
  if (!ctx.shopify) {
    return { ok: false, error: "Credenciales de la tienda no disponibles en el contexto." };
  }
  const result = await createCodOrder({
    tenantId: ctx.tenant.id,
    creds: ctx.shopify,
    shippingRules: ctx.tenant.shipping_rules ?? {},
    conversationId: ctx.conversationId,
    items,
    cliente,
  });
  if (result.ok) {
    ctx.createdOrder = result;
  }
  return result;
}

// Envía foto(s) del producto al cliente por WhatsApp (link = imagen de Shopify).
// `cantidad` (1-4, default 1) permite mandar la galería cuando el cliente pide
// más fotos. Persiste un mensaje saliente del bot (msg_type image) por cada
// foto. En el sandbox del editor (sin wa/customerPhone) hace no-op y lo reporta.
// La foto va SIN caption: el texto de venta es la respuesta normal del turno.
// Un caption escrito por el modelo duplicaba el pitch (caption + texto final).
async function enviarImagenProducto(ctx: ToolContext, args: Args) {
  const productoId = String(args.producto_id ?? "");
  const cantidad = Math.min(4, Math.max(1, Math.trunc(Number(args.cantidad)) || 1));
  const reenviar = args.reenviar === true;
  const supabase = createAdminClient();
  const { data: prod } = await supabase
    .from("products")
    .select("title, image_url, image_urls")
    .eq("tenant_id", ctx.tenant.id)
    .eq("shopify_id", productoId)
    .maybeSingle();
  if (!prod) return { enviado: false, error: "Producto no encontrado." };

  // Principal primero, luego la galería, sin duplicados.
  const gallery = Array.isArray(prod.image_urls) ? (prod.image_urls as string[]) : [];
  const candidates = [
    ...new Set([...(prod.image_url ? [prod.image_url] : []), ...gallery]),
  ];
  if (candidates.length === 0) return { enviado: false, error: "El producto no tiene imagen." };

  // Guard anti-repetición: la foto de un producto se manda UNA vez por
  // conversación (el episodio vigente: lo posterior al último cierre, igual
  // que la ventana de historial del worker). Las fotos restantes de la
  // galería solo salen con `cantidad` > 1 (el cliente pidió más ángulos) y
  // nunca se repite una URL ya enviada. `reenviar=true` (petición explícita
  // del cliente) ignora lo ya enviado en turnos anteriores, pero nunca
  // repite dentro del mismo turno.
  const alreadySent = new Set(ctx.sentImageUrls ?? []);
  if (!reenviar && ctx.conversationId) {
    const { data: conv } = await supabase
      .from("conversations")
      .select("closed_at")
      .eq("id", ctx.conversationId)
      .maybeSingle();
    let sentQuery = supabase
      .from("messages")
      .select("media_url")
      .eq("conversation_id", ctx.conversationId)
      .eq("sender", "bot")
      .eq("msg_type", "image")
      .not("media_url", "is", null);
    if (conv?.closed_at) sentQuery = sentQuery.gt("created_at", conv.closed_at);
    const { data: sentRows } = await sentQuery;
    for (const row of sentRows ?? []) alreadySent.add(row.media_url as string);
  }

  const remaining = candidates.filter((u) => !alreadySent.has(u));
  if (!reenviar && cantidad === 1 && remaining.length < candidates.length) {
    return {
      enviado: false,
      nota: "foto_ya_enviada",
      titulo: prod.title,
      detalle:
        "Ya enviaste la foto de este producto en esta conversación: NO la repitas, responde con texto. Si el cliente pide ver MÁS fotos o ángulos, llama con cantidad mayor; solo si pide que se la reenvíes, usa reenviar=true.",
    };
  }
  const urls = remaining.slice(0, cantidad);
  if (urls.length === 0) {
    return {
      enviado: false,
      nota: "fotos_ya_enviadas",
      titulo: prod.title,
      detalle:
        "Ya enviaste todas las fotos de este producto en esta conversación. NO vuelvas a llamar esta herramienta para este producto: responde con texto. Solo si el cliente pide explícitamente que le reenvíes la foto, llama de nuevo con reenviar=true.",
    };
  }

  if (!ctx.wa || !ctx.customerPhone || !ctx.conversationId) {
    // Sandbox (probador de /admin o dev/chat): no hay a quién enviar. Si hay
    // conversación real (probador), se persiste el marcador [foto] igual que
    // en producción para que el guard funcione entre turnos y el historial
    // que ve Gemini sea el mismo. `imagen` se mantiene por compatibilidad;
    // `imagenes` trae la lista completa.
    if (ctx.conversationId) {
      for (const url of urls) {
        await supabase.from("messages").insert({
          tenant_id: ctx.tenant.id,
          conversation_id: ctx.conversationId,
          sender: "bot",
          msg_type: "image",
          content: `[foto] ${prod.title ?? ""}`.trim(),
          media_url: url,
        });
      }
    }
    for (const url of urls) ctx.sentImageUrls?.add(url);
    return {
      enviado: false,
      nota: "sin_destinatario_dev",
      imagen: urls[0],
      imagenes: urls,
    };
  }

  let sent = 0;
  try {
    for (const url of urls) {
      const waId = await sendImage(ctx.wa, ctx.customerPhone, { link: url });
      await supabase.from("messages").insert({
        tenant_id: ctx.tenant.id,
        conversation_id: ctx.conversationId,
        wa_message_id: waId,
        sender: "bot",
        msg_type: "image",
        content: `[foto] ${prod.title ?? ""}`.trim(),
        media_url: url,
      });
      ctx.sentImageUrls?.add(url);
      sent++;
    }
    return { enviado: true, titulo: prod.title, fotos_enviadas: sent };
  } catch (e) {
    if (sent > 0) {
      return { enviado: true, titulo: prod.title, fotos_enviadas: sent, error: (e as Error).message };
    }
    return { enviado: false, error: (e as Error).message };
  }
}

async function escalarAHumano(ctx: ToolContext, args: Args) {
  const motivo = String(args.motivo ?? "otro");
  // Guard server-side: "fuera de catálogo" exige haber buscado en este turno.
  if (motivo === "fuera_de_catalogo" && !ctx.calledTools?.has("buscar_productos")) {
    return {
      escalado: false,
      error:
        "Primero busca en el catálogo con buscar_productos; escala solo si confirmas que no existe.",
    };
  }
  // Etiqueta del ticket: la elección de la IA (enum por tenant) con fallback
  // determinista motivo→etiqueta. null = sin etiqueta (visible para todos).
  const labelId = resolveLabelId(
    ctx.ticketLabels ?? [],
    typeof args.etiqueta === "string" ? args.etiqueta : null,
    motivo
  );
  const etiqueta =
    ctx.ticketLabels?.find((l) => l.id === labelId)?.name ?? null;
  if (ctx.testMode) {
    // Probador: se marca el resultado en la UI sin crear ticket real.
    return { escalado: true, motivo, etiqueta_resuelta: etiqueta, simulado: true };
  }
  if (!ctx.conversationId) {
    // Modo dev sin conversación real: solo confirmamos.
    return { escalado: true, motivo, nota: "sin_conversacion_dev" };
  }
  await escalateToHuman({
    tenantId: ctx.tenant.id,
    conversationId: ctx.conversationId,
    reason: motivo,
    labelId,
  });
  return { escalado: true, motivo, etiqueta };
}

const HANDLERS: Record<string, (ctx: ToolContext, args: Args) => unknown> = {
  buscar_productos: buscarProductos,
  ver_detalle_producto: verDetalleProducto,
  ver_historial_cliente: verHistorialCliente,
  calcular_envio: calcularEnvio,
  crear_orden: crearOrden,
  enviar_imagen_producto: enviarImagenProducto,
  escalar_a_humano: escalarAHumano,
};

export async function executeTool(
  name: string,
  args: Args,
  ctx: ToolContext
): Promise<unknown> {
  const handler = HANDLERS[name];
  if (!handler) return { error: `Herramienta desconocida: ${name}` };
  const result = await handler(ctx, args);
  ctx.calledTools?.add(name);
  return result;
}
