import "server-only";

function approvedSupabaseOrigin(value: string | undefined) {
  if (!value || value !== value.trim()) return null;

  try {
    const parsed = new URL(value);
    if (
      (value !== parsed.origin && value !== `${parsed.origin}/`) ||
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      !parsed.hostname.endsWith(".supabase.co") ||
      parsed.hostname === "supabase.co"
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function getSupabaseConfig() {
  const url = approvedSupabaseOrigin(process.env.SUPABASE_URL) ?? "";

  return {
    url,
    serviceRoleKey: url ? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "" : ""
  };
}

export function isSupabaseConfigured() {
  const { url, serviceRoleKey } = getSupabaseConfig();
  return Boolean(url && serviceRoleKey);
}
