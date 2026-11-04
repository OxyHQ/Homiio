import type { NextFunction, Request, Response } from 'express';

/**
 * The request every controller handles: its route parameters are strings.
 *
 * Express 5 types `req.params` values as `string | string[]`, because a
 * `*splat` segment captures an array. A `:name` segment is always one string,
 * and no controller taking this type is mounted on a splat route — the one
 * splat route, the legacy image door, reads its tail from a plain `Request`
 * (`imageController.serveLegacyImage`).
 */
export type ControllerRequest = Request<Record<string, string>>;
export type ControllerResponse = Response;
export type ControllerNext = NextFunction;
