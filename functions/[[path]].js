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
  { prefix: '/essays/',                   backend: 'https://wh-essays.pages.dev',                    hubOwnsRoot: true  },
  { prefix: '/signals/',                  backend: 'https://wh-signals.pages.dev',                   hubOwnsRoot: true  },

  // Books: no hub page exists — proxy everything including the root.
  { prefix: '/computational-geography/', backend: 'https://wh-computational-geography.pages.dev', hubOwnsRoot: false },
  { prefix: '/mathematics/',             backend: 'https://wh-mathematics.pages.dev',             hubOwnsRoot: false },
  { prefix: '/math-for-data-science-ai/', backend: 'https://wh-math-ds-ai.pages.dev',            hubOwnsRoot: false },
  { prefix: '/data-engineering/',        backend: 'https://wh-data-engineering.pages.dev',       hubOwnsRoot: false },
  { prefix: '/systems-thinking/',        backend: 'https://wh-systems-thinking.pages.dev',       hubOwnsRoot: false },
  { prefix: '/gearlab/',                 backend: 'https://wh-gearlab.pages.dev',                hubOwnsRoot: false },
];

export async function onRequest(context) {
  const url  = new URL(context.request.url);
  const path = url.pathname;

  for (const { prefix, backend, hubOwnsRoot } of PROXY_ROUTES) {
    const base = prefix.slice(0, -1); // '/essays/' → '/essays'

    const isRoot    = path === base || path === prefix;
    const isSubpath = path.startsWith(prefix) && path !== prefix;

    if (!isRoot && !isSubpath) continue;  // no match

    // Hub-owned listing pages (/essays/, /signals/) — let the static file serve.
    if (isRoot && hubOwnsRoot) return context.next();

    // Sub-paths with a trailing slash get a 301 redirect to the canonical
    // no-trailing-slash URL.  Quarto WEBSITE projects use bare relative paths
    // like src="site_libs/quarto-nav.js" (no leading slash, no ../), which
    // resolve correctly only when the browser URL is NOT a "directory" (i.e.
    // has no trailing slash).  Without this redirect, browsers at
    // /essays/alberta-calling/ resolve site_libs/ inside that directory instead
    // of at /essays/site_libs/ — causing X-Content-Type-Options MIME errors.
    if (isSubpath && path.endsWith('/')) {
      const canonical = url.origin + path.slice(0, -1) + (url.search || '');
      return Response.redirect(canonical, 301);
    }

    // Compute the sub-path to forward to the backend.
    let subpath;
    if (isRoot) {
      subpath = '/';
    } else {
      subpath = '/' + path.slice(prefix.length);
      // Strip trailing slash — Quarto outputs slug.html; CF Pages serves at
      // /slug (no slash).  A trailing slash causes a 308 redirect loop.
      if (subpath.length > 1 && subpath.endsWith('/')) {
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
