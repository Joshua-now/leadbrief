import { NextResponse } from 'next/server'

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const appUrl = process.env.NEXT_PUBLIC_APP_URL

  const envStatus = {
    NEXT_PUBLIC_SUPABASE_URL: !!supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: !!supabaseAnonKey,
    SUPABASE_SERVICE_ROLE_KEY: !!supabaseServiceKey,
    NEXT_PUBLIC_APP_URL: !!appUrl,
  }

  const allConfigured = Object.values(envStatus).every(Boolean)

  return NextResponse.json({
    status: allConfigured ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    supabase: {
      configured: !!supabaseUrl && !!supabaseAnonKey,
      serviceKeyConfigured: !!supabaseServiceKey,
    },
    environment: envStatus,
  })
}
