import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { createClient as createAdminClient } from "@supabase/supabase-js"

/** Server component / Route handler client (uses anon key + cookie auth) */
export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll can fail in Server Components — safe to ignore
          }
        },
      },
    }
  )
}

/** Service role client for pipeline writes (server-only, never expose to browser) */
export function createServiceClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}
