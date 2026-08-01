// Shared Cloudflare R2 (S3-compatible) client — extracted from routes/auth.js
// (avatar upload) and routes/seller.js (product images), which each carried
// their own copy of this before seller_documents (private bucket) became a
// third consumer. Only the client factory + signed-GET-URL helper live here;
// each route still owns its own multer setup/limits/fileFilter since those
// differ per upload (avatar vs product images vs documents).
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const https = require('https');

// Lazy/optional — @aws-sdk/s3-request-presigner is a newer addition than
// @aws-sdk/client-s3 (added for seller_documents signed URLs). Requiring it
// lazily means this whole module still loads fine (getR2Client keeps working
// for the existing public-bucket uploads) even before `npm install` has run
// on a given machine/deploy — getSignedGetUrl is simply unavailable until then.
let getSignedUrl;
try {
  getSignedUrl = require('@aws-sdk/s3-request-presigner').getSignedUrl;
} catch(e) {
  console.warn('[R2] @aws-sdk/s3-request-presigner not installed yet — signed URLs (seller documents) unavailable. Run: npm install');
}

function getR2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    requestHandler: new NodeHttpHandler({
      httpsAgent: new https.Agent({ secureProtocol: 'TLSv1_2_method', rejectUnauthorized: true }),
    }),
  });
}

// For the private seller-documents bucket only — never a durable URL (see
// db.js's seller_documents comment): callers must generate one of these per
// request, not store it. Default 10 minutes, long enough for an admin/seller
// to load a document detail page and view the file.
async function getSignedGetUrl(bucket, key, expiresIn = 600) {
  const r2 = getR2Client();
  return getSignedUrl(r2, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
}

module.exports = { getR2Client, getSignedGetUrl };
