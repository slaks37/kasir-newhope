CREATE OR REPLACE FUNCTION public.custom_signup(
  user_email TEXT,
  user_password TEXT
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_user_id UUID;
  existing_user UUID;
BEGIN
  -- Cek apakah email sudah terdaftar
  SELECT id INTO existing_user FROM auth.users WHERE email = user_email LIMIT 1;
  IF existing_user IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Email ini sudah terdaftar');
  END IF;

  -- Buat ID baru
  new_user_id := gen_random_uuid();

  -- Insert user baru langsung ke tabel auth.users
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, 
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, 
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  VALUES (
    '00000000-0000-0000-0000-000000000000', new_user_id, 'authenticated', 'authenticated', 
    user_email, crypt(user_password, gen_salt('bf')), NOW(), 
    '{"provider":"email","providers":["email"]}', '{}', NOW(), NOW(), 
    '', '', '', ''
  );

  RETURN jsonb_build_object('ok', true, 'user_id', new_user_id);
END;
$$;
