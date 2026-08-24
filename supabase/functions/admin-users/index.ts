// ---------------------------------------------------------------------------
// admin-users
//
// Account management for the head of family. Creating an auth user, changing
// someone else's password and deleting an account all need the service role,
// which must never reach the browser — so they live here instead.
//
// Every request is authenticated twice: the caller's JWT must be valid, and
// their profile row must say role = 'head'. A member or driver calling this
// gets a 403 no matter what they put in the body.
//
// Actions: create | update | set_password | delete
// ---------------------------------------------------------------------------
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, json } from './cors.ts'

const EMAIL_DOMAIN = 'ssfamily.local'
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,29}$/

type Role = 'head' | 'member' | 'driver'

interface Body {
  action: 'create' | 'update' | 'set_password'  | 'delete'
  id?: string
  name?: string
  username?: string
  password?: string
  relation?: string
  role?: Role
  phone?: string
  whatsapp_number?: string
  can_approve_menu?: boolean
}

const loginEmail = (username: string) => `${username.trim().toLowerCase()}@${EMAIL_DOMAIN}`

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader) return json({ error: 'Not signed in.' }, 401)

  // Who is calling?
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const {
    data: { user: caller },
    error: callerError,
  } = await asCaller.auth.getUser()

  if (callerError || !caller) return json({ error: 'Not signed in.' }, 401)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: callerProfile } = await admin
    .from('users')
    .select('role')
    .eq('id', caller.id)
    .maybeSingle()

  if (callerProfile?.role !== 'head') {
    return json({ error: 'Only the head of family can manage accounts.' }, 403)
  }

  let body: Body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body.' }, 400)
  }

  // -------------------------------------------------------------- create
  if (body.action === 'create') {
    const username = (body.username ?? '').trim().toLowerCase()
    const name = (body.name ?? '').trim()
    const password = body.password ?? ''
    const role: Role = body.role ?? 'member'

    if (!name) return json({ error: 'Full name is required.' }, 400)
    if (!USERNAME_RE.test(username)) {
      return json(
        {
          error:
            'Username must be 2-30 characters: lowercase letters, numbers, dot, dash or underscore.',
        },
        400,
      )
    }
    if (password.length < 6) {
      return json({ error: 'Password must be at least 6 characters.' }, 400)
    }

    const { data: taken } = await admin
      .from('users')
      .select('id')
      .ilike('username', username)
      .maybeSingle()
    if (taken) return json({ error: `Username "${username}" is already taken.` }, 409)

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: loginEmail(username),
      password,
      email_confirm: true,
      user_metadata: {
        name,
        username,
        role,
        relation: body.relation?.trim() || null,
        phone: body.phone?.trim() || null,
        whatsapp_number: body.whatsapp_number?.trim() || null,
        created_by_admin: 'true',
      },
    })

    if (createError || !created?.user) {
      return json({ error: createError?.message ?? 'Could not create the account.' }, 400)
    }

    // handle_new_user() writes the profile; make sure every field landed even
    // if that trigger is ever changed.
    await admin
      .from('users')
      .update({
        name,
        username,
        role,
        relation: body.relation?.trim() || null,
        phone: body.phone?.trim() || null,
        whatsapp_number: body.whatsapp_number?.trim() || null,
        can_approve_menu: body.can_approve_menu ?? false,
      })
      .eq('id', created.user.id)

    return json({ ok: true, id: created.user.id, username })
  }

  // -------------------------------------------------------------- update
  if (body.action === 'update') {
    if (!body.id) return json({ error: 'Missing user id.' }, 400)

    const patch: Record<string, unknown> = {}
    if (body.name !== undefined) {
      const name = body.name.trim()
      if (!name) return json({ error: 'Full name cannot be empty.' }, 400)
      patch.name = name
    }
    if (body.relation !== undefined) patch.relation = body.relation.trim() || null
    if (body.phone !== undefined) patch.phone = body.phone.trim() || null
    if (body.whatsapp_number !== undefined) {
      patch.whatsapp_number = body.whatsapp_number.trim() || null
    }
    if (body.can_approve_menu !== undefined) patch.can_approve_menu = body.can_approve_menu
    if (body.role !== undefined) {
      if (body.id === caller.id && body.role !== 'head') {
        return json({ error: 'You cannot remove your own head-of-family role.' }, 400)
      }
      patch.role = body.role
    }

    // Changing a username moves the login itself, because the sign-in address
    // is derived from it. Do that first: if it fails, the profile is untouched
    // and the person can still sign in with the name they had.
    if (body.username !== undefined) {
      const username = body.username.trim().toLowerCase()
      const { data: current } = await admin
        .from('users')
        .select('username')
        .eq('id', body.id)
        .maybeSingle()

      if (username !== (current?.username ?? '')) {
        if (!USERNAME_RE.test(username)) {
          return json(
            {
              error:
                'Username must be 2-30 characters: lowercase letters, numbers, dot, dash or underscore.',
            },
            400,
          )
        }

        const { data: taken } = await admin
          .from('users')
          .select('id')
          .ilike('username', username)
          .neq('id', body.id)
          .maybeSingle()
        if (taken) return json({ error: `Username "${username}" is already taken.` }, 409)

        const { error: authError } = await admin.auth.admin.updateUserById(body.id, {
          email: loginEmail(username),
          email_confirm: true,
          user_metadata: { username },
        })
        if (authError) return json({ error: authError.message }, 400)

        patch.username = username
        patch.email = loginEmail(username)
      }
    }

    if (Object.keys(patch).length === 0) return json({ ok: true })

    const { error } = await admin.from('users').update(patch).eq('id', body.id)
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true, username: patch.username })
  }

  // -------------------------------------------------- set_password (reset)
  if (body.action === 'set_password') {
    if (!body.id) return json({ error: 'Missing user id.' }, 400)
    if ((body.password ?? '').length < 6) {
      return json({ error: 'Password must be at least 6 characters.' }, 400)
    }

    const { error } = await admin.auth.admin.updateUserById(body.id, {
      password: body.password,
    })
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true })
  }

  // -------------------------------------------------------------- delete
  if (body.action === 'delete') {
    if (!body.id) return json({ error: 'Missing user id.' }, 400)
    if (body.id === caller.id) {
      return json({ error: 'You cannot delete your own account.' }, 400)
    }

    // Never leave the family without a head.
    const { data: victim } = await admin
      .from('users')
      .select('role')
      .eq('id', body.id)
      .maybeSingle()

    if (victim?.role === 'head') {
      const { count } = await admin
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'head')
      if ((count ?? 0) <= 1) {
        return json({ error: 'That is the only head of family — promote someone else first.' }, 400)
      }
    }

    const { error } = await admin.auth.admin.deleteUser(body.id)
    if (error) return json({ error: error.message }, 400)
    return json({ ok: true })
  }

  return json({ error: 'Unknown action.' }, 400)
})
