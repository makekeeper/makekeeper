# Docker Hub listings

The published description of each mirrored image (#341). Docker Hub is a discovery
channel — an auto-generated stub there is a wasted first impression — so the text
lives here, in the repository, and is applied to the registry from these files
rather than typed into a web form.

`short.txt` holds the one-line description (Docker Hub caps it at 100 characters);
`app.md` and `web.md` hold the full descriptions. Images are referenced by their
`raw.githubusercontent.com` URL on the public mirror, so they appear on Docker Hub
only after `publish-github` has pushed a snapshot carrying `docs/media/`.

To re-apply after an edit (`$USER`/`$TOKEN` = the same Docker Hub credentials the
release job uses, the token needs write access):

```bash
JWT=$(curl -s -H 'Content-Type: application/json' \
  -d "$(jq -n --arg u "$USER" --arg p "$TOKEN" '{username:$u,password:$p}')" \
  https://hub.docker.com/v2/users/login/ | jq -r .token)
for r in app web; do
  curl -s -X PATCH -H "Authorization: JWT $JWT" -H 'Content-Type: application/json' \
    -d "$(jq -n --rawfile f docs/dockerhub/$r.md --rawfile s docs/dockerhub/short.txt \
          '{full_description:$f, description:($s|rtrimstr("\n"))}')" \
    "https://hub.docker.com/v2/repositories/makekeeper/$r/"
done
```
