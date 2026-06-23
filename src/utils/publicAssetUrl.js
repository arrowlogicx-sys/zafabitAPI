const trimTrailingSlash = (value) => String(value || '').replace(/\/+$/, '');

const resolvePublicAssetUrl = (req, assetUrl) => {
  if (!assetUrl) {
    return null;
  }

  const value = String(assetUrl).trim();
  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  const configuredOrigin = trimTrailingSlash(process.env.PUBLIC_API_BASE_URL);
  const forwardedProto = String(req?.get?.('x-forwarded-proto') || '')
    .split(',')[0]
    .trim();
  const protocol = forwardedProto || req?.protocol || 'http';
  const host = req?.get?.('host');
  const requestOrigin = host ? `${protocol}://${host}` : '';
  const origin = configuredOrigin || requestOrigin;

  if (!origin) {
    return value;
  }

  return `${trimTrailingSlash(origin)}/${value.replace(/^\/+/, '')}`;
};

module.exports = { resolvePublicAssetUrl };
