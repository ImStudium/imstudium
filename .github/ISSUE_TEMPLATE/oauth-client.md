---
name: OAuth2 client registration
about: Request Stud.IP OAuth2 client from university IT (RZ)
title: "[OAuth] Register client for DigiCampus CLI"
labels: enhancement
---

## University

- [ ] Uni Augsburg
- [ ] Other: ___

## Purpose

DigiCampus Studium OS needs an OAuth2 PKCE client for non-interactive auth (`digicampus login --oauth`).

## Request details for RZ

| Field | Value |
|-------|-------|
| Application name | DigiCampus Studium OS |
| Redirect URI | `http://127.0.0.1:8745/callback` |
| Grant type | Authorization Code + PKCE |
| Scope | Stud.IP API access (same as web session) |
| Homepage | https://github.com/paddy-shrp/digicampus |

## After approval

1. Add `clientId` to `~/.config/digicampus/config.json`
2. Document in `docs/OAUTH.md`
3. Test `digicampus login --oauth`

## References

- [docs/OAUTH.md](../../docs/OAUTH.md)
- Stud.IP OAuth2 documentation
