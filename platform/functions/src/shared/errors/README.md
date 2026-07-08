# shared/errors/

`PlatformError` base class and named subclasses.

Callers throw a named `PlatformError` subclass. Callable-function boundaries translate these into `HttpsError`; trigger boundaries log them structurally.
