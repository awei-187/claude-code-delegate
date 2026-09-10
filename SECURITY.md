# Security

Do not include credentials, private repository contents, or raw job logs in public vulnerability reports. Report security issues privately through the publisher channel used for the plugin distribution.

The principal trust boundaries are documented in the skill: Claude receives file tools only; user/managed Claude settings remain trusted inputs; verification runs locally with the helper's OS permissions; and `--restricted` is not an operating-system sandbox.

Before a release, run all automated validators and tests plus one real visible-Windows smoke test. Treat changes to process launching, path containment, cancellation, cleanup, verification arguments, settings handling, or log retention as security-sensitive.
