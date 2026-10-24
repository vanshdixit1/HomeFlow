# Security Policy

## Supported use

HomeFlow is currently a self-hosted, single-household application. It is not a multi-tenant SaaS product. Do not expose it publicly until production secrets, TLS, trusted proxy headers, and persistent storage are configured.

The [hosted demo](https://homeflow-taupe-theta.vercel.app) is for evaluation only. Do not enter sensitive information or rely on its ephemeral data.

## Reporting a vulnerability

Please do not open public issues containing credentials, household data, or exploit details. Contact the repository maintainer privately through the contact method listed on the GitHub profile and include a concise impact description and reproduction steps. Do not include live secrets or personal household data.

## Secret handling

- Never commit `.env` files, tokens, passwords, certificates, database files, or local IDE configuration.
- Keep Bedrock disabled unless you intentionally configure AWS access and accept possible usage charges.
- Rotate any credential that may have been exposed; removing it from a later commit does not revoke it.
