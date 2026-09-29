import { Body, Controller, ForbiddenException, Headers, HttpCode, HttpStatus, NotFoundException, Post, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { IvrService } from './ivr.service.js';
import { validTwilioSignature } from './twilio.js';

type TwilioForm = Record<string, string>;

/**
 * Twilio Voice webhooks for telephony EVV (D-073). Public — Twilio can't sign in — but **every request must carry a
 * valid X-Twilio-Signature** for the exact URL Twilio called (TWILIO_WEBHOOK_BASE_URL + path + query), so nobody else
 * can clock anyone in. Off (404) until TWILIO_AUTH_TOKEN and TWILIO_WEBHOOK_BASE_URL are set.
 */
@ApiExcludeController()
@Public()
@Controller('ivr/voice')
export class IvrController {
  constructor(
    private readonly ivr: IvrService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async incoming(@Req() req: Request, @Res() res: Response, @Body() body: TwilioForm, @Headers('x-twilio-signature') sig?: string) {
    this.verify(req, body, sig);
    this.send(res, await this.ivr.incoming(body.From ?? ''));
  }

  @Post('code')
  @HttpCode(HttpStatus.OK)
  async code(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: TwilioForm,
    @Query('tries') tries: string,
    @Headers('x-twilio-signature') sig?: string,
  ) {
    this.verify(req, body, sig);
    this.send(res, await this.ivr.code(body.From ?? '', body.Digits ?? '', Math.max(1, Number(tries) || 1)));
  }

  @Post('action')
  @HttpCode(HttpStatus.OK)
  async action(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: TwilioForm,
    @Query('visit') visit: string,
    @Query('staff') staff: string,
    @Headers('x-twilio-signature') sig?: string,
  ) {
    this.verify(req, body, sig);
    const uuid = /^[0-9a-f-]{36}$/i;
    if (!uuid.test(visit ?? '') || !uuid.test(staff ?? '')) throw new ForbiddenException();
    this.send(res, await this.ivr.action(body.From ?? '', body.Digits ?? '', visit, staff));
  }

  private verify(req: Request, body: TwilioForm, signature: string | undefined): void {
    const token = this.config.get('TWILIO_AUTH_TOKEN', { infer: true });
    const base = this.config.get('TWILIO_WEBHOOK_BASE_URL', { infer: true });
    if (!token || !base) throw new NotFoundException();
    const url = `${base.replace(/\/$/, '')}${req.originalUrl}`;
    const params = Object.fromEntries(Object.entries(body ?? {}).map(([k, v]) => [k, String(v)]));
    if (!validTwilioSignature(token, url, params, signature)) throw new ForbiddenException('Invalid signature');
  }

  private send(res: Response, xml: string): void {
    res.status(HttpStatus.OK).type('text/xml').send(xml);
  }
}
