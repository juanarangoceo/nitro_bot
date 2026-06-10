// Herramientas (function calling) que el asesor expone a Gemini.
// Todas resuelven por tenant_id del contexto y corren server-side con el
// cliente service_role. REGLA CLAVE: precios y totales se calculan aquí desde
// el catálogo, nunca los decide la IA.

import { createAdminClient } from "../supabase/admin";
import { searchProducts } from "./rag";
import { escalateToHuman } from "./escalation";
import { createCodOrder, type OrderItem, type CustomerData } from "../shopify/orders";
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
};

// --- Declaraciones para Gemini (subset OpenAPI) ---------------------------
export const toolDeclarations = [
  {
    name: "buscar_productos",
    description:
      "Busca productos en el catálogo real de la tienda por similitud semántica. Úsala siempre que el cliente pregunte por productos, características, precios o disponibilidad.",
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
    name: "ver_stock",
    description: "Consulta la disponibilidad (stock) actual de un producto por su id.",
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
            telefono: { type: "string" },
            direccion: { type: "string" },
            ciudad: { type: "string" },
          },
          required: ["nombre", "telefono", "direccion", "ciudad"],
        },
      },
      required: ["items", "datos_cliente"],
    },
  },
  {
    name: "enviar_imagen_producto",
    description:
      "Envía al cliente la foto de un producto del catálogo por WhatsApp. Úsala cuando recomiendes un producto y convenga que el cliente lo vea. Pasa el shopify_id (campo 'id' que devuelve buscar_productos).",
    parameters: {
      type: "object",
      properties: {
        producto_id: { type: "string", description: "shopify_id del producto." },
        mensaje: {
          type: "string",
          description: "Texto corto opcional que acompaña la foto (caption).",
        },
      },
      required: ["producto_id"],
    },
  },
  {
    name: "escalar_a_humano",
    description:
      "Escala la conversación a un agente humano (reclamo, fuera de catálogo, o el cliente lo pide). El asesor deja de responder hasta que se resuelva.",
    parameters: {
      type: "object",
      properties: {
        motivo: {
          type: "string",
          description: "reclamo | fuera_de_catalogo | pide_humano | otro",
        },
      },
      required: ["motivo"],
    },
  },
];

// --- Implementaciones ------------------------------------------------------
type Args = Record<string, unknown>;

async function buscarProductos(ctx: ToolContext, args: Args) {
  const productos = await searchProducts(ctx.tenant.id, String(args.consulta ?? ""), 5);
  return {
    productos: productos.map((p) => ({
      id: p.shopify_id,
      titulo: p.title,
      precio: p.price,
      stock: p.stock,
    })),
  };
}

async function verStock(ctx: ToolContext, args: Args) {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("products")
    .select("title, stock")
    .eq("tenant_id", ctx.tenant.id)
    .eq("shopify_id", String(args.producto_id))
    .maybeSingle();
  if (!data) return { encontrado: false };
  return { encontrado: true, titulo: data.title, stock: data.stock };
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

// Envía la foto del producto al cliente por WhatsApp (link = imagen de Shopify).
// Persiste un mensaje saliente del bot (msg_type image). En el sandbox del editor
// (sin wa/customerPhone) hace no-op y lo reporta.
async function enviarImagenProducto(ctx: ToolContext, args: Args) {
  const productoId = String(args.producto_id ?? "");
  const caption = args.mensaje ? String(args.mensaje) : undefined;
  const supabase = createAdminClient();
  const { data: prod } = await supabase
    .from("products")
    .select("title, image_url")
    .eq("tenant_id", ctx.tenant.id)
    .eq("shopify_id", productoId)
    .maybeSingle();
  if (!prod) return { enviado: false, error: "Producto no encontrado." };
  if (!prod.image_url) return { enviado: false, error: "El producto no tiene imagen." };

  if (!ctx.wa || !ctx.customerPhone || !ctx.conversationId) {
    // Sandbox del editor: no hay a quién enviar.
    return { enviado: false, nota: "sin_destinatario_dev", imagen: prod.image_url };
  }

  try {
    const waId = await sendImage(ctx.wa, ctx.customerPhone, {
      link: prod.image_url,
      caption,
    });
    await supabase.from("messages").insert({
      tenant_id: ctx.tenant.id,
      conversation_id: ctx.conversationId,
      wa_message_id: waId,
      sender: "bot",
      msg_type: "image",
      content: caption ?? `[foto] ${prod.title ?? ""}`.trim(),
      media_url: prod.image_url,
    });
    return { enviado: true, titulo: prod.title };
  } catch (e) {
    return { enviado: false, error: (e as Error).message };
  }
}

async function escalarAHumano(ctx: ToolContext, args: Args) {
  const motivo = String(args.motivo ?? "otro");
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
  ver_stock: verStock,
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
  return await handler(ctx, args);
}
