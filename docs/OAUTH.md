# OAuth2 registration (Stud.IP)

DigiCampus supports OAuth2 PKCE for headless-friendly auth once a public client is registered.

## Endpoints (DigiCampus)

- Authorize: `https://digicampus.uni-augsburg.de/dispatch.php/api/oauth2/authorize`
- Token: `https://digicampus.uni-augsburg.de/dispatch.php/api/oauth2/token`
- Admin: `https://digicampus.uni-augsburg.de/dispatch.php/admin/oauth2` (root only)

## Request a public client (Uni Augsburg)

Contact RZ support: https://support.rz.uni-augsburg.de

Template:

> We maintain an open-source CLI tool for students ([digicampus](https://github.com/your-org/digicampus)) that uses the Stud.IP JSON:API. We request an OAuth2 public client (PKCE) with:
> - Name: DigiCampus Studium OS CLI
> - Redirect URI: `http://127.0.0.1:*/callback` (loopback)
> - Scope: `api`

## Usage after registration

```bash
export DIGICAMPUS_OAUTH_CLIENT_ID=your_client_id
digicampus login --oauth
```

Or in `~/.config/digicampus/config.json`:

```json
{
  "oauth": {
    "clientId": "your_client_id"
  }
}
```

## Until OAuth is registered

Use browser login (default):

```bash
digicampus login
```

Or import session cookie from browser DevTools:

```bash
digicampus session import --cookie "<Seminar_Session value>"
```
