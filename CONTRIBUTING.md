# Contributing to MakeKeeper

Thanks for your interest in improving MakeKeeper. Please read this before opening a pull request —
contributing means agreeing to the terms below.

## Licensing of contributions

MakeKeeper is multi-licensed (see [`LICENSING.md`](LICENSING.md)). Contributions follow the license
of the file they touch — **inbound = outbound**:

- Changes to the application or first-party plugins (`apps/*`, `libs/plugin-*`) are contributed
  under the **Functional Source License, FSL-1.1-ALv2** ([`LICENSE.md`](LICENSE.md)).
- Changes to the shared SDK libraries (`libs/plugin-contract`, `libs/frontend-core`,
  `libs/backend-core`) are contributed under the **Apache License, Version 2.0**.

### Reserved right to additional licensing

In addition to the inbound = outbound grant above, you agree that the Licensor (DMITRII TITOV, or a
successor entity) **may also license your contribution under other terms**, including commercial
terms, without further notice or compensation. This keeps a commercial/dual-licensing option open
for the project. You confirm you have the right to grant this — i.e. the contribution is your own
work, or you are otherwise entitled to submit it under these terms.

## Developer Certificate of Origin (sign-off)

Every commit must be signed off. Add the `Signed-off-by` trailer with:

```bash
git commit -s -m "type(scope): description"
```

This appends a line matching your Git `user.name` and `user.email`, certifying the Developer
Certificate of Origin, Version 1.1:

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

Pull requests whose commits are not signed off cannot be merged.

## Where your pull request goes

The GitHub repository is a published mirror. Development happens upstream, and each release is
published here as a single snapshot commit that replaces the tree wholesale — so a pull request
merged here would survive as a commit whose content disappears at the next release.

Pull requests are therefore **ported upstream by hand, not merged**, and closed once the change has
landed. The commit that carries it is authored by the release identity; you are credited in its
message. Your sign-off below still governs the licensing of the contribution.

This is worth knowing before you spend an evening on a branch — the route is different, not closed.

## Before you open a pull request

- Follow the conventions in [`CLAUDE.md`](CLAUDE.md) / [`.agents/AGENTS.md`](.agents/AGENTS.md) —
  strict TypeScript, i18n keys for all user- and model-facing text, shared UI primitives, plugin
  boundaries.
- Lint and build the projects you changed (`nx lint <project>`, `nx build <project>`).
- Keep commit messages in the `type(scope): description` form.
