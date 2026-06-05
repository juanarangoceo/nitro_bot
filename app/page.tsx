import { redirect } from "next/navigation";

// La raíz lleva al dashboard; el proxy redirige a /login si no hay sesión.
export default function Home() {
  redirect("/dashboard");
}
