import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Audit } from '../../common/decorators/audit.decorator.js';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { Permissions } from '../../common/decorators/permissions.decorator.js';
import { AuthModule } from '../auth/auth.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { ListMessagesQueryDto } from '../messaging/dto/messaging.dto.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { PatientsModule } from '../patients/patients.module.js';
import { GrantPortalAccessDto, PortalMessageDto } from './dto/portal.dto.js';
import { PortalAccessService } from './portal-access.service.js';
import { PortalUserGuard } from './portal.guard.js';
import { PortalService } from './portal.service.js';

const uuid = () => new ParseUUIDPipe();
const AUDIT = { resourceType: 'patients', idParam: 'patientId' } as const;

/** Staff: who can sign in to the portal for this patient (D-058). */
@ApiTags('portal-access')
@Controller('patients/:patientId/portal-access')
export class PortalAccessController {
  constructor(private readonly access: PortalAccessService) {}

  @Permissions('patients:read')
  @Get()
  get(@CurrentUser() caller: AuthUser, @Param('patientId', uuid()) patientId: string) {
    return this.access.get(caller, patientId);
  }

  /** Creates or links the portal account. A new account's temporary password is in the response, once. */
  @Permissions('patients:update')
  @Audit({ action: 'GRANT_PORTAL_ACCESS', ...AUDIT })
  @Post()
  grant(@CurrentUser() caller: AuthUser, @Param('patientId', uuid()) patientId: string, @Body() dto: GrantPortalAccessDto) {
    return this.access.grant(caller, patientId, dto);
  }

  @Permissions('patients:update')
  @Audit({ action: 'RESET_PORTAL_PASSWORD', ...AUDIT })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@CurrentUser() caller: AuthUser, @Param('patientId', uuid()) patientId: string) {
    return this.access.resetPassword(caller, patientId);
  }

  @Permissions('patients:update')
  @Audit({ action: 'REVOKE_PORTAL_ACCESS', ...AUDIT })
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@CurrentUser() caller: AuthUser, @Param('patientId', uuid()) patientId: string) {
    return this.access.revoke(caller, patientId);
  }
}

/** The patient portal API (DESIGN.md §6.14, D-058). Portal users only; each sees only their linked patients. */
@ApiTags('portal')
@UseGuards(PortalUserGuard)
@Controller('portal')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get('me')
  me(@CurrentUser() caller: AuthUser) {
    return this.portal.me(caller);
  }

  @Audit({ action: 'PORTAL_VIEW_PROFILE', ...AUDIT })
  @Get('patients/:patientId/profile')
  profile(@CurrentUser() caller: AuthUser, @Param('patientId', uuid()) patientId: string) {
    return this.portal.profile(caller, patientId);
  }

  @Audit({ action: 'PORTAL_VIEW_VISITS', ...AUDIT })
  @Get('patients/:patientId/visits')
  visits(@CurrentUser() caller: AuthUser, @Param('patientId', uuid()) patientId: string) {
    return this.portal.visits(caller, patientId);
  }

  @Audit({ action: 'PORTAL_VIEW_CARE_PLAN', ...AUDIT })
  @Get('patients/:patientId/care-plan')
  carePlan(@CurrentUser() caller: AuthUser, @Param('patientId', uuid()) patientId: string) {
    return this.portal.carePlan(caller, patientId);
  }

  @Audit({ action: 'PORTAL_VIEW_MEDICATIONS', ...AUDIT })
  @Get('patients/:patientId/medications')
  medications(@CurrentUser() caller: AuthUser, @Param('patientId', uuid()) patientId: string) {
    return this.portal.medications(caller, patientId);
  }

  @Audit({ action: 'PORTAL_VIEW_DOCUMENTS', ...AUDIT })
  @Get('patients/:patientId/documents')
  documents(@CurrentUser() caller: AuthUser, @Param('patientId', uuid()) patientId: string) {
    return this.portal.documents(caller, patientId);
  }

  @Audit({ action: 'PORTAL_DOWNLOAD_DOCUMENT', resourceType: 'documents', idParam: 'documentId' })
  @Get('patients/:patientId/documents/:documentId/download')
  async download(
    @CurrentUser() caller: AuthUser,
    @Param('patientId', uuid()) patientId: string,
    @Param('documentId', uuid()) documentId: string,
  ) {
    const file = await this.portal.download(caller, patientId, documentId);
    return new StreamableFile(file.content, {
      type: file.mimeType,
      disposition: `attachment; filename="${file.fileName}"`,
      length: file.content.length,
    });
  }

  /** The conversation with the care team about this patient (newest first). */
  @Audit({ action: 'PORTAL_VIEW_MESSAGES', ...AUDIT })
  @Get('patients/:patientId/messages')
  messages(@CurrentUser() caller: AuthUser, @Param('patientId', uuid()) patientId: string, @Query() query: ListMessagesQueryDto) {
    return this.portal.messages(caller, patientId, query);
  }

  @Audit({ action: 'PORTAL_SEND_MESSAGE', ...AUDIT })
  @Post('patients/:patientId/messages')
  send(@CurrentUser() caller: AuthUser, @Param('patientId', uuid()) patientId: string, @Body() dto: PortalMessageDto) {
    return this.portal.send(caller, patientId, dto.content);
  }

  @Post('patients/:patientId/messages/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  read(@CurrentUser() caller: AuthUser, @Param('patientId', uuid()) patientId: string) {
    return this.portal.markRead(caller, patientId);
  }
}

@Module({
  imports: [AuthModule, PatientsModule, DocumentsModule, MessagingModule],
  controllers: [PortalAccessController, PortalController],
  providers: [PortalAccessService, PortalService, PortalUserGuard],
})
export class PortalModule {}
