# Scope and maintenance

Version 0.6.0 combines the CDP execution engine, managed sessions, standalone Windows shell and Browser Intelligence. See [CHANGELOG](../CHANGELOG.md) for delivered behavior.

The repository is useful as a standalone local tool and a browser-automation teaching example. It can coexist with other agent browsers; installing it does not configure another browser or move accounts between products.

Current limits are documented in the README: the desktop installer targets Windows x64, native managed executable defaults target Windows, and cross-platform desktop workflows have not been validated. Website compatibility depends on the page's DOM, browser configuration and account authorization.

Changes should be driven by reproducible issues or actual workflow needs. Keep tests and examples local, and keep personal profiles, real task records and machine-specific launch configuration out of public commits.
