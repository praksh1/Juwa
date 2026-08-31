export default {
  fetch(request, env) {
    const url = new URL(request.url);

    // Cloudflare's static-asset router previously returned the full site over
    // plain HTTP. Redirect before serving any HTML so sign-in and game traffic
    // always use the encrypted origin.
    if (url.protocol === 'http:') {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }

    return env.ASSETS.fetch(request);
  },
};
