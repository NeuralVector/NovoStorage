# NovoStorage beginner code tour

This branch adds explanatory comments to the source code. This document gives the
larger picture before you read individual files.

## How a request moves through the application

1. `src/server.ts` starts the process.
2. `src/app.ts` creates Nest and configures Fastify.
3. `src/app.module.ts` registers controllers and providers.
4. A controller in `src/controllers/` receives an HTTP request.
5. The controller asks an abstraction in `src/services/` to do the work.
6. A service talks to PostgreSQL, Clerk, or S3.
7. The controller returns JSON, a stream, a redirect, or an HTML page.

The important design idea is that controllers describe HTTP behavior while services
hide external systems. For example, `FilesController` depends on `ObjectStorage`,
not directly on the `S3Client` class.

## Server-side TypeScript

- `interface` describes the shape of an object without creating a runtime object.
- `type` is another way to name a TypeScript type.
- `async` means a function returns a `Promise`.
- `await` pauses that function until a promise completes.
- `Promise<T>` means the eventual result has type `T`.
- `@Controller()` and `@Get()` are Nest decorators. They attach routing metadata
  to a class or method.
- `@Inject(TOKEN)` tells Nest which provider should be passed to a constructor.
- `private readonly` means a class property is only usable inside the class and
  cannot be reassigned after construction.

## Frontend TypeScript

`src/frontend/dashboard.ts` runs in the browser. It uses the DOM directly:

- `document.querySelector()` finds an HTML element.
- `addEventListener()` runs a function when something happens, such as a click.
- `fetch()` makes an HTTP request to the backend.
- `response.json()` reads a JSON response.
- `createElement()` creates an element in memory.
- `append()` adds that element to the page.
- `hidden` controls whether an element is visible.

The dashboard keeps its current UI state in variables such as `storageItems`,
`currentPath`, and `selectedItem`. Whenever state changes, it calls a render
function to update the visible HTML.

## HTML and CSS

HTML provides the page structure and named elements such as `#file-rows`.
TypeScript finds those names later using CSS selectors.

CSS selectors describe which elements receive styles:

```css
.file-row {
	/* Every element with class="file-row". */
	border-bottom: 1px solid #ddd;
}

#file-rows {
	/* The one element with id="file-rows". */
	display: grid;
}
```

An HTML `class` is reusable. An HTML `id` should identify one specific element.

## Authentication flow

The browser goes to `/login`. `LandingController` asks `ClerkAuthOperations` to
redirect to Clerk's Account Portal and includes a `redirect_url`. Clerk authenticates
the user and sends the browser back to that URL with a temporary handoff parameter.
The root controller recognizes that handoff and sends the browser to the dashboard.

The server still authenticates every protected API request independently. A browser
being on the dashboard is not enough to authorize an API request.

## File flow

Uploads are streamed from Fastify to the application and then to S3. The application
reserves quota before uploading and releases the reservation if the upload fails.
Downloads are streamed in the opposite direction, so the complete file does not need
to be held in memory.

PostgreSQL stores application metadata such as quota counters, share tokens, and
shared-file references. Backblaze stores the file bytes.

## Sharing flow

The owner creates a share token. Another user accepts it. PostgreSQL stores a
reference containing the owner's S3 object key and the recipient's user ID. No file
copy is created. When the recipient downloads the file, the API checks the reference
and streams the owner's object.
