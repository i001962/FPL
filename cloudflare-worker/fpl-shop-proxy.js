export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname === "/" ? "/index.html" : url.pathname;

    const upstream = new URL(
      `https://qstorage.quilibrium.com/footy/static-shop-template${path}`,
    );
    upstream.search = url.search;

    return fetch(new Request(upstream, request));
  },
};
