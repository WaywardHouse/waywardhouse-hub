/**
 * CF Pages catch-all Function — transparent proxy for content sub-sites.
 *
 * CF Pages invokes this Function for any path that doesn't exactly match a
 * static asset.  For paths like /essays/fire-country (no static file) the
 * Function proxies to the appropriate *.pages.dev sub-site.
 *
 * For the hub-owned listing pages (/essays/, /signals/) we set
 * hubOwnsRoot: true — those exact paths fall through to context.next() so
 * the Astro-built static file (dist/essays/index.html etc.) is served.
 *
 * Note: _redirects 200 proxy rules are silently ignored on *.pages.dev
 * domains; this Function is the correct mechanism for cross-origin proxying
 * in Cloudflare Pages.
 */

const PROXY_ROUTES = [
  // Hub has its own listing page for essays and signals — only proxy subpaths.
  // isBook: false — Quarto website projects use src="site_libs/..." (no ../),
  // so the browser URL must NOT have a trailing slash (see redirect below).
  { prefix: '/essays/',                   backend: 'https://wh-essays.pages.dev',                    hubOwnsRoot: true,  isBook: false },
  { prefix: '/signals/',                  backend: 'https://wh-signals.pages.dev',                   hubOwnsRoot: true,  isBook: false },

  // Books: no hub page exists — proxy everything including the root.
  // isBook: true — Quarto book projects use src="../site_libs/..." (with ../),
  // so the browser URL MUST have a trailing slash for the relative path to
  // resolve to /prefix/site_libs/ instead of /site_libs/.
  { prefix: '/computational-geography/', backend: 'https://wh-computational-geography.pages.dev', hubOwnsRoot: false, isBook: true },
  { prefix: '/mathematics/',             backend: 'https://wh-mathematics.pages.dev',             hubOwnsRoot: false, isBook: true },
  { prefix: '/math-for-data-science-ai/', backend: 'https://wh-math-ds-ai.pages.dev',            hubOwnsRoot: false, isBook: true },
  { prefix: '/data-engineering/',        backend: 'https://wh-data-engineering.pages.dev',       hubOwnsRoot: false, isBook: true },
  { prefix: '/systems-thinking/',        backend: 'https://wh-systems-thinking.pages.dev',       hubOwnsRoot: false, isBook: true },
  { prefix: '/gearlab/',                 backend: 'https://wh-gearlab.pages.dev',                hubOwnsRoot: false, isBook: true },
];

// Legacy /learn/<slug> paths — redirect to the canonical path without the prefix.
// These rules live here (not _redirects) because the catch-all Function intercepts
// all requests before _redirects is evaluated.
const LEARN_REDIRECT_MAP = {
  '/learn/computational-geography': '/computational-geography',
  '/learn/mathematics':             '/mathematics',
  '/learn/math-for-data-science-ai': '/math-for-data-science-ai',
  '/learn/data-engineering':        '/data-engineering',
  '/learn/systems-thinking':        '/systems-thinking',
  '/learn/gearlab':                 '/gearlab',
};

export async function onRequest(context) {
  const url  = new URL(context.request.url);
  const path = url.pathname;

  // /learn/<slug>[/...] → /<slug>[/...]
  if (path.startsWith('/learn/')) {
    for (const [from, to] of Object.entries(LEARN_REDIRECT_MAP)) {
      if (path === from || path === from + '/' || path.startsWith(from + '/')) {
        const rest = path.slice(from.length); // '' | '/' | '/chapter/...'
        return Response.redirect(url.origin + to + rest + (url.search || ''), 301);
      }
    }
  }

  for (const { prefix, backend, hubOwnsRoot, isBook } of PROXY_ROUTES) {
    const base = prefix.slice(0, -1); // '/essays/' → '/essays'

    const isRoot    = path === base || path === prefix;
    const isSubpath = path.startsWith(prefix) && path !== prefix;

    if (!isRoot && !isSubpath) continue;  // no match

    // Hub-owned listing pages (/essays/, /signals/) — let the static file serve.
    if (isRoot && hubOwnsRoot) return context.next();

    if (isSubpath) {
      if (isBook) {
        // Quarto BOOK projects use src="../site_libs/..." (relative with ../),
        // which only resolves correctly when the browser URL is a "directory"
        // (has a trailing slash).  Redirect bare page paths to the slash form.
        // Only redirect paths that look like HTML pages (no file extension) —
        // asset URLs like /site_libs/bootstrap.min.css must not get a slash.
        const hasExtension = /\.[a-zA-Z0-9]+$/.test(path);
        if (!path.endsWith('/') && !hasExtension) {
          return Response.redirect(url.origin + path + '/' + (url.search || ''), 301);
        }
      } else {
        // Quarto WEBSITE projects use src="site_libs/..." (no ../).
        // The browser URL must NOT have a trailing slash so that site_libs/
        // resolves to /prefix/site_libs/ rather than /prefix/slug/site_libs/.
        if (path.endsWith('/')) {
          return Response.redirect(url.origin + path.slice(0, -1) + (url.search || ''), 301);
        }
      }
    }

    // Compute the sub-path to forward to the backend.
    let subpath;
    if (isRoot) {
      subpath = '/';
    } else {
      subpath = '/' + path.slice(prefix.length);
      // For website routes (not books), strip trailing slash: Quarto website
      // projects output slug.html and CF Pages serves at /slug (no slash).
      // For book routes, the trailing slash is preserved because book pages
      // live in directories (getting-started/index.html) and the backend
      // returns 200 for the slash form.
      if (!isBook && subpath.length > 1 && subpath.endsWith('/')) {
        subpath = subpath.slice(0, -1);
      }
    }

    const targetUrl = `${backend}${subpath}${url.search}`;

    const proxied = await fetch(targetUrl, {
      method:  context.request.method,
      headers: {
        'accept':          context.request.headers.get('accept')          ?? '*/*',
        'accept-encoding': context.request.headers.get('accept-encoding') ?? '',
        'accept-language': context.request.headers.get('accept-language') ?? '',
        'user-agent':      context.request.headers.get('user-agent')      ?? '',
        'referer':         context.request.headers.get('referer')         ?? '',
      },
      body: ['GET', 'HEAD'].includes(context.request.method)
        ? undefined
        : context.request.body,
      redirect: 'follow',
    });

    return proxied;
  }

  // Not a proxied path — fall through to static assets / hub 404.
  return context.next();
}
