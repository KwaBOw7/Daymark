import { createClient, type SupabaseClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const cloudConfigured = Boolean(url && key && !url.includes('YOUR_PROJECT'));
export const supabase: SupabaseClient | null = cloudConfigured ? createClient(url!,key!,{
  auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, flowType:'pkce' },
  global:{ headers:{ 'x-application-name':'daymark-personal-scheduler' } }
}) : null;
export const cloudConfigurationMessage = cloudConfigured ? '' : 'Cloud sync is not configured. Your schedule is saved on this device until Supabase credentials are added.';
