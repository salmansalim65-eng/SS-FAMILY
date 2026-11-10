import { redirect } from "next/navigation";
import { AppDataProvider } from "@/components/data";
import { Shell } from "@/components/shell";
import { serverSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { data } = await (await serverSupabase()).auth.getUser();
  if (!data.user) redirect("/login");
  return (
    <AppDataProvider userId={data.user.id}>
      <Shell userId={data.user.id}>{children}</Shell>
    </AppDataProvider>
  );
}
