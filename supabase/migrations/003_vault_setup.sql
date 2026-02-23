-- ========================================
-- MailDeck: Token Encryption via pgcrypto
-- ========================================
-- OAuth access/refresh tokens are encrypted at rest using a symmetric key
-- stored in Supabase Vault. Only service_role can encrypt/decrypt.

-- Insert the master encryption key into Supabase Vault.
-- In production, replace this placeholder with a real 32-byte hex key.
-- You can generate one with: select encode(gen_random_bytes(32), 'hex');
--
-- NOTE: Run this manually or via Supabase Dashboard > Vault:
--   select vault.create_secret('MAILDECK_TOKEN_KEY', '<your-64-char-hex-key>');

-- ========================================
-- encrypt_token() — encrypts a token string
-- ========================================
-- NOTE: Functions are created in the public schema so Supabase RPC can
-- discover them, but access is revoked from all roles except service_role.
-- This means only Edge Functions running with the service role key can call them.

create or replace function public.encrypt_token(plain_text text)
returns bytea
language plpgsql
security definer
set search_path = ''
as $$
declare
  key_hex text;
  key_bytes bytea;
begin
  -- Retrieve encryption key from Supabase Vault
  select decrypted_secret into key_hex
  from vault.decrypted_secrets
  where name = 'MAILDECK_TOKEN_KEY'
  limit 1;

  if key_hex is null then
    raise exception 'Encryption key not found in vault';
  end if;

  key_bytes := decode(key_hex, 'hex');

  return extensions.pgp_sym_encrypt(plain_text, encode(key_bytes, 'escape'));
end;
$$;

-- ========================================
-- decrypt_token() — decrypts a token bytea
-- ========================================
create or replace function public.decrypt_token(encrypted_text bytea)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  key_hex text;
  key_bytes bytea;
begin
  if encrypted_text is null then
    return null;
  end if;

  -- Retrieve encryption key from Supabase Vault
  select decrypted_secret into key_hex
  from vault.decrypted_secrets
  where name = 'MAILDECK_TOKEN_KEY'
  limit 1;

  if key_hex is null then
    raise exception 'Encryption key not found in vault';
  end if;

  key_bytes := decode(key_hex, 'hex');

  return extensions.pgp_sym_decrypt(encrypted_text, encode(key_bytes, 'escape'));
end;
$$;

-- Revoke all access from public roles — only service_role can call these
revoke all on function public.encrypt_token(text) from public, anon, authenticated;
revoke all on function public.decrypt_token(bytea) from public, anon, authenticated;

-- Grant to service_role only
grant execute on function public.encrypt_token(text) to service_role;
grant execute on function public.decrypt_token(bytea) to service_role;
