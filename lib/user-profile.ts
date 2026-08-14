/**
 * Shape a User row into the profile the browser is allowed to see.
 *
 * The one rule this file exists to enforce: `password` is never on the way out.
 * Both the login response and /api/auth/me go through here, so there is a single
 * place to audit.
 *
 * `role` is the whole permission model. It used to be joined by sections[] and
 * canAdd/canEdit/canDelete/canSync/ownerFilter/orgs, none of which any route ever
 * checked — the server enforced nothing and the browser hid a few nav links. Now
 * that only admins can log in at all, those columns described a model that did
 * not exist, so they are gone.
 */
export interface PublicProfile {
  email: string
  name: string
  role: string
}

type UserRow = { email: string; name: string; role: string }

export function toProfile(u: UserRow): PublicProfile {
  return { email: u.email, name: u.name, role: u.role }
}
