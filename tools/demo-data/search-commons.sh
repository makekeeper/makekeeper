#!/bin/bash
# Prints the top Commons image hits for each query, so a human/agent can pick.
for q in "$@"; do
  echo "### $q"
  curl -s -G "https://commons.wikimedia.org/w/api.php" \
    --data-urlencode "action=query" --data-urlencode "format=json" \
    --data-urlencode "generator=search" --data-urlencode "gsrsearch=$q filetype:bitmap" \
    --data-urlencode "gsrnamespace=6" --data-urlencode "gsrlimit=4" \
    --data-urlencode "prop=imageinfo" --data-urlencode "iiprop=url|size|extmetadata" \
    --data-urlencode "iiurlwidth=1024" \
    -H 'User-Agent: makekeeper-demo-seed/0.1 (local dev)' \
  | jq -r '.query.pages | to_entries | sort_by(.value.index) | .[] | "\(.value.title)\t\(.value.imageinfo[0].thumburl // "-")\t\(.value.imageinfo[0].extmetadata.LicenseShortName.value // "?")"'
  echo
done
