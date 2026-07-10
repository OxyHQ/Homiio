import type { Request, Response } from 'express';
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';

import { logger } from '../../middlewares/logging';
import {
  Profile,
  getUserId,
  ok,
  err,
  setStreamingHeaders,
  onGracefulClose,
} from './shared';
import {
  CONTRACT_SYSTEM_FILE_PROMPT,
  IMG_SYSTEM_PROMPT,
} from '../../services/aiService';

const PDF_FALLBACK_MSG =
  'I couldn’t read this PDF. Please share a text version or try an OCR scan, and I’ll review it.';
const IMG_FALLBACK_MSG =
  'I couldn’t extract clear details from this image. Please try a clearer photo, or describe what you’d like me to look for.';

export async function analyzeFile(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, 'Unauthorized');

    const activeProfile = await Profile.findByOxyUserId(userId);
    if (!activeProfile) return err(res, 404, 'No active profile found');

    const file = (req as any).file as any | undefined;
    if (!file?.buffer) return err(res, 400, 'file is required (multipart/form-data, key: file)');

    const mediaType = file.mimetype || 'application/octet-stream';
    const userTextRaw: string = typeof (req as any).body?.text === 'string' ? (req as any).body.text : '';
    const userText = userTextRaw.trim().slice(0, 2000);
    const buffer = file.buffer;

    if (mediaType.startsWith('application/pdf')) {
      try {
        const result = await streamText({
          model: openai('gpt-4o-mini'),
          system: CONTRACT_SYSTEM_FILE_PROMPT,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: userText || 'Please review this lease/contract and advise.' },
                {
                  type: 'file',
                  data: buffer,
                  mediaType: 'application/pdf',
                  filename: file.originalname || 'upload.pdf',
                },
              ],
            },
          ],
          maxTokens: 700,
          temperature: 0.2,
        } as any);
        let out = '';
        for await (const c of result.textStream) out += c;
        const trimmed = out.trim();
        return ok(res, { output: trimmed || PDF_FALLBACK_MSG, filename: file.originalname, mediaType });
      } catch (e) {
        logger.warn('PDF native model path failed, falling back to pdf-parse', {
          error: (e as Error)?.message,
        });
        const pdfParse = require('pdf-parse');
        const parsedText = await pdfParse(buffer).then((r: any) => String(r?.text || ''));
        const clipped = parsedText.slice(0, 120000);
        const result = await streamText({
          model: openai('gpt-4o'),
          system: CONTRACT_SYSTEM_FILE_PROMPT,
          messages: [
            {
              role: 'user',
              content: `${userText || 'Please review this lease/contract and advise.'}\n\n${clipped}`,
            },
          ],
          maxTokens: 700,
          temperature: 0.2,
        } as any);
        let out = '';
        for await (const c of result.textStream) out += c;
        const trimmed = out.trim();
        return ok(res, { output: trimmed || PDF_FALLBACK_MSG, filename: file.originalname, mediaType });
      }
    }

    if (mediaType.startsWith('image/')) {
      const promptText =
        userText ||
        'Describe what this image shows that is relevant to a housing issue (e.g., damages, mold, notices). Be concise and helpful to a tenant.';
      const result = await streamText({
        model: openai('gpt-4o'),
        system: IMG_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: promptText },
              { type: 'image', image: buffer },
            ],
          },
        ],
        maxTokens: 512,
        temperature: 0.2,
      } as any);
      let out = '';
      for await (const c of result.textStream) out += c;
      const trimmed = out.trim();
      return ok(res, { output: trimmed || IMG_FALLBACK_MSG, filename: file.originalname, mediaType });
    }

    return err(res, 415, 'Unsupported media type. Please upload an image (png/jpeg/webp) or a PDF.');
  } catch (e: any) {
    logger.error('analyzeFile failed', { error: e?.message });
    return err(res, 500, 'internal error');
  }
}

export async function analyzeFileStream(req: Request, res: Response) {
  try {
    setStreamingHeaders(res);
    if (!res.getHeader('Access-Control-Allow-Origin')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    }

    const userId = getUserId(req);
    if (!userId) return err(res, 401, 'Unauthorized');

    const activeProfile = await Profile.findByOxyUserId(userId);
    if (!activeProfile) return err(res, 404, 'No active profile found');

    const file = (req as any).file as any | undefined;
    if (!file?.buffer) return err(res, 400, 'file is required (multipart/form-data, key: file)');

    const mediaType = file.mimetype || 'application/octet-stream';
    const userTextRaw: string = typeof (req as any).body?.text === 'string' ? (req as any).body.text : '';
    const userText = userTextRaw.trim().slice(0, 2000);
    const buffer = file.buffer;

    let result: any;

    if (mediaType.startsWith('application/pdf')) {
      try {
        result = await streamText({
          model: openai('gpt-4o-mini'),
          system: CONTRACT_SYSTEM_FILE_PROMPT,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: userText || 'Please review this lease/contract and advise.' },
                {
                  type: 'file',
                  data: buffer,
                  mediaType: 'application/pdf',
                  filename: file.originalname || 'upload.pdf',
                },
              ],
            },
          ],
          maxTokens: 700,
          temperature: 0.2,
        } as any);
      } catch (e) {
        logger.warn('PDF native model path failed in stream, falling back to pdf-parse', {
          error: (e as Error)?.message,
        });
        const pdfParse = require('pdf-parse');
        const parsedText = await pdfParse(buffer).then((r: any) => String(r?.text || ''));
        const clipped = parsedText.slice(0, 120000);
        result = await streamText({
          model: openai('gpt-4o'),
          system: CONTRACT_SYSTEM_FILE_PROMPT,
          messages: [
            {
              role: 'user',
              content: `${userText || 'Please review this lease/contract and advise.'}\n\n${clipped}`,
            },
          ],
          maxTokens: 700,
          temperature: 0.2,
        } as any);
      }
    } else if (mediaType.startsWith('image/')) {
      const promptText =
        userText ||
        'Describe what this image shows that is relevant to a housing issue (e.g., damages, mold, notices). Be concise and helpful to a tenant.';
      result = await streamText({
        model: openai('gpt-4o'),
        system: IMG_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: promptText },
              { type: 'image', image: buffer },
            ],
          },
        ],
        maxTokens: 512,
        temperature: 0.2,
      } as any);
    } else {
      return err(res, 415, 'Unsupported media type. Please upload an image (png/jpeg/webp) or a PDF.');
    }

    onGracefulClose(req, res);
    await result.pipeDataStreamToResponse(res);
  } catch (e: any) {
    if ((res as any).headersSent) {
      try {
        (res as any).end?.();
      } catch (closeErr) {
        // best-effort: response already closed
      }
      return;
    }
    logger.error('analyzeFileStream failed', { error: e?.message });
    return err(res, 500, 'internal error');
  }
}
