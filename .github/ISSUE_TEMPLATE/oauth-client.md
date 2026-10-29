---
name: OAuth2 client registration
about: Request Stud.IP OAuth2 client from university IT (RZ)
title: "[OAuth] Register client for ImStudium CLI"
labels: enhancement
---

## University

- [ ] Uni Augsburg
- [ ] Other: ___

## Purpose

ImStudium needs an OAuth2 PKCE client for non-interactive auth (`imstudium login --oauth`).

## Request details for RZ

| Field | Value |
|-------|-------|
| Application name | ImStudium |
| Redirect URI | `http://127.0.0.1:8745/callback` |
| Grant type | Authorization Code + PKCE |
| Scope | Stud.IP API access (same as web session) |
| Homepage | https://github.com/ImStudium/imstudium |

## After approval

1. Add `clientId` to `~/.config/imstudium/config.json`
2. Document in `docs/OAUTH.md`
3. Test `imstudium login --oauth`

## References

- [docs/OAUTH.md](../../docs/OAUTH.md)
- Stud.IP OAuth2 documentation
