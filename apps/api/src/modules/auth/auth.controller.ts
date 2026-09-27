import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AppEnv, type EnvironmentVariables } from '../../config/env.validation.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { AuthService } from './auth.service.js';
import {
  ChangePasswordDto,
  DisableTwoFactorDto,
  LoginDto,
  RefreshTokenDto,
  RegenerateRecoveryCodesDto,
  TwoFactorCodeDto,
  TwoFactorLoginDto,
} from './dto/auth.dto.js';
import { clearRefreshCookie, deliverTokens, readRefreshCookie } from './refresh-cookie.js';
import type { ClientInfo } from './token.service.js';
import { TwoFactorService } from './two-factor/two-factor.service.js';

/** Stricter rate limit for credential endpoints: 10 per minute per IP. */
const CREDENTIAL_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  /** Secure cookies everywhere except local development/test over plain http. */
  private readonly secureCookies: boolean;

  constructor(
    private readonly auth: AuthService,
    private readonly twoFactor: TwoFactorService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    const env = config.get('APP_ENV', { infer: true });
    this.secureCookies = env !== AppEnv.Development && env !== AppEnv.Test;
  }

  @Public()
  @Throttle(CREDENTIAL_LIMIT)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto.email, dto.password, clientInfo(req));
    return 'requires2FA' in result ? result : deliverTokens(req, res, result, this.secureCookies);
  }

  @Public()
  @Throttle(CREDENTIAL_LIMIT)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = dto.refreshToken ?? readRefreshCookie(req);
    if (!token) throw new UnauthorizedException('Session expired. Please log in again.');
    try {
      return deliverTokens(req, res, await this.auth.refresh(token, clientInfo(req)), this.secureCookies);
    } catch (error) {
      if (!dto.refreshToken) clearRefreshCookie(res, this.secureCookies);
      throw error;
    }
  }

  /** Public so a client whose access token already expired can still end its session. */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = dto.refreshToken ?? readRefreshCookie(req);
    if (token) await this.auth.logout(token, clientInfo(req));
    clearRefreshCookie(res, this.secureCookies);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  /** Second login step for users with 2FA: exchanges the challenge token + a TOTP code for a session. */
  @Public()
  @Throttle(CREDENTIAL_LIMIT)
  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  async verifyTwoFactor(@Body() dto: TwoFactorLoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.verifyTwoFactorLogin(
      dto.twoFactorToken,
      { code: dto.code, recoveryCode: dto.recoveryCode },
      clientInfo(req),
    );
    return deliverTokens(req, res, result, this.secureCookies);
  }

  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  setupTwoFactor(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.twoFactor.setup(user, clientInfo(req));
  }

  @Throttle(CREDENTIAL_LIMIT)
  /** Turns 2FA on and returns 10 one-time backup codes — the only time they are shown. */
  @Post('2fa/enable')
  @HttpCode(HttpStatus.OK)
  enableTwoFactor(@CurrentUser() user: AuthUser, @Body() dto: TwoFactorCodeDto, @Req() req: Request) {
    return this.twoFactor.enable(user, dto.code, clientInfo(req));
  }

  /** Replaces all backup codes with a new set (password + current authenticator code required). */
  @Throttle(CREDENTIAL_LIMIT)
  @Post('2fa/recovery-codes')
  @HttpCode(HttpStatus.OK)
  regenerateRecoveryCodes(
    @CurrentUser() user: AuthUser,
    @Body() dto: RegenerateRecoveryCodesDto,
    @Req() req: Request,
  ) {
    return this.twoFactor.regenerateRecoveryCodes(user, dto.password, dto.code, clientInfo(req));
  }

  @Throttle(CREDENTIAL_LIMIT)
  @Post('2fa/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  async disableTwoFactor(@CurrentUser() user: AuthUser, @Body() dto: DisableTwoFactorDto, @Req() req: Request) {
    await this.twoFactor.disable(user, dto.password, dto.code, clientInfo(req));
  }

  @Throttle(CREDENTIAL_LIMIT)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.auth.changePassword(user, dto.currentPassword, dto.newPassword, clientInfo(req));
    return deliverTokens(req, res, tokens, this.secureCookies);
  }
}

function clientInfo(req: Request): ClientInfo {
  return { ipAddress: req.ip, userAgent: req.header('user-agent') };
}
