# Where a client label rides — LLM providers and the proxies in front of them

Research for #223. Date of research: 2026-08-04.

**The question.** A MakeKeeper provider connection will carry one human-written label plus a
cumulative detail switch (connection / + user / + project), composed into a human-readable string
like `makekeeper-prod/ivan/kitchen-remodel`. MakeKeeper picks the transport per provider type; the
end user never configures a header name. Which field does each target actually read, and does the
value ever become visible to the operator — in a log, in a spend report, in a dashboard?

MakeKeeper's provider types are `gemini | openai | anthropic | ollama | custom`
(`libs/plugin-chat/src/backend/providers.dto.ts`), where `custom` is an OpenAI-compatible base URL —
which is where a LiteLLM or Aperture endpoint lands today. All outbound calls are made with raw
`fetch` in `libs/plugin-chat/src/backend/llm-client.ts`, so MakeKeeper controls both headers and
body completely; no SDK sits in the way to strip an unknown header or field.

---

## Short answer

| Target | Recommended transport | Surfaces in log? | Surfaces in spend/usage report? |
|---|---|---|---|
| **LiteLLM proxy** | `x-litellm-tags: <label>` (header) | **Yes** — `LiteLLM_SpendLogs.request_tags` | **Yes** — `LiteLLM_DailyTagSpend`, `/tag/info`, Tag Management UI, tag budgets |
| **Tailscale Aperture** | any custom header, e.g. `x-makekeeper-label: <label>` | **Yes, always captured** in the request capture (headers are stored) | **Only if** the tailnet admin adds the header to `database.headers.filterable`; otherwise not queryable |
| **OpenAI `/v1/chat/completions`** | `user` (still accepted; officially "being replaced") | Not exposed to the customer | **No** — not a documented Usage API dimension |
| **OpenAI, forward-looking** | `prompt_cache_key` (routing) + `safety_identifier` (abuse) | No | **No** |
| **OpenAI-compatible gateways** | `user` — but most **accept and discard** it | LiteLLM: yes (`end_user`). vLLM/Ollama/Gemini-compat: no | LiteLLM: yes; others: no |
| **Anthropic Messages API** | `metadata.user_id` — **but see the constraint** | Not exposed to the customer | **No** — Usage/Cost API cannot group by it |
| **Google Gemini (Developer API)** | **nothing exists** | — | — |
| **Google Gemini (Vertex AI)** | `labels` map, **but** value charset excludes `/` | Not documented | **Yes** — Cloud Billing reports / BigQuery billing export |
| **Ollama `/api/chat`** | **nothing exists** | — | — |

Read the table with this in mind: the two proxies are the only targets where the label reaches a
human who cares. For the four direct providers, a per-request label is at best accepted and at worst
forbidden — and in **no** direct-provider case does it show up in a spend report.

---

## Verdict on the open design question

**A user-configurable custom header name is needed as an escape hatch — but only one, and only for
the proxy case.** No single sanctioned field covers every target.

The reasoning, in order of how much it costs to be wrong:

1. **LiteLLM needs no escape hatch.** `x-litellm-tags` is a first-class, documented, spend-tracked
   dimension. Hard-code it for `custom` connections and it just works.
2. **Aperture forces the hatch.** Aperture has *no* per-request label concept at all. Its one
   client-controlled dimension is an arbitrary HTTP header that **the tailnet admin names** in
   `database.headers.filterable`. MakeKeeper cannot know that name — the operator picks it. If
   MakeKeeper hard-codes `x-makekeeper-label` and the operator has indexed `x-client` instead, the
   label is captured but not filterable, and the whole feature is invisible in exactly the product
   whose selling point is attribution. This is the case the hatch exists for.
3. **Direct providers must not use the hatch.** Anthropic and OpenAI both instruct that their
   identifier fields carry *opaque* values (see below). Vertex `labels` rejects `/` outright. Sending
   `makekeeper-prod/ivan/kitchen-remodel` to Vertex is an API error, not a degraded experience.

**Recommended shape.** Per connection: the label, the detail switch, and one optional advanced field
"custom header name" (empty by default). Transport selection:

- `custom` / OpenAI-compatible: send `x-litellm-tags: <label>` **and** `user: <label>` in the body.
  Both are ignored by proxies that do not understand them; LiteLLM records both (as `request_tags`
  and as `end_user`). If the custom header name is filled in, send that header too.
- `openai`: `user: <label>`. Do **not** put the label in `safety_identifier`.
- `anthropic`: leave `metadata.user_id` alone unless the label is known to be non-identifying; it
  surfaces nowhere anyway, so the honest default is "off for direct Anthropic".
- `gemini`: nothing to send on the Developer API. On Vertex, only if the label is slugified to the
  Vertex charset — a separate decision, not this one.
- `ollama`: nothing to send.

So: the escape hatch is real and load-bearing, but it is an *advanced, usually-empty* field whose
only documented consumer is Aperture. The end user is not asked to configure a header name in the
normal path — the promise in the design holds.

---

## LiteLLM proxy

The best-supported target by a wide margin. LiteLLM offers five independent attribution slots, and
the important thing is that they do **not** all persist the same way.

### Tags — the intended mechanism

Three interchangeable places, per
[Request Tags for Spend Tracking](https://docs.litellm.ai/docs/proxy/request_tags):

```bash
# (a) header — comma-separated, no body rewrite
curl http://0.0.0.0:4000/v1/chat/completions \
  -H 'Authorization: Bearer sk-1234' \
  -H 'x-litellm-tags: makekeeper-prod/ivan/kitchen-remodel' \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}'

# (b) body, top-level array
{"model":"gpt-4o","messages":[...],"tags":["makekeeper-prod"]}

# (c) body, nested under metadata
{"model":"gpt-4o","messages":[...],"metadata":{"tags":["makekeeper-prod"]}}
```

- The header is documented as `x-litellm-tags`, `Optional[str]`, "a comma separated list
  (e.g. `tag1,tag2,tag3`) of tags", used "for tag-based routing OR spend-tracking" —
  [Request Headers](https://docs.litellm.ai/docs/proxy/request_headers).
- Precedence when several sources are present: request body > header > config tags —
  [Request Tags](https://docs.litellm.ai/docs/proxy/request_tags).
- **No documented length or charset constraint on a tag value.** A slash is not called out as
  problematic. *(Absence of a documented constraint is not a guarantee — untested.)*
- **Surfaces in the log:** stored in `LiteLLM_SpendLogs.request_tags` —
  [Request Tags](https://docs.litellm.ai/docs/proxy/request_tags),
  [`schema.prisma`](https://github.com/BerriAI/litellm/blob/main/schema.prisma).
- **Surfaces in spend:** aggregated into `LiteLLM_DailyTagSpend`; readable via `/tag/info`; tag
  budgets are set from `/tag/new` or the Admin UI's **Tag Management** page —
  [Setting Tag Budgets](https://docs.litellm.ai/docs/proxy/tag_budgets).
- Related knob: `litellm_settings.extra_spend_tag_headers: ["x-custom-header"]` promotes *any* named
  custom header's value into `request_tags` — [Request Tags](https://docs.litellm.ai/docs/proxy/request_tags).
  This is a second, operator-side path that a MakeKeeper custom header would also satisfy.

### The `user` body field → tracked end user

Documented resolution order for the customer/end-user id, per
[Customers / End-Users](https://docs.litellm.ai/docs/proxy/customers): `x-litellm-customer-id`
header, then `x-litellm-end-user-id` header, then the `user` body field, then `litellm_metadata.user`,
then `metadata.user_id`.

```bash
curl 'http://0.0.0.0:4000/chat/completions' \
  -H 'Authorization: Bearer sk-1234' \
  -d '{"model":"llama3","messages":[{"role":"user","content":"test"}],"user":"palantir"}'
```

- The value lands in the `end_user` column of the spend log — "Customer - the `user` sent in the
  request" — [Spend Tracking](https://docs.litellm.ai/docs/proxy/cost_tracking).
- It is **upserted** into a customer record: "The customer_id will be upserted into the DB with the
  new spend. If the customer_id already exists, spend will be incremented" —
  [Customers](https://docs.litellm.ai/docs/proxy/customers). Worth noting for MakeKeeper: a label
  with a per-project detail level will create one customer row per project.
- Readable via `GET /customer/info?end_user_id=…` — [Customers](https://docs.litellm.ai/docs/proxy/customers).
- Note the semantic split the docs insist on: `user` in the body is the **end user / customer**;
  the `user` column in the spend log is the **internal user who owns the key**. Different columns.

### Arbitrary body `metadata` — mostly NOT persisted

The spend-log `metadata` column is not a dump of whatever you sent. The sanctioned slot for
free-form JSON is `x-litellm-spend-logs-metadata` (a JSON string) or
`metadata.spend_logs_metadata` — [Request Headers](https://docs.litellm.ai/docs/proxy/request_headers),
[Spend Tracking](https://docs.litellm.ai/docs/proxy/cost_tracking), where it is described as an
enterprise feature. A bare `{"metadata": {"my_client": "foo"}}` reaches callback logging but is not
a spend-table column. *(The whitelist behaviour is visible in
[`spend_tracking_utils.py`](https://github.com/BerriAI/litellm/blob/main/litellm/proxy/spend_tracking/spend_tracking_utils.py);
I did not read the file line-by-line — medium confidence on the exact key list, high confidence on
"arbitrary metadata is not a spend column", which the docs' insistence on `spend_logs_metadata`
implies.)*

### Custom headers from a named header

`general_settings.user_header_mappings` maps a named request header onto a LiteLLM user role —
e.g. `X-OpenUI-User-Id` → `internal_user`, `X-OpenWebUI-User-Email` → `customer` —
[Open WebUI tutorial](https://docs.litellm.ai/docs/tutorials/openweb_ui). This is operator-side
config naming a header, the same shape as Aperture's indexed headers.

### Forwarding upstream

Arbitrary `x-*` headers are forwarded to the upstream provider only when
`forward_client_headers_to_llm_api` is enabled —
[Request Headers](https://docs.litellm.ai/docs/proxy/request_headers). Off by default, which means a
MakeKeeper custom header is normally consumed by the proxy and does not reach OpenAI/Anthropic. That
is the desired behaviour here.

### Virtual keys / teams

`key_alias`, `team_id` and `organization_id` are per-key, not per-request, but they are the cheapest
attribution of all if one MakeKeeper connection = one virtual key. Tags can also be pinned to a key
or team so every request inherits them — [Setting Tag Budgets](https://docs.litellm.ai/docs/proxy/tag_budgets).

---

## Tailscale Aperture

**Headline: Aperture attributes by Tailscale identity, not by request content. There is no
per-request label, tag, or project field — nothing equivalent to `x-litellm-tags`.**

### Identity comes from the tailnet, not the request

> "When a request arrives at Aperture, the proxy queries Tailscale with the remote IP address.
> Tailscale responds with the user's login name (for example, `alice@example.com`), a persistent
> device identifier, and any tags assigned to that device."
> — [How Aperture works](https://tailscale.com/docs/aperture/how-aperture-works)

The same page notes this identity is trustworthy precisely because "it comes from Tailscale's
control plane, not from the client", that "every metric record includes the login name and device
ID", and that a tagged device with no user account gets a synthetic identity built from its ACL tags
(e.g. `tag:api,tag:prod`). Those are **tailnet ACL tags set in policy**, not request tags.

Consequences for the design: for a MakeKeeper instance sitting on a tailnet, Aperture already knows
*which machine* the traffic came from. It cannot know *which MakeKeeper user* or *which project* —
one MakeKeeper server is one Tailscale node. So an in-request label is **complementary, not
redundant**: it supplies exactly the detail levels (user, project) that Tailscale identity cannot.

### The one client-controlled dimension: indexed headers

Aperture always captures request headers, but they are inert until indexed:

```json
{
  "database": {
    "headers": {
      "filterable": [
        { "name": "x-request-id" },
        { "name": "user-agent" },
        { "name": "authorization", "redact_values": true }
      ]
    }
  }
}
```

- "Header name to index. Case-insensitive, and applied to both the request and response hops."
  `redact_values` (default false): "Aperture stores only the header's presence, never its value."
  — [Aperture configuration reference](https://tailscale.com/docs/aperture/configuration)
- Each indexed header "becomes a queryable index on that header's name and values, so you can filter
  by header presence or value on any dashboard page that supports filtering" — same page.
- Indexing alone is not enough: a caller can use the filter "only when a grant assigns it through the
  `filterable_headers` capability" — same page.
- The dashboard reference confirms the filter surface: "When header filtering is configured, you can
  also filter this page by indexed request and response headers", on My Dashboard and Usage
  Overview — [Aperture dashboard reference](https://tailscale.com/docs/aperture/reference/dashboard).
  The same page's dimension list is otherwise Tailscale identity, model/provider, and date; it makes
  **no mention of custom client-supplied labels**.

So a MakeKeeper header **is** captured unconditionally and **becomes queryable** the moment the
operator indexes it — but the operator chooses the name. Hence the escape hatch.

### Where the label would show up even without indexing

The S3 session-log export record contains `id`, `ver`, `timestamp`, `identity`, `model`, `api_type`,
`usage`, `estimated_cost`, `duration_ms`, `capture_id`, `session_id`, `path`, `status_code`, and a
`capture` object that includes "headers, processed JSON bodies, tool use data, and, optionally, raw
binary request and response bodies" —
[Export usage data to S3](https://tailscale.com/docs/aperture/how-to/export-usage-data-to-s3).
`identity` is "login name, stable node ID, and tags"; there is **no dedicated label field**.

The dashboard Logs page "groups related requests into sessions, letting you trace the flow of a
conversation or coding task by reviewing full request and response data" —
[Observe and export AI usage](https://tailscale.com/docs/aperture/observe-and-export).

### API shape

Aperture accepts OpenAI `/v1/chat/completions` and `/v1/responses`, Anthropic `/v1/messages`, the
Gemini API, Vertex AI, and Bedrock —
[Provider compatibility reference](https://tailscale.com/docs/aperture/provider-compatibility). That
page documents `add_headers` on a provider — headers *Aperture* adds when calling upstream — but
says nothing about stripping or rewriting client-supplied fields.

---

## OpenAI / OpenAI-compatible `/v1/chat/completions`

```jsonc
{
  "model": "gpt-4o",
  "messages": [...],
  "user": "makekeeper-prod/ivan/kitchen-remodel",   // still accepted
  "prompt_cache_key": "makekeeper-prod",             // the routing successor
  "safety_identifier": "<hash>"                      // the abuse-detection successor
}
```

The current SDK type definitions are unambiguous about the split
([`openai-python`, `completion_create_params.py`](https://github.com/openai/openai-python/blob/main/src/openai/types/chat/completion_create_params.py)):

- **`user`** — "This field is being replaced by `safety_identifier` and `prompt_cache_key`. Use
  `prompt_cache_key` instead to maintain caching optimizations. A stable identifier for your
  end-users." Still present in the request type; described as being replaced, **not** removed. It is
  **not** listed on the [Deprecations](https://developers.openai.com/api/docs/deprecations) page —
  the deprecation lives in the parameter description, not the formal deprecation schedule.
- **`safety_identifier`** — "A stable identifier used to help detect users of your application that
  may be violating OpenAI's usage policies. The IDs should be a string that uniquely identifies each
  user, **with a maximum length of 64 characters**. We recommend hashing their username or email
  address, in order to avoid sending us any identifying information." The safety-best-practices
  guide repeats it: "Hash the username or email address in order to avoid sending us any identifying
  information" — [Safety best practices](https://developers.openai.com/api/docs/guides/safety-best-practices).
  **This is the wrong home for a human-readable label**, by explicit instruction.
- **`prompt_cache_key`** — "Used by OpenAI to cache responses for similar requests to optimize your
  cache hit rates. Replaces the `user` field." The caching guide gives the example value
  `"tenant:acme:knowledge-base-v1"` — a human-readable, slash-free, colon-separated slug — and warns
  to "keep the total traffic across all prefixes for each key to approximately 15 requests per
  minute. If a key receives a higher rate, some requests may miss the cache" —
  [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).
  A per-project label is therefore *shape-compatible* with `prompt_cache_key`, but putting a label
  there changes cache routing — a functional side effect, not a free ride.

### Does it surface?

**No, not for the customer.** The documented grouping dimensions of the organization Usage API
(`/v1/organization/usage/completions`) are `project_id`, `user_id`, `api_key_id`, and `model`, and the
result rows carry those same fields —
[Usage: completions](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/completions)
*(reached via search result summary; the page itself 404'd/403'd for direct fetch — see "Not
established")*. Nothing in the docs indicates the request-body `user` or `safety_identifier` string
appears as a usage dimension. `safety_identifier` is described as feeding OpenAI's abuse detection
and, per the Safety dashboard, showing *blocked* requests — not general usage attribution.

**OpenAI's own attribution mechanism is Projects**, not a request field: scope an API key to a
project and group usage by `project_id`. That is org-side setup, invisible to MakeKeeper.

### Where else `user` surfaces

**Azure OpenAI is the one place the `user` field is genuinely displayed back to you.** Azure's
"potentially abusive user detection" pane lists a **UserGUID** column, described as "sent by the
customer through `user` field in Azure OpenAI APIs", alongside an abuse score and category counts.
It requires a content-filter config and your own Azure Data Explorer database, and Microsoft's own
caution is "Use GUID strings to identify individual users. Don't include sensitive personal
information in the *user* field" —
[Microsoft Learn: risks & safety monitoring](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/risks-safety-monitor).
Again an abuse surface, not a usage surface, and again a rule against human-readable values.

For OpenAI proper, `safety_identifier` has one narrow display surface: the Safety dashboard,
introduced 2026-06-23 — "The Safety dashboard shows blocked Responses requests based on
`safety_identifier` values sent on requests to identify end users"
([changelog](https://developers.openai.com/api/docs/changelog)). **Blocked requests only**, console
only, no API. Not usage attribution.

### Do OpenAI-compatible gateways pass `user` through?

**Mostly no — the norm is accept-and-discard.** This corrects a natural assumption:

- **vLLM** declares the field with the comment `# NOTE this will be ignored by vLLM` above
  `user: str | None = None` —
  [`vllm/entrypoints/openai/chat_completion/protocol.py`](https://github.com/vllm-project/vllm/blob/main/vllm/entrypoints/openai/chat_completion/protocol.py).
- **Ollama's OpenAI-compatibility layer** has no `user` field on `ChatCompletionRequest` at all —
  [`openai/openai.go`](https://github.com/ollama/ollama/blob/main/openai/openai.go).
- **Gemini's OpenAI-compatibility layer** states that parameters not listed "will be silently
  ignored by the compatibility layer" — [OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai).
- **LiteLLM** is the exception that matters: it both records `user` as `end_user` *and* translates it
  onward — "LiteLLM translates the OpenAI `user` param to Anthropic's `metadata[user_id]` param" —
  [LiteLLM Anthropic provider docs](https://docs.litellm.ai/docs/providers/anthropic).

The practical reading: sending `user` costs nothing and is recorded by the one gateway that matters
here (LiteLLM), but it must not be relied on as a universal carrier.

---

## Anthropic Messages API

```jsonc
{
  "model": "claude-sonnet-5",
  "max_tokens": 1024,
  "messages": [...],
  "metadata": { "user_id": "..." }
}
```

From the [Messages API reference](https://platform.claude.com/docs/en/api/messages):

> `metadata` — "An object describing metadata about the request."
> `user_id` — "An external identifier for the user who is associated with the request. This should
> be a uuid, hash value, or other opaque identifier. Anthropic may use this id to help detect abuse.
> **Do not include any identifying information such as name, email address, or phone number.**"

Two things follow. First, the field is explicitly meant to be **opaque** — a human-readable
`makekeeper-prod/ivan/kitchen-remodel` runs against its documented purpose, and if the label's
`+user` detail level carries a real username it violates the rule outright. Second:

**No documented maximum length.** A 256-character limit is very widely repeated by third-party
write-ups, but it appears on no Anthropic-owned page I could render, and the SDK types state no
constraint — [`messages.ts`](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/messages/messages.ts).
Do not code against 256 as if it were documented.

There is also a beta header `anthropic-user-profile-id` — "the user profile ID to attribute this
request to", for acting on behalf of a party other than your organization, gated behind the
`user-profiles` beta header. It is the closest thing Anthropic has to a genuine attribution header,
but it is beta and semantically about acting-on-behalf-of, not about labelling your own traffic.

**It does not surface in the spend report.** The Usage & Cost Admin API filters and groups by "API
key, workspace, model, service tier, context window, data residency, or speed" — and the Cost API
groups "by workspace or description"
([Usage and Cost API](https://platform.claude.com/docs/en/api/usage-cost-api)). `metadata.user_id`
is not among them. Anthropic's own answer to cost attribution is **workspaces and API keys**
("Cost attribution: allocate expenses by workspace for chargebacks", same page).

I found no documentation that `metadata.user_id` is visible to the customer anywhere — not in the
Console, not in the Usage API, not in an export. Treat it as write-only from MakeKeeper's point of
view.

---

## Google Gemini `generateContent`

**Two different APIs, two different answers.**

**Gemini Developer API** (`generativelanguage.googleapis.com`, which is MakeKeeper's `gemini`
default): the documented `GenerateContentRequest` body fields are `contents`, `tools`, `toolConfig`,
`safetySettings`, `systemInstruction`, `generationConfig`, `cachedContent`, `serviceTier`, and
`store` — [Generating content](https://ai.google.dev/api/generate-content). **There is no `labels`,
`metadata`, or `user` field.** Nothing to send.

And you cannot smuggle one in: Google's APIs parse request bodies with ProtoJSON, whose specified
default is that "the protobuf JSON parser should reject unknown fields by default"
([protobuf.dev, ProtoJSON format](https://protobuf.dev/programming-guides/json/)). An extra field is
an error, not a no-op.

**Vertex AI** (`generateContent` under `projects.locations.publishers.models`): there *is* a
top-level `labels` map — "user-defined metadata for the request… used for billing and reporting
only" — [Custom metadata labels](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/add-labels-to-api-calls),
[`generateContent` reference](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1/projects.locations.publishers.models/generateContent).

```jsonc
{
  "contents": [...],
  "labels": { "client": "makekeeper_prod", "project": "kitchen_remodel" }
}
```

Constraints — and they matter for this design. The authoritative statement is in Google's own
proto, [`google/cloud/aiplatform/v1/prediction_service.proto`](https://github.com/googleapis/googleapis/blob/master/google/cloud/aiplatform/v1/prediction_service.proto):

```protobuf
// Optional. The labels with user-defined metadata for the request. It is used
// for billing and reporting only.
//
// Label keys and values can be no longer than 63 characters
// (Unicode codepoints) and can only contain lowercase letters, numeric
// characters, underscores, and dashes. International characters are allowed.
// Label values are optional. Label keys must start with a letter.
map<string, string> labels = 10 [(google.api.field_behavior) = OPTIONAL];
```

- Keys and values: **max 63 Unicode codepoints**.
- **Lowercase letters, digits, underscores and dashes only.** Keys must start with a letter.
- **A `/` is not allowed.** The composed label `makekeeper-prod/ivan/kitchen-remodel` is *invalid*
  as a Vertex label value — it would have to be slugified, or split across several key/value pairs
  (`{"client":"makekeeper_prod","user":"ivan","project":"kitchen_remodel"}`, which the cumulative
  detail switch maps onto rather neatly).
- Labels are documented as available on Google's own models; passing them to a Model Garden partner
  model (Anthropic/Llama/Mistral served through Vertex) is documented to error.

Where it surfaces: **the billing pipeline** — Cloud Billing cost reports and the detailed BigQuery
billing export, whose schema carries `labels.key`/`labels.value` columns
([detailed usage cost data schema](https://docs.cloud.google.com/billing/docs/how-to/export-data-bigquery-tables/detailed-usage)).
This is the only direct-provider target where a client label reaches a cost report. The proto's own
scoping — "used for billing and reporting only" — argues against it appearing in Cloud Logging or
Cloud Monitoring, and neither is documented as a label surface.

*(One residual caveat: the BigQuery billing schema describes labels "on the Google Cloud resource
where the usage occurred". Whether a per-request label lands in `labels` or in `system_labels` is
not documented — verify against a real export before building a cost dashboard on it.)*

---

## Ollama `/api/chat`

**No equivalent exists.** The documented parameters of `POST /api/chat` are `model`, `messages`,
`tools`, `think`, `format`, `options`, `stream`, and `keep_alive` —
[Ollama API docs](https://github.com/ollama/ollama/blob/main/docs/api.md). There is no field for a
client label, user identifier, metadata, or tags, and Ollama has no spend concept to report into.
The `ChatRequest` struct in [`api/types.go`](https://github.com/ollama/ollama/blob/main/api/types.go)
confirms the same field set.

**Unknown fields are silently ignored, not rejected.** The chat handler binds with Gin's
`ShouldBindJSON` ([`server/routes.go`](https://github.com/ollama/ollama/blob/main/server/routes.go)),
which uses Go's `encoding/json` without `DisallowUnknownFields()`. So sending
`{"client_label": "..."}` will not 400 — it simply goes nowhere and nothing logs it. Harmless, and
useless.

If a MakeKeeper `ollama` connection points at something that is *not* Ollama (a
proxy speaking the Ollama protocol), a custom header is the only possible carrier — another small
argument for the escape hatch being a per-connection field rather than a per-provider-type constant.

---

## Not found / unclear — stated plainly

These are the things I could **not** establish. Do not build on them without checking first.

1. **Whether Aperture forwards the OpenAI `user` field, or arbitrary client `x-*` headers, upstream
   to the provider.** Not documented anywhere I could find. The reasonable reading of a reverse proxy
   is that the body travels unchanged, but Aperture's docs never say so. Unverified.
2. **~~Whether OpenAI's Usage API `user_id` means the org member or the request-body `user`.~~
   Resolved: it is the organization member.** The Admin API's `user` object "represents an individual
   user within an organization", with ids shaped `user_abc`, plus `email`, `name` and `role` —
   [List users](https://developers.openai.com/api/reference/python/resources/admin/subresources/organization/subresources/users/methods/list).
   The Costs endpoint (`/v1/organization/costs`) groups only by `project_id`, `line_item` and
   `api_key_id` — no user dimension at all. Neither `user`, `safety_identifier` nor
   `prompt_cache_key` appears anywhere in a Usage or Costs response. *(I could not fetch these
   reference pages directly — `platform.openai.com` 403s and the `developers.openai.com` deep links
   404 to automated fetch — so this rests on search-rendered summaries of the official reference.
   Medium-high confidence; the conclusion is consistent across every source.)*
3. **Whether unknown body fields are rejected by OpenAI and Anthropic.** Both are reported to return
   400 on unrecognized arguments, but I found **no primary documentation** stating it — OpenAI's
   error text is only reproduced in forums and
   [openai-python#1354](https://github.com/openai/openai-python/issues/1354), and Anthropic's
   [errors page](https://platform.claude.com/docs/en/api/errors) documents `invalid_request_error`
   only generically. **Lower confidence.** Relevant because it means an invented custom body field is
   not a safe no-op on those two providers — unlike on Ollama, where it verifiably is.
4. **Whether `metadata.user_id` is visible anywhere in the Anthropic Console.** I established it is
   absent from the Usage/Cost Admin API dimensions. I found no positive documentation of it being
   displayed anywhere else, but "no documentation of it" is weaker than "documented as invisible".
5. **Any documented maximum length for Anthropic's `metadata.user_id`.** The widely-repeated 256
   characters appears on no Anthropic-owned page I could render and in no SDK type. Treat as
   **unverified folklore**, not a constraint.
6. **Exact character constraints on a LiteLLM tag value.** None documented. Whether a `/` in a tag
   survives routing, budget matching and the UI is untested. If MakeKeeper's composed label uses `/`,
   this is worth a five-minute test against a local LiteLLM before shipping.
7. **The LiteLLM spend-log `metadata` whitelist.** I did not read
   `spend_tracking_utils.py` line-by-line; the claim that arbitrary body `metadata` is dropped from
   the spend table rests on the docs directing you to `spend_logs_metadata` for that purpose.
   Medium confidence.
8. **Whether `/spend/tags` (as distinct from `/tag/info`) is enterprise-gated.** The tag-budget docs
   document `/tag/info` and the Tag Management UI; I did not confirm the licensing of the older
   `/spend/tags` endpoint from primary docs.
9. **Aperture has no public source repository** I could find; everything above rests on
   tailscale.com documentation, which for this product is thin but — on the header-indexing point,
   which is the one that matters — explicit and adequate.
