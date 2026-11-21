# Security Policy

## Supported Versions

DEPLO is in early development. Security fixes are applied to the latest
development version on the default branch.

## Reporting a Vulnerability

Please do not publish exploitable vulnerability details in a public issue.

Use GitHub's **Report a vulnerability** feature in the repository's
Security tab when private vulnerability reporting is enabled. If that feature
is unavailable, contact the repository owner privately through GitHub.

Include:
- A description of the issue and its potential impact.
- Steps to reproduce or a proof of concept that does not access other
  people's data.
- Affected commits, files, or versions, if known.

Please allow maintainers reasonable time to investigate and prepare a fix
before public disclosure.

## Security Notes

- Never commit secrets or production credentials.
- Treat uploaded archives and repository contents as untrusted input.
- Do not run customer-provided code without isolation, resource limits,
  and appropriate access controls.
- The current dashboard is a prototype and is not yet a production hosting
  service.
