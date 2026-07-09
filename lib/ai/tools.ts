// Herramientas (function calling) que el asesor expone a Gemini.
// Todas resuelven por tenant_id del contexto y corren server-side con el
// cliente service_role. REGLA CLAVE: precios y totales se calculan aquí desde
// el catálogo, nunca los decide la IA.

import { createAdminClient } from "../supabase/admin";
import { searchProducts } from "./rag";
import { escalateToHuman } from "./escalation";
import { createCodOrder, type OrderItem, type CustomerData } from "../shopify/orders";
import { resolveDepartment } from "../shopify/colombia";
import { sendImage, type WaCreds } from "../whatsapp/meta";
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
      "Envía al cliente fotos de un producto del catálogo por WhatsApp. Úsala cuando recomiendes un producto y convenga que el cliente lo vea. Pasa el shopify_id (campo 'id' que devuelve buscar_productos).",
    parameters: {
      type: "object",
      properties: {
        producto_id: { type: "string", description: "shopify_id del producto." },
        mensaje: {
          type: "string",
          description: "Texto corto opcional que acompaña la foto (caption).",
        },
        cantidad: {
          type: "number",
          description:
            "Cuántas fotos enviar (1 a 4, default 1). Usa más de 1 SOLO si el cliente pide ver más fotos o ángulos del producto.",
        },
      },
      required: ["producto_id"],
    },
  },
  {
    name: "escalar_a_humano",
    description:
      "Escala la conversación a un agente humano y el asesor DEJA de responder: es el ÚLTIMO recurso. Úsala SOLO si: (a) el cliente tiene un reclamo o problema con un pedido ya realizado, (b) pide explícitamente hablar con una persona, o (c) pide un producto que confirmaste que NO existe llamando buscar_productos en este mismo turno. NUNCA escales por preguntas de envíos, garantías, devoluciones, precios o disponibilidad: eso lo respondes tú con las herramientas y la información de la empresa.",
    parameters: {
      type: "object",
      properties: {
        motivo: {
          type: "string",
          enum: ["reclamo", "fuera_de_catalogo", "pide_humano", "otro"],
        },
      },
      required: ["motivo"],
    },
  },
];

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
  const productos = await searchProducts(ctx.tenant.id, String(args.consulta ?? ""), 5);
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
  if (!data) return { encontrado: false };
  const disponible = data.status === "active";
  return {
    encontrado: true,
    titulo: data.title,
    precio: data.price,
    descripcion: data.description?.trim() || null,
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
  const items = (args.items ?? []) as OrderItem[];
  const cliente = (args.datos_cliente ?? {}) as CustomerData;
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, error: "Sin items." };
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
  return await createCodOrder({
    tenantId: ctx.tenant.id,
    creds: ctx.shopify,
    shippingRules: ctx.tenant.shipping_rules ?? {},
    conversationId: ctx.conversationId,
    items,
    cliente,
  });
}

// Envía foto(s) del producto al cliente por WhatsApp (link = imagen de Shopify).
// `cantidad` (1-4, default 1) permite mandar la galería cuando el cliente pide
// más fotos. Persiste un mensaje saliente del bot (msg_type image) por cada
// foto. En el sandbox del editor (sin wa/customerPhone) hace no-op y lo reporta.
async function enviarImagenProducto(ctx: ToolContext, args: Args) {
  const productoId = String(args.producto_id ?? "");
  const caption = args.mensaje ? String(args.mensaje) : undefined;
  const cantidad = Math.min(4, Math.max(1, Math.trunc(Number(args.cantidad)) || 1));
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
  const urls = [
    ...new Set([...(prod.image_url ? [prod.image_url] : []), ...gallery]),
  ].slice(0, cantidad);
  if (urls.length === 0) return { enviado: false, error: "El producto no tiene imagen." };

  if (!ctx.wa || !ctx.customerPhone || !ctx.conversationId) {
    // Sandbox del editor: no hay a quién enviar. `imagen` se mantiene por
    // compatibilidad; `imagenes` trae la lista completa.
    return {
      enviado: false,
      nota: "sin_destinatario_dev",
      imagen: urls[0],
      imagenes: urls,
    };
  }

  let sent = 0;
  try {
    for (const [i, url] of urls.entries()) {
      const waId = await sendImage(ctx.wa, ctx.customerPhone, {
        link: url,
        caption: i === 0 ? caption : undefined,
      });
      await supabase.from("messages").insert({
        tenant_id: ctx.tenant.id,
        conversation_id: ctx.conversationId,
        wa_message_id: waId,
        sender: "bot",
        msg_type: "image",
        content: i === 0 ? caption ?? `[foto] ${prod.title ?? ""}`.trim() : `[foto] ${prod.title ?? ""}`.trim(),
        media_url: url,
      });
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
  if (ctx.testMode) {
    // Probador: se marca el resultado en la UI sin crear ticket real.
    return { escalado: true, motivo, simulado: true };
  }
  if (!ctx.conversationId) {
    // Modo dev sin conversación real: solo confirmamos.
    return { escalado: true, motivo, nota: "sin_conversacion_dev" };
  }
  await escalateToHuman({
    tenantId: ctx.tenant.id,
    conversationId: ctx.conversationId,
    reason: motivo,
  });
  return { escalado: true, motivo };
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
