// backend/src/controllers/data-room.controller.js
// ============================================================================
// Data Room controller — parse/validate (Zod), call the service, shape HTTP.
// The CSV handler wires Express `res` as the service's sink; if the service
// throws before the first write we still answer JSON through errorHandler,
// after the first write we can only end the (truncated) stream.
// The Excel handler splits that in two: prepareExport() raises every JSON
// status (400/403/404/413) BEFORE the download headers are set, then
// writeXlsx() streams straight into `res`.
// ============================================================================
import { dataRoomService } from "../services/data-room.service.js";
import { getDataset } from "../lib/data-room/registry.js";
import * as data_room_model_1 from "../models/data-room.model.js";
import { AppError } from "../middleware/errors.js";

export const dataRoomController = {
    async datasets(req, res) {
        res.json(dataRoomService.datasets());
    },

    async page(req, res) {
        const { source, dataset } = data_room_model_1.dataRoomParamsSchema.parse(req.params);
        const query = data_room_model_1.dataRoomQuerySchema.parse(req.query);
        res.json(await dataRoomService.page(req.user, source, dataset, query));
    },

    async exportCsv(req, res) {
        const { source, dataset } = data_room_model_1.dataRoomParamsSchema.parse(req.params);
        const query = data_room_model_1.dataRoomQuerySchema.parse(req.query);
        const ds = getDataset(source, dataset);
        if (!ds) throw new AppError('Unknown dataset', 404);

        let aborted = false;
        req.on('close', () => { if (!res.writableEnded) aborted = true; });

        let started = false;
        const sink = {
            write(chunk) {
                if (!started) {
                    started = true;
                    res.status(200);
                    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
                    res.setHeader('Content-Disposition', `attachment; filename="${dataRoomService.exportFilename(ds, query)}"`);
                    res.setHeader('Cache-Control', 'no-store');
                }
                res.write(chunk);
            },
            end() { res.end(); },
        };
        try {
            await dataRoomService.streamCsv(req.user, source, dataset, query, sink, {
                ip: req.ip,
                userAgent: req.headers['user-agent'],
                isAborted: () => aborted,
            });
        } catch (err) {
            if (!started) throw err; // JSON error via errorHandler
            req.log?.error({ err }, 'Data Room export failed mid-stream');
            res.end();
        }
    },

    async freshness(req, res) {
        res.json(await dataRoomService.freshness(req.user));
    },

    async exportXlsx(req, res) {
        const { source, dataset } = data_room_model_1.dataRoomParamsSchema.parse(req.params);
        const query = data_room_model_1.dataRoomQuerySchema.parse(req.query);
        // Everything that can fail with a JSON status happens here, before headers.
        const plan = await dataRoomService.prepareExport(req.user, source, dataset, query);

        let aborted = false;
        req.on('close', () => { if (!res.writableEnded) aborted = true; });

        res.status(200);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${dataRoomService.exportFilename(plan.ds, query, 'xlsx')}"`);
        res.setHeader('Cache-Control', 'no-store');
        try {
            await dataRoomService.writeXlsx(plan, res, {
                ip: req.ip,
                userAgent: req.headers['user-agent'],
                isAborted: () => aborted,
            });
        } catch (err) {
            req.log?.error({ err }, 'Data Room xlsx export failed mid-stream');
            res.end();
        }
    },
};
