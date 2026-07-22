// Generic zod-schema-to-Express-middleware adapter. Route files define their
// own schemas locally (colocated with the routes they guard) and pass them
// here — this file has no knowledge of what's being validated.
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const issue = result.error.issues[0];
      const field = issue?.path?.length ? issue.path.join('.') : null;
      return res.status(400).json({
        error: field ? `${field}: ${issue.message}` : (issue?.message || 'Invalid request.'),
        code: 'VALIDATION_ERROR',
      });
    }
    req[source] = result.data;
    next();
  };
}

// Shared by any route that writes an uploaded file's extension into a
// storage key (R2 avatar/product-image uploads) — derives the extension
// from the already-validated mimetype instead of the client-controlled
// original filename, which could otherwise inject arbitrary characters.
const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
  'image/gif':  'gif',
};

module.exports = { validate, MIME_EXT };
