# OAuth2 registration (Stud.IP)

ImStudium supports OAuth2 PKCE for headless-friendly auth once a public client is registered.

## Endpoints (DigiCampus / Uni Augsburg)

- Authorize: `https://digicampus.uni-augsburg.de/dispatch.php/api/oauth2/authorize`
- Token: `https://digicampus.uni-augsburg.de/dispatch.php/api/oauth2/token`
- Admin: `https://digicampus.uni-augsburg.de/dispatch.php/admin/oauth2` (root only)

## Request a public client (Uni Augsburg)

Contact RZ support: https://support.rz.uni-augsburg.de

Template:

> We maintain an open-source CLI tool for students ([imstudium](https://github.com/paddy-shrp/imstudium)) that uses the Stud.IP JSON:API. We request an OAuth2 public client (PKCE) with:
> - Name: ImStudium CLI
> - Redirect URI: `http://127.0.0.1:*/callback` (loopback)
> - Scope: `api`

## Usage after registration

```bash
export IMSTUDIUM_OAUTH_CLIENT_ID=your_client_id
imstudium login --oauth
```

Or in `~/.config/imstudium/config.json`:

```json
{
  "oauth": {
    "clientId": "your_client_id"
  }
}
```

## Until OAuth is registered

```bash
imstudium login
```

Opens a sign-in browser window and auto-detects your session — no copy/paste. This uses Stud.IP's **session cookie** auth (same as the web UI).

**ImStudium (Uni Augsburg) as of Jul 2025:** OAuth2 keys are not configured on the server (`invalid_setup`). Ask RZ to run `cli/studip oauth2:keys` and register a client. Until then, browser sign-in is the correct path.

Or import manually (scripts/CI only):

```bash
imstudium session import --cookie "<Seminar_Session value>"
```
