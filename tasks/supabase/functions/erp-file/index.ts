// ERP task panels → task files in the private "task-files" bucket.
// POST { key, email, action, ... }:
//   open     { attachment }              → { url }  (5-minute link)
//   prepare  { task, name }              → { url, path }  (one-time upload link)
//   register { task, name, path, size, mime } → { id }  (after the upload)
//   remove   { attachment }              → { ok }
// The ERP key, the user (by email) and their right to the task are checked by
// the erp_file_* functions, as for erp_task_detail.
import { createClient } from "jsr:@supabase/supabase-js@2";

const BUCKET = "task-files";
const LINK_SECONDS = 300;
const UUID = /^[0-9a-f-]{36}$/i;

const fail = (error: string, status = 400) => Response.json({ error }, { status });

Deno.serve(async (req) => {
  if (req.method !== "POST") return fail("POST only", 405);
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return fail("Bad request");
  }
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : "");
  const key = str("key");
  const email = str("email");
  if (!key || !email) return fail("Bad request");

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const call = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(fn, { p_key: key, p_email: email, ...args });
    if (error) throw Object.assign(new Error(error.message), { denied: error.code === "42501" });
    return data;
  };

  try {
    switch (str("action")) {
      case "open": {
        if (!UUID.test(str("attachment"))) return fail("Bad request");
        const f = (await call("erp_file_open", { p_attachment: str("attachment") })) as { path: string };
        const s = await admin.storage.from(BUCKET).createSignedUrl(f.path, LINK_SECONDS);
        if (s.error || !s.data) return fail("Could not open the file.", 500);
        return Response.json({ url: s.data.signedUrl });
      }
      case "prepare": {
        if (!UUID.test(str("task"))) return fail("Bad request");
        const path = (await call("erp_file_prepare", { p_task: str("task"), p_name: str("name") })) as string;
        const s = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
        if (s.error || !s.data) return fail("Could not start the upload.", 500);
        return Response.json({ url: s.data.signedUrl, path });
      }
      case "register": {
        if (!UUID.test(str("task"))) return fail("Bad request");
        const id = await call("erp_file_register", {
          p_task: str("task"),
          p_name: str("name"),
          p_path: str("path"),
          p_size: typeof b.size === "number" ? Math.round(b.size) : null,
          p_mime: str("mime"),
        });
        return Response.json({ id });
      }
      case "remove": {
        if (!UUID.test(str("attachment"))) return fail("Bad request");
        const path = (await call("erp_file_remove", { p_attachment: str("attachment") })) as string;
        await admin.storage.from(BUCKET).remove([path]);
        return Response.json({ ok: true });
      }
      default:
        return fail("Unknown action");
    }
  } catch (e) {
    const err = e as Error & { denied?: boolean };
    return fail(err.denied ? "Not allowed" : err.message, err.denied ? 403 : 400);
  }
});
