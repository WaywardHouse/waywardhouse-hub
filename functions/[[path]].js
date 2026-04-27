/**
 * CF Pages catch-all Function — transparent proxy for content sub-sites
 *
 * Static assets in dist/ take precedence over this function (CF Pages
 * behaviour), so hub-owned pages like /essays/ and /signals/ are served
 * from the static build without ever reaching here.  All other paths
 * under the proxy prefixes below are forwarded to their respective
 * *.pages.dev projects.
 *
 * Note: _redirects 200 proxy rules are silently ignored on *.pages.dev
 * domains; this Function is the correct mechanism for cross-origin proxying
 * in Cloudflare Pages.
 */

const PROXY_ROUTES = [
  { prefix: '/essays/',                   backend: 'https://wh-essays.pages.dev' },
  { prefix: '/signals/',                  backend: 'https://wh-signals.pages.dev' },
  { prefix: '/computational-geography/', backend: 'https://wh-computational-geography.pages.dev' },
  { prefix: '/mathematics/',             backend: 'https://wh-mathematics.pages.dev' },
  { prefix: '/math-for-data-science-ai/', backend: 'https://wh-math-ds-ai.pages.dev' },
  { prefix: '/data-engineering/',        backend: 'https://wh-data-engineering.pages.dev' },
  { prefix: '/systems-thinking/',        backend: 'https://wh-systems-thinking.pages.dev' },
  { prefix: '/gearlab/',                 backend: 'https://wh-gearlab.pages.dev' },
];

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname;

  for (const { prefix, backend } of PROXY_ROUTES) {
    const base = prefix.slice(0, -1); // e.g. '/essays'

    if (path === base || path.startsWith(prefix)) {
      // Compute the sub-path to forward to the backend
      let subpath;
      if (path === base || path === prefix) {
        subpath = '/';
      } else {
        // Strip prefix, keep leading slash
        subpath = '/' + path.slice(prefix.length);
        // Strip trailing slash — Quarto outputs slug.html; CF Pages normalises
        // to /slug (no slash).  A trailing slash would cause a 308 loop.
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
        // GET/HEAD have no body; body only for POST etc.
        body: ['GET', 'HEAD'].includes(context.request.method)
          ? undefined
          : context.request.body,
        redirect: 'follow',
      });

      return proxied;
    }
  }

  // Not a proxied path — fall through to static assets / hub 404
  return context.next();
}
