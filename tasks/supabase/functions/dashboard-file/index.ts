// SS Dashboard → a short-lived link to one task file in the private
// "task-files" bucket. POST { key, attachment }. The dashboard key and the
// owner's right to see the task are checked by dashboard_attachment_path.
import { createClient } from "jsr:@supabase/supabase-js@2";

const LINK_SECONDS = 300;

Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "POST only" }, { status: 405 });
  let body: { key?: unknown; attachment?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const key = typeof body.key === "string" ? body.key : "";
  const attachment = typeof body.attachment === "string" ? body.attachment : "";
  if (!key || !/^[0-9a-f-]{36}$/i.test(attachment)) return Response.json({ error: "Bad request" }, { status: 400 });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc("dashboard_attachment_path", { p_key: key, p_attachment: attachment });
  if (error) {
    const denied = error.code === "42501";
    return Response.json({ error: denied ? "Not allowed" : error.message }, { status: denied ? 403 : 404 });
  }
  const file = data as { path: string; name: string };
  const signed = await admin.storage.from("task-files").createSignedUrl(file.path, LINK_SECONDS);
  if (signed.error || !signed.data) return Response.json({ error: "Could not open the file." }, { status: 500 });
  return Response.json({ url: signed.data.signedUrl, name: file.name });
});
