# Single sign-on (OpenID Connect)

Patzer can let people sign in with an identity provider you already run:
Authentik, Keycloak, Authelia, Pocket ID, Zitadel, or anything else that speaks
OpenID Connect. It is configured entirely through environment variables and is
off until you set them.

What you get:

- A **"Sign in with …" button** on the login page, with a label you choose.
- An optional **SSO-only mode** without Patzer passwords. On a fresh install
  it skips the setup wizard: the first SSO login creates the admin.
- **Admins chosen by a provider group**, re-checked at every login.
- **Logout that also ends the provider session**, so the next person at the
  family computer can't walk back in with one click.
- Optional **automatic account creation** for people the provider lets in.
- Optional **linking to existing accounts** by username or email, so accounts
  that predate SSO keep their games and ratings.
- In *Admin → Users*, **which accounts sign in how**: password accounts,
  password accounts linked to SSO, and accounts created by SSO.

## Configuration

| Var | Default | What it does |
|---|---|---|
| `OIDC_ISSUER` | (none) | The provider's issuer URL, exactly as the provider shows it, **including any trailing `/`**. SSO is on when this and `OIDC_CLIENT_ID` are both set. |
| `OIDC_CLIENT_ID` | (none) | Client ID of the application you created at the provider. |
| `OIDC_CLIENT_SECRET` | (empty) | Client secret. Leave empty for a public client (PKCE is always used). |
| `OIDC_BUTTON_TEXT` | "Sign in with SSO" (translated) | Label of the button on the login page, e.g. `Sign in with Authentik`. |
| `OIDC_ONLY` | `false` | `true` removes password login, sign-up, "forgot password" and password reset, in the interface and on the server, and replaces the setup wizard on a fresh install ([SSO only](#sso-only)). Ignored, with a warning in the log, when SSO isn't configured, so a typo can't lock everyone out. |
| `OIDC_ADMIN_GROUP` | (none) | Name of a provider group whose members are Patzer admins ([Admins from a provider group](#admins-from-a-provider-group)). |
| `OIDC_AUTO_PROVISION` | `false` | `true` creates a Patzer account for someone the provider lets in who has none yet. With `false`, only linked or matched accounts can sign in through SSO (plus the very first account in SSO-only mode). |
| `OIDC_MATCH_BY` | `none` | How a first SSO login finds an existing account: `username` (the provider's `preferred_username`, case-insensitive), `email` (only when the provider says the email is verified) or `none`. |
| `PUBLIC_BASE_URL` | (request origin) | The address people use to reach Patzer, e.g. `https://chess.example.com`. The callback and logout URLs are built from it. **Set it behind a reverse proxy.** The *Public base URL* in Admin → System takes precedence when set. |
| `COOKIE_SECURE` | `false` | Set to `true` when Patzer is served over HTTPS. |

The provider must allow these two URLs (replace the host with your
`PUBLIC_BASE_URL`):

- **Callback:** `https://chess.example.com/api/auth/oidc/callback`
- **After logout:** `https://chess.example.com/login`

Patzer asks for the scopes `openid profile email` and reads the claims `sub`,
`preferred_username`, `name`, `email`, `email_verified` and, for the admin
group, `groups`.

### Docker Compose example

```yaml
services:
  patzer:
    image: sikamikaniko123/patzer:latest   # or `build: .`
    environment:
      - PUBLIC_BASE_URL=https://chess.example.com
      - COOKIE_SECURE=true
      - OIDC_ISSUER=https://auth.example.com/application/o/patzer/
      - OIDC_CLIENT_ID=${PATZER_OIDC_CLIENT_ID}
      - OIDC_CLIENT_SECRET=${PATZER_OIDC_CLIENT_SECRET}
      - OIDC_BUTTON_TEXT=Sign in with Authentik
      - OIDC_ONLY=true
      - OIDC_ADMIN_GROUP=patzer-admins
      - OIDC_AUTO_PROVISION=true
    volumes:
      - ./data:/app/data
```

## Two ways to run it

### SSO next to passwords

This is the default (`OIDC_ONLY` unset). The login page shows the SSO button
above the usual form, and everything else works as before. On a fresh install
the setup wizard creates the admin, and SSO logins are sent back to the wizard
until it's done.

To also use SSO for the wizard's admin, choose the same username as at the
provider in the wizard, and set `OIDC_MATCH_BY=username` for your first SSO
login. That links the two for good.

### SSO only

With `OIDC_ONLY=true` there are no Patzer passwords: the login page shows only
the SSO button, and the server refuses password login, sign-up, "forgot
password", password reset and the setup wizard.

**On a fresh install** there is no setup wizard, since nobody could use the
password it asks for. At startup Patzer:

1. closes sign-up, since accounts come from the provider;
2. leaves the coach unconfigured (set it up later in *Admin → System*);
3. sends everyone to the login page, and creates the admin from the first SSO
   login:
   - **with `OIDC_ADMIN_GROUP`**, the first member of that group to sign in
     becomes the admin. Until then, everyone else is turned away with "This
     server is waiting for its administrator to sign in first" and no account
     is created for them;
   - **without it**, the first person to sign in becomes the admin.

   The first account is created even with `OIDC_AUTO_PROVISION=false`; that
   setting applies from the second account on.

The log says which of the two applies when Patzer starts.

**Switching an existing install to SSO only:** first make sure the admins can
get in through SSO. Either sign in with SSO once while passwords still work, or
use `OIDC_ADMIN_GROUP`, or use `OIDC_MATCH_BY`. Then set `OIDC_ONLY=true`.

## Admins from a provider group

With `OIDC_ADMIN_GROUP=patzer-admins`, the provider decides who is an admin:

- **The role follows the group at every SSO login.** Joining the group makes
  someone an admin at their next login; leaving it makes them a normal user
  again. A role you change in *Admin → Users* for someone who signs in through
  SSO is overwritten at their next login.
- **While there is no admin, only group members can sign in through SSO.** On
  a fresh SSO-only install that's how the first admin is chosen. It also covers
  the case where the last admin leaves the group: add someone back, and they
  restore an admin at their next login.
- **If the provider sends no `groups` claim**, roles are left as they are, and
  the log warns about it, so a missing scope or mapping can't demote anyone.
  (While there's no admin yet, a login without the claim is refused, because
  it can't prove membership.)
- Accounts that only ever sign in with a password are not affected.

The group name is compared exactly as the provider sends it. Authentik sends
group names. Keycloak sends paths such as `/patzer-admins`, depending on the
mapper.

## Setting up Authentik

1. **Create the provider.** *Applications → Providers → Create → OAuth2/OpenID
   Provider*:
   - **Client type:** Confidential.
   - **Redirect URIs:** add both URLs above as *Strict* entries. The
     after-logout URL belongs here too, or Authentik may refuse to send people
     back to Patzer after logging them out.
   - **Signing key:** pick a certificate, e.g. *authentik Self-signed
     Certificate*.
   - Keep the default scopes (`openid`, `email`, `profile`). Authentik's
     `profile` scope already includes the user's groups.
2. **Create the application** (*Applications → Applications → Create*), choose
   the provider, and give it a slug such as `patzer`. The issuer is then
   `https://auth.example.com/application/o/patzer/`. Copy it from the
   provider's overview (*OpenID Configuration Issuer*), trailing slash
   included.
3. **Decide who may sign in.** Bind a group or policy to the application, e.g.
   a `family` group. People outside it are stopped by Authentik before Patzer
   ever sees them.
4. **Decide who administers Patzer.** Create a group such as `patzer-admins`,
   add yourself, and set `OIDC_ADMIN_GROUP=patzer-admins`. Its members also
   need to pass step 3.
5. **Make logout end the Authentik session.** When Patzer logs someone out, it
   sends the browser to Authentik's end-session endpoint, which runs the
   provider's *invalidation flow*. Authentik's
   `default-provider-invalidation-flow` only ends the app session and leaves
   the user signed in to Authentik. To sign them out of Authentik as well, give
   the provider an invalidation flow that contains a **User Logout** stage:
   either a new flow just for Patzer, or that stage added to the default flow,
   which then applies to every application.
6. **Only if you use `OIDC_MATCH_BY=email`:** since 2025.10 Authentik sends
   `email_verified: false` unless told otherwise, and Patzer never matches on an
   unverified email. Create a scope mapping for the `email` scope that returns
   `email_verified: True` and use it instead of the default one. Only do this
   if your users can't change their own email address in Authentik.

### Other providers

The same two URLs go into whatever the provider calls them. In Keycloak that's
*Valid redirect URIs* and *Valid post logout redirect URIs*, with *Client
authentication* on; for `OIDC_ADMIN_GROUP`, add a *Group Membership* mapper
that puts the groups in the ID token or userinfo. If a provider doesn't
advertise an `end_session_endpoint`, logout simply ends the Patzer session and
stays on Patzer.

## How accounts are found

On every SSO login Patzer goes through these steps, in order:

1. **An identity seen before** (same issuer and `sub`) signs into the same
   account as last time, whatever its username or email have become since.
2. **Otherwise, `OIDC_MATCH_BY`** may link it to an existing account:
   - `username`: an account whose username equals the provider's
     `preferred_username`, ignoring letter case.
   - `email`: an account with the same email, only if the provider marks it
     verified.

   The link is permanent. An account can be linked to only one identity per
   provider: a second identity that matches it is refused ("already linked"),
   and so is a username that matches two accounts differing only in case.
3. **Otherwise, `OIDC_AUTO_PROVISION=true`** creates an account. It takes the
   provider's username, or the next free `name-2`, `name-3`, … if that's taken.
   It also takes the display name, the email (unless another account already
   uses it) and the language of the browser. The account is a normal user,
   unless the admin group or the [first run](#sso-only) makes it an admin. It
   has **no password** and is marked as created by SSO.
4. **Otherwise** the login is refused with "You don't have a Patzer account yet".
   The admin can create the account in *Admin → Users*; with `OIDC_MATCH_BY`,
   it's linked at that person's first SSO login.

**Emails of linked accounts.** When an account without an email is linked or
signs in through SSO, it gets the provider's email, if no other account uses
it. That way password resets and notifications work for it too. An email the
account already has is never overwritten.

## Admin → Users

The *Sign-in* column shows how each account came to be:

- **Password:** created by the setup wizard, sign-up or the admin console.
  *linked to SSO* underneath means it signs in through the provider as well.
- **SSO:** created by a single sign-on login.

## Getting back in

- **The provider is down, or misconfigured, and `OIDC_ONLY=true`:** remove
  `OIDC_ONLY` and restart. Password login comes back for every account that
  has a password: the wizard's admin and accounts made in the admin console.
  Accounts created through SSO have none. If email is set up, "Forgot
  password?" works for them, since they have the provider's email.
  Otherwise, an admin sets one in *Admin → Users*. If the only admin was
  created through SSO and there's no email, set a password directly in the
  database as described in the
  [FAQ](FAQ.md#i-forgot-my-admin-password).
- **No admin left** (with `OIDC_ADMIN_GROUP`): put someone back in the group at
  the provider. Their next SSO login makes them an admin again.
- **Undo a link** (e.g. it went to the wrong account): there's no screen for
  this yet. With the container stopped, run
  `sqlite3 chess.db "DELETE FROM oidc_identities WHERE user_id = <id>;"`.
  Deleting a user removes their link automatically.

## Troubleshooting

The server logs every SSO attempt with an `[auth] sso_…` line that names the
reason. The login page shows a short message for each of these:

| Message on the login page | Usual cause |
|---|---|
| *The sign-in service can't be reached* | `OIDC_ISSUER` doesn't match the issuer the provider reports, character for character (look for a missing trailing `/`). Otherwise the container can't reach the provider: check DNS from inside the container, and that its certificate is trusted. For a private CA, mount the certificate and point `NODE_EXTRA_CA_CERTS` at it. |
| *Sign-in was cancelled or not allowed* | The user cancelled, or the provider refused them (e.g. not in the group bound to the application). |
| *That sign-in took too long* | More than ten minutes passed at the provider, or the browser dropped Patzer's short-lived login cookie. `COOKIE_SECURE=true` on a plain-HTTP site does exactly that. |
| *Single sign-on didn't work* | Usually a redirect URI mismatch: the provider has to list the callback URL built from `PUBLIC_BASE_URL` (or the Admin → System setting) exactly. A wrong client secret also lands here. |
| *You don't have a Patzer account yet* | `OIDC_AUTO_PROVISION` is off and no account matched. |
| *This account is already linked to a different sign-in* | See [How accounts are found](#how-accounts-are-found), step 2. |
| *This server is waiting for its administrator to sign in first* | `OIDC_ADMIN_GROUP` is set and no admin exists yet: a member of the group has to sign in first. If a member gets this too, the provider isn't sending the `groups` claim (the log says so). |

If logout returns to Patzer but you're still signed in at the provider, the
provider's invalidation flow has no logout stage (Authentik step 5). If the
provider refuses the logout redirect, the after-logout URL is missing from its
allowed redirect URIs.

A plain-`http` issuer works, with a warning in the log, for testing on a
trusted network.

## Testing

`npm run test:oidc` runs the whole flow against a real OpenID provider
(`oidc-provider`) on two local ports:

- a fresh SSO-only install, where the admin group decides who goes first;
- provisioning;
- an account made in the admin console, then linked through SSO;
- roles following the provider group;
- the *Sign-in* column data;
- the logout round trip through the provider;
- a cancelled login.

As part of `npm test`:

- `server/test/oidc.test.ts` covers account matching, emails, the admin group and the SSO-only guards;
- `server/test/oidc-first-run.test.ts` and `server/test/oidc-mixed.test.ts` cover the two kinds of fresh install;
- `web/src/pages/Login.test.tsx` and `web/src/pages/admin/Users.test.tsx` cover the screens.
