import type { NextFunction, Request, Response } from 'express';

/**
 * Some proxies (Azure App Service's front end, Application Gateway) write "ip:port" into X-Forwarded-For. Express
 * can't parse that, so every connection would look like a different client (one rate-limit bucket each) and audit
 * logs would carry ports. Strip the ports before Express reads the header (D-081).
 */
export function stripForwardedPorts(header: string): string {
  return header
    .split(',')
    .map((part) => {
      const entry = part.trim();
      const v4 = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(entry);
      if (v4) return v4[1]!;
      const v6 = /^\[([0-9a-fA-F:.]+)\](?::\d+)?$/.exec(entry);
      return v6 ? v6[1]! : entry;
    })
    .join(', ');
}

export function forwardedForMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers['x-forwarded-for'];
  if (typeof header === 'string' && header.includes(':')) req.headers['x-forwarded-for'] = stripForwardedPorts(header);
  next();
}
