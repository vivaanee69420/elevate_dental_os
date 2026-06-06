// ============================================================================
// File repository — S3 presign + Supabase data access for the files domain.
// ============================================================================
import * as client_s3_1 from "@aws-sdk/client-s3";
import * as s3_request_presigner_1 from "@aws-sdk/s3-request-presigner";
import * as crypto_1 from "crypto";
import * as supabase_1 from "../lib/supabase.js";
const s3 = new client_s3_1.S3Client({ region: 'eu-west-2' });
const BUCKET = process.env.S3_BUCKET || 'elevate-files-eu-west-2';
export const fileRepository = {
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
    // Presign a short-lived S3 GET so the browser can download an object the
    // backend has already authorised. `filename` (optional) sets a download
    // name via Content-Disposition.
    async presignDownload(key, filename) {
        const command = new client_s3_1.GetObjectCommand({
            Bucket: BUCKET,
            Key: key,
            ResponseContentDisposition: filename
                ? `attachment; filename="${filename.replace(/"/g, '')}"`
                : undefined,
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
