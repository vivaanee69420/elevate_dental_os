"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fileRepository = void 0;
// ============================================================================
// File repository — S3 presign + Supabase data access for the files domain.
// ============================================================================
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const crypto_1 = require("crypto");
const supabase_1 = require("../lib/supabase");
const s3 = new client_s3_1.S3Client({ region: 'eu-west-2' });
const BUCKET = process.env.S3_BUCKET || 'elevate-files-eu-west-2';
exports.fileRepository = {
    buildKey(orgId, filename) {
        return `${orgId}/${(0, crypto_1.randomUUID)()}-${filename}`;
    },
    async presignUpload(key, contentType) {
        const command = new client_s3_1.PutObjectCommand({
            Bucket: BUCKET,
            Key: key,
            ContentType: contentType,
            ServerSideEncryption: 'aws:kms',
        });
        return (0, s3_request_presigner_1.getSignedUrl)(s3, command, { expiresIn: 300 });
    },
    async insert(row) {
        const { data } = await supabase_1.serviceClient
            .from('files')
            .insert(row)
            .select()
            .single();
        return data;
    },
    async list(orgId) {
        const { data } = await supabase_1.serviceClient
            .from('files')
            .select('*')
            .eq('organisation_id', orgId)
            .order('created_at', { ascending: false })
            .limit(100);
        return data;
    },
};
