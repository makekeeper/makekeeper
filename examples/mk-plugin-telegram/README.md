# mk-plugin-telegram — workshop events in your own chat

One bot for the instance, one chat per person. Messages about the workshop go
to the person who asked for them and to nobody else.

## Why this example exists

- **Notifications belong to a person, not to an instance.** A chat is filed
  under the opaque `userRef` (contract 1.4): two people in one workspace get
  their own messages, and the plugin cannot tell who either of them is.
- **A public route that a person, not the core, calls.** Every message carries
  an unsubscribe link. It hits the plugin's own unsigned `/unsubscribe` route
  and works from the chat client — no account, no login, one token that
  authorizes exactly one thing.
- **A capability other plugins call.** `telegram.notify` lets a printer plugin
  say "your print finished" without knowing what Telegram is. With this plugin
  absent the call resolves to nothing and the caller carries on.
- **A `WRITE` agent tool.** `send_me_a_message` reaches out of the app and into
  someone's phone, so the runtime gates it behind the user's confirmation.
- **A domain-event subscriber.** The manifest subscribes to
  `logistics.order.received` and asks for `logistics:read` — the pair is the
  point: hearing an owner's event requires the grant that reads its data, and
  without the grant the subscription is inert. The handler re-reads the order
  through the scoped surface and quotes only what it read; a delivery that
  cannot be verified sends nothing. (Upgrading from 0.1.x: the new permission
  needs the admin's re-consent before events flow.)

## Long polling, not a webhook

A webhook needs this container reachable from the public internet, which a
workshop's plugin container generally is not. Telling people to expose it would
be worse advice than one held-open HTTP connection. The unsubscribe route is
public because a chat client must reach it — that one is a link a person
clicks, not a callback.

## Setting it up

1. Create a bot with **@BotFather** and copy the token it gives you.
2. Open **Settings → External plugins**, expand this plugin's card, paste the
   token and press **Check the token**. Only a token Telegram accepted is
   stored — checking one and keeping another is the trap the flow avoids.
3. Optionally fill in the plugin's public URL; without it messages simply carry
   no unsubscribe link.
4. Every person then opens **Telegram** in the sidebar, presses *Get a code*,
   and sends that code to the bot.

Codes live in memory only, expire in ten minutes, are one-shot, and identify
the person who asked — the chat comes from the message that carried it.

## Run it

```bash
./examples/run-plugin.sh examples/mk-plugin-telegram --core http://localhost:3000
npm --prefix examples/mk-plugin-telegram test
```
