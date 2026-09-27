import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
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
import type { ClientInfo } from './token.service.js';
import { TwoFactorService } from './two-factor/two-factor.service.js';

/** Stricter rate limit for credential endpoints: 10 per minute per IP. */
const CREDENTIAL_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  @Public()
  @Throttle(CREDENTIAL_LIMIT)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto.email, dto.password, clientInfo(req));
  }

  @Public()
  @Throttle(CREDENTIAL_LIMIT)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, clientInfo(req));
  }

  /** Public so a client whose access token already expired can still end its session. */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshTokenDto, @Req() req: Request): Promise<void> {
    await this.auth.logout(dto.refreshToken, clientInfo(req));
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
  verifyTwoFactor(@Body() dto: TwoFactorLoginDto, @Req() req: Request) {
    return this.auth.verifyTwoFactorLogin(
      dto.twoFactorToken,
      { code: dto.code, recoveryCode: dto.recoveryCode },
      clientInfo(req),
    );
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
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto, @Req() req: Request) {
    return this.auth.changePassword(user, dto.currentPassword, dto.newPassword, clientInfo(req));
  }
}

function clientInfo(req: Request): ClientInfo {
  return { ipAddress: req.ip, userAgent: req.header('user-agent') };
}
